/**
 * Init DDL and the vector-index lifecycle.
 *
 * `initSchema` runs the server-wide DDL — the pgvector extension and the
 * `public.ontology` registry table — as one all-or-nothing transaction at
 * adapter init. The ten-table set is ontology-scoped and runs only at
 * ontology creation, inside the fresh `ont_<key>` namespace
 * (`registry.ts`). Idempotence rides `CREATE TABLE IF NOT EXISTS` with
 * all constraints inline and explicitly named (PG has no
 * `ADD CONSTRAINT IF NOT EXISTS`); no fixed constraint or index name uses
 * the `vec_` prefix, which is reserved for the dynamically created vector
 * indexes.
 *
 * The vector-lifecycle functions take the caller's bound `namespace` and
 * run their transactions inside it, so index DDL and catalog reads
 * (`current_schema()`) resolve within that ontology alone.
 *
 * The DDL carries structure only — identity, referential integrity,
 * exactly-one-owner, uniqueness. Business rules validate in the service,
 * with no backstop CHECKs. The `entity`/`relation` `type_key` columns get
 * no FK to the schema tables: deleting a type deliberately orphans its
 * instances. The `embedding` columns are dimensionless, so init is
 * provider-independent — the width lives only in the HNSW indexes, whose
 * lifecycle is the second half of this module.
 */

import {
  ALL_ENTITY_TYPES_SCOPE,
  documentPropertyScope,
  entityTypeScope,
  reportWidthMismatch,
  reportWidthRecreate,
  SAVED_QUERY_SCOPE,
} from "../../core/vectorDrift.js";
import type { Querier } from "./errors.js";
import { withTransaction } from "./errors.js";
import { quoteIdent } from "./oql/bindings.js";

/**
 * Server-wide DDL, executed at adapter init only: the pgvector extension
 * and the `public` home — the ontology registry. Always
 * schema-qualified, because `public` is the fixed server-wide home
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
];

/**
 * The ten-table set one ontology lives in. Deliberately unqualified —
 * namespace-relocatable: ontology creation runs it inside a fresh
 * `ont_<key>` namespace via the transaction's search path
 * (`registry.ts`).
 */
