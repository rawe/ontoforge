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
 * - Relation deletes and lookups carry the type key in the WHERE — the
 *   reference adapter's typed relationship match answers not-found for a
 *   mismatched type key, and the PK alone would not.
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
 */


import type { ValidatedQuery } from "../../core/oql/index.js";
import type {
  FilterCondition,
  Row,
  RuntimeStore,
  SearchIndexStore,
  SearchWritePlan,
} from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";
import { SAVED_QUERY_INDEX } from "./ddl.js";
import {
  runArrayQuery,
  runQuery,
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
import { applySearchWritePlan, PostgresSearchIndexStore } from "./searchIndexStore.js";
import { distance, minScoreFloor, similarity, vectorParams, vectorSearch } from "./search.js";

type PropertyDefs = Record<string, PropertyDef>;

const NO_DEFS: PropertyDefs = {};

// Read column lists.
const ENTITY_COLS = "id, type_key, props, created_at, updated_at";
const RELATION_COLS = "id, type_key, from_id, to_id, props, created_at, updated_at";

/** Only saved queries the index can hold. The reference adapter's vector
 * index contains nothing without a vector, so an un-embedded description
 * is invisible to discovery there; here the predicate says so explicitly,
 * because a plan that does not use the index would otherwise see them. */
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

/** The jsonb text for a props write: datetime `Date`s → ISO text. */
function propsJson(properties: Row, propertyDefs: PropertyDefs): string {
  return JSON.stringify(toJson(properties, propertyDefs));
}

export class PostgresRuntimeStore implements RuntimeStore {
  /** Bound to one ontology and its namespace; unbound (tests only) runs
   * against the connection's default namespace. */
  constructor(
    public readonly ontologyKey: string = "",
    private readonly namespace?: string,
  ) {}

  /** Door one, carrying this store's binding. */
  private query(text: string, params?: unknown[]): Promise<DbResult> {
    return runQuery(text, params, this.namespace);
  }

  /** Door two, carrying this store's binding. */
  private tx<T>(
    work: (querier: Querier) => Promise<T>,
    isolation: IsolationLevel = "READ COMMITTED",
  ): Promise<T> {
    return withTransaction(work, isolation, this.namespace);
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

  /** The lens, ALL types with their properties, and this lens's
   * inclusions — one coherent REPEATABLE READ snapshot.
   * Answers null when no lens has the key. */
  async getFullSchemaWithLensInclusions(lensKey: string): Promise<Row | null> {
    return this.tx(async (querier) => {
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
      };
    }, "REPEATABLE READ");
  }

  /** AiAgentConfig rows for one lens, by key. */
  async getAiAgentConfigs(lensKey: string): Promise<Row[]> {
    const result = await this.query(
      `SELECT ac.key, ac.name, ac.description, ac.system_prompt, ac.tools
       FROM ai_agent_config ac
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
    _embedding: number[] | null = null,
    search?: SearchWritePlan | null,
  ): Promise<Row> {
    const result = await this.write(
      `INSERT INTO entity (id, type_key, props)
       VALUES ($1, $2, $3::jsonb)
       RETURNING ${ENTITY_COLS}`,
      [entityId, entityTypeKey, propsJson(properties, propertyDefs)],
      search,
    );
    return entityRow(result.rows[0]!, propertyDefs);
  }

  /** Count, short-circuit on zero, then page — two statements in one
   * READ COMMITTED transaction; search fragment and filter conditions
   * AND-ed, matching the reference adapter's clause composition. */
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
    _embedding: number[] | null = null,
    _hasEmbeddingUpdate = false,
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
      `INSERT INTO relation (id, type_key, from_id, to_id, props)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${RELATION_COLS}`,
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
   * neighbour order is arbitrary on every backend.
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
