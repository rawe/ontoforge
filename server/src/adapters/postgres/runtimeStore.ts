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
 * - Semantic rankings use iterative scans at each index's own cast width.
 *   Keyword rankings read stored tsvectors. Saved-query discovery alone
 *   applies a score floor after ranking.
 *
 * - `executeOql` compiles the validated query to one SQL SELECT
 *   (`oql/`) and runs it through the array-mode door; the compiled plan
 *   names the columns and drives the value conversion.
 */

import type { TextSearchLanguage } from "../../registry/schemas.js";

import { fromSql, toSql } from "pgvector";

import type { ValidatedQuery } from "../../core/oql/index.js";
import type {
  KeywordPropertySegment,
  FilterCondition,
  Row,
  RuntimeStore,
  SearchedType,
  SearchedProperty,
} from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";
import { chunkIndexNameOf, entityIndexNameOf, indexWidth, SAVED_QUERY_INDEX } from "./ddl.js";
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
import { distance, minScoreFloor, similarity, vectorParams, vectorSearch } from "./search.js";

type PropertyDefs = Record<string, PropertyDef>;

const NO_DEFS: PropertyDefs = {};

// Read column lists — `embedding` is deliberately absent from all three.
const ENTITY_COLS = "id, type_key, props, created_at, updated_at";
const RELATION_COLS = "id, type_key, from_id, to_id, props, created_at, updated_at";
const CHUNK_COLS =
  "id, entity_id, entity_type_key, property_key, chunk_index, start_char, char_length, text";

/** Only rows the search indexes can hold. The reference adapter's vector
 * indexes contain nothing without a vector, so an un-embedded row is
 * invisible to search there; here the predicate says so explicitly,
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

/** One `document_chunk` row → the port's chunk shape. Chunks carry no
 * timestamps, and their ids are internal — never addressable. */
