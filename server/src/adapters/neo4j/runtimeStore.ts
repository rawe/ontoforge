import type { KeywordPropertySegment } from "../../core/ports.js";
/**
 * Neo4j implementation of the runtime store (instance-data persistence).
 *
 * Implements the runtime side of the persistence port (see
 * `core/ports.ts`). Each method owns its session — opened through
 * `runSession`, so driver failures surface as `StoreError` (rule 4) — and
 * delegates to the query functions in `runtimeQueries.ts`. Physical naming
 * (PascalCase labels, UPPER_SNAKE_CASE relationship types) is derived here
 * from the lens-level type keys the service passes in.
 *
 * Write values cross the port in their port-safe forms (JS `Date` for
 * datetimes, ISO strings for dates, plain numbers for integers) and are
 * converted to driver-native types here, guided by the property
 * definitions the service supplies — the driver would otherwise store
 * every number as a float and every temporal as a string.
 *
 * The property definitions the read methods carry are the row-decoding
 * aid for adapters whose storage does not distinguish temporals from
 * text. Neo4j stores native temporals and reads them back as such, so
 * this adapter ignores those parameters.
 */

import type { TextSearchLanguage } from "../../registry/schemas.js";

import neo4j, { type Driver } from "neo4j-driver";

import type { ValidatedQuery } from "../../core/oql/index.js";
import type {
  FilterCondition,
  Row,
  RuntimeStore,
  SearchedType,
  SearchedProperty,
} from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";
import {
  documentIndexName,
  documentVirtualLabel,
  toPascalCase,
  toUpperSnakeCase,
  validateVectorIndexedProperties,
} from "./ddl.js";
import { runSession } from "./errors.js";
import { buildFilterClauses, buildSearchClause, toNeo4jParameter } from "./filters.js";
import { compileQuery } from "./oqlCompiler.js";
import * as queries from "./runtimeQueries.js";

/** Convert a property map to driver-native parameter values. Internal
 * `_doc_*_length` counters are integers; everything else follows its
 * property definition's data type. */
function toWriteProperties(properties: Row, propertyDefs: Record<string, PropertyDef>): Row {
  const converted: Row = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith("_doc_") && key.endsWith("_length")) {
      converted[key] = neo4j.int(value as number);
      continue;
    }
    const def = propertyDefs[key];
    converted[key] = def === undefined ? value : toNeo4jParameter(value, def.dataType);
  }
  return converted;
}

/** The WHERE fragments and bound parameters for a search's filter
 * conditions on the node aliased `alias` — `null` for both when there
 * are none, which is how the query functions read "unfiltered". */
function filterFragments(
  filters: FilterCondition[] | null,
  alias: string,
): [string[] | null, Row | null] {
  if (filters === null || filters.length === 0) {
    return [null, null];
  }
  const [whereClauses, params] = buildFilterClauses(filters, alias);
  return [whereClauses, params];
}

export class Neo4jRuntimeStore implements RuntimeStore {
  /** Bound to one ontology; unbound (tests only) carries the empty key. */
  constructor(
    private readonly driver: Driver,
    public readonly ontologyKey: string = "",
    public readonly textSearchLanguage: TextSearchLanguage = "english",
  ) {}

  // ------------------------------------------------------------------
  // Declarations
  // ------------------------------------------------------------------

  /** Declared unsupported: the in-index WHERE of a vector search cannot
   * express a pattern predicate, so a path condition on search
   * is rejected above the port and the entity list is the alternative
   * (`docs/storage-adapters.md`, the divergence list). */
  supportsKeywordRanking(): boolean {
    return false;
  }

