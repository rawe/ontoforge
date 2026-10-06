/**
 * `SearchIndexStore` on PostgreSQL: index definitions, generations and
 * their entries, inside one ontology's namespace.
 *
 * Entries live in `search_entry`, list-partitioned by generation. A
 * generation's partition is a table of its own, `se_<generation uuid
 * hex>` — the name is derived, never stored, and reversible. Its
 * lifecycle:
 *
 * 1. **create** — a standalone table shaped like the parent, carrying a
 *    CHECK that matches its future partition bound (so the attach needs no
 *    validation scan) and btree indexes on `entity_id` and `part_id` for
 *    the deletes that reach it while it fills. A generation still building
 *    for the same index and representation is superseded: it retires.
 * 2. **fill** — entry writes go to the generation's own table by name,
 *    before and after the attach alike, so the caller never knows which.
 * 3. **finish** — build the search structure on the table (semantic: HNSW
 *    over `embedding::halfvec(D)` with the generation's width; keyword:
 *    GIN over `tsv`), then in one transaction attach it, drop the CHECK,
 *    retire the previous active generation and mark this one ready. The
 *    old generation serves until that commit.
 * 4. **retire** — after the switch, the retired partition is detached
 *    (`DETACH … CONCURRENTLY`, which cannot run in a transaction: the
 *    statement runs alone, qualified by namespace) and dropped.
 *
 * The active generation of an index and representation is the one in
 * state `ready`; partial unique indexes allow at most one ready and one
 * building per pair. Readers of a generation's table take its row
 * `FOR SHARE` and check the state, so a state change waits for them and
 * nobody reads a table after the change that leads to its drop. Storage
 * removal always follows a committed state change and is best-effort: a
 * table left behind — an interrupted retirement, a generation deleted by
 * an FK cascade (`search_index` → `entity_type` does not drop tables) — is
 * collected by `sweepGenerations`.
 *
 * The queue (`search_queue`) holds the parts waiting to be composed, per
 * generation. Writes enqueue in their own transaction
 * (`applySearchWritePlan`, run by the runtime store); a worker claims a
 * batch under a lease (`FOR UPDATE SKIP LOCKED`), composes outside any
 * transaction, then completes or fails the claim. An item's
 * `enqueued_at` is the claim's token: enqueueing an item again while it
 * is leased refreshes it, and the completion of the older claim leaves it
 * queued.
 */

import { toSql } from "pgvector";

import { ConflictError, NotFoundError } from "../../core/exceptions.js";

import {
  canonicalKeywordLanguages,
  KEYWORD_LANGUAGES,
  type KeywordLanguage,
} from "../../core/keywordLanguage.js";
import type {
  ClaimedSearchQueueItem,
  IndexContentRequest,
  NewSearchGeneration,
  RankedSearchEntry,
  Row,
  SearchEntryHash,
  SearchEntryPart,
  SearchEntryQuery,
  SearchEntryWrite,
  SearchGenerationRecord,
  SearchGenerationState,
  SearchIndexRecord,
  SearchIndexStore,
  SearchPartKind,
  SearchQueuePartKind,
  SearchQueueStats,
  SearchSettings,
  SearchWritePlan,
} from "../../core/ports.js";
import type { RetrieverAgentRecord, RetrieverAgentWrite } from "../../core/retrieverAgent.js";
import type {
  SearchIndexDefinition,
  SearchIndexKind,
  SearchRepresentation,
} from "../../core/searchIndex.js";
import { MAX_LAST_ERRORS, type IndexContentSize } from "../../core/searchPipeline.js";
import { keywordTsquery } from "../../core/searchQuery.js";
import { runQuery, withTransaction, type DbResult, type Querier } from "./errors.js";
import { buildFilterClauses } from "./filters.js";
import { quoteIdent } from "./oql/bindings.js";
import { isUuid } from "./rows.js";
import { readTypesWithProperties } from "./schemaRead.js";

const INDEX_COLS = "search_index_id, key, kind, definition, created_at, updated_at";

const AGENT_COLS =
  "retriever_agent_id, key, name, description, config_version, config, warnings, created_at, updated_at";

const GENERATION_COLS =
  "generation_id, search_index_id, representation, definition_hash, model_id, dimensions, " +
  "languages, state, total, done, failed, created_at, ready_at";

/** The identity of an entry, the parent's and every partition's key. */
const ENTRY_KEY = "generation_id, entity_id, part_kind, group_no, part_id";

/** A list of parts as a row source (`jsonb_to_recordset`), aliased `p`. */
const PARTS_SOURCE =
  "jsonb_to_recordset($2::jsonb) AS p(entity_id uuid, part_kind text, group_no integer, part_id text)";

const PART_MATCH =
  "e.entity_id = p.entity_id AND e.part_kind = p.part_kind " +
  "AND e.group_no = p.group_no AND e.part_id = p.part_id";

const PARTITION_PATTERN = /^se_([0-9a-f]{32})$/;

/** The channel every server process listens on for queued search work;
 * the payload is the ontology key. One channel per database: the
 * listeners wake for any ontology. */
export const SEARCH_WORK_CHANNEL = "ontoforge_search_work";

/** Enqueueing an item that is already queued refreshes it instead: a new
 * token (so a claim of the older state cannot complete it), a fresh start
 * of its attempts, due now. The lease stays — the worker holding it
 * releases it when it completes. */
const ENQUEUE_CONFLICT =
  `ON CONFLICT (${ENTRY_KEY}) DO UPDATE SET enqueued_at = clock_timestamp(), ` +
  `attempts = 0, not_before = now(), last_error = NULL, last_error_at = NULL`;

const LIVE_STATES = "('building', 'ready')";

/** A list of claimed items as a row source, aliased `c`. */
const CLAIMED_SOURCE =
  "jsonb_to_recordset($1::jsonb) AS c(generation_id uuid, entity_id uuid, part_kind text, " +
  "group_no integer, part_id text, token text, delay_ms double precision)";

const CLAIMED_MATCH =
  "q.generation_id = c.generation_id AND q.entity_id = c.entity_id AND q.part_kind = c.part_kind " +
  "AND q.group_no = c.group_no AND q.part_id = c.part_id";

/** The table one generation's entries live in. */
function partitionName(generationId: string): string {
  return `se_${generationId.replaceAll("-", "")}`;
}