export const ONTOLOGY_DDL_STATEMENTS: string[] = [
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
  updated_at     timestamptz NOT NULL DEFAULT now()
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

  `CREATE TABLE IF NOT EXISTS lens_includes (
  lens_id          uuid   NOT NULL CONSTRAINT lens_includes_lens_fk
                          REFERENCES lens (lens_id) ON DELETE CASCADE,
  entity_type_id   uuid   CONSTRAINT lens_includes_entity_type_fk
                          REFERENCES entity_type (entity_type_id) ON DELETE CASCADE,
  relation_type_id uuid   CONSTRAINT lens_includes_relation_type_fk
                          REFERENCES relation_type (relation_type_id) ON DELETE CASCADE,
  properties       text[],  -- NULL = all properties; '{}' = none. The distinction is contract.
  CONSTRAINT lens_includes_one_type CHECK (num_nonnulls(entity_type_id, relation_type_id) = 1),
  CONSTRAINT lens_includes_entity_unique   UNIQUE (lens_id, entity_type_id),
  CONSTRAINT lens_includes_relation_unique UNIQUE (lens_id, relation_type_id)
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

  // --- Instance side -----------------------------------------------------

  `CREATE TABLE IF NOT EXISTS entity (
  id         uuid        CONSTRAINT entity_pk PRIMARY KEY,   -- caller-supplied (service randomUUID), no default
  type_key   text        NOT NULL,                           -- NO FK: deleting a type orphans its instances by design
  props      jsonb       NOT NULL DEFAULT '{}'::jsonb,       -- user properties; system props are columns, not keys here
  embedding  vector,                                         -- dimensionless; NULL until written; width policed by the HNSW index
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
  -- no embedding column: relations are never embedded
)`,
  `CREATE INDEX IF NOT EXISTS relation_type_key_idx ON relation (type_key)`,
  `CREATE INDEX IF NOT EXISTS relation_from_id_idx  ON relation (from_id)`,
  `CREATE INDEX IF NOT EXISTS relation_to_id_idx    ON relation (to_id)`,

  `CREATE TABLE IF NOT EXISTS document_chunk (
  id              uuid    CONSTRAINT document_chunk_pk PRIMARY KEY,   -- server randomUUID; never addressable (internal)
  entity_id       uuid    NOT NULL CONSTRAINT document_chunk_entity_fk REFERENCES entity (id) ON DELETE CASCADE,
  entity_type_key text    NOT NULL,
  property_key    text    NOT NULL,
  chunk_index     integer NOT NULL,   -- Row key _index
  start_char      integer NOT NULL,   -- code-point offset
  char_length     integer NOT NULL,   -- code-point length
  text            text    NOT NULL,
  embedding       vector              -- dimensionless; optional per chunk
  -- no timestamps (chunks carry none)
)`,
  `CREATE INDEX IF NOT EXISTS document_chunk_entity_property_idx ON document_chunk (entity_id, property_key)`,
];

/** Create the server-wide objects if absent, in one transaction. Boot
 * DDL creates nothing ontology-scoped — ontologies are provisioned by
 * the registry, each in its own namespace. */
export async function initSchema(): Promise<void> {
  await withTransaction(async (querier) => {
    for (const statement of SERVER_DDL_STATEMENTS) {
      await querier.query(statement);
    }
  });
}

// ---------------------------------------------------------------------------
// Vector-index lifecycle
// ---------------------------------------------------------------------------

/*
 * Every vector index is a cast-expression HNSW over the dimensionless
 * `embedding` column — `(embedding::vector(D)) vector_cosine_ops`, cosine
 * mirroring the reference adapter's similarity function. Because the
 * column carries no width, there is no ALTER and no absent-then-added
 * state: the column is always there, NULL until written, and the width
 * lives only in the index. Queries must repeat the same cast expression
 * or the planner ignores the index; the width for that cast comes from
 * the reconciliation read below.
 *
 * Names: dynamic indexes are `vec_<table>_<id>`, where `<id>` is the
 * 32-hex uuid (hyphens stripped) of the schema row that causes the index
 * to exist — the `entity_type` row, or the property-definition row for a
 * document property's chunks. The mapping is mechanically reversible in
 * both directions, which is what makes the orphan sweep possible; index
 * names are therefore never stored. The two full-table indexes are fixed
 * objects outside the `vec_` prefix.
 *
 * Build mode is plain `CREATE INDEX`, never `CONCURRENTLY`: index DDL
 * joins the surrounding transaction, and a failed or interrupted build
 * leaves nothing behind — this engine has no failed-index state to sweep.
 * Writers to the one table wait during a build; builds happen only on
 * schema changes and provider setup.
 */

/** Cross-type entity search — full-table, fixed name. */
export const ENTITY_ALL_INDEX = "entity_embedding_all_idx";

/** Saved-query descriptions — full-table, fixed name. */
export const SAVED_QUERY_INDEX = "saved_query_embedding_idx";

/** The 32-hex form of a schema row's uuid: the reversible half of a name. */
function indexUuid(rowId: string): string {
  return rowId.replaceAll("-", "");
}

function entityIndexName(entityTypeId: string): string {
  return `vec_entity_${indexUuid(entityTypeId)}`;
}

function chunkIndexName(propertyId: string): string {
  return `vec_document_chunk_${indexUuid(propertyId)}`;
}

/** A key as a SQL literal. Keys reach DDL only here — DDL binds no
 * parameters — and `KEY_PATTERN` already excludes quoting hazards, so
 * this is defense in depth. */
function literal(key: string): string {
  return `'${key.replaceAll("'", "''")}'`;
}

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

/**
 * One index of the inventory, minus its width: what it is called, what
 * the API calls it, and what it covers.
 *
 * The four members are one fact each and always travel together — every
 * one of them is derivable from the schema row that causes the index to
 * exist plus the keys that row carries, so they are derived once, here,
 * and never written out at a call site.
 */
interface IndexSpec {
  name: string;
  describes: string;
  table: string;
  predicate: string | null;
}

/** The index of one entity type. */
function entityIndexSpec(entityTypeId: string, entityTypeKey: string): IndexSpec {
  return {
    name: entityIndexName(entityTypeId),
    describes: entityTypeScope(entityTypeKey),
    table: "entity",
    predicate: `type_key = ${literal(entityTypeKey)}`,
  };
}

/** The chunk index of one document property. */
function chunkIndexSpec(
  propertyId: string,
  entityTypeKey: string,
  propertyKey: string,
): IndexSpec {
  return {
    name: chunkIndexName(propertyId),
    describes: documentPropertyScope(entityTypeKey, propertyKey),
    table: "document_chunk",
    predicate:
      `entity_type_key = ${literal(entityTypeKey)} ` +
      `AND property_key = ${literal(propertyKey)}`,
  };
}

