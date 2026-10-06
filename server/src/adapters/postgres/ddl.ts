/**
 * Init DDL and the vector-index lifecycle.
 *
 * `initSchema` runs the server-wide DDL — the pgvector extension, the
 * `public.ontology` registry table and the storage version — and the
 * storage upgrade as one all-or-nothing transaction at adapter init
 * (`storageVersion.ts`). The ontology table set is ontology-scoped and runs only at
 * ontology creation, inside the fresh `ont_<key>` namespace
 * (`registry.ts`). Idempotence rides `CREATE TABLE IF NOT EXISTS` with
 * all constraints inline and explicitly named (PG has no
 * `ADD CONSTRAINT IF NOT EXISTS`) — except the name-property FK, which
 * closes the `entity_type` ↔ `property_def` cycle after both tables
 * exist.
 *
 * The saved-query index functions take the caller's bound `namespace` and
 * run their transactions inside it, so index DDL and catalog reads
 * (`current_schema()`) resolve within that ontology alone.
 *
 * The DDL carries structure only — identity, referential integrity,
 * exactly-one-owner, uniqueness. Business rules validate in the service,
 * with no backstop CHECKs; the search tables check only their closed
 * vocabularies (index kind, representation, generation state). The
 * `entity`/`relation` `type_key` columns get no FK to the schema tables:
 * deleting a type deliberately orphans its instances. Search over
 * instances lives in the search-index tables alone; the one vector
 * column beside them, the saved-query description's, is dimensionless, so
 * init is provider-independent — the width lives only in its HNSW index,
 * whose lifecycle is the second half of this module.
 */

import { DEFAULT_KEYWORD_LANGUAGES } from "../../core/keywordLanguage.js";

import {
  reportWidthMismatch,
  reportWidthRecreate,
  SAVED_QUERY_SCOPE,
} from "../../core/vectorDrift.js";
import type { Querier } from "./errors.js";
import { runQuery, withTransaction } from "./errors.js";
import { quoteIdent } from "./oql/bindings.js";
import { bringStorageUpToDate } from "./storageVersion.js";

/**
 * Server-wide DDL, executed at adapter init only: the pgvector extension
 * and the `public` home — the ontology registry and the storage version.
 * Always schema-qualified, because `public` is the fixed server-wide home
 * regardless of any search path.
 */
const SERVER_DDL_STATEMENTS: string[] = [
  `CREATE EXTENSION IF NOT EXISTS vector`,

  `CREATE TABLE IF NOT EXISTS public.ontology (
  ontology_id  uuid        CONSTRAINT ontology_pk PRIMARY KEY,   -- caller-supplied, no default
  key          text        NOT NULL CONSTRAINT ontology_key_unique UNIQUE,
  display_name text        CONSTRAINT ontology_display_name_unique UNIQUE,  -- nullable: absent names never collide
  namespace    text        NOT NULL,   -- the ontology's physical home, ont_<key>
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
)`,

  // One row: the storage version (`storageVersion.ts`).
  `CREATE TABLE IF NOT EXISTS public.storage_version (
  version integer NOT NULL
)`,
];

/** A value as a SQL literal. Values reach DDL only here — DDL binds no
 * parameters. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The table set one ontology lives in — schema, instances and search
 * indices — and the initial search settings. Deliberately unqualified —
 * namespace-relocatable: ontology creation runs it inside a fresh
 * `ont_<key>` namespace via the transaction's search path
 * (`registry.ts`).
 */