/** The generation a partition name belongs to. */
function generationIdOf(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A vector width as it reaches DDL — the only number interpolated. */
function width(dimensions: number | null): number {
  if (dimensions === null || !Number.isSafeInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid embedding width: ${dimensions}`);
  }
  return dimensions;
}

/** The text-vector expression of a keyword generation: the text stemmed in
 * each language of the set, concatenated. Languages reach SQL only from
 * the closed list. */
function tsvExpression(languages: readonly string[] | null, text: string): string {
  if (languages === null || languages.length === 0) {
    throw new Error("A keyword generation needs a language set");
  }
  return languages
    .map((language) => {
      if (!(KEYWORD_LANGUAGES as readonly string[]).includes(language)) {
        throw new Error(`Unknown keyword language: ${language}`);
      }
      return `to_tsvector('${language}'::regconfig, ${text})`;
    })
    .join(" || ");
}

function partsJson(parts: SearchEntryPart[]): string {
  return JSON.stringify(
    parts.map((part) => ({
      entity_id: part.entityId,
      part_kind: part.partKind,
      group_no: part.groupNo,
      part_id: part.partId,
    })),
  );
}

function toIndex(row: Row): SearchIndexRecord {
  return {
    searchIndexId: row["search_index_id"] as string,
    key: row["key"] as string,
    kind: row["kind"] as SearchIndexKind,
    definition: row["definition"] as SearchIndexDefinition,
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

function toAgent(row: Row): RetrieverAgentRecord {
  return {
    retrieverAgentId: row["retriever_agent_id"] as string,
    key: row["key"] as string,
    name: row["name"] as string,
    description: (row["description"] as string | null) ?? null,
    configVersion: row["config_version"] as number,
    config: row["config"],
    warnings: (row["warnings"] as string[] | null) ?? [],
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

function toGeneration(row: Row): SearchGenerationRecord {
  const languages = row["languages"] as KeywordLanguage[] | null;
  return {
    generationId: row["generation_id"] as string,
    searchIndexId: row["search_index_id"] as string,
    representation: row["representation"] as SearchRepresentation,
    definitionHash: row["definition_hash"] as string,
    modelId: (row["model_id"] as string | null) ?? null,
    dimensions: (row["dimensions"] as number | null) ?? null,
    languages: languages === null ? null : canonicalKeywordLanguages(languages),
    state: row["state"] as SearchGenerationState,
    total: row["total"] as number,
    done: row["done"] as number,
    failed: row["failed"] as number,
    createdAt: row["created_at"] as Date,
    readyAt: (row["ready_at"] as Date | null) ?? null,
  };
}

/** Programming errors in a new generation: each representation carries
 * exactly its own identity. */
function checkNewGeneration(generation: NewSearchGeneration): void {
  if (!isUuid(generation.generationId)) {
    throw new Error(`Invalid generation id: ${generation.generationId}`);
  }
  if (generation.representation === "semantic") {
    width(generation.dimensions);
    if (generation.modelId === null) throw new Error("A semantic generation needs a model id");
  } else {
    tsvExpression(generation.languages, "text");
  }
}

export class PostgresSearchIndexStore implements SearchIndexStore {
  constructor(
    private readonly namespace: string,
    readonly ontologyKey: string,
  ) {}

  private query(text: string, params?: unknown[]): Promise<DbResult> {
    return runQuery(text, params, this.namespace);
  }

  private tx<T>(work: (querier: Querier) => Promise<T>): Promise<T> {
    return withTransaction(work, "READ COMMITTED", this.namespace);
  }

  /** A namespace-qualified name, for statements that run unbound. */
  private qualified(name: string): string {
    return `${quoteIdent(this.namespace)}.${quoteIdent(name)}`;
  }

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------

  async getSearchSettings(): Promise<SearchSettings> {
    const result = await this.query(
      `SELECT keyword_languages, disabled_defaults FROM search_settings`,
    );
    return toSettings(result.rows[0]!);
  }

  async setSearchSettings(settings: SearchSettings): Promise<SearchSettings> {
    const result = await this.query(
      `UPDATE search_settings SET keyword_languages = $1::text[], disabled_defaults = $2::jsonb
       RETURNING keyword_languages, disabled_defaults`,
      [canonicalKeywordLanguages(settings.keywordLanguages), JSON.stringify(settings.disabledDefaults)],
    );
    return toSettings(result.rows[0]!);
  }

  // ------------------------------------------------------------------
  // Index definitions
  // ------------------------------------------------------------------

  async createIndex(
    searchIndexId: string,
    kind: SearchIndexKind,
    definition: SearchIndexDefinition,
  ): Promise<SearchIndexRecord | null> {
    const result = await this.query(
      `INSERT INTO search_index (search_index_id, key, kind, entity_type_id, definition)
       SELECT $1::uuid, $2, $3, et.entity_type_id, $5::jsonb FROM entity_type et WHERE et.key = $4
       RETURNING ${INDEX_COLS}`,
      [searchIndexId, definition.key, kind, definition.entityType, JSON.stringify(definition)],
    );
    const row = result.rows[0];
    return row ? toIndex(row) : null;
  }

  async listIndices(): Promise<SearchIndexRecord[]> {
    const result = await this.query(`SELECT ${INDEX_COLS} FROM search_index ORDER BY key`);
    return result.rows.map(toIndex);
  }

  async getIndex(key: string): Promise<SearchIndexRecord | null> {
    const result = await this.query(`SELECT ${INDEX_COLS} FROM search_index WHERE key = $1`, [key]);
    const row = result.rows[0];
    return row ? toIndex(row) : null;
  }

  async updateIndexDefinition(
    key: string,
    definition: SearchIndexDefinition,
  ): Promise<SearchIndexRecord | null> {
    const result = await this.query(
      `UPDATE search_index si
       SET definition = $2::jsonb, entity_type_id = et.entity_type_id, updated_at = now()
       FROM entity_type et
       WHERE si.key = $1 AND et.key = $3
       RETURNING si.search_index_id, si.key, si.kind, si.definition, si.created_at, si.updated_at`,
      [key, JSON.stringify({ ...definition, key }), definition.entityType],
    );
    const row = result.rows[0];
    return row ? toIndex(row) : null;
  }

  async deleteIndex(key: string): Promise<boolean> {
    // Generations, queued work and lens inclusions go by FK cascade; the
    // partitions are tables, which the sweep removes.
    const result = await this.query(`DELETE FROM search_index WHERE key = $1`, [key]);
    if (result.rowCount === 0) return false;
    await this.bestEffort(() => this.sweepGenerations());
    return true;
  }

  async includeIndexInScopedLenses(key: string): Promise<number> {
    const result = await this.query(
      `INSERT INTO lens_includes (lens_id, search_index_id)
       SELECT l.lens_id, si.search_index_id
       FROM search_index si, lens l
       WHERE si.key = $1 AND (
         EXISTS (SELECT 1 FROM lens_includes i
                 WHERE i.lens_id = l.lens_id AND i.entity_type_id = si.entity_type_id)
         OR (NOT EXISTS (SELECT 1 FROM lens_includes i
                         WHERE i.lens_id = l.lens_id AND i.entity_type_id IS NOT NULL)
             AND EXISTS (SELECT 1 FROM lens_includes i
                         WHERE i.lens_id = l.lens_id AND i.relation_type_id IS NOT NULL)))
       ON CONFLICT DO NOTHING`,
      [key],
    );
    return result.rowCount;
  }

  async listLensIndexInclusions(lensId: string): Promise<string[]> {
    if (!isUuid(lensId)) return [];
    const result = await this.query(
      `SELECT si.key FROM lens_includes li
       JOIN search_index si ON si.search_index_id = li.search_index_id
       WHERE li.lens_id = $1 ORDER BY si.key`,
      [lensId],
    );
    return result.rows.map((row) => row["key"] as string);
  }

  async includeIndexInLens(lensId: string, key: string): Promise<boolean> {
    if (!isUuid(lensId)) return false;
    // A second inclusion of the same index violates
    // `lens_includes_search_index_unique` — a conflict.
    const result = await this.query(
      `INSERT INTO lens_includes (lens_id, search_index_id)
       SELECT l.lens_id, si.search_index_id
       FROM lens l, search_index si
       WHERE l.lens_id = $1 AND si.key = $2`,
      [lensId, key],
    );
    return result.rowCount > 0;
  }

  async excludeIndexFromLens(lensId: string, key: string): Promise<boolean> {
    if (!isUuid(lensId)) return false;
    const result = await this.query(
      `DELETE FROM lens_includes li
       USING search_index si
       WHERE li.lens_id = $1 AND li.search_index_id = si.search_index_id AND si.key = $2`,
      [lensId, key],
    );
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Retriever agents
  // ------------------------------------------------------------------

  async listRetrieverAgents(lensId: string): Promise<RetrieverAgentRecord[]> {
    if (!isUuid(lensId)) return [];
    const result = await this.query(
      `SELECT ${AGENT_COLS} FROM retriever_agent WHERE lens_id = $1 ORDER BY name, key`,
      [lensId],
    );
    return result.rows.map(toAgent);
  }

  async getRetrieverAgent(lensId: string, key: string): Promise<RetrieverAgentRecord | null> {
    if (!isUuid(lensId)) return null;
    const result = await this.query(
      `SELECT ${AGENT_COLS} FROM retriever_agent WHERE lens_id = $1 AND key = $2`,
      [lensId, key],
    );
    const row = result.rows[0];
    return row ? toAgent(row) : null;
  }

  async saveRetrieverAgent(
    lensId: string,
    agent: RetrieverAgentWrite,
    createOnly: boolean,
  ): Promise<[RetrieverAgentRecord, boolean]> {
    return this.tx(async (querier) => {
      // The lens row lock serializes writes to one lens's agents.
      if (!isUuid(lensId) || (await querier.query(
        `SELECT lens_id FROM lens WHERE lens_id = $1 FOR UPDATE`, [lensId],
      )).rows.length === 0) {
        throw new NotFoundError("Lens not found");
      }
      const conflict = createOnly
        ? "ON CONFLICT (lens_id, key) DO NOTHING"
        : `ON CONFLICT (lens_id, key) DO UPDATE SET name = EXCLUDED.name,
             description = EXCLUDED.description, config_version = EXCLUDED.config_version,
             config = EXCLUDED.config, warnings = EXCLUDED.warnings, updated_at = now()`;
      const result = await querier.query(
        `INSERT INTO retriever_agent
           (retriever_agent_id, lens_id, key, name, description, config_version, config, warnings)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
         ${conflict}
         RETURNING ${AGENT_COLS}, retriever_agent_id = $1 AS created`,
        [
          agent.retrieverAgentId, lensId, agent.key, agent.name, agent.description,
          agent.configVersion, JSON.stringify(agent.config), JSON.stringify(agent.warnings),
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ConflictError(`Retriever agent '${agent.key}' already exists in the target lens`);
      }
      return [toAgent(row), row["created"] === true];
    });
  }

  async deleteRetrieverAgent(lensId: string, key: string): Promise<boolean> {
    if (!isUuid(lensId)) return false;
    const result = await this.query(
      `DELETE FROM retriever_agent WHERE lens_id = $1 AND key = $2`,
      [lensId, key],
    );
    return result.rowCount > 0;
  }

  async transferRetrieverAgent(
    sourceLensId: string,
    sourceKey: string,
    targetLensId: string,
    targetKey: string,
    copyId: string | null,
    expectedConfig: string,
  ): Promise<RetrieverAgentRecord> {
    return this.tx(async (querier) => {
      const ids = [...new Set([sourceLensId, targetLensId])];
      // Both owners locked in a fixed order, so two transfers never deadlock.
      const lenses = ids.every(isUuid)
        ? await querier.query(
            `SELECT lens_id FROM lens WHERE lens_id = ANY($1::uuid[]) ORDER BY lens_id FOR UPDATE`,
            [ids],
          )
        : { rows: [] };
      if (lenses.rows.length !== ids.length) throw new NotFoundError("Source or target lens not found");
      const source = (
        await querier.query(
          `SELECT ${AGENT_COLS} FROM retriever_agent WHERE lens_id = $1 AND key = $2 FOR UPDATE`,
          [sourceLensId, sourceKey],
        )
      ).rows[0];
      if (source === undefined) throw new NotFoundError(`Retriever agent '${sourceKey}' not found`);
      if (JSON.stringify([source["config_version"], source["config"]]) !== expectedConfig) {
        throw new ConflictError("Source retriever agent changed; reload before transfer");
      }
      const taken = await querier.query(
        `SELECT key FROM retriever_agent WHERE lens_id = $1 AND key = $2`,
        [targetLensId, targetKey],
      );
      if (taken.rows.length > 0) {
        throw new ConflictError(`Retriever agent '${targetKey}' already exists in the target lens`);
      }
      const result = copyId !== null
        ? await querier.query(
            `INSERT INTO retriever_agent
               (retriever_agent_id, lens_id, key, name, description, config_version, config, warnings)
             SELECT $1, $2, $3, name, description, config_version, config, warnings
               FROM retriever_agent WHERE lens_id = $4 AND key = $5
             RETURNING ${AGENT_COLS}`,
            [copyId, targetLensId, targetKey, sourceLensId, sourceKey],
          )
        : await querier.query(
            `UPDATE retriever_agent SET lens_id = $1, key = $2, updated_at = now()
             WHERE lens_id = $3 AND key = $4 RETURNING ${AGENT_COLS}`,
            [targetLensId, targetKey, sourceLensId, sourceKey],
          );
      return toAgent(result.rows[0]!);
    });
  }

  // ------------------------------------------------------------------
  // Generations
  // ------------------------------------------------------------------

  async createGeneration(
    generation: NewSearchGeneration,
    options: { backfillEntityType?: string } = {},
  ): Promise<SearchGenerationRecord | null> {
    checkNewGeneration(generation);
    if (!isUuid(generation.searchIndexId)) return null;
    const table = partitionName(generation.generationId);
    const created = await this.tx(async (querier) => {
      // Serializes generation changes of one index.
      const index = await querier.query(
        `SELECT 1 FROM search_index WHERE search_index_id = $1 FOR UPDATE`,
        [generation.searchIndexId],
      );
      if (index.rowCount === 0) return null;
      const superseded = await retire(querier, generation.searchIndexId, generation.representation, "building");
      const inserted = await querier.query(
        `INSERT INTO search_generation
           (generation_id, search_index_id, representation, definition_hash, model_id,
            dimensions, languages, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], 'building')
         RETURNING ${GENERATION_COLS}`,
        [
          generation.generationId,
          generation.searchIndexId,
          generation.representation,
          generation.definitionHash,
          generation.representation === "semantic" ? generation.modelId : null,
          generation.representation === "semantic" ? generation.dimensions : null,
          generation.representation === "keyword" ? generation.languages : null,
        ],
      );
      await querier.query(
        `CREATE TABLE ${table} (LIKE search_entry,
           CONSTRAINT ${table}_pk PRIMARY KEY (${ENTRY_KEY}),
           CONSTRAINT ${table}_bound CHECK (generation_id = '${generation.generationId}'::uuid))`,
      );
      await querier.query(`CREATE INDEX ${table}_entity ON ${table} (entity_id)`);
      await querier.query(`CREATE INDEX ${table}_part ON ${table} (part_id)`);
      let record = toGeneration(inserted.rows[0]!);
      if (options.backfillEntityType !== undefined) {
        const queued = await enqueueEntities(querier, [generation.generationId], options.backfillEntityType);
        const counted = await querier.query(
          `UPDATE search_generation SET total = $2 WHERE generation_id = $1 RETURNING ${GENERATION_COLS}`,
          [generation.generationId, queued],
        );
        record = toGeneration(counted.rows[0]!);
        if (queued > 0) await notifySearchWork(querier, this.ontologyKey);
      }
      return { record, superseded };
    });
    if (created === null) return null;
    await this.bestEffort(() => this.dropPartitions(created.superseded));
    return created.record;
  }

  async getGeneration(generationId: string): Promise<SearchGenerationRecord | null> {
    if (!isUuid(generationId)) return null;
    const result = await this.query(
      `SELECT ${GENERATION_COLS} FROM search_generation WHERE generation_id = $1`,
      [generationId],
    );
    const row = result.rows[0];
    return row ? toGeneration(row) : null;
  }

  async listGenerations(searchIndexId?: string): Promise<SearchGenerationRecord[]> {
    if (searchIndexId !== undefined && !isUuid(searchIndexId)) return [];
    const result = await this.query(
      `SELECT ${GENERATION_COLS} FROM search_generation
       WHERE $1::uuid IS NULL OR search_index_id = $1::uuid
       ORDER BY created_at, generation_id`,
      [searchIndexId ?? null],
    );
    return result.rows.map(toGeneration);
  }

  async recordGenerationProgress(
    generationId: string,
    delta: { total?: number; done?: number; failed?: number },
  ): Promise<void> {
    if (!isUuid(generationId)) return;
    await this.query(
      `UPDATE search_generation
       SET total = total + $2, done = done + $3, failed = failed + $4
       WHERE generation_id = $1`,
      [generationId, delta.total ?? 0, delta.done ?? 0, delta.failed ?? 0],
    );
  }

  async finishGeneration(generationId: string): Promise<boolean> {
    const generation = await this.getGeneration(generationId);
    if (generation === null || generation.state !== "building") return false;
    const table = partitionName(generationId);

    // The search structure first, in a transaction of its own: a long
    // build holds no lock a modeling change would wait for. Writers to the
    // table wait; a superseding change drops the table only afterwards.
    const built = await this.tx(async (querier) => {
      const exists = await querier.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [table]);
      if (exists.rows[0]?.["present"] !== true) return false;
      if (generation.representation === "semantic") {
        await querier.query(
          `CREATE INDEX IF NOT EXISTS ${table}_embedding ON ${table}
           USING hnsw ((embedding::halfvec(${width(generation.dimensions)})) halfvec_cosine_ops)`,
        );
      } else {
        await querier.query(`CREATE INDEX IF NOT EXISTS ${table}_tsv ON ${table} USING gin (tsv)`);
      }
      return true;
    });
    if (!built) return false;

    const retired = await this.tx(async (querier) => {
      await querier.query(`SELECT 1 FROM search_index WHERE search_index_id = $1 FOR UPDATE`, [
        generation.searchIndexId,
      ]);
      const current = await querier.query(
        `SELECT state FROM search_generation WHERE generation_id = $1 FOR UPDATE`,
        [generationId],
      );
      if (current.rows[0]?.["state"] !== "building") return null;
      const previous = await retire(querier, generation.searchIndexId, generation.representation, "ready");
      await querier.query(
        `ALTER TABLE search_entry ATTACH PARTITION ${table} FOR VALUES IN ('${generationId}')`,
      );
      await querier.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_bound`);
      await querier.query(
        `UPDATE search_generation SET state = 'ready', ready_at = now() WHERE generation_id = $1`,
        [generationId],
      );
      return previous;
    });
    if (retired === null) return false;
    await this.bestEffort(() => this.dropPartitions(retired));
    return true;
  }

  async failGeneration(generationId: string): Promise<boolean> {
    if (!isUuid(generationId)) return false;
    const failed = await this.tx(async (querier) => {
      const result = await querier.query(
        `UPDATE search_generation SET state = 'failed'
         WHERE generation_id = $1 AND state = 'building'`,
        [generationId],
      );
      if (result.rowCount === 0) return false;
      await querier.query(`DELETE FROM search_queue WHERE generation_id = $1`, [generationId]);
      return true;
    });
    if (failed) await this.bestEffort(() => this.dropPartitions([generationId]));
    return failed;
  }

  async retireGeneration(generationId: string): Promise<boolean> {
    if (!isUuid(generationId)) return false;
    const retired = await this.tx(async (querier) => {
      const result = await querier.query(
        `UPDATE search_generation SET state = 'retired'
         WHERE generation_id = $1 AND state IN ${LIVE_STATES}`,
        [generationId],
      );
      if (result.rowCount === 0) return false;
      await querier.query(`DELETE FROM search_queue WHERE generation_id = $1`, [generationId]);
      return true;
    });
    if (retired) await this.bestEffort(() => this.dropPartitions([generationId]));
    return retired;
  }

  async sweepGenerations(): Promise<void> {
    const tables = await this.query(
      `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname ~ '^se_[0-9a-f]{32}$'`,
    );
    // A later statement than the catalog read: a table and its generation
    // row commit together, so every table seen above has its row visible.
    const live = await this.query(
      `SELECT generation_id FROM search_generation WHERE state IN ('building', 'ready')`,
    );
    const liveIds = new Set(live.rows.map((row) => row["generation_id"] as string));
    const orphans = tables.rows
      .map((row) => generationIdOf(PARTITION_PATTERN.exec(row["relname"] as string)![1]!))
      .filter((generationId) => !liveIds.has(generationId));
    await this.dropPartitions(orphans);
  }

  // ------------------------------------------------------------------
  // Entries
  // ------------------------------------------------------------------

  async upsertEntries(generationId: string, entries: SearchEntryWrite[]): Promise<boolean> {
    if (!isUuid(generationId)) return false;
    return this.tx(async (querier) => {
      const generation = await liveGeneration(querier, generationId);
      if (generation === null) return false;
      if (entries.length === 0) return true;
      const semantic = generation.representation === "semantic";
      if (semantic) {
        for (const entry of entries) {
          if (entry.embedding !== null && entry.embedding.length !== generation.dimensions) {
            throw new Error(
              `Embedding width ${entry.embedding.length} does not match the generation's ` +
                `${generation.dimensions}`,
            );
          }
        }
      }
      const tsv = semantic ? "NULL::tsvector" : tsvExpression(generation.languages, "e.text");
      const rows = entries.map((entry) => ({
        entity_id: entry.entityId,
        part_kind: entry.partKind,
        group_no: entry.groupNo,
        part_id: entry.partId,
        relation_type: entry.relationType,
        target_type: entry.targetType,
        target_id: entry.targetId,
        start_char: entry.startChar,
        char_length: entry.charLength,
        text: entry.text,
        text_hash: entry.textHash,
        embedding: semantic && entry.embedding !== null ? JSON.stringify(entry.embedding) : null,
      }));
      await querier.query(
        `INSERT INTO ${partitionName(generationId)}
           (${ENTRY_KEY}, relation_type, target_type, target_id, start_char, char_length,
            text, text_hash, embedding, tsv)
         SELECT $1::uuid, e.entity_id, e.part_kind, e.group_no, e.part_id, e.relation_type,
                e.target_type, e.target_id, e.start_char, e.char_length, e.text,
                decode(e.text_hash, 'hex'), e.embedding::halfvec, ${tsv}
         FROM jsonb_to_recordset($2::jsonb) AS e(
           entity_id uuid, part_kind text, group_no integer, part_id text, relation_type text,
           target_type text, target_id uuid, start_char integer, char_length integer,
           text text, text_hash text, embedding text)
         ON CONFLICT (${ENTRY_KEY}) DO UPDATE SET
           relation_type = EXCLUDED.relation_type, target_type = EXCLUDED.target_type,
           target_id = EXCLUDED.target_id, start_char = EXCLUDED.start_char,
           char_length = EXCLUDED.char_length, text = EXCLUDED.text,
           text_hash = EXCLUDED.text_hash, embedding = EXCLUDED.embedding, tsv = EXCLUDED.tsv`,
        [generationId, JSON.stringify(rows)],
      );
      return true;
    });
  }

  async readEntryHashes(
    generationId: string,
    parts: SearchEntryPart[],
  ): Promise<SearchEntryHash[]> {
    if (!isUuid(generationId) || parts.length === 0) return [];
    return this.tx(async (querier) => {
      if ((await liveGeneration(querier, generationId)) === null) return [];
      const result = await querier.query(
        `SELECT e.entity_id, e.part_kind, e.group_no, e.part_id, encode(e.text_hash, 'hex') AS text_hash
         FROM ${partitionName(generationId)} e, ${PARTS_SOURCE}
         WHERE e.generation_id = $1 AND ${PART_MATCH}`,
        [generationId, partsJson(parts)],
      );
      return result.rows.map((row) => ({
        entityId: row["entity_id"] as string,
        partKind: row["part_kind"] as SearchPartKind,
        groupNo: row["group_no"] as number,
        partId: row["part_id"] as string,
        textHash: row["text_hash"] as string,
      }));
    });
  }

  async deleteEntries(generationId: string, parts: SearchEntryPart[]): Promise<number> {
    if (!isUuid(generationId) || parts.length === 0) return 0;
    return this.tx(async (querier) => {
      if ((await liveGeneration(querier, generationId)) === null) return 0;
      const result = await querier.query(
        `DELETE FROM ${partitionName(generationId)} e USING ${PARTS_SOURCE}
         WHERE e.generation_id = $1 AND ${PART_MATCH}`,
        [generationId, partsJson(parts)],
      );
      return result.rowCount;
    });
  }

  async deleteEntityPartsExcept(
    generationId: string,
    entityId: string,
    partKind: SearchPartKind,
    groupNo: number,
    keepPartIds: string[],
  ): Promise<number> {
    if (!isUuid(generationId) || !isUuid(entityId)) return 0;
    return this.tx(async (querier) => {
      if ((await liveGeneration(querier, generationId)) === null) return 0;
      const result = await querier.query(
        `DELETE FROM ${partitionName(generationId)}
         WHERE entity_id = $1 AND part_kind = $2 AND group_no = $3
           AND NOT (part_id = ANY($4::text[]))`,
        [entityId, partKind, groupNo, keepPartIds],
      );
      return result.rowCount;
    });
  }

  async deleteEntriesOfEntity(entityId: string): Promise<number> {
    if (!isUuid(entityId)) return 0;
    return this.deleteEverywhere(`entity_id = $1`, [entityId]);
  }

  async deleteEntriesOfRelation(relationId: string): Promise<number> {
    if (!isUuid(relationId)) return 0;
    return this.deleteEverywhere(`part_kind = 'relation' AND part_id = $1`, [relationId]);
  }

  /**
   * One ranking over a ready generation's partition, its row share-locked
   * so the table stays while it is read. Semantic: an iterative HNSW scan
   * (`strict_order`) at the generation's width, so the limit counts the
   * entries that pass the filters. Keyword: the query's lexemes in each
   * language of the generation's set (`keywordTsquery`), ranked by
   * `ts_rank_cd`. Entity filters run as an `EXISTS` on the owning entity.
   */
  async rankEntries(query: SearchEntryQuery): Promise<RankedSearchEntry[]> {
    if (!isUuid(query.generationId) || query.limit < 1) return [];
    const table = partitionName(query.generationId);
    return this.tx(async (querier) => {
      const generation = await liveGeneration(querier, query.generationId);
      if (generation === null || generation.state !== "ready") return [];

      const params: unknown[] = [];
      let rank: string;
      let order: string;
      const where: string[] = [];
      if (generation.representation === "semantic") {
        const dimensions = width(generation.dimensions);
        if (query.vector === undefined || query.vector.length !== dimensions) {
          throw new Error(
            `Query vector width ${query.vector?.length} does not match the generation's ${dimensions}`,
          );
        }
        await querier.query("SET LOCAL hnsw.iterative_scan = strict_order");
        params.push(toSql(query.vector));
        const distance = `s.embedding::halfvec(${dimensions}) <=> $1::halfvec(${dimensions})`;
        rank = `1 - (${distance}) / 2`;
        order = distance;
        where.push("s.embedding IS NOT NULL");
      } else {
        const lexemes = await querier.query(
          `SELECT tsvector_to_array(to_tsvector(language::regconfig, $1)) AS lexemes
           FROM unnest($2::text[]) WITH ORDINALITY AS l(language, n) ORDER BY n`,
          [query.text ?? "", generation.languages ?? []],
        );
        const tsquery = keywordTsquery(
          lexemes.rows.map((row) => row["lexemes"] as string[]),
          query.matching ?? "any",
        );
        if (tsquery === null) return [];
        params.push(tsquery);
        rank = "ts_rank_cd(s.tsv, $1::tsquery)";
        order = "score DESC, s.entity_id, s.part_kind, s.group_no, s.part_id";
        where.push("s.tsv @@ $1::tsquery");
      }
      if (query.entityIds !== undefined && query.entityIds !== null) {
        if (query.entityIds.length === 0) return [];
        params.push(query.entityIds.filter(isUuid));
        where.push(`s.entity_id = ANY($${params.length}::uuid[])`);
      }
      if (query.relationTypes !== null) {
        params.push(query.relationTypes);
        where.push(`(s.relation_type IS NULL OR s.relation_type = ANY($${params.length}::text[]))`);
      }
      if (query.targetTypes !== null) {
        params.push(query.targetTypes);
        where.push(`(s.target_type IS NULL OR s.target_type = ANY($${params.length}::text[]))`);
      }
      const filters = buildFilterClauses(query.conditions, params);
      if (filters.length > 0) {
        where.push(
          `EXISTS (SELECT 1 FROM entity WHERE entity.id = s.entity_id AND ${filters.join(" AND ")})`,
        );
      }
      params.push(query.limit);
      const result = await querier.query(
        `SELECT s.entity_id, s.part_kind, s.group_no, s.part_id, s.relation_type, s.target_type,
                s.target_id, s.start_char, s.char_length, s.text, ${rank} AS score
         FROM ${table} s
         WHERE ${where.join(" AND ")}
         ORDER BY ${order}
         LIMIT $${params.length}`,
        params,
      );
      return result.rows.map((row) => ({
        entityId: row["entity_id"] as string,
        partKind: row["part_kind"] as SearchPartKind,
        groupNo: row["group_no"] as number,
        partId: row["part_id"] as string,
        relationType: (row["relation_type"] as string | null) ?? null,
        targetType: (row["target_type"] as string | null) ?? null,
        targetId: (row["target_id"] as string | null) ?? null,
        startChar: (row["start_char"] as number | null) ?? null,
        charLength: (row["char_length"] as number | null) ?? null,
        text: row["text"] as string,
        score: Number(row["score"]),
      }));
    });
  }

  // ------------------------------------------------------------------
  // Queue
  // ------------------------------------------------------------------

  async readFullSchema(): Promise<Row> {
    return withTransaction(
      (querier) => readTypesWithProperties(querier, false),
      "REPEATABLE READ",
      this.namespace,
    );
  }

  async enqueueEntityType(generationIds: string[], entityTypeKey: string): Promise<number> {
    const ids = generationIds.filter(isUuid);
    if (ids.length === 0) return 0;
    return this.tx(async (querier) => {
      const queued = await enqueueEntities(querier, ids, entityTypeKey);
      if (queued > 0) await notifySearchWork(querier, this.ontologyKey);
      return queued;
    });
  }

  async claimQueueItems(options: {
    limit: number;
    leaseSeconds: number;
    maxAttempts: number;
    semanticModelId: string | null;
  }): Promise<ClaimedSearchQueueItem[]> {
    // One statement: the rows are locked, skipping those another claim
    // holds, and leased; the lease commits with it.
    const result = await this.query(
      `WITH claimable AS (
         SELECT q.generation_id, q.entity_id, q.part_kind, q.group_no, q.part_id, g.representation
         FROM search_queue q JOIN search_generation g ON g.generation_id = q.generation_id
         WHERE g.state IN ${LIVE_STATES}
           AND q.attempts < $2 AND q.not_before <= now()
           AND (q.lease_until IS NULL OR q.lease_until < now())
           AND (g.representation = 'keyword' OR g.model_id = $3::text)
         ORDER BY g.representation = 'keyword' DESC, q.enqueued_at
         LIMIT $1
         FOR UPDATE OF q SKIP LOCKED
       )
       UPDATE search_queue q SET lease_until = now() + make_interval(secs => $4::double precision)
       FROM claimable c
       WHERE ${CLAIMED_MATCH}
       RETURNING q.generation_id, q.entity_id, q.part_kind, q.group_no, q.part_id, q.attempts,
                 q.enqueued_at::text AS token, c.representation`,
      [options.limit, options.maxAttempts, options.semanticModelId, options.leaseSeconds],
    );
    return result.rows.map((row) => ({
      generationId: row["generation_id"] as string,
      entityId: row["entity_id"] as string,
      partKind: row["part_kind"] as SearchQueuePartKind,
      groupNo: row["group_no"] as number,
      partId: row["part_id"] as string,
      representation: row["representation"] as SearchRepresentation,
      attempts: row["attempts"] as number,
      token: row["token"] as string,
    }));
  }

  async completeQueueItems(items: ClaimedSearchQueueItem[]): Promise<void> {
    if (items.length === 0) return;
    await this.tx(async (querier) => {
      const claimed = claimedJson(items.map((item) => ({ item, delayMs: 0 })));
      await querier.query(
        `DELETE FROM search_queue q USING ${CLAIMED_SOURCE}
         WHERE ${CLAIMED_MATCH} AND q.enqueued_at = c.token::timestamptz`,
        [claimed],
      );
      // Enqueued again while leased: keep it, released for the next claim.
      await querier.query(
        `UPDATE search_queue q SET lease_until = NULL FROM ${CLAIMED_SOURCE} WHERE ${CLAIMED_MATCH}`,
        [claimed],
      );
    });
  }

  async failQueueItems(
    failures: { item: ClaimedSearchQueueItem; delayMs: number }[],
    error: string,
  ): Promise<void> {
    if (failures.length === 0) return;
    await this.tx(async (querier) => {
      const claimed = claimedJson(failures);
      // An item enqueued again since its claim already starts afresh.
      await querier.query(
        `UPDATE search_queue q
         SET attempts = q.attempts + 1, last_error = $2, last_error_at = now(), lease_until = NULL,
             not_before = now() + make_interval(secs => c.delay_ms / 1000.0)
         FROM ${CLAIMED_SOURCE}
         WHERE ${CLAIMED_MATCH} AND q.enqueued_at = c.token::timestamptz`,
        [claimed, error.slice(0, 2000)],
      );
      await querier.query(
        `UPDATE search_queue q SET lease_until = NULL FROM ${CLAIMED_SOURCE} WHERE ${CLAIMED_MATCH}`,
        [claimed],
      );
    });
  }

  async queueStats(maxAttempts: number): Promise<SearchQueueStats[]> {
    // Per generation: the counts, and the newest item per distinct error
    // message, newest first.
    const result = await this.query(
      `WITH errors AS (
         SELECT DISTINCT ON (generation_id, last_error)
                generation_id, entity_id, part_kind, last_error,
                coalesce(last_error_at, enqueued_at) AS at
         FROM search_queue WHERE last_error IS NOT NULL
         ORDER BY generation_id, last_error, at DESC
       ), ranked AS (
         SELECT *, row_number() OVER (PARTITION BY generation_id ORDER BY at DESC) AS n FROM errors
       )
       SELECT q.generation_id,
              count(*) FILTER (WHERE q.attempts < $1)::int AS pending,
              count(*) FILTER (WHERE q.attempts >= $1)::int AS failed,
              (SELECT coalesce(jsonb_agg(jsonb_build_object(
                         'entityId', r.entity_id, 'partKind', r.part_kind,
                         'message', r.last_error, 'at', r.at) ORDER BY r.at DESC), '[]'::jsonb)
               FROM ranked r WHERE r.generation_id = q.generation_id AND r.n <= $2) AS last_errors
       FROM search_queue q GROUP BY q.generation_id`,
      [maxAttempts, MAX_LAST_ERRORS],
    );
    return result.rows.map((row) => ({
      generationId: row["generation_id"] as string,
      pending: row["pending"] as number,
      failed: row["failed"] as number,
      lastErrors: (row["last_errors"] as Row[]).map((error) => ({
        entityId: error["entityId"] as string,
        partKind: error["partKind"] as SearchQueuePartKind,
        message: error["message"] as string,
        at: new Date(error["at"] as string),
      })),
    }));
  }

  // ------------------------------------------------------------------
  // Modeling reads
  // ------------------------------------------------------------------

  async findLensesIncludingIndex(key: string): Promise<string[]> {
    const result = await this.query(
      `SELECT l.key FROM lens_includes li
       JOIN lens l ON l.lens_id = li.lens_id
       JOIN search_index si ON si.search_index_id = li.search_index_id
       WHERE si.key = $1 ORDER BY l.key`,
      [key],
    );
    return result.rows.map((row) => row["key"] as string);
  }

  async measureIndexContent(request: IndexContentRequest): Promise<IndexContentSize> {
    // Passages per document, as the chunker cuts them: one up to the chunk
    // size, then one per further (size - overlap) characters. The chunker
    // prefers boundaries, so a real document may need a few more.
    const passages = request.passages;
    const entities = await this.query(
      `SELECT count(*)::int AS entities,
              coalesce(sum(CASE
                WHEN $2::text IS NULL THEN 0
                WHEN coalesce(char_length(e.props ->> $2::text), 0) = 0 THEN 0
                WHEN char_length(e.props ->> $2::text) <= $3::int THEN 1
                ELSE 1 + ceil((char_length(e.props ->> $2::text) - $3::int)::numeric
                              / ($3::int - $4::int))
              END), 0)::bigint AS passages
       FROM entity e WHERE e.type_key = $1`,
      [request.entityType, passages?.property ?? null, passages?.chunkSize ?? 1, passages?.chunkOverlap ?? 0],
    );
    const entityCount = entities.rows[0]!["entities"] as number;
    let relationEntries = 0;
    for (const group of request.groups) {
      const [own, other] = group.owner === "from" ? ["from_id", "to_id"] : ["to_id", "from_id"];
      const relations = await this.query(
        `SELECT count(*)::bigint AS n
         FROM relation r
         JOIN entity o ON o.id = r.${own}
         JOIN entity t ON t.id = r.${other}
         WHERE r.type_key = $1 AND o.type_key = $2
           AND ($3::text[] IS NULL OR t.type_key = ANY($3::text[]))`,
        [group.relationType, request.entityType, group.targetTypes],
      );
      relationEntries += Number(relations.rows[0]!["n"]);
    }
    return {
      entities: entityCount,
      selfEntries: request.selfEntries ? entityCount : 0,
      relationEntries,
      passageEntries: Number(entities.rows[0]!["passages"]),
    };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Delete matching entries in every generation (`deleteEntriesEverywhere`). */
  private async deleteEverywhere(where: string, params: unknown[]): Promise<number> {
    return this.tx((querier) => deleteEntriesEverywhere(querier, where, params));
  }

  /**
   * Remove the tables of generations that no longer serve: detach an
   * attached one first — concurrently, so readers of the other partitions
   * never wait, or finalizing a detach an interruption left pending —
   * then drop it. Each statement runs alone, outside any transaction, as
   * `DETACH … CONCURRENTLY` requires.
   */
  private async dropPartitions(generationIds: string[]): Promise<void> {
    if (generationIds.length === 0) return;
    const tables = generationIds.map(partitionName);
    const attached = await this.query(
      `SELECT c.relname, i.inhdetachpending AS pending
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relname = ANY($1::text[])`,
      [tables],
    );
    const pending = new Map(
      attached.rows.map((row) => [row["relname"] as string, row["pending"] as boolean]),
    );
    const parent = this.qualified("search_entry");
    for (const table of tables) {
      if (pending.has(table)) {
        const mode = pending.get(table) ? "FINALIZE" : "CONCURRENTLY";
        await runQuery(`ALTER TABLE ${parent} DETACH PARTITION ${this.qualified(table)} ${mode}`);
      }
      await runQuery(`DROP TABLE IF EXISTS ${this.qualified(table)}`);
    }
  }

  /** Storage removal after a committed state change: a failure is logged
   * (by the doors) and left to the next sweep, never the caller's. */
  private async bestEffort(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch {
      // Logged as a storage failure; `sweepGenerations` retries.
    }
  }
}