/** Cross-type entity search: no schema row, no predicate — and no port
 * method of its own, since the schema lifecycle never names it and
 * nothing above the port has anything to say about it. */
const CROSS_TYPE_SPEC: IndexSpec = {
  name: ENTITY_ALL_INDEX,
  describes: ALL_ENTITY_TYPES_SCOPE,
  table: "entity",
  predicate: null,
};

/** Saved-query descriptions. Lens scoping is a plain query-time
 * predicate, so the index needs no scoping of its own. */
const SAVED_QUERY_SPEC: IndexSpec = {
  name: SAVED_QUERY_INDEX,
  describes: SAVED_QUERY_SCOPE,
  table: "saved_query",
  predicate: null,
};

function createHnsw(spec: IndexSpec, dimensions: number): string {
  const where = spec.predicate === null ? "" : ` WHERE ${spec.predicate}`;
  return (
    `CREATE INDEX IF NOT EXISTS ${spec.name} ON ${spec.table} ` +
    `USING hnsw ((${castExpression(dimensions)}) vector_cosine_ops)${where}`
  );
}

/**
 * The two fixed vector indexes as CREATE statements, unqualified like the
 * ten-table DDL: ontology provisioning runs them inside the fresh
 * namespace's search path (`registry.ts`).
 */
export function fixedVectorIndexStatements(dimensions: number): string[] {
  return [createHnsw(CROSS_TYPE_SPEC, dimensions), createHnsw(SAVED_QUERY_SPEC, dimensions)];
}

/** Drop one index. Callers pass a plain name — derived from a schema row
 * or read from the catalog, it makes no difference here — and the quoting
 * happens once, at this seam, through the package's one quoter: a name
 * read back from the catalog may be anything, and nothing about it is
 * assumed. */