export function ontologyDdlStatements(): string[] {
  return [
  // --- Schema side -------------------------------------------------------

  `CREATE TABLE IF NOT EXISTS lens (
  lens_id      uuid        CONSTRAINT lens_pk PRIMARY KEY,   -- caller-supplied, no default
  key          text        NOT NULL CONSTRAINT lens_key_unique  UNIQUE,
  name         text        NOT NULL CONSTRAINT lens_name_unique UNIQUE,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
)`,

  `CREATE TABLE IF NOT EXISTS entity_type (
  entity_type_id uuid        CONSTRAINT entity_type_pk PRIMARY KEY,
  key            text        NOT NULL CONSTRAINT entity_type_key_unique UNIQUE,
  display_name   text        NOT NULL,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  name_property  text        NOT NULL   -- key of the name property; FK added after property_def
)`,

  `CREATE TABLE IF NOT EXISTS relation_type (
  relation_type_id       uuid        CONSTRAINT relation_type_pk PRIMARY KEY,
  key                    text        NOT NULL CONSTRAINT relation_type_key_unique UNIQUE,
  display_name           text        NOT NULL,
  description            text,
  source_entity_type_key text        NOT NULL CONSTRAINT relation_type_source_fk
                                     REFERENCES entity_type (key) ON DELETE RESTRICT,
  target_entity_type_key text        NOT NULL CONSTRAINT relation_type_target_fk
                                     REFERENCES entity_type (key) ON DELETE RESTRICT,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
)`,

  `CREATE TABLE IF NOT EXISTS property_def (
  property_id      uuid        CONSTRAINT property_def_pk PRIMARY KEY,
  entity_type_id   uuid        CONSTRAINT property_def_entity_type_fk
                               REFERENCES entity_type (entity_type_id) ON DELETE CASCADE,
  relation_type_id uuid        CONSTRAINT property_def_relation_type_fk
                               REFERENCES relation_type (relation_type_id) ON DELETE CASCADE,
  key              text        NOT NULL,
  display_name     text        NOT NULL,
  description      text,
  data_type        text        NOT NULL,  -- plain text: validated above the port (structure-only rule)
  required         boolean     NOT NULL,
  default_value    text,                  -- always a string, never typed at definition time
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_def_one_owner CHECK (num_nonnulls(entity_type_id, relation_type_id) = 1),
  CONSTRAINT property_def_entity_key_unique   UNIQUE (entity_type_id, key),
  CONSTRAINT property_def_relation_key_unique UNIQUE (relation_type_id, key)
)`,

  // The name property is one of the type's own properties: the composite
  // key pins it to the owning type. Deferred, because a type and its name
  // property are created in one transaction and each references the other.
  `ALTER TABLE entity_type ADD CONSTRAINT entity_type_name_property_fk
  FOREIGN KEY (entity_type_id, name_property) REFERENCES property_def (entity_type_id, key)
  DEFERRABLE INITIALLY DEFERRED`,

  // A search index definition; its key is unique per ontology. Managed
  // indices (default, passage) are derived from the schema.
  `CREATE TABLE IF NOT EXISTS search_index (
  search_index_id uuid        CONSTRAINT search_index_pk PRIMARY KEY,
  key             text        NOT NULL CONSTRAINT search_index_key_unique UNIQUE,
  kind            text        NOT NULL CONSTRAINT search_index_kind_check
                              CHECK (kind IN ('default', 'passage', 'custom')),
  entity_type_id  uuid        NOT NULL CONSTRAINT search_index_entity_type_fk
                              REFERENCES entity_type (entity_type_id) ON DELETE CASCADE,
  definition      jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
)`,

  // Three inclusion kinds, one per row: an entity type, a relation type
  // (each with its property allowlist), or a search index (no allowlist).
  `CREATE TABLE IF NOT EXISTS lens_includes (
  lens_id          uuid   NOT NULL CONSTRAINT lens_includes_lens_fk
                          REFERENCES lens (lens_id) ON DELETE CASCADE,
  entity_type_id   uuid   CONSTRAINT lens_includes_entity_type_fk
                          REFERENCES entity_type (entity_type_id) ON DELETE CASCADE,
  relation_type_id uuid   CONSTRAINT lens_includes_relation_type_fk
                          REFERENCES relation_type (relation_type_id) ON DELETE CASCADE,
  properties       text[],  -- NULL = all properties; '{}' = none. The distinction is contract.
  search_index_id  uuid   CONSTRAINT lens_includes_search_index_fk
                          REFERENCES search_index (search_index_id) ON DELETE CASCADE,
  CONSTRAINT lens_includes_one_type
    CHECK (num_nonnulls(entity_type_id, relation_type_id, search_index_id) = 1),
  CONSTRAINT lens_includes_entity_unique   UNIQUE (lens_id, entity_type_id),
  CONSTRAINT lens_includes_relation_unique UNIQUE (lens_id, relation_type_id),
  CONSTRAINT lens_includes_search_index_unique UNIQUE (lens_id, search_index_id)
)`, // no timestamps, no PK

  `CREATE TABLE IF NOT EXISTS ai_agent_config (
  agent_config_id uuid        CONSTRAINT ai_agent_config_pk PRIMARY KEY,
  lens_id         uuid        NOT NULL CONSTRAINT ai_agent_config_lens_fk
                              REFERENCES lens (lens_id) ON DELETE CASCADE,
  key             text        NOT NULL,
  name            text        NOT NULL,
  description     text,
  system_prompt   text,
  tools           text[],     -- NULL = all tools
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agent_config_key_unique UNIQUE (lens_id, key)   -- upsert arbiter
)`,

  `CREATE TABLE IF NOT EXISTS saved_query (
  saved_query_id uuid        CONSTRAINT saved_query_pk PRIMARY KEY,
  lens_id        uuid        NOT NULL CONSTRAINT saved_query_lens_fk
                             REFERENCES lens (lens_id) ON DELETE CASCADE,
  lens_key       text,       -- denormalized (normative, Part 1); nullable
  key            text        NOT NULL,
  name           text        NOT NULL,
  description    text        NOT NULL,
  steps          text        NOT NULL,  -- opaque serialized JSON — the store does not interpret it
  parameters     text        NOT NULL,  -- same
  embedding      vector,                -- description embedding; width policed by the index
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_query_key_unique UNIQUE (lens_id, key)        -- upsert arbiter
)`,

  `CREATE TABLE IF NOT EXISTS retriever_agent (
  retriever_agent_id uuid        CONSTRAINT retriever_agent_pk PRIMARY KEY,
  lens_id            uuid        NOT NULL CONSTRAINT retriever_agent_lens_fk
                                 REFERENCES lens (lens_id) ON DELETE CASCADE,
  key                text        NOT NULL,
  name               text        NOT NULL,
  description        text,
  config_version     integer     NOT NULL,
  config             jsonb       NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  warnings           jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- notes of a version-1 conversion
  CONSTRAINT retriever_agent_key_unique UNIQUE (lens_id, key)
)`,

  // --- Instance side -----------------------------------------------------

  `CREATE TABLE IF NOT EXISTS entity (
  id         uuid        CONSTRAINT entity_pk PRIMARY KEY,   -- caller-supplied (service randomUUID), no default
  type_key   text        NOT NULL,                           -- NO FK: deleting a type orphans its instances by design
  props      jsonb       NOT NULL DEFAULT '{}'::jsonb,       -- user properties; system props are columns, not keys here
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  -- no search columns: entities are searched through search_entry
)`,
  `CREATE INDEX IF NOT EXISTS entity_type_key_idx ON entity (type_key)`,

  `CREATE TABLE IF NOT EXISTS relation (
  id         uuid        CONSTRAINT relation_pk PRIMARY KEY,
  type_key   text        NOT NULL,                           -- NO FK (as entity)
  from_id    uuid        NOT NULL CONSTRAINT relation_from_fk REFERENCES entity (id) ON DELETE CASCADE,
  to_id      uuid        NOT NULL CONSTRAINT relation_to_fk   REFERENCES entity (id) ON DELETE CASCADE,
  props      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS relation_type_key_idx ON relation (type_key)`,
  `CREATE INDEX IF NOT EXISTS relation_from_id_idx  ON relation (from_id)`,
  `CREATE INDEX IF NOT EXISTS relation_to_id_idx    ON relation (to_id)`,

  // --- Search indices ----------------------------------------------------

  ...searchStorageStatements(),
  `INSERT INTO search_settings (keyword_languages)
  VALUES (ARRAY[${DEFAULT_KEYWORD_LANGUAGES.map(literal).join(", ")}])`,
];
}