// ---------------------------------------------------------------------------
// Shared with the runtime store's writes
// ---------------------------------------------------------------------------

/**
 * Delete matching entries in every generation: through the parent for
 * the attached partitions, and from each building generation's table,
 * which is not attached yet. Runs on the caller's transaction.
 */
export async function deleteEntriesEverywhere(
  querier: Querier,
  where: string,
  params: unknown[],
): Promise<number> {
  const building = await querier.query(
    `SELECT generation_id FROM search_generation WHERE state = 'building'
     ORDER BY generation_id FOR SHARE`,
  );
  let deleted = (await querier.query(`DELETE FROM search_entry WHERE ${where}`, params)).rowCount;
  for (const row of building.rows) {
    const table = partitionName(row["generation_id"] as string);
    deleted += (await querier.query(`DELETE FROM ${table} WHERE ${where}`, params)).rowCount;
  }
  return deleted;
}

/** The relations an entity is an end of, as relation-part ids. */
const RELATIONS_OF_ENTITY =
  "part_kind = 'relation' AND part_id IN (SELECT id::text FROM relation WHERE from_id = $1 OR to_id = $1)";

/**
 * Apply the search work of one write on the write's own transaction, so it
 * commits — or not — with the write. Index ids resolve to every building
 * or ready generation of the index. An entity deletion must be applied
 * before the entity row goes: the relations that cascade with it name the
 * entries of their other ends. The workers are woken by a notification
 * that PostgreSQL delivers at commit.
 */
