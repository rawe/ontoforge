/**
 * `RuntimeStore` on PostgreSQL.
 *
 * Instance CRUD on the two generic jsonb tables (`entity`, `relation`).
 * Operation mapping (M3.4):
 *
 * - Ids from the wire pass the strict `isUuid()` guard (`rows.ts`) before
 *   any statement; off-format input short-circuits to the method's
 *   not-found shape — `null` / `false` / empty page / dropped from the
 *   `getEntitiesByIds` batch / empty neighbour list — without touching
 *   the database, keeping 22P02 unreachable from caller input.
 * - Listings are the two-statement `[rows, total]` contract (count,
 *   short-circuit on zero, then page) in one READ COMMITTED transaction;
 *   `getNeighbors` runs both directions in one transaction for `both`
 *   (outgoing takes the whole budget, incoming only the remainder, the
 *   second statement skipped at remainder zero) and door one otherwise.
 * - Writes encode via `json.ts` (`toJson`); reads spread `props` through
 *   `fromJson`, which decodes datetime keys back to JS `Date` wherever
 *   the port supplies property definitions. `getEntity`/`getRelation`
 *   carry none, so their datetime values stay the stored ISO text — the
 *   wire form is byte-identical (the stored text IS `toISOString()`).
 * - Instance rows carry no search data: search reads the search-index
 *   entries (`searchIndexStore.ts`), which every write queues work for in
 *   its own transaction.
 * - Relation deletes and lookups carry the type key in the WHERE — a
 *   mismatched type key answers not-found, which the PK alone would not.
 * - `getFullSchemaWithLensInclusions` is one REPEATABLE READ
 *   transaction (M2.3's coherent-snapshot obligation).
 *
 * - Saved-query discovery, the one vector query here, uses an iterative
 *   scan at its index's own cast width and applies a score floor after
 *   ranking.
 *
 * - `executeOql` compiles the validated query to one SQL SELECT
 *   (`oql/`) and runs it through the array-mode door; the compiled plan
 *   names the columns and drives the value conversion.
 *
 * - The hierarchy reads follow only the parent relations the caller
 *   names; the ancestor walk is one recursive statement with a cycle
 *   guard.
 * - The create with a parent relation writes both rows and their search
 *   work in one transaction.
 * - `transaction` holds the design shared and checks the revision first
 *   (`design.ts`), then hands its work a store bound to one connection: the
 *   two doors, and the ruleset and changeset stores' doors, take the bound
 *   querier instead of the pool. The neutral reads (`parentsOf`,
 *   `childrenOf`, `lockTargets`, `getEntitiesByIdsHashed`,
 *   `getRelationsByIds`, `getEntityTypes`) serve a changeset's checks and commit
 *   validation; `lockTargets` and a locking `childrenOf` hold their rows
 *   only inside a transaction. The entity reads among them fingerprint
 *   document values in SQL, so no document text leaves the database.
 */


import { sameDesign } from "../../core/designRevision.js";
import { DesignChangedError } from "../../core/exceptions.js";
import type { ValidatedQuery } from "../../core/oql/index.js";
import type {
  ChangesetStore,
  DesignRevision,
  FilterCondition,
  LockedTarget,
  NavigatorStore,
  ParentLink,
  Row,
  RulesetStore,
  RuntimeStore,
  SearchIndexStore,
  SearchWritePlan,
} from "../../core/ports.js";
import type { ParentEnd, PropertyDef } from "../../core/schemas.js";
import { SAVED_QUERY_INDEX } from "./ddl.js";
import { holdDesignShared, readDesign } from "./design.js";
import {
  runArrayQuery,
  runQuery,
  withBoundTransaction,
  withTransaction,
  type DbResult,
  type IsolationLevel,
  type Querier,
} from "./errors.js";
import { bindValues, compileOql, convertRows } from "./oql/index.js";
import {
  buildEndpointClauses,
  buildFilterClauses,
  buildOrderBy,
  buildSearchClause,
} from "./filters.js";
import { fromJson, toJson } from "./json.js";
import { camelizeRow, isUuid } from "./rows.js";
import { LENS_COLS, readTypesWithProperties, splitInclusions } from "./schemaRead.js";
import { PostgresChangesetStore } from "./changesetStore.js";
import { PostgresNavigatorStore } from "./navigatorStore.js";
import { PostgresRulesetStore } from "./rulesetStore.js";
import { applySearchWritePlan, PostgresSearchIndexStore } from "./searchIndexStore.js";
import { distance, minScoreFloor, similarity, vectorParams, vectorSearch } from "./search.js";

type PropertyDefs = Record<string, PropertyDef>;

const NO_DEFS: PropertyDefs = {};

// Read column lists.
const ENTITY_COLS = "id, type_key, props, created_at, updated_at";
const RELATION_COLS = "id, type_key, from_id, to_id, props, created_at, updated_at";