function chunkRow(row: Row): Row {
  return {
    _id: row.id,
    _entityId: row.entity_id,
    _entityTypeKey: row.entity_type_key,
    _propertyKey: row.property_key,
    _index: row.chunk_index,
    startChar: row.start_char,
    charLength: row.char_length,
    text: row.text,
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
    public readonly textSearchLanguage: TextSearchLanguage = "english",
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

  // ------------------------------------------------------------------
  // Declarations
  // ------------------------------------------------------------------

  /** Path conditions filter both rankings here: the entity ranking
   * carries them as ordinary predicates, and the passage ranking joins
   * each passage to its parent entity inside the vector query. */
  supportsKeywordRanking(): boolean {
    return true;
  }

  supportsSearchPathConditions(): boolean {
    return true;
  }

  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  /** The lens view: the lens, ALL types with their properties, and
   * this lens's inclusions — one coherent REPEATABLE READ snapshot.
   * Answers null when no lens has the key. */
  async getFullSchema(lensKey: string): Promise<Row | null> {
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
         WHERE oi.lens_id = $1`,
        [lensId],
      );
      const { entityInclusions, relationInclusions } = splitInclusions(incs.rows);

      return { lens, entityTypes, relationTypes, entityInclusions, relationInclusions };
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
    propertyText = "",
    keywordSegments?: KeywordPropertySegment[],
  ): Promise<Row> {
    const result = await this.query(
      `INSERT INTO entity (id, type_key, props, embedding, property_text, keyword_text, keyword_segments)
       VALUES ($1, $2, $3::jsonb, $4::vector, $5, $6, $7::jsonb)
       RETURNING ${ENTITY_COLS}`,
      [
        entityId,
        entityTypeKey,
        propsJson(properties, propertyDefs),
        embedding === null ? null : toSql(embedding),
        propertyText,
        (keywordSegments ?? []).map((segment) => segment.text).join("\n"),
        keywordSegments === undefined ? null : JSON.stringify(keywordSegments),
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
    embedding: number[] | null = null,
    hasEmbeddingUpdate = false,
    propertyText = "",
    keywordSegments?: KeywordPropertySegment[],
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
      params.push(propertyText);
      embeddingSet += `, property_text = $${params.length}`;
    }
    if (keywordSegments !== undefined) {
      params.push(keywordSegments.map((segment) => segment.text).join("\n"));
      embeddingSet += `, keyword_text = $${params.length}`;
      params.push(JSON.stringify(keywordSegments));
      embeddingSet += `, keyword_segments = $${params.length}::jsonb`;
    }
    const result = await this.query(
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
    const result = await this.query(`DELETE FROM entity WHERE type_key = $1 AND id = $2`, [
      entityTypeKey,
      entityId,
    ]);
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Document chunks
  // ------------------------------------------------------------------

  /** The text→vector map behind chunk-embedding reuse: embedded chunks
   * only, keyed by text (chunk texts of one property are distinct). The
   * one port method that deliberately returns vectors. */
  async getChunkEmbeddingsForEntityProperty(
    entityId: string,
    propertyKey: string,
  ): Promise<Record<string, number[]>> {
    if (!isUuid(entityId)) {
      return {};
    }
    const result = await this.query(
      `SELECT text, embedding::text AS embedding FROM document_chunk
       WHERE entity_id = $1 AND property_key = $2 AND ${EMBEDDED}`,
      [entityId, propertyKey],
    );
    const map: Record<string, number[]> = {};
    for (const row of result.rows) {
      // `WHERE embedding IS NOT NULL` over a dense `vector` column: the
      // parse can only yield the coordinate list.
      map[row.text as string] = fromSql(row.embedding as string) as number[];
    }
    return map;
  }

  async deleteChunksForEntityProperty(entityId: string, propertyKey: string): Promise<void> {
    if (!isUuid(entityId)) {
      return;
    }
    await this.query(`DELETE FROM document_chunk WHERE entity_id = $1 AND property_key = $2`, [
      entityId,
      propertyKey,
    ]);
  }

  /**
   * Write one batch of chunks — the service has already deleted what they
   * replace, so this only inserts. The batch travels as one jsonb
   * document expanded by `jsonb_to_recordset`, which keeps the statement
   * single and its parameter count independent of the document's length.
   * The three values shared by every chunk are bound once. An empty batch
   * touches nothing.
   */
  async createDocumentChunks(
    entityId: string,
    entityTypeKey: string,
    propertyKey: string,
    chunks: Row[],
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    const batch = chunks.map((chunk) => {
      // A chunk the provider could not embed arrives without the key and
      // is stored without a vector, as the reference adapter stores it.
      const vector = chunk._embedding as number[] | undefined;
      return {
        id: chunk._id,
        chunk_index: chunk._index,
        start_char: chunk.startChar,
        char_length: chunk.charLength,
        text: chunk.text,
        embedding: vector === undefined ? null : toSql(vector),
      };
    });
    await this.query(
      `INSERT INTO document_chunk (id, entity_id, entity_type_key, property_key,
                                   chunk_index, start_char, char_length, text, embedding)
       SELECT c.id, $1, $2, $3, c.chunk_index, c.start_char, c.char_length, c.text,
              c.embedding::vector
       FROM jsonb_to_recordset($4::jsonb) AS c(id uuid, chunk_index int, start_char int,
                                               char_length int, text text, embedding text)`,
      [entityId, entityTypeKey, propertyKey, JSON.stringify(batch)],
    );
  }

  /** One document property's chunks, ranked. The floor lives in the
   * service for this path — the port method takes no `minScore`.
   *
   * Filters are evaluated on the parent entity inside the statement: a
   * semi-join to the `entity` row, carrying the same predicate fragments
   * the entity ranking carries (`filters.ts`, which anchors a path
   * condition on `entity.id` — the joined row here). The iterative scan
   * therefore refills the page with passages whose parent passes, and
   * the limit counts filtered hits. The join is written as EXISTS so the
   * outer statement's column references stay unqualified and the index
   * expression is repeated verbatim. */
  async documentSearchSemantic(
    properties: SearchedProperty[],
    embedding: number[],
    limit: number,
  ): Promise<Row[]> {
    return this.rankedSemantic(properties, embedding, limit, true);
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
  // Search rankings
  // ------------------------------------------------------------------

  async propertySearchKeyword(types: SearchedType[], query: string, limit: number): Promise<Row[]> {
    return this.rankedKeyword(types, query, limit, false);
  }
  async documentSearchKeyword(
    properties: SearchedProperty[],
    query: string,
    limit: number,
  ): Promise<Row[]> {
    return this.rankedKeyword(properties, query, limit, true);
  }

  /** Plain words, stemmed in the immutable ontology language. Reads stored tsvectors. */
  private async rankedKeyword(
    searched: (SearchedType | SearchedProperty)[],
    query: string,
    limit: number,
    document: boolean,
  ): Promise<Row[]> {
    if (!searched.length) return [];
    const params: unknown[] = [query, this.textSearchLanguage];
    const scopes = searched.map((item) => {
      params.push(item.entityTypeKey);
      const where = [`${document ? "entity_type_key" : "type_key"} = $${params.length}`];
      if ("propertyKey" in item) {
        params.push(item.propertyKey);
        where.push(`property_key = $${params.length}`);
      }
      const filters = buildFilterClauses(item.conditions, params);
      if (document && filters.length)
        where.push(
          `EXISTS (SELECT 1 FROM entity WHERE entity.id = document_chunk.entity_id AND ${filters.join(" AND ")})`,
        );
      else where.push(...filters);
      return `(${where.join(" AND ")})`;
    });
    params.push(limit);
    const ranking = `SELECT ${document ? CHUNK_COLS : `${ENTITY_COLS}, keyword_text, keyword_segments`}, ts_rank_cd(search_vector, query) AS score
      FROM ${document ? "document_chunk" : "entity"}, plainto_tsquery($2::regconfig, $1) AS query
      WHERE search_vector @@ query AND (${scopes.join(" OR ")})
      ORDER BY score DESC, id LIMIT $${params.length}`;
    // Materialize the bounded ranking BEFORE tokenizing its retained fields. Query
    // lexemes use the same parser/dictionary as plainto_tsquery. Before attributing
    // fields, require the ordered native token stream (including duplicate tokens)
    // to agree with parsing each segment separately. Markup can span the joining
    // newline and hide a term from one field even when another field supplies it.
    // Default-parser token 12 is blank: ignore only these intentional separators.
    // Any other boundary effect yields unknown, preserving aggregate ranking.
    const sql = document ? ranking : `WITH ranked AS MATERIALIZED (${ranking})
      SELECT ranked.*, CASE WHEN keyword_segments IS NULL OR (
        SELECT coalesce(jsonb_agg(jsonb_build_array(parsed.tokid, parsed.token)
          ORDER BY parsed.token_position), '[]'::jsonb)
        FROM ts_parse('default', keyword_text) WITH ORDINALITY AS parsed(tokid, token, token_position)
        WHERE parsed.tokid <> 12
      ) IS DISTINCT FROM (
        SELECT coalesce(jsonb_agg(jsonb_build_array(parsed.tokid, parsed.token)
          ORDER BY source.segment_position, parsed.token_position), '[]'::jsonb)
        FROM jsonb_array_elements(keyword_segments) WITH ORDINALITY AS source(segment, segment_position)
        CROSS JOIN LATERAL ts_parse('default', source.segment->>'text')
          WITH ORDINALITY AS parsed(tokid, token, token_position)
        WHERE parsed.tokid <> 12
      ) THEN NULL ELSE (
        SELECT CASE WHEN tsvector_to_array(to_tsvector($2::regconfig, $1))
          <@ coalesce(array_agg(DISTINCT term.lexeme), ARRAY[]::text[])
          THEN array_agg(DISTINCT segment->>'propertyKey' ORDER BY segment->>'propertyKey')
          ELSE NULL END
        FROM jsonb_array_elements(keyword_segments) AS segment
        CROSS JOIN LATERAL unnest(tsvector_to_array(to_tsvector($2::regconfig, segment->>'text'))) AS term(lexeme)
        WHERE term.lexeme = ANY(tsvector_to_array(to_tsvector($2::regconfig, $1)))
      ) END AS keyword_property_keys FROM ranked ORDER BY score DESC, id`;
    const result = await this.query(sql, params);
    return result.rows.map((row) =>
      document
        ? { chunk: chunkRow(row), score: row.score }
        : {
            entity: entityRow(
              row,
              (searched.find((t) => t.entityTypeKey === row.type_key) as SearchedType).propertyDefs,
            ),
            score: row.score,
            keywordPropertyKeys: row.keyword_property_keys ?? null,
          },
    );
  }

  async propertySearchSemantic(
    types: SearchedType[],
    embedding: number[],
    limit: number,
  ): Promise<Row[]> {
    return this.rankedSemantic(types, embedding, limit, false);
  }

  /** One scan per per-type index, one UNION ALL ranking statement. */
  private async rankedSemantic(
    searched: (SearchedType | SearchedProperty)[],
    embedding: number[],
    limit: number,
    document: boolean,
  ): Promise<Row[]> {
    if (!searched.length) return [];
    return this.tx(async (querier) => {
      await querier.query("SET LOCAL hnsw.iterative_scan = strict_order");
      const params = vectorParams(embedding);
      const scans: string[] = [];
      for (const item of searched) {
        const index =
          "propertyKey" in item
            ? await chunkIndexNameOf(querier, item.entityTypeKey, item.propertyKey)
            : await entityIndexNameOf(querier, item.entityTypeKey);
        const width = (index ? await indexWidth(querier, index) : null) ?? embedding.length;
        params.push(item.entityTypeKey);
        const where = [
          `${document ? "entity_type_key" : "type_key"} = $${params.length}`,
          EMBEDDED,
        ];
        if ("propertyKey" in item) {
          params.push(item.propertyKey);
          where.push(`property_key = $${params.length}`);
        }
        const clauses = buildFilterClauses(item.conditions, params);
        if (document && clauses.length)
          where.push(
            `EXISTS (SELECT 1 FROM entity WHERE entity.id = document_chunk.entity_id AND ${clauses.join(" AND ")})`,
          );
        else where.push(...clauses);
        params.push(limit);
        scans.push(
          `(SELECT ${document ? CHUNK_COLS : ENTITY_COLS}, ${similarity(width)} FROM ${document ? "document_chunk" : "entity"} WHERE ${where.join(" AND ")} ORDER BY ${distance(width)} LIMIT $${params.length})`,
        );
      }
      params.push(limit);
      const result = await querier.query(
        `SELECT * FROM (${scans.join(" UNION ALL ")}) AS ranked ORDER BY score DESC LIMIT $${params.length}`,
        params,
      );
      return result.rows.map((row) =>
        document
          ? { chunk: chunkRow(row), score: row.score }
          : {
              entity: entityRow(
                row,
                (searched.find((t) => t.entityTypeKey === row.type_key) as SearchedType)
                  .propertyDefs,
              ),
              score: row.score,
            },
      );
    });
  }

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
  ): Promise<Row> {
    const result = await this.query(
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
  ): Promise<Row | null> {
    if (!isUuid(relationId)) {
      return null;
    }
    const result = await this.query(
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
    const result = await this.query(`DELETE FROM relation WHERE type_key = $1 AND id = $2`, [
      relationTypeKey,
      relationId,
    ]);
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