export async function applySearchWritePlan(
  querier: Querier,
  plan: SearchWritePlan,
  ontologyKey: string,
): Promise<void> {
  if (plan.deleteEntity !== null && isUuid(plan.deleteEntity)) {
    const where = `entity_id = $1 OR (${RELATIONS_OF_ENTITY})`;
    await querier.query(`DELETE FROM search_queue WHERE ${where}`, [plan.deleteEntity]);
    await deleteEntriesEverywhere(querier, where, [plan.deleteEntity]);
  }
  if (plan.deleteRelation !== null && isUuid(plan.deleteRelation)) {
    const where = `part_kind = 'relation' AND part_id = $1`;
    await querier.query(`DELETE FROM search_queue WHERE ${where}`, [plan.deleteRelation]);
    await deleteEntriesEverywhere(querier, where, [plan.deleteRelation]);
  }

  let queued = 0;
  if (plan.entityParts.length > 0) {
    const result = await querier.query(
      `INSERT INTO search_queue (${ENTRY_KEY})
       SELECT DISTINCT g.generation_id, p.entity_id, p.part_kind, p.group_no, p.part_id
       FROM jsonb_to_recordset($1::jsonb) AS p(search_index_id uuid, entity_id uuid,
              part_kind text, group_no integer, part_id text)
       JOIN search_generation g ON g.search_index_id = p.search_index_id AND g.state IN ${LIVE_STATES}
       ${ENQUEUE_CONFLICT}`,
      [
        JSON.stringify(
          plan.entityParts.map((part) => ({
            search_index_id: part.searchIndexId,
            entity_id: part.entityId,
            part_kind: part.partKind,
            group_no: part.groupNo,
            part_id: part.partId,
          })),
        ),
      ],
    );
    queued += result.rowCount;
  }
  if (plan.relationParts.length > 0) {
    const result = await querier.query(
      `INSERT INTO search_queue (${ENTRY_KEY})
       SELECT DISTINCT g.generation_id,
              CASE WHEN p.owner = 'from' THEN r.from_id ELSE r.to_id END,
              'relation', p.group_no, r.id::text
       FROM jsonb_to_recordset($1::jsonb) AS p(search_index_id uuid, group_no integer,
              relation_id uuid, owner text)
       JOIN relation r ON r.id = p.relation_id
       JOIN search_generation g ON g.search_index_id = p.search_index_id AND g.state IN ${LIVE_STATES}
       ${ENQUEUE_CONFLICT}`,
      [
        JSON.stringify(
          plan.relationParts.map((part) => ({
            search_index_id: part.searchIndexId,
            group_no: part.groupNo,
            relation_id: part.relationId,
            owner: part.owner,
          })),
        ),
      ],
    );
    queued += result.rowCount;
  }
  if (plan.fanOut.length > 0) {
    const result = await querier.query(
      `INSERT INTO search_queue (${ENTRY_KEY})
       SELECT DISTINCT g.generation_id,
              CASE WHEN p.owner = 'from' THEN r.from_id ELSE r.to_id END,
              'relation', p.group_no, r.id::text
       FROM jsonb_to_recordset($1::jsonb) AS p(search_index_id uuid, group_no integer,
              relation_type text, owner text, target_entity_id uuid)
       JOIN relation r ON r.type_key = p.relation_type
        AND ((p.owner = 'from' AND r.to_id = p.target_entity_id)
          OR (p.owner = 'to' AND r.from_id = p.target_entity_id))
       JOIN search_generation g ON g.search_index_id = p.search_index_id AND g.state IN ${LIVE_STATES}
       ${ENQUEUE_CONFLICT}`,
      [
        JSON.stringify(
          plan.fanOut.map((part) => ({
            search_index_id: part.searchIndexId,
            group_no: part.groupNo,
            relation_type: part.relationType,
            owner: part.owner,
            target_entity_id: part.targetEntityId,
          })),
        ),
      ],
    );
    queued += result.rowCount;
  }
  if (queued > 0) await notifySearchWork(querier, ontologyKey);
}