// The two instance inserts, shared by the single creates and the create
// with a parent relation.
const INSERT_ENTITY = `INSERT INTO entity (id, type_key, props)
       VALUES ($1, $2, $3::jsonb)
       RETURNING ${ENTITY_COLS}`;
const INSERT_RELATION = `INSERT INTO relation (id, type_key, from_id, to_id, props)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${RELATION_COLS}`;

/** Only saved queries the index can hold: an un-embedded description is
 * invisible to discovery. The predicate says so explicitly, because a
 * plan that does not use the index would otherwise see them. */
const EMBEDDED = "embedding IS NOT NULL";

/** One `entity` row → the port shape: system columns as underscore keys,
 * user properties spread from `props` (datetimes decoded per the defs). */
function entityRow(row: Row, propertyDefs: PropertyDefs): Row {
  return {
    _id: row.id,
    _entityTypeKey: row.type_key,
    _createdAt: row.created_at,
    _updatedAt: row.updated_at,
    ...fromJson(row.props as Row, propertyDefs),
  };
}

/** One `relation` row → the port shape; the endpoint ids are the
 * documented no-underscore exception. Relations carry timestamps. */
function relationRow(row: Row, propertyDefs: PropertyDefs): Row {
  return {
    _id: row.id,
    _relationTypeKey: row.type_key,
    _createdAt: row.created_at,
    _updatedAt: row.updated_at,
    fromEntityId: row.from_id,
    toEntityId: row.to_id,
    ...fromJson(row.props as Row, propertyDefs),
  };
}

/**
 * `${alias}.props` with every string under a document key of its type
 * replaced by its fingerprint, `{sha256, length}`: the hex SHA-256 of
 * its UTF-8 bytes and `char_length`. `keysParam` is jsonb, type key → its
 * document keys. The `OFFSET 0` fences keep each document read out of
 * `props` once, so it is not detoasted again per use.
 */
function fingerprintedProps(alias: string, keysParam: string): string {
  return `(SELECT (${alias}.props - coalesce(array_agg(k), '{}'::text[]))
             || coalesce(jsonb_object_agg(k, jsonb_build_object(
                  'sha256', encode(sha256(convert_to(t, 'UTF8')), 'hex'),
                  'length', char_length(t))), '{}'::jsonb)
           FROM (SELECT k, v #>> '{}' AS t
                   FROM (SELECT k, ${alias}.props -> k AS v
                           FROM jsonb_array_elements_text(${keysParam}::jsonb -> ${alias}.type_key) AS k
                         OFFSET 0) AS keyed
                  WHERE jsonb_typeof(v) = 'string'
                 OFFSET 0) AS documents) AS props`;
}

/** The jsonb text for a props write: datetime `Date`s → ISO text. */
function propsJson(properties: Row, propertyDefs: PropertyDefs): string {
  return JSON.stringify(toJson(properties, propertyDefs));
}

export class PostgresRuntimeStore implements RuntimeStore {
  /** Bound to one ontology and its namespace; unbound (tests only) runs
   * against the connection's default namespace. `bound`: the connection
   * of the transaction `transaction` opened. */
  constructor(
    public readonly ontologyKey: string = "",
    private readonly namespace?: string,
    private readonly bound?: Querier,
  ) {}

  /** Door one, carrying this store's binding. */
  private query(text: string, params?: unknown[]): Promise<DbResult> {
    if (this.bound !== undefined) {
      return this.bound.query(text, params);
    }
    return runQuery(text, params, this.namespace);
  }

  /** Door two, carrying this store's binding. A bound store is already
   * inside its transaction, which cannot change its isolation. */
  private tx<T>(
    work: (querier: Querier) => Promise<T>,
    isolation: IsolationLevel = "READ COMMITTED",
  ): Promise<T> {
    if (this.bound !== undefined) {
      if (isolation !== "READ COMMITTED") {
        throw new Error(`A bound store cannot open a ${isolation} transaction`);
      }
      return work(this.bound);
    }
    return withTransaction(work, isolation, this.namespace);
  }

  designRevision(): Promise<DesignRevision> {
    return readDesign(this.bound, this.namespace);
  }

  transaction<T>(design: DesignRevision, work: (store: RuntimeStore) => Promise<T>): Promise<T> {
    return withBoundTransaction(async (querier) => {
      if (!sameDesign(await holdDesignShared(querier), design)) throw new DesignChangedError();
      return work(new PostgresRuntimeStore(this.ontologyKey, this.namespace, querier));
    }, this.namespace);
  }