/**
 * The search-index tables beside `search_index` (which `lens_includes`
 * references, so it comes earlier): the settings singleton, generations,
 * the work queue and the entries. Generation lifecycle and the per-
 * generation partitions are `searchIndexStore.ts`'s.
 */
function searchStorageStatements(): string[] {
  return [
  // One row. The keyword language set every keyword generation stems in,
  // and the managed indices switched off.
  `CREATE TABLE IF NOT EXISTS search_settings (
  singleton          boolean NOT NULL DEFAULT true CONSTRAINT search_settings_pk PRIMARY KEY
                             CONSTRAINT search_settings_singleton CHECK (singleton),
  keyword_languages  text[]  NOT NULL,
  disabled_defaults  jsonb   NOT NULL DEFAULT '{}'::jsonb
)`,

  // One build of one representation of one index. At most one is building
  // and at most one is ready — the active one — per index and
  // representation.
  `CREATE TABLE IF NOT EXISTS search_generation (
  generation_id   uuid        CONSTRAINT search_generation_pk PRIMARY KEY,
  search_index_id uuid        NOT NULL CONSTRAINT search_generation_search_index_fk
                              REFERENCES search_index (search_index_id) ON DELETE CASCADE,
  representation  text        NOT NULL CONSTRAINT search_generation_representation_check
                              CHECK (representation IN ('semantic', 'keyword')),
  definition_hash text        NOT NULL,
  model_id        text,       -- semantic only
  dimensions      integer,    -- semantic only
  languages       text[],     -- keyword only
  state           text        NOT NULL CONSTRAINT search_generation_state_check
                              CHECK (state IN ('building', 'ready', 'retired', 'failed')),
  total           integer     NOT NULL DEFAULT 0,
  done            integer     NOT NULL DEFAULT 0,
  failed          integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ready_at        timestamptz
)`,
  `CREATE UNIQUE INDEX search_generation_building_unique
  ON search_generation (search_index_id, representation) WHERE state = 'building'`,
  `CREATE UNIQUE INDEX search_generation_ready_unique
  ON search_generation (search_index_id, representation) WHERE state = 'ready'`,

  // Parts of one generation waiting to be (re)composed.
  `CREATE TABLE IF NOT EXISTS search_queue (
  generation_id uuid        NOT NULL CONSTRAINT search_queue_generation_fk
                            REFERENCES search_generation (generation_id) ON DELETE CASCADE,
  entity_id     uuid        NOT NULL,
  part_kind     text        NOT NULL,
  group_no      integer     NOT NULL,
  part_id       text        NOT NULL,
  enqueued_at   timestamptz NOT NULL DEFAULT now(),
  attempts      integer     NOT NULL DEFAULT 0,
  not_before    timestamptz NOT NULL DEFAULT now(),
  lease_until   timestamptz,
  last_error    text,
  last_error_at timestamptz,
  CONSTRAINT search_queue_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id)
)`,
  // The worker claims due items; a deleted entity or relation takes its
  // queued items along.
  `CREATE INDEX search_queue_due_idx ON search_queue (not_before)`,
  `CREATE INDEX search_queue_entity_idx ON search_queue (entity_id)`,
  `CREATE INDEX search_queue_part_idx ON search_queue (part_id)`,

  // One partition per generation (se_<generation uuid hex>). The vector
  // column carries no width: each semantic partition's HNSW index casts to
  // its generation's width.
  `CREATE TABLE IF NOT EXISTS search_entry (
  generation_id uuid     NOT NULL,
  entity_id     uuid     NOT NULL,
  part_kind     text     NOT NULL,
  group_no      integer  NOT NULL,
  part_id       text     NOT NULL,
  relation_type text,
  target_type   text,
  target_id     uuid,
  start_char    integer,   -- passages: code-point offset in the document
  char_length   integer,   -- passages: code-point length
  text          text     NOT NULL,
  text_hash     bytea    NOT NULL,
  embedding     halfvec,   -- semantic generations
  tsv           tsvector,  -- keyword generations
  CONSTRAINT search_entry_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id)
) PARTITION BY LIST (generation_id)`,
  ];
}