/** Queue one `entity` item per entity of a type into each live generation
 * of `generationIds`. The count queued. */
async function enqueueEntities(
  querier: Querier,
  generationIds: string[],
  entityTypeKey: string,
): Promise<number> {
  const result = await querier.query(
    `INSERT INTO search_queue (${ENTRY_KEY})
     SELECT g.generation_id, e.id, 'entity', 0, ''
     FROM search_generation g, entity e
     WHERE g.generation_id = ANY($1::uuid[]) AND g.state IN ${LIVE_STATES} AND e.type_key = $2
     ${ENQUEUE_CONFLICT}`,
    [generationIds, entityTypeKey],
  );
  return result.rowCount;
}

/** Wake the workers of every server process — delivered at commit. */
async function notifySearchWork(querier: Querier, ontologyKey: string): Promise<void> {
  await querier.query(`SELECT pg_notify($1, $2)`, [SEARCH_WORK_CHANNEL, ontologyKey]);
}

function claimedJson(failures: { item: ClaimedSearchQueueItem; delayMs: number }[]): string {
  return JSON.stringify(
    failures.map(({ item, delayMs }) => ({
      generation_id: item.generationId,
      entity_id: item.entityId,
      part_kind: item.partKind,
      group_no: item.groupNo,
      part_id: item.partId,
      token: item.token,
      delay_ms: delayMs,
    })),
  );
}