  /**
   * One instance write, with the search work it causes in the same
   * transaction when there is any (`applySearchWritePlan`). The work is
   * queued only when the write touched a row; a deletion's work runs
   * first, while the relations it names still exist.
   */
  private write(
    text: string,
    params: unknown[],
    search: SearchWritePlan | null | undefined,
    order: "after" | "before" = "after",
  ): Promise<DbResult> {
    if (search === null || search === undefined) {
      return this.query(text, params);
    }
    return this.tx(async (querier) => {
      if (order === "before") {
        await applySearchWritePlan(querier, search, this.ontologyKey);
      }
      const result = await querier.query(text, params);
      if (order === "after" && result.rowCount > 0) {
        await applySearchWritePlan(querier, search, this.ontologyKey);
      }
      return result;
    });
  }

  // ------------------------------------------------------------------
  // Search indices
  // ------------------------------------------------------------------

  searchIndices(): SearchIndexStore {
    if (this.namespace === undefined) {
      throw new Error("An unbound runtime store has no search indices");
    }
    return new PostgresSearchIndexStore(this.namespace, this.ontologyKey);
  }

  navigators(): NavigatorStore {
    if (this.namespace === undefined) {
      throw new Error("An unbound runtime store has no navigators");
    }
    return new PostgresNavigatorStore(this.namespace);
  }

  rulesets(): RulesetStore {
    if (this.namespace === undefined) {
      throw new Error("An unbound runtime store has no rulesets");
    }
    return new PostgresRulesetStore(this.namespace, this.bound);
  }

  changesets(): ChangesetStore {
    if (this.namespace === undefined) {
      throw new Error("An unbound runtime store has no changesets");
    }
    return new PostgresChangesetStore(this.namespace, this.bound);
  }

  // ------------------------------------------------------------------
  // Declarations
  // ------------------------------------------------------------------

  /** Keyword ranking and path conditions are the search indices': the
   * entries carry stemmed text, and the index query joins each entry to
   * its entity for every condition. */
  supportsKeywordRanking(): boolean {
    return true;
  }

  supportsSearchPathConditions(): boolean {
    return true;
  }

  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  /** The lens, ALL types with their properties, this lens's inclusions
   * and the design revision — one coherent REPEATABLE READ snapshot.
   * Answers null when no lens has the key. */
  async getFullSchemaWithLensInclusions(lensKey: string): Promise<Row | null> {
    return this.tx(async (querier) => {
      const design = await readDesign(querier, this.namespace);
      const lensResult = await querier.query(`SELECT ${LENS_COLS} FROM lens WHERE key = $1`, [
        lensKey,
      ]);
      const lensRow = lensResult.rows[0];
      if (lensRow === undefined) {
        return null;
      }
      const lens = camelizeRow(lensRow);
      const lensId = lens.lensId as string;

      const { entityTypes, relationTypes } = await readTypesWithProperties(querier, false);

      const incs = await querier.query(
        `SELECT oi.properties, et.key AS entity_type_key, rt.key AS relation_type_key
         FROM lens_includes oi
         LEFT JOIN entity_type et ON et.entity_type_id = oi.entity_type_id
         LEFT JOIN relation_type rt ON rt.relation_type_id = oi.relation_type_id
         WHERE oi.lens_id = $1 AND oi.search_index_id IS NULL
         ORDER BY et.key, rt.key`,
        [lensId],
      );
      const { entityInclusions, relationInclusions } = splitInclusions(incs.rows);
      const indexIncs = await querier.query(
        `SELECT si.key FROM lens_includes oi
         JOIN search_index si ON si.search_index_id = oi.search_index_id
         WHERE oi.lens_id = $1 ORDER BY si.key`,
        [lensId],
      );
      const searchIndexInclusions = indexIncs.rows.map((row) => row["key"] as string);

      return {
        lens,
        entityTypes,
        relationTypes,
        entityInclusions,
        relationInclusions,
        searchIndexInclusions,
        design,
      };
    }, "REPEATABLE READ");
  }

  /** AgentConfig rows for one lens, by key. */
  async getAgentConfigs(lensKey: string): Promise<Row[]> {
    const result = await this.query(
      `SELECT ac.key, ac.name, ac.description, ac.system_prompt, ac.tools
       FROM assistant_agent ac
       JOIN lens o ON o.lens_id = ac.lens_id
       WHERE o.key = $1
       ORDER BY ac.name`,
      [lensKey],
    );
    return result.rows.map(camelizeRow);
  }

  /** SavedQuery rows for one lens, by key. */
  async getSavedQueries(lensKey: string): Promise<Row[]> {
    const result = await this.query(
      `SELECT sq.key, sq.name, sq.description, sq.steps, sq.parameters
       FROM saved_query sq
       JOIN lens o ON o.lens_id = sq.lens_id
       WHERE o.key = $1
       ORDER BY sq.name`,
      [lensKey],
    );
    return result.rows.map(camelizeRow);
  }

  // ------------------------------------------------------------------
  // Entity instances
  // ------------------------------------------------------------------