/** Whether a pgvector version has the `halfvec` type search entries are
 * stored in (0.7.0 and later). */
export function supportsHalfvec(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 0 || minor >= 7;
}

/**
 * Log the pgvector version — the installed one, or the one the boot DDL is
 * about to install — and warn when it predates `halfvec`: search-index
 * storage cannot be created then (no fallback).
 */
export async function reportPgvectorVersion(): Promise<void> {
  const result = await runQuery(
    `SELECT coalesce(
       (SELECT extversion FROM pg_extension WHERE extname = 'vector'),
       (SELECT default_version FROM pg_available_extensions WHERE name = 'vector')
     ) AS version`,
  );
  const version = result.rows[0]?.["version"] as string | null | undefined;
  if (version === null || version === undefined) {
    console.warn("pgvector is not available: the vector extension cannot be installed.");
    return;
  }
  console.log(`pgvector ${version}`);
  if (!supportsHalfvec(version)) {
    console.warn(
      `pgvector ${version} has no halfvec type (0.7.0 or later required): ` +
        "search-index storage cannot be created. Upgrade pgvector.",
    );
  }
}

/** Create the server-wide objects if absent and bring older storage up
 * to date, in one transaction (`storageVersion.ts`). Boot DDL creates
 * nothing ontology-scoped — ontologies are provisioned by the registry,
 * each in its own namespace; only an upgrade step reaches into them. */
export async function initSchema(): Promise<void> {
  await withTransaction((querier) => bringStorageUpToDate(querier, SERVER_DDL_STATEMENTS));
}

// ---------------------------------------------------------------------------
// Saved-query vector index
// ---------------------------------------------------------------------------