  supportsSearchPathConditions(): boolean {
    return false;
  }

  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  async getFullSchema(lensKey: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getFullSchema(session, lensKey));
  }

  async getAiAgentConfigs(lensKey: string): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.getAiAgentConfigs(session, lensKey));
  }

  async getSavedQueries(lensKey: string): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.getSavedQueries(session, lensKey));
  }

  // ------------------------------------------------------------------
  // Vector-index metadata validation
  // ------------------------------------------------------------------

  /** Reject string values too large for vector-index filter metadata.
   * Synchronous; raises the domain `ValidationError` (see `ddl.ts`). */
  validateVectorIndexedProperties(
    entityTypeKey: string,
    properties: Row,
    filterProperties: string[],
    entityId: string | null = null,
  ): void {
    validateVectorIndexedProperties(entityTypeKey, properties, filterProperties, entityId);
  }

  // ------------------------------------------------------------------
  // Entity instances
  // ------------------------------------------------------------------

  async createEntity(
    entityTypeKey: string,
    entityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
    embedding: number[] | null = null,
    _propertyText = "",
    _keywordSegments?: KeywordPropertySegment[],
  ): Promise<Row> {
    return runSession(this.driver, (session) =>
      queries.createEntity(
        session,
        entityTypeKey,
        toPascalCase(entityTypeKey),
        entityId,
        toWriteProperties(properties, propertyDefs),
        embedding,
      ),
    );
  }

  async listEntities(
    entityTypeKey: string,
    _propertyDefs: Record<string, PropertyDef>,
    filters: FilterCondition[],
    search: string | null,
    searchPropertyKeys: string[],
    sortField: string,
    order: string,
    limit: number,
    offset: number,
  ): Promise<[Row[], number]> {
    const [whereClauses, params] = buildFilterClauses(filters);
    if (search !== null && search !== undefined && searchPropertyKeys.length > 0) {
      const [clause, searchParams] = buildSearchClause(search, searchPropertyKeys);
      whereClauses.push(clause);
      Object.assign(params, searchParams);
    }
    return runSession(this.driver, (session) =>
      queries.listEntities(
        session,
        toPascalCase(entityTypeKey),
        entityTypeKey,
        whereClauses,
        params,
        sortField,
        order,
        limit,
        offset,
      ),
    );
  }

  async getEntity(entityTypeKey: string, entityId: string): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getEntity(session, toPascalCase(entityTypeKey), entityId),
    );
  }

  async getEntityById(
    entityId: string,
    _propertyDefs: Record<string, PropertyDef>,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getEntityById(session, entityId));
  }

  async updateEntity(
    entityTypeKey: string,
    entityId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: Record<string, PropertyDef>,
    embedding: number[] | null = null,
    hasEmbeddingUpdate = false,
    _propertyText = "",
    _keywordSegments?: KeywordPropertySegment[],
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateEntity(
        session,
        toPascalCase(entityTypeKey),
        entityId,
        toWriteProperties(setProperties, propertyDefs),
        removeProperties,
        embedding,
        hasEmbeddingUpdate,
      ),
    );
  }

  async deleteEntity(entityTypeKey: string, entityId: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteEntity(session, toPascalCase(entityTypeKey), entityId),
    );
  }

  // ------------------------------------------------------------------
  // Document chunks
  // ------------------------------------------------------------------

  async getChunkEmbeddingsForEntityProperty(
    entityId: string,
    propertyKey: string,
  ): Promise<Record<string, number[]>> {
    return runSession(this.driver, (session) =>
      queries.getChunkEmbeddingsForEntityProperty(session, entityId, propertyKey),
    );
  }

  async deleteChunksForEntityProperty(entityId: string, propertyKey: string): Promise<void> {
    return runSession(this.driver, (session) =>
      queries.deleteChunksForEntityProperty(session, entityId, propertyKey),
    );
  }

  async createDocumentChunks(
    entityId: string,
    entityTypeKey: string,
    propertyKey: string,
    chunks: Row[],
  ): Promise<void> {
    // Ordinals and coordinates are integers; the driver would otherwise
    // store plain JS numbers as floats.
    const rows = chunks.map((chunk) => ({
      ...chunk,
      _index: neo4j.int(chunk._index as number),
      startChar: neo4j.int(chunk.startChar as number),
      charLength: neo4j.int(chunk.charLength as number),
    }));
    return runSession(this.driver, (session) =>
      queries.createDocumentChunks(
        session,
        entityId,
        documentVirtualLabel(entityTypeKey, propertyKey),
        rows,
      ),
    );
  }

  /** Conditions are built against the parent node alias `n` and applied
   * below the port, after the index lookup (`runtimeQueries.ts`). Only
   * plain conditions arrive: this adapter declares no path-condition
   * support for semantic search, so the service rejects paths above the
   * port before any search runs. */
  async documentSearchSemantic(
    properties: SearchedProperty[],
    embedding: number[],
    limit: number,
  ): Promise<Row[]> {
    return this.rankedSemantic(properties, embedding, limit, true);
  }

  async getEntitiesByIds(
    entityIds: string[],
    _propertyDefs: Record<string, PropertyDef>,
  ): Promise<Record<string, Row>> {
    return runSession(this.driver, (session) => queries.getEntitiesByIds(session, entityIds));
  }

  // ------------------------------------------------------------------
  // Semantic search
  // ------------------------------------------------------------------

  async propertySearchKeyword(): Promise<Row[]> {
    throw new Error("Keyword ranking is not supported");
  }
  async documentSearchKeyword(): Promise<Row[]> {
    throw new Error("Keyword ranking is not supported");
  }

  async propertySearchSemantic(
    types: SearchedType[],
    embedding: number[],
    limit: number,
  ): Promise<Row[]> {
    return this.rankedSemantic(types, embedding, limit, false);
  }

  private async rankedSemantic(
    searched: (SearchedType | SearchedProperty)[],
    embedding: number[],
    limit: number,
    document: boolean,
  ): Promise<Row[]> {
    if (!searched.length) return [];
    const params: Row = { embedding, limit: neo4j.int(limit) };
    const scans = searched.map((item, i) => {
      const [clauses, filterParams] = filterFragments(item.conditions, "n");
      let where = (clauses ?? []).join(" AND ");
      for (const [key, value] of Object.entries(filterParams ?? {}).sort(
        ([a], [b]) => b.length - a.length,
      )) {
        where = where.replaceAll(`$${key}`, `$s${i}_${key}`);
        params[`s${i}_${key}`] = value;
      }
      const label =
        "propertyKey" in item
          ? documentVirtualLabel(item.entityTypeKey, item.propertyKey)
          : toPascalCase(item.entityTypeKey);
      const index =
        "propertyKey" in item
          ? documentIndexName(item.entityTypeKey, item.propertyKey)
          : `${item.entityTypeKey}_embedding`;
      const alias = document ? "c" : "n";
      const parent = document && where ? "MATCH (n:_Entity)-[:_HAS_CHUNK]->(c) " : "WITH n, score ";
      return (
        `MATCH (${alias}:${label}) SEARCH ${alias} IN (VECTOR INDEX ${index} FOR $embedding LIMIT $limit) SCORE AS score ` +
        (where ? `${parent}WHERE ${where} ` : "") +
        `RETURN ${alias} {.*} AS value, score`
      );
    });
    return runSession(this.driver, async (session) => {
      const result = await session.run(
        `CALL () { ${scans.join(" UNION ALL ")} } RETURN value, score ORDER BY score DESC LIMIT $limit`,
        params,
      );
      return result.records.map((record) => ({
        [document ? "chunk" : "entity"]: queries.toEntityRow(record.get("value")),
        score: record.get("score"),
      }));
    });
  }

  /** Rank SavedQuery descriptions for one lens by vector similarity. */
  async searchSavedQueries(
    queryEmbedding: number[],
    lensKey: string,
    limit: number,
    minScore: number | null,
  ): Promise<Row[]> {
    return runSession(this.driver, (session) =>
      queries.searchSavedQueries(session, queryEmbedding, lensKey, limit, minScore),
    );
  }

  // ------------------------------------------------------------------
  // Relation instances
  // ------------------------------------------------------------------

  async createRelation(
    relationTypeKey: string,
    relationId: string,
    fromEntityId: string,
    toEntityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Row> {
    return runSession(this.driver, (session) =>
      queries.createRelation(
        session,
        relationTypeKey,
        toUpperSnakeCase(relationTypeKey),
        relationId,
        fromEntityId,
        toEntityId,
        toWriteProperties(properties, propertyDefs),
      ),
    );
  }

  async listRelations(
    relationTypeKey: string,
    _propertyDefs: Record<string, PropertyDef>,
    filters: FilterCondition[],
    fromEntityId: string | null,
    toEntityId: string | null,
    sortField: string,
    order: string,
    limit: number,
    offset: number,
  ): Promise<[Row[], number]> {
    const [whereClauses, params] = buildFilterClauses(filters, "r");
    if (fromEntityId) {
      whereClauses.push("from._id = $from_entity_id_filter");
      params.from_entity_id_filter = fromEntityId;
    }
    if (toEntityId) {
      whereClauses.push("to._id = $to_entity_id_filter");
      params.to_entity_id_filter = toEntityId;
    }
    return runSession(this.driver, (session) =>
      queries.listRelations(
        session,
        toUpperSnakeCase(relationTypeKey),
        relationTypeKey,
        whereClauses,
        params,
        sortField,
        order,
        limit,
        offset,
      ),
    );
  }

  async getRelation(relationTypeKey: string, relationId: string): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getRelation(session, toUpperSnakeCase(relationTypeKey), relationId),
    );
  }

  async updateRelation(
    relationTypeKey: string,
    relationId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateRelation(
        session,
        toUpperSnakeCase(relationTypeKey),
        relationId,
        toWriteProperties(setProperties, propertyDefs),
        removeProperties,
      ),
    );
  }

  async deleteRelation(relationTypeKey: string, relationId: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteRelation(session, toUpperSnakeCase(relationTypeKey), relationId),
    );
  }

  // ------------------------------------------------------------------
  // OQL
  // ------------------------------------------------------------------

  /**
   * Compile a validated OQL query to Cypher and execute it read-only.
   * The validated query crosses the port opaque (`core/ports.ts` rule 1);
   * parameters arrive separately as a map (empty for ad-hoc queries —
   * binding is a saved-query concern). Parameters the analysis recorded
   * as SKIP/LIMIT operands are wrapped as driver integers — a plain JS
   * number crosses the wire as a Float, which the server rejects as a
   * paging count.
   */
  async executeOql(validated: ValidatedQuery, params: Row = {}): Promise<[string[], Row[]]> {
    const cypher = compileQuery(validated);
    const converted: Row = { ...params };
    for (const name of validated.analysis.skipLimitParams) {
      if (name in converted) {
        converted[name] = neo4j.int(converted[name] as number);
      }
    }
    return runSession(this.driver, (session) =>
      queries.executeCypherRead(session, cypher, converted),
    );
  }

  // ------------------------------------------------------------------
  // Graph traversal
  // ------------------------------------------------------------------

  async getNeighbors(
    entityId: string,
    direction: string,
    relationTypeKey: string | null,
    limit: number,
    _propertyDefsByType: Record<string, Record<string, PropertyDef>>,
  ): Promise<Row[]> {
    const relTypeFilter = relationTypeKey ? toUpperSnakeCase(relationTypeKey) : null;
    return runSession(this.driver, (session) =>
      queries.getNeighbors(session, entityId, direction, relTypeFilter, limit),
    );
  }
}
