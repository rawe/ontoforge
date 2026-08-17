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
 * - `embedding` is never selected and appears in no returned row.
 * - Relation deletes and lookups carry the type key in the WHERE — the
 *   reference adapter's typed relationship match answers not-found for a
 *   mismatched type key, and the PK alone would not.
 * - The runtime `getFullSchema` (lens view) is one REPEATABLE READ
 *   transaction (M2.3's coherent-snapshot obligation).
 *
 * Vectors, document chunks and semantic search land at M4; `executeOql`
 * lands at M5.
 */

import { toSql } from "pgvector";

import type { FilterCondition, Row, RuntimeStore } from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";
import { runQuery, withTransaction, type Querier } from "./errors.js";
import {
  buildEndpointClauses,
  buildFilterClauses,
  buildOrderBy,
  buildSearchClause,
} from "./filters.js";
import { fromJson, toJson } from "./json.js";
import { camelizeRow, isUuid } from "./rows.js";
import { notImplemented } from "./notImplemented.js";

type PropertyDefs = Record<string, PropertyDef>;

const NO_DEFS: PropertyDefs = {};

// Read column lists — `embedding` is deliberately absent from both.
const ENTITY_COLS = "id, type_key, props, created_at, updated_at";
const RELATION_COLS = "id, type_key, from_id, to_id, props, created_at, updated_at";

// Schema-read column lists (the lens view's building blocks).
const ONTOLOGY_COLS = "ontology_id, key, name, description, created_at, updated_at";
const PROPERTY_COLS =
  "property_id, key, display_name, description, data_type, required, default_value";

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
  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  /** The lens view: the ontology, ALL types with their properties, and
   * this ontology's inclusions — one coherent REPEATABLE READ snapshot.
   * Answers null when no ontology has the key. */
  async getFullSchema(ontologyKey: string): Promise<Row | null> {
    return withTransaction(async (querier) => {
      const ont = await querier.query(
        `SELECT ${ONTOLOGY_COLS} FROM ontology WHERE key = $1`,
        [ontologyKey],
      );
      const ontRow = ont.rows[0];
      if (ontRow === undefined) {
        return null;
      }
      const ontology = camelizeRow(ontRow);
      const ontologyId = ontology.ontologyId as string;

      const props = await querier.query(
        `SELECT ${PROPERTY_COLS}, entity_type_id, relation_type_id
         FROM property_def ORDER BY key`,
      );
      const propsByOwner = new Map<string, Row[]>();
      for (const raw of props.rows) {
        const { entityTypeId, relationTypeId, ...property } = camelizeRow(raw);
        const ownerId = (entityTypeId ?? relationTypeId) as string;
        const bucket = propsByOwner.get(ownerId) ?? [];
        bucket.push(property);
        propsByOwner.set(ownerId, bucket);
      }

      const ets = await querier.query(
        `SELECT entity_type_id, key, display_name, description, created_at, updated_at
         FROM entity_type ORDER BY key`,
      );
      const entityTypes = ets.rows.map((raw) => {
        const et = camelizeRow(raw);
        et.properties = propsByOwner.get(et.entityTypeId as string) ?? [];
        return et;
      });

      const rts = await querier.query(
        `SELECT relation_type_id, key, display_name, description, created_at, updated_at,
                source_entity_type_key AS source_key, target_entity_type_key AS target_key
         FROM relation_type ORDER BY key`,
      );
      const relationTypes = rts.rows.map((raw) => {
        const rt = camelizeRow(raw);
        rt.properties = propsByOwner.get(rt.relationTypeId as string) ?? [];
        return rt;
      });

      const incs = await querier.query(
        `SELECT oi.properties, et.key AS entity_type_key, rt.key AS relation_type_key
         FROM ontology_includes oi
         LEFT JOIN entity_type et ON et.entity_type_id = oi.entity_type_id
         LEFT JOIN relation_type rt ON rt.relation_type_id = oi.relation_type_id
         WHERE oi.ontology_id = $1`,
        [ontologyId],
      );
      const entityInclusions: Row[] = [];
      const relationInclusions: Row[] = [];
      for (const raw of incs.rows) {
        const properties = (raw.properties as string[] | null) ?? null;
        if (raw.entity_type_key !== null) {
          entityInclusions.push({ key: raw.entity_type_key, properties });
        } else {
          relationInclusions.push({ key: raw.relation_type_key, properties });
        }
      }

      return { ontology, entityTypes, relationTypes, entityInclusions, relationInclusions };
    }, "REPEATABLE READ");
  }

  /** AiAgentConfig rows for one ontology, by key. */
  async getAiAgentConfigs(ontologyKey: string): Promise<Row[]> {
    const result = await runQuery(
      `SELECT ac.key, ac.name, ac.description, ac.system_prompt, ac.tools
       FROM ai_agent_config ac
       JOIN ontology o ON o.ontology_id = ac.ontology_id
       WHERE o.key = $1
       ORDER BY ac.name`,
      [ontologyKey],
    );
    return result.rows.map(camelizeRow);
  }

  /** SavedQuery rows for one ontology, by key. */
  async getSavedQueries(ontologyKey: string): Promise<Row[]> {
    const result = await runQuery(
      `SELECT sq.key, sq.name, sq.description, sq.steps, sq.parameters
       FROM saved_query sq
       JOIN ontology o ON o.ontology_id = sq.ontology_id
       WHERE o.key = $1
       ORDER BY sq.name`,
      [ontologyKey],
    );
    return result.rows.map(camelizeRow);
  }

  // ------------------------------------------------------------------
  // Vector-index metadata validation
  // ------------------------------------------------------------------

  /** The confirmed PG no-op (M4.2): pgvector's partial HNSW indexes
   * carry no filter metadata, so no property value can be too large. */
  validateVectorIndexedProperties(): void {
    // No adapter-side limit exists on this backend.
  }

  // ------------------------------------------------------------------
  // Entity instances
  // ------------------------------------------------------------------

  async createEntity(
    entityTypeKey: string,
    entityId: string,
    properties: Row,
    propertyDefs: PropertyDefs,
    embedding: number[] | null = null,
  ): Promise<Row> {
    const result = await runQuery(
      `INSERT INTO entity (id, type_key, props, embedding)
       VALUES ($1, $2, $3::jsonb, $4::vector)
       RETURNING ${ENTITY_COLS}`,
      [
        entityId,
        entityTypeKey,
        propsJson(properties, propertyDefs),
        embedding === null ? null : toSql(embedding),
      ],
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

    return withTransaction(async (querier) => {
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

  /** No property definitions cross this read (approved M3.1 scope):
   * datetime values stay the stored ISO text — byte-identical on the
   * wire, and no in-process consumer inspects them. */
  async getEntity(entityTypeKey: string, entityId: string): Promise<Row | null> {
    if (!isUuid(entityId)) {
      return null;
    }
    const result = await runQuery(
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
    const result = await runQuery(`SELECT ${ENTITY_COLS} FROM entity WHERE id = $1`, [
      entityId,
    ]);
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
    embedding: number[] | null = null,
    hasEmbeddingUpdate = false,
  ): Promise<Row | null> {
    if (!isUuid(entityId)) {
      return null;
    }
    const params: unknown[] = [
      entityTypeKey,
      entityId,
      propsJson(setProperties, propertyDefs),
      removeProperties,
    ];
    let embeddingSet = "";
    if (hasEmbeddingUpdate) {
      params.push(embedding === null ? null : toSql(embedding));
      embeddingSet = `, embedding = $${params.length}::vector`;
    }
    const result = await runQuery(
      `UPDATE entity
       SET props = (props || $3::jsonb) - $4::text[], updated_at = now()${embeddingSet}
       WHERE type_key = $1 AND id = $2
       RETURNING ${ENTITY_COLS}`,
      params,
    );
    const row = result.rows[0];
    return row === undefined ? null : entityRow(row, propertyDefs);
  }

  /** One DELETE; relations (both directions) and chunks vanish by
   * CASCADE (M2.2). */
  async deleteEntity(entityTypeKey: string, entityId: string): Promise<boolean> {
    if (!isUuid(entityId)) {
      return false;
    }
    const result = await runQuery(`DELETE FROM entity WHERE type_key = $1 AND id = $2`, [
      entityTypeKey,
      entityId,
    ]);
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Document chunks
  // ------------------------------------------------------------------

  getChunkEmbeddingsForEntityProperty(): Promise<Record<string, number[]>> {
    return notImplemented("getChunkEmbeddingsForEntityProperty");
  }

  deleteChunksForEntityProperty(): Promise<void> {
    return notImplemented("deleteChunksForEntityProperty");
  }

  createDocumentChunks(): Promise<void> {
    return notImplemented("createDocumentChunks");
  }

  searchDocumentChunks(): Promise<Row[]> {
    return notImplemented("searchDocumentChunks");
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
    const result = await runQuery(
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
  // Semantic search
  // ------------------------------------------------------------------

  semanticSearch(): Promise<Row[]> {
    return notImplemented("semanticSearch");
  }

  semanticSearchAll(): Promise<Row[]> {
    return notImplemented("semanticSearchAll");
  }

  searchSavedQueries(): Promise<Row[]> {
    return notImplemented("searchSavedQueries");
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
  ): Promise<Row> {
    const result = await runQuery(
      `INSERT INTO relation (id, type_key, from_id, to_id, props)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${RELATION_COLS}`,
      [relationId, relationTypeKey, fromEntityId, toEntityId, propsJson(properties, propertyDefs)],
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

    return withTransaction(async (querier) => {
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
    const result = await runQuery(
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
  ): Promise<Row | null> {
    if (!isUuid(relationId)) {
      return null;
    }
    const result = await runQuery(
      `UPDATE relation
       SET props = (props || $3::jsonb) - $4::text[], updated_at = now()
       WHERE type_key = $1 AND id = $2
       RETURNING ${RELATION_COLS}`,
      [relationTypeKey, relationId, propsJson(setProperties, propertyDefs), removeProperties],
    );
    const row = result.rows[0];
    return row === undefined ? null : relationRow(row, propertyDefs);
  }

  /** One DELETE; neither endpoint is touched. */
  async deleteRelation(relationTypeKey: string, relationId: string): Promise<boolean> {
    if (!isUuid(relationId)) {
      return false;
    }
    const result = await runQuery(`DELETE FROM relation WHERE type_key = $1 AND id = $2`, [
      relationTypeKey,
      relationId,
    ]);
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // OQL
  // ------------------------------------------------------------------

  executeOql(): Promise<[string[], Row[]]> {
    return notImplemented("executeOql");
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
      return withTransaction(async (querier) => {
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
      { query: runQuery },
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