/*
 * The saved-query description index is a cast-expression HNSW over the
 * dimensionless `embedding` column — `(embedding::vector(D))
 * vector_cosine_ops`, cosine mirroring the reference adapter's similarity
 * function. Because the column carries no width, there is no ALTER and no
 * absent-then-added state: the column is always there, NULL until
 * written, and the width lives only in the index. Queries must repeat the
 * same cast expression or the planner ignores the index; the width for
 * that cast comes from the catalog read below.
 *
 * Build mode is plain `CREATE INDEX`, never `CONCURRENTLY`: index DDL
 * joins the surrounding transaction, and a failed or interrupted build
 * leaves nothing behind.
 */

/** Saved-query descriptions — full-table, fixed name. */
export const SAVED_QUERY_INDEX = "saved_query_embedding_idx";

/**
 * The indexed expression: the dimensionless `embedding` column cast to
 * one width.
 *
 * An HNSW index over it is usable only by a query that repeats the
 * expression verbatim, so index and query must build it from the same
 * place — hence the export, which `search.ts` consumes. The width is the
 * only number either side interpolates into SQL, so it is checked here,
 * at the one seam both go through.
 */
export function castExpression(width: number): string {
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new Error(`Invalid embedding width: ${width}`);
  }
  return `embedding::vector(${width})`;
}

/** The saved-query index at one width. Lens scoping is a plain
 * query-time predicate, so the index needs no scoping of its own. */
function createSavedQueryIndex(dimensions: number): string {
  return (
    `CREATE INDEX IF NOT EXISTS ${SAVED_QUERY_INDEX} ON saved_query ` +
    `USING hnsw ((${castExpression(dimensions)}) vector_cosine_ops)`
  );
}

/**
 * The fixed vector indexes as CREATE statements — one, for saved-query
 * descriptions — unqualified like the ontology table DDL: ontology
 * provisioning runs them inside the fresh namespace's search path
 * (`registry.ts`).
 */
export function fixedVectorIndexStatements(dimensions: number): string[] {
  return [createSavedQueryIndex(dimensions)];
}

/**
 * The width an existing index is built for, or null if it does not exist.
 *
 * Read from the index's own column type in the catalog — `format_type`
 * over its `pg_attribute` row yields `vector(D)` for the cast expression,
 * which is what `pg_get_indexdef` would show without any text parsing.
 *
 * Exported because a vector query needs the same number: it has to
 * repeat the index's cast expression verbatim or the planner ignores the
 * index (`search.ts`).
 */
export async function indexWidth(querier: Querier, indexName: string): Promise<number | null> {
  const result = await querier.query(
    `SELECT format_type(att.atttypid, att.atttypmod) AS coltype
     FROM pg_attribute att
     JOIN pg_class idx ON idx.oid = att.attrelid
     JOIN pg_namespace nsp ON nsp.oid = idx.relnamespace
     WHERE nsp.nspname = current_schema() AND idx.relkind = 'i'
       AND idx.relname = $1 AND att.attnum = 1`,
    [indexName],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  const match = /^vector\((\d+)\)$/.exec(row["coltype"] as string);
  return match === null ? null : Number(match[1]);
}

/**
 * Ensure the saved-query description index exists at `dimensions`.
 *
 * An index fixes its width when it is created and a create-if-absent is a
 * no-op against one that exists, so changing the embedding model leaves
 * an index that rejects every vector the new model produces. A drifted
 * width is REPORTED (`core/vectorDrift.ts` holds the words), never
 * repaired.
 */
export async function ensureSavedQueryVectorIndex(
  dimensions: number,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      const existing = await indexWidth(querier, SAVED_QUERY_INDEX);
      if (existing !== null && existing !== dimensions) {
        reportWidthMismatch(SAVED_QUERY_SCOPE, existing, dimensions);
      }
      await querier.query(createSavedQueryIndex(dimensions));
    },
    "READ COMMITTED",
    namespace,
  );
}

/**
 * Drop the saved-query index when its width no longer matches the model —
 * the rebuild's first phase. It has to be a phase of its own: while an
 * index of the old width stands, a description vector of the model's
 * width cannot be stored, so the vectors cannot be regenerated underneath
 * it. `ensureSavedQueryVectorIndex` builds it again once they have been.
 * An index of the right width is left alone.
 */
export async function dropMismatchedSavedQueryVectorIndex(
  dimensions: number,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      const existing = await indexWidth(querier, SAVED_QUERY_INDEX);
      if (existing === null || existing === dimensions) {
        return;
      }
      await querier.query(`DROP INDEX IF EXISTS ${quoteIdent(SAVED_QUERY_INDEX)}`);
      reportWidthRecreate(SAVED_QUERY_SCOPE, existing, dimensions);
    },
    "READ COMMITTED",
    namespace,
  );
}