async function dropIndex(querier: Querier, indexName: string): Promise<void> {
  await querier.query(`DROP INDEX IF EXISTS ${quoteIdent(indexName)}`);
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
 * Handle an existing index whose width no longer matches the model.
 *
 * An index fixes its width when it is created and a create-if-absent is a
 * no-op against one that exists, so changing the embedding model leaves
 * an index that rejects every vector the new model produces. On the
 * startup and per-type create paths this only reports: dropping an index
 * destroys the vectors it holds, and that is the operator's call. The
 * rebuild path passes `recreateOnMismatch`, because there the drop is
 * followed immediately by regeneration at the new width.
 *
 * Only the detection is here. What the operator is told — the wording
 * and the API-scope vocabulary every backend shares — is
 * `core/vectorDrift.ts`.
 */
async function reconcileIndexWidth(
  querier: Querier,
  indexName: string,
  describes: string,
  dimensions: number,
  recreateOnMismatch: boolean,
): Promise<void> {
  const existing = await indexWidth(querier, indexName);
  if (existing === null || existing === dimensions) {
    return;
  }

  if (!recreateOnMismatch) {
    reportWidthMismatch(describes, existing, dimensions);
    return;
  }

  await dropIndex(querier, indexName);
  reportWidthRecreate(describes, existing, dimensions);
}

/** Reconcile the width of an index, then create it if absent. */
async function ensureIndex(
  querier: Querier,
  spec: IndexSpec,
  dimensions: number,
  recreateOnMismatch: boolean,
): Promise<void> {
  await reconcileIndexWidth(querier, spec.name, spec.describes, dimensions, recreateOnMismatch);
  await querier.query(createHnsw(spec, dimensions));
}

/** The uuid of the `entity_type` row a key names, or null if it is gone. */
async function entityTypeIdOf(querier: Querier, entityTypeKey: string): Promise<string | null> {
  const result = await querier.query(`SELECT entity_type_id FROM entity_type WHERE key = $1`, [
    entityTypeKey,
  ]);
  const row = result.rows[0];
  return row === undefined ? null : (row["entity_type_id"] as string);
}

/** The uuid of the property-definition row a (type, property) pair names
 * — 1:1 with the pair — or null if it is gone. */
async function documentPropertyIdOf(
  querier: Querier,
  entityTypeKey: string,
  propertyKey: string,
): Promise<string | null> {
  const result = await querier.query(
    `SELECT p.property_id FROM property_def p
     JOIN entity_type et ON et.entity_type_id = p.entity_type_id
     WHERE et.key = $1 AND p.key = $2`,
    [entityTypeKey, propertyKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : (row["property_id"] as string);
}

/**
 * The entity-type index a key names, or null when the type is gone (and
 * with it the name's only derivation). A vector query asks for it to
 * learn the width its cast must use — see `indexWidth`.
 */
export async function entityIndexNameOf(
  querier: Querier,
  entityTypeKey: string,
): Promise<string | null> {
  const entityTypeId = await entityTypeIdOf(querier, entityTypeKey);
  return entityTypeId === null ? null : entityIndexName(entityTypeId);
}

/** The chunk index a (type, property) pair names, or null if it is gone. */
export async function chunkIndexNameOf(
  querier: Querier,
  entityTypeKey: string,
  propertyKey: string,
): Promise<string | null> {
  const propertyId = await documentPropertyIdOf(querier, entityTypeKey, propertyKey);
  return propertyId === null ? null : chunkIndexName(propertyId);
}

/**
 * The rows a chunk index exists for: document properties owned by an
 * entity type.
 *
 * Shared verbatim by the create loop and the orphan sweep, because the
 * two must agree on exactly one set. Read wider by the sweep, a property
 * that stopped being a document keeps its index forever — never
 * recreated, never collected; read narrower, the sweep drops indexes the
 * inventory just built.
 */
const DOCUMENT_PROPERTY_ROWS = `FROM property_def p
     JOIN entity_type et ON et.entity_type_id = p.entity_type_id
     WHERE p.data_type = 'document'`;

/** Every dynamically named index currently in the schema. */
async function dynamicIndexNames(querier: Querier): Promise<string[]> {
  const result = await querier.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = current_schema() AND indexname LIKE 'vec\\_%'`,
  );
  return result.rows.map((row) => row["indexname"] as string);
}

/**
 * Drop every dynamic index whose uuid matches no schema row.
 *
 * This is the reverse direction of the naming rule: name → uuid → schema
 * row. It collects the indexes of deleted types and document properties
 * (whose drop hooks run after the row is gone, leaving the name
 * underivable), import-regenerated ids, and the stale-predicate case — a
 * re-created type key gets a fresh uuid, while the old index's
 * `WHERE type_key = …` predicate would still match its rows.
 *
 * "Matches a schema row" means the inventory's row, not any row: a
 * property that is no longer a document is no longer in the inventory,
 * so its chunk index is an orphan like any other.
 */
async function sweepOrphanIndexes(querier: Querier): Promise<void> {
  const names = await dynamicIndexNames(querier);
  if (names.length === 0) {
    return;
  }
  const entityTypeIds = await querier.query(`SELECT entity_type_id FROM entity_type`);
  const knownTypes = new Set(
    entityTypeIds.rows.map((row) => indexUuid(row["entity_type_id"] as string)),
  );
  const propertyIds = await querier.query(`SELECT p.property_id ${DOCUMENT_PROPERTY_ROWS}`);
  const knownProperties = new Set(
    propertyIds.rows.map((row) => indexUuid(row["property_id"] as string)),
  );

  for (const name of names) {
    const entity = /^vec_entity_([0-9a-f]{32})$/.exec(name);
    if (entity !== null && knownTypes.has(entity[1]!)) {
      continue;
    }
    const chunk = /^vec_document_chunk_([0-9a-f]{32})$/.exec(name);
    if (chunk !== null && knownProperties.has(chunk[1]!)) {
      continue;
    }
    await dropIndex(querier, name);
  }
}

/**
 * Create the vector index for one entity type.
 *
 * `filterProperties` is accepted and ignored: the index covers the cast
 * expression alone, so it is vector-only either way. Semantic search
 * composes with filters on every property regardless — they are ordinary
 * predicates beside the vector scan, needing no declaration and no
 * rebuild.
 */
export async function createVectorIndex(
  entityTypeKey: string,
  dimensions: number,
  _filterProperties?: string[] | null,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      const entityTypeId = await entityTypeIdOf(querier, entityTypeKey);
      if (entityTypeId === null) {
        return;
      }
      await ensureIndex(querier, entityIndexSpec(entityTypeId, entityTypeKey), dimensions, false);
    },
    "READ COMMITTED",
    namespace,
  );
}

/**
 * Drop the vector index of one entity type.
 *
 * The name is re-derived from the schema row. Callers that have already
 * deleted the row leave the index behind as an orphan — `ensureVectorIndexes`
 * sweeps it on the next startup or rebuild.
 */
export async function dropVectorIndex(entityTypeKey: string, namespace?: string): Promise<void> {
  await withTransaction(
    async (querier) => {
      const entityTypeId = await entityTypeIdOf(querier, entityTypeKey);
      if (entityTypeId === null) {
        return;
      }
      await dropIndex(querier, entityIndexName(entityTypeId));
    },
    "READ COMMITTED",
    namespace,
  );
}

/**
 * Rebuild an entity type's vector index against its current properties.
 *
 * Width-only here: properties are never part of the index, so the rebuild
 * has nothing to pick up from a property change and the call is a
 * harmless no-op on those paths. The drop and the create share one
 * transaction.
 */
export async function rebuildVectorIndex(
  entityTypeKey: string,
  dimensions: number,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      const entityTypeId = await entityTypeIdOf(querier, entityTypeKey);
      if (entityTypeId === null) {
        return;
      }
      const spec = entityIndexSpec(entityTypeId, entityTypeKey);
      await dropIndex(querier, spec.name);
      // Not `ensureIndex`: the index is gone, so there is nothing left to
      // reconcile — only a catalog read that could answer nothing.
      await querier.query(createHnsw(spec, dimensions));
    },
    "READ COMMITTED",
    namespace,
  );
}

/** Create the chunk vector index of one document property. */
export async function createDocumentVectorIndex(
  entityTypeKey: string,
  propertyKey: string,
  dimensions: number,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      const propertyId = await documentPropertyIdOf(querier, entityTypeKey, propertyKey);
      if (propertyId === null) {
        return;
      }
      await ensureIndex(
        querier,
        chunkIndexSpec(propertyId, entityTypeKey, propertyKey),
        dimensions,
        false,
      );
    },
    "READ COMMITTED",
    namespace,
  );
}

/** Drop the chunk vector index of one document property. As with
 * `dropVectorIndex`, a vanished property row leaves an orphan for the
 * sweep. */
export async function dropDocumentVectorIndex(
  entityTypeKey: string,
  propertyKey: string,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      const propertyId = await documentPropertyIdOf(querier, entityTypeKey, propertyKey);
      if (propertyId === null) {
        return;
      }
      await dropIndex(querier, chunkIndexName(propertyId));
    },
    "READ COMMITTED",
    namespace,
  );
}

/** Ensure the saved-query description index exists. */
export async function ensureSavedQueryVectorIndex(
  dimensions: number,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      await ensureIndex(querier, SAVED_QUERY_SPEC, dimensions, false);
    },
    "READ COMMITTED",
    namespace,
  );
}

/**
 * Ensure the whole vector-index inventory, in one all-or-nothing
 * transaction: sweep the orphans, then reconcile and create the per-type
 * indexes, the chunk indexes of every document property, the cross-type
 * index, and the saved-query index.
 *
 * `recreateOnMismatch` is the rebuild path's flag — the one path allowed
 * to repair a width mismatch, because it regenerates the vectors it drops.
 */
export async function ensureVectorIndexes(
  dimensions: number,
  recreateOnMismatch = false,
  namespace?: string,
): Promise<void> {
  await withTransaction(
    async (querier) => {
      await sweepOrphanIndexes(querier);

      const entityTypes = await querier.query(
        `SELECT entity_type_id, key FROM entity_type ORDER BY key`,
      );
      for (const row of entityTypes.rows) {
        await ensureIndex(
          querier,
          entityIndexSpec(row["entity_type_id"] as string, row["key"] as string),
          dimensions,
          recreateOnMismatch,
        );
      }

      const documentProperties = await querier.query(
        `SELECT p.property_id, p.key AS property_key, et.key AS entity_type_key
     ${DOCUMENT_PROPERTY_ROWS}
     ORDER BY et.key, p.key`,
      );
      for (const row of documentProperties.rows) {
        await ensureIndex(
          querier,
          chunkIndexSpec(
            row["property_id"] as string,
            row["entity_type_key"] as string,
            row["property_key"] as string,
          ),
          dimensions,
          recreateOnMismatch,
        );
      }

      await ensureIndex(querier, CROSS_TYPE_SPEC, dimensions, recreateOnMismatch);
      await ensureIndex(querier, SAVED_QUERY_SPEC, dimensions, recreateOnMismatch);
    },
    "READ COMMITTED",
    namespace,
  );
}