function toSettings(row: Row): SearchSettings {
  return {
    keywordLanguages: canonicalKeywordLanguages(row["keyword_languages"] as KeywordLanguage[]),
    disabledDefaults: row["disabled_defaults"] as Record<string, unknown>,
  };
}

/** Retire the generation of an index and representation in one state
 * (`building`: superseded; `ready`: replaced) and drop its queued work.
 * Returns the retired ids — their tables are the caller's to remove. */
async function retire(
  querier: Querier,
  searchIndexId: string,
  representation: SearchRepresentation,
  state: "building" | "ready",
): Promise<string[]> {
  const result = await querier.query(
    `UPDATE search_generation SET state = 'retired'
     WHERE search_index_id = $1 AND representation = $2 AND state = $3
     RETURNING generation_id`,
    [searchIndexId, representation, state],
  );
  const ids = result.rows.map((row) => row["generation_id"] as string);
  if (ids.length > 0) {
    await querier.query(`DELETE FROM search_queue WHERE generation_id = ANY($1::uuid[])`, [ids]);
  }
  return ids;
}

/** The generation, share-locked, while it is building or ready; null
 * otherwise. Holding the lock keeps its table from going away. */
async function liveGeneration(
  querier: Querier,
  generationId: string,
): Promise<SearchGenerationRecord | null> {
  const result = await querier.query(
    `SELECT ${GENERATION_COLS} FROM search_generation
     WHERE generation_id = $1 AND state IN ('building', 'ready') FOR SHARE`,
    [generationId],
  );
  const row = result.rows[0];
  return row ? toGeneration(row) : null;
}