  async createEntity(
    entityTypeKey: string,
    entityId: string,
    properties: Row,
    propertyDefs: PropertyDefs,
    search?: SearchWritePlan | null,
  ): Promise<Row> {
    const result = await this.write(
      INSERT_ENTITY,
      [entityId, entityTypeKey, propsJson(properties, propertyDefs)],
      search,
    );
    return entityRow(result.rows[0]!, propertyDefs);
  }

  /** Count, short-circuit on zero, then page — two statements in one
   * READ COMMITTED transaction; search fragment and filter conditions
   * AND-ed. */
  async listEntities(
    entityTypeKey: string,
    propertyDefs: PropertyDefs,
    filters: FilterCondition[],
    search: string | null,
    searchPropertyKeys: string[],
    sortField: string,
    order: string,
    limit: number,
    offset: number,
  ): Promise<[Row[], number]> {
    const params: unknown[] = [entityTypeKey];
    const where = ["type_key = $1", ...buildFilterClauses(filters, params)];
    if (search !== null && search !== undefined && searchPropertyKeys.length > 0) {
      where.push(buildSearchClause(search, searchPropertyKeys, params));
    }
    const whereSql = where.join(" AND ");

    return this.tx(async (querier) => {
      const total = await countRows(querier, `entity WHERE ${whereSql}`, params);
      if (total === 0) {
        return [[], 0];
      }
      const orderBy = buildOrderBy(sortField, propertyDefs, order, params);
      params.push(limit, offset);
      const page = await querier.query(
        `SELECT ${ENTITY_COLS} FROM entity WHERE ${whereSql}
         ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return [page.rows.map((row) => entityRow(row, propertyDefs)), total];
    });
  }

  async distinctEntityValues(entityTypeKey: string, propertyKey: string, limit: number): Promise<string[]> {
    const result = await this.query(
      `SELECT DISTINCT props->>$2 AS value FROM entity
       WHERE type_key = $1 AND props->>$2 IS NOT NULL AND props->>$2 <> ''
       ORDER BY value LIMIT $3`,
      [entityTypeKey, propertyKey, limit],
    );
    return result.rows.map((row) => String(row["value"]));
  }

  /** No property definitions cross this read (approved M3.1 scope):
   * datetime values stay the stored ISO text — byte-identical on the
   * wire, and no in-process consumer inspects them. */
  async getEntity(entityTypeKey: string, entityId: string): Promise<Row | null> {
    if (!isUuid(entityId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${ENTITY_COLS} FROM entity WHERE type_key = $1 AND id = $2`,
      [entityTypeKey, entityId],
    );
    const row = result.rows[0];
    return row === undefined ? null : entityRow(row, NO_DEFS);
  }

  async getEntityById(entityId: string, propertyDefs: PropertyDefs): Promise<Row | null> {
    if (!isUuid(entityId)) {
      return null;
    }
    const result = await this.query(`SELECT ${ENTITY_COLS} FROM entity WHERE id = $1`, [entityId]);
    const row = result.rows[0];
    return row === undefined ? null : entityRow(row, propertyDefs);
  }

  /** One statement covers the set/remove split; `updated_at` is always
   * stamped (the service short-circuits true no-op payloads above). */
  async updateEntity(
    entityTypeKey: string,
    entityId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: PropertyDefs,
    search?: SearchWritePlan | null,
  ): Promise<Row | null> {
    if (!isUuid(entityId)) {
      return null;
    }
    const result = await this.write(
      `UPDATE entity
       SET props = (props || $3::jsonb) - $4::text[], updated_at = now()
       WHERE type_key = $1 AND id = $2
       RETURNING ${ENTITY_COLS}`,
      [entityTypeKey, entityId, propsJson(setProperties, propertyDefs), removeProperties],
      search,
    );
    const row = result.rows[0];
    return row === undefined ? null : entityRow(row, propertyDefs);
  }

  /** One DELETE; relations (both directions) vanish by CASCADE (M2.2). */
  async deleteEntity(
    entityTypeKey: string,
    entityId: string,
    search?: SearchWritePlan | null,
  ): Promise<boolean> {
    if (!isUuid(entityId)) {
      return false;
    }
    const result = await this.write(
      `DELETE FROM entity WHERE type_key = $1 AND id = $2`,
      [entityTypeKey, entityId],
      search,
      "before",
    );
    return result.rowCount > 0;
  }

  /** Off-format ids are dropped from the batch (they can match no row);
   * an effectively empty batch answers without touching the database. */
  async getEntitiesByIds(
    entityIds: string[],
    propertyDefs: PropertyDefs,
  ): Promise<Record<string, Row>> {
    const validIds = entityIds.filter(isUuid);
    if (validIds.length === 0) {
      return {};
    }
    const result = await this.query(
      `SELECT ${ENTITY_COLS} FROM entity WHERE id = ANY($1::uuid[])`,
      [validIds],
    );
    const entities: Record<string, Row> = {};
    for (const row of result.rows) {
      const entity = entityRow(row, propertyDefs);
      entities[entity._id as string] = entity;
    }
    return entities;
  }

  // ------------------------------------------------------------------
  // Saved-query discovery
  // ------------------------------------------------------------------

  /** Saved-query descriptions for one lens. The lens is a plain
   * query-time predicate: the index carries no scoping of its own. */
  async searchSavedQueries(
    queryEmbedding: number[],
    lensKey: string,
    limit: number,
    minScore: number | null,
  ): Promise<Row[]> {
    const params = vectorParams(queryEmbedding);
    params.push(lensKey, limit);
    const rows = await vectorSearch(
      () => Promise.resolve(SAVED_QUERY_INDEX),
      queryEmbedding,
      params,
      (width) =>
        `SELECT key, name, description, parameters, ${similarity(width)} FROM saved_query
         WHERE lens_key = $2 AND ${EMBEDDED}
         ORDER BY ${distance(width)} LIMIT $3`,
      this.namespace,
    );
    return minScoreFloor(rows, minScore);
  }

  // ------------------------------------------------------------------
  // Relation instances
  // ------------------------------------------------------------------

  /** The service pre-checks both endpoints; if one vanishes between the
   * pre-check and this INSERT, the named FK violation is translated to
   * the exact NotFoundError the pre-check would have raised (M2.3). */
  async createRelation(
    relationTypeKey: string,
    relationId: string,
    fromEntityId: string,
    toEntityId: string,
    properties: Row,
    propertyDefs: PropertyDefs,
    search?: SearchWritePlan | null,
  ): Promise<Row> {
    const result = await this.write(
      INSERT_RELATION,
      [relationId, relationTypeKey, fromEntityId, toEntityId, propsJson(properties, propertyDefs)],
      search,
    );
    return relationRow(result.rows[0]!, propertyDefs);
  }

  async listRelations(
    relationTypeKey: string,
    propertyDefs: PropertyDefs,
    filters: FilterCondition[],
    fromEntityId: string | null,
    toEntityId: string | null,
    sortField: string,
    order: string,
    limit: number,
    offset: number,
  ): Promise<[Row[], number]> {
    // Endpoint filters ride the indexed uuid columns; a present but
    // off-format id can match no row — the empty page, never a 22P02.
    const from = fromEntityId ? fromEntityId : null;
    const to = toEntityId ? toEntityId : null;
    if ((from !== null && !isUuid(from)) || (to !== null && !isUuid(to))) {
      return [[], 0];
    }
    const params: unknown[] = [relationTypeKey];
    const where = [
      "type_key = $1",
      ...buildFilterClauses(filters, params),
      ...buildEndpointClauses(from, to, params),
    ];
    const whereSql = where.join(" AND ");

    return this.tx(async (querier) => {
      const total = await countRows(querier, `relation WHERE ${whereSql}`, params);
      if (total === 0) {
        return [[], 0];
      }
      const orderBy = buildOrderBy(sortField, propertyDefs, order, params);
      params.push(limit, offset);
      const page = await querier.query(
        `SELECT ${RELATION_COLS} FROM relation WHERE ${whereSql}
         ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return [page.rows.map((row) => relationRow(row, propertyDefs)), total];
    });
  }

  /** No property definitions cross this read — see `getEntity`. */
  async getRelation(relationTypeKey: string, relationId: string): Promise<Row | null> {
    if (!isUuid(relationId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${RELATION_COLS} FROM relation WHERE type_key = $1 AND id = $2`,
      [relationTypeKey, relationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : relationRow(row, NO_DEFS);
  }

  async updateRelation(
    relationTypeKey: string,
    relationId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: PropertyDefs,
    search?: SearchWritePlan | null,
  ): Promise<Row | null> {
    if (!isUuid(relationId)) {
      return null;
    }
    const result = await this.write(
      `UPDATE relation
       SET props = (props || $3::jsonb) - $4::text[], updated_at = now()
       WHERE type_key = $1 AND id = $2
       RETURNING ${RELATION_COLS}`,
      [relationTypeKey, relationId, propsJson(setProperties, propertyDefs), removeProperties],
      search,
    );
    const row = result.rows[0];
    return row === undefined ? null : relationRow(row, propertyDefs);
  }

  /** One DELETE; neither endpoint is touched. */
  async deleteRelation(
    relationTypeKey: string,
    relationId: string,
    search?: SearchWritePlan | null,
  ): Promise<boolean> {
    if (!isUuid(relationId)) {
      return false;
    }
    const result = await this.write(
      `DELETE FROM relation WHERE type_key = $1 AND id = $2`,
      [relationTypeKey, relationId],
      search,
      "before",
    );
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // OQL
  // ------------------------------------------------------------------

  /**
   * Compile a validated OQL query to one SQL SELECT and run it bare
   * through door one — a single statement needs no transaction, and the
   * compiler has no code path that emits anything but a SELECT, so
   * read-only holds by construction rather than by a session mode.
   *
   * The validated query crosses the port opaque (`core/ports.ts` rule 1);
   * parameters arrive separately as a map (empty for ad-hoc queries —
   * binding is a saved-query concern) and are resolved against the
   * compiled bind plan here, never spliced into the text.
   */
  async executeOql(validated: ValidatedQuery, params: Row = {}): Promise<[string[], Row[]]> {
    const compiled = compileOql(validated);
    const rows = await runArrayQuery(compiled.sql, bindValues(compiled, params), this.namespace);
    return [compiled.columns, convertRows(compiled, rows)];
  }

  // ------------------------------------------------------------------
  // Graph traversal
  // ------------------------------------------------------------------

  /**
   * Adjacent relations paired with the entities at the far end. For
   * `both` the limit is ONE shared budget: outgoing edges are taken
   * first, up to the whole limit, and incoming edges receive only the
   * remainder — the documented trap
   * (`docs/capabilities/instance-data.md#traversal`). No ORDER BY:
   * neighbour order is arbitrary.
   */
  async getNeighbors(
    entityId: string,
    direction: string,
    relationTypeKey: string | null,
    limit: number,
    propertyDefsByType: Record<string, PropertyDefs>,
  ): Promise<Row[]> {
    if (!isUuid(entityId)) {
      return [];
    }

    if (direction === "both") {
      return this.tx(async (querier) => {
        const outgoing = await neighborPage(
          querier,
          "outgoing",
          entityId,
          relationTypeKey,
          limit,
          propertyDefsByType,
        );
        const remaining = limit - outgoing.length;
        if (remaining <= 0) {
          return outgoing;
        }
        const incoming = await neighborPage(
          querier,
          "incoming",
          entityId,
          relationTypeKey,
          remaining,
          propertyDefsByType,
        );
        return [...outgoing, ...incoming];
      });
    }

    return neighborPage(
      { query: (text, params) => this.query(text, params) },
      direction === "outgoing" ? "outgoing" : "incoming",
      entityId,
      relationTypeKey,
      limit,
      propertyDefsByType,
    );
  }

  // ------------------------------------------------------------------
  // Hierarchy
  // ------------------------------------------------------------------

  /**
   * One recursive statement. Each level is one probe per reading end on
   * the `to_id` / `from_id` indexes: a `source` reading finds the parent
   * at `from_id` of a row whose `to_id` is the child, a `target` reading
   * the other way round. The cycle guard stops a branch at an entity
   * already on its path, the start included.
   */
  async getAncestors(
    entityId: string,
    readings: Record<string, ParentEnd>,
  ): Promise<{ type: string; id: string }[]> {
    const [sourceKeys, targetKeys] = splitReadings(readings);
    if (!isUuid(entityId) || sourceKeys.length + targetKeys.length === 0) {
      return [];
    }
    const result = await this.query(
      `WITH RECURSIVE walk (id, depth, path) AS (
         SELECT $1::uuid, 0, ARRAY[$1::uuid]
         UNION ALL
         SELECT p.id, w.depth + 1, w.path || p.id
           FROM walk w
           CROSS JOIN LATERAL (
             SELECT r.from_id AS id FROM relation r
              WHERE r.to_id = w.id AND r.type_key = ANY($2::text[])
             UNION ALL
             SELECT r.to_id FROM relation r
              WHERE r.from_id = w.id AND r.type_key = ANY($3::text[])
           ) p
          WHERE NOT (p.id = ANY(w.path))
       )
       SELECT e.type_key, w.id, min(w.depth) AS depth
         FROM walk w JOIN entity e ON e.id = w.id
        WHERE w.depth > 0
        GROUP BY w.id, e.type_key
        ORDER BY depth, e.type_key, w.id`,
      [entityId, sourceKeys, targetKeys],
    );
    return result.rows.map((row) => ({ type: row.type_key as string, id: row.id as string }));
  }

  async hasChildren(entityId: string, readings: Record<string, ParentEnd>): Promise<boolean> {
    const [sourceKeys, targetKeys] = splitReadings(readings);
    if (!isUuid(entityId) || sourceKeys.length + targetKeys.length === 0) {
      return false;
    }
    const result = await this.query(
      `SELECT EXISTS (SELECT 1 FROM relation WHERE from_id = $1 AND type_key = ANY($2::text[]))
           OR EXISTS (SELECT 1 FROM relation WHERE to_id = $1 AND type_key = ANY($3::text[]))
           AS has_children`,
      [entityId, sourceKeys, targetKeys],
    );
    return result.rows[0]!.has_children as boolean;
  }

  /** Both inserts in one transaction, each followed by its own search
   * work, as `write` applies it to a single create. The relation insert
   * fails on a vanished parent (`relation_from_fk` / `relation_to_fk`),
   * which rolls the entity back too. */
  async createEntityWithParent(
    entity: {
      entityTypeKey: string;
      entityId: string;
      properties: Row;
      propertyDefs: PropertyDefs;
      search?: SearchWritePlan | null;
    },
    relation: {
      relationTypeKey: string;
      relationId: string;
      fromEntityId: string;
      toEntityId: string;
      properties: Row;
      propertyDefs: PropertyDefs;
      search?: SearchWritePlan | null;
    },
  ): Promise<{ entity: Row; relation: Row }> {
    return this.tx(async (querier) => {
      const entityResult = await querier.query(INSERT_ENTITY, [
        entity.entityId,
        entity.entityTypeKey,
        propsJson(entity.properties, entity.propertyDefs),
      ]);
      if (entity.search !== null && entity.search !== undefined) {
        await applySearchWritePlan(querier, entity.search, this.ontologyKey);
      }
      const relationResult = await querier.query(INSERT_RELATION, [
        relation.relationId,
        relation.relationTypeKey,
        relation.fromEntityId,
        relation.toEntityId,
        propsJson(relation.properties, relation.propertyDefs),
      ]);
      if (relation.search !== null && relation.search !== undefined) {
        await applySearchWritePlan(querier, relation.search, this.ontologyKey);
      }
      return {
        entity: entityRow(entityResult.rows[0]!, entity.propertyDefs),
        relation: relationRow(relationResult.rows[0]!, relation.propertyDefs),
      };
    });
  }

  // ------------------------------------------------------------------
  // Neutral reads for commit validation
  // ------------------------------------------------------------------

  async parentsOf(ids: string[], readings: Record<string, ParentEnd>): Promise<ParentLink[]> {
    const validIds = ids.filter(isUuid);
    const [sourceKeys, targetKeys] = splitReadings(readings);
    if (validIds.length === 0 || sourceKeys.length + targetKeys.length === 0) {
      return [];
    }
    const result = await this.query(
      `SELECT ${LINK_COLS} FROM relation
        WHERE (to_id = ANY($1::uuid[]) AND type_key = ANY($2::text[]))
           OR (from_id = ANY($1::uuid[]) AND type_key = ANY($3::text[]))
        ORDER BY child_id, type_key, id`,
      [validIds, sourceKeys, targetKeys],
    );
    return result.rows.map(toParentLink);
  }

  /** With `lock`: the entities first, then the relations, each in id
   * order, in one transaction. */
  async childrenOf(
    ids: string[],
    readings: Record<string, ParentEnd>,
    lock = false,
  ): Promise<ParentLink[]> {
    const validIds = ids.filter(isUuid);
    const [sourceKeys, targetKeys] = splitReadings(readings);
    if (validIds.length === 0 || (!lock && sourceKeys.length + targetKeys.length === 0)) {
      return [];
    }
    const children = `SELECT ${LINK_COLS} FROM relation
        WHERE (from_id = ANY($1::uuid[]) AND type_key = ANY($2::text[]))
           OR (to_id = ANY($1::uuid[]) AND type_key = ANY($3::text[]))`;
    const params = [validIds, sourceKeys, targetKeys];
    if (!lock) {
      const result = await this.query(`${children} ORDER BY parent_id, type_key, id`, params);
      return result.rows.map(toParentLink);
    }
    return this.tx(async (querier) => {
      await querier.query(`SELECT id FROM entity WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [
        validIds,
      ]);
      if (sourceKeys.length + targetKeys.length === 0) {
        return [];
      }
      const result = await querier.query(`${children} ORDER BY id FOR UPDATE`, params);
      return result.rows.map(toParentLink);
    });
  }

  /** One statement; each document value fingerprinted in SQL. */
  async getEntitiesByIdsHashed(ids: string[], documentKeys: Record<string, string[]>): Promise<Record<string, Row>> {
    const validIds = ids.filter(isUuid);
    if (validIds.length === 0) {
      return {};
    }
    const result = await this.query(
      `SELECT e.id, e.type_key, e.created_at, e.updated_at, ${fingerprintedProps("e", "$2")}
         FROM entity e WHERE e.id = ANY($1::uuid[])`,
      [validIds, JSON.stringify(documentKeys)],
    );
    return Object.fromEntries(result.rows.map((row) => [row.id as string, entityRow(row, NO_DEFS)]));
  }

  /** One statement; no property definitions cross it, as `getRelation`. */
  async getRelationsByIds(ids: string[]): Promise<Record<string, Row>> {
    const validIds = ids.filter(isUuid);
    if (validIds.length === 0) {
      return {};
    }
    const result = await this.query(`SELECT ${RELATION_COLS} FROM relation WHERE id = ANY($1::uuid[])`, [validIds]);
    return Object.fromEntries(result.rows.map((row) => [row.id as string, relationRow(row, NO_DEFS)]));
  }

  /** One statement over the id and type columns. */
  async getEntityTypes(ids: string[]): Promise<Record<string, string>> {
    const validIds = ids.filter(isUuid);
    if (validIds.length === 0) {
      return {};
    }
    const result = await this.query(`SELECT id, type_key FROM entity WHERE id = ANY($1::uuid[])`, [validIds]);
    return Object.fromEntries(result.rows.map((row) => [row.id as string, row.type_key as string]));
  }

  /** Entities first, then relations, each in id order. Relations hold
   * no documents. */
  async lockTargets(ids: string[], documentKeys: Record<string, string[]>): Promise<LockedTarget[]> {
    const validIds = ids.filter(isUuid);
    if (validIds.length === 0) {
      return [];
    }
    return this.tx(async (querier) => {
      const targets: LockedTarget[] = [];
      for (const [kind, table, props] of [
        ["entity", "entity", fingerprintedProps("t", "$2")],
        ["relation", "relation", "t.props"],
      ] as const) {
        const result = await querier.query(
          `SELECT t.id, t.type_key, ${props} FROM ${table} t WHERE t.id = ANY($1::uuid[]) ORDER BY t.id FOR UPDATE`,
          kind === "entity" ? [validIds, JSON.stringify(documentKeys)] : [validIds],
        );
        for (const row of result.rows) {
          targets.push({ id: row.id as string, kind, typeKey: row.type_key as string, props: row.props as Row });
        }
      }
      return targets;
    });
  }
}

/** A parent relation's columns, its parent and child end resolved by
 * whether its type's parent is the source end (`$2`). */
const LINK_COLS = `id, type_key,
        CASE WHEN type_key = ANY($2::text[]) THEN from_id ELSE to_id END AS parent_id,
        CASE WHEN type_key = ANY($2::text[]) THEN to_id ELSE from_id END AS child_id`;

function toParentLink(row: Row): ParentLink {
  return {
    relationType: row.type_key as string,
    relationId: row.id as string,
    parentId: row.parent_id as string,
    childId: row.child_id as string,
  };
}

/** The relation type keys of the readings whose parent is the source
 * end, and those whose parent is the target end. */
function splitReadings(readings: Record<string, ParentEnd>): [string[], string[]] {
  const keys = Object.keys(readings);
  return [
    keys.filter((key) => readings[key] === "source"),
    keys.filter((key) => readings[key] === "target"),
  ];
}

/** `count(*)` over one FROM/WHERE fragment; bigint arrives as text. */
async function countRows(querier: Querier, fromWhere: string, params: unknown[]): Promise<number> {
  const result = await querier.query(`SELECT count(*)::int AS total FROM ${fromWhere}`, params);
  return result.rows[0]!.total as number;
}

/** One limited neighbour SELECT for one direction, mapped to the
 * `{relation, entity}` port shape with the computed `direction`. */
async function neighborPage(
  querier: Querier,
  direction: "outgoing" | "incoming",
  entityId: string,
  relationTypeKey: string | null,
  limit: number,
  propertyDefsByType: Record<string, PropertyDefs>,
): Promise<Row[]> {
  const [rootColumn, farColumn] =
    direction === "outgoing" ? ["from_id", "to_id"] : ["to_id", "from_id"];
  const params: unknown[] = [entityId];
  let typeFilter = "";
  if (relationTypeKey !== null) {
    params.push(relationTypeKey);
    typeFilter = ` AND r.type_key = $${params.length}`;
  }
  params.push(limit);
  const result = await querier.query(
    `SELECT r.id AS relation_id, r.type_key AS relation_type_key, r.props AS relation_props,
            r.created_at AS relation_created_at, r.updated_at AS relation_updated_at,
            e.id, e.type_key, e.props, e.created_at, e.updated_at
     FROM relation r
     JOIN entity e ON e.id = r.${farColumn}
     WHERE r.${rootColumn} = $1${typeFilter}
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map((row) => ({
    relation: {
      _id: row.relation_id,
      _relationTypeKey: row.relation_type_key,
      _createdAt: row.relation_created_at,
      _updatedAt: row.relation_updated_at,
      direction,
      ...fromJson(
        row.relation_props as Row,
        propertyDefsByType[row.relation_type_key as string] ?? NO_DEFS,
      ),
    },
    entity: {
      _id: row.id,
      _entityTypeKey: row.type_key,
      _createdAt: row.created_at,
      _updatedAt: row.updated_at,
      ...fromJson(row.props as Row, propertyDefsByType[row.type_key as string] ?? NO_DEFS),
    },
  }));
}
