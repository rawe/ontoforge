/**
 * Init DDL and `wipe()`.
 *
 * `initSchema` runs the whole ten-table set — schema side and instance
 * side together — as one all-or-nothing transaction at adapter init.
 * Idempotence rides `CREATE TABLE IF NOT EXISTS` with all constraints
 * inline and explicitly named (PG has no `ADD CONSTRAINT IF NOT EXISTS`);
 * no fixed constraint or index name uses the `vec_` prefix, which is
 * reserved for the dynamically created vector indexes.
 *
 * The DDL carries structure only — identity, referential integrity,
 * exactly-one-owner, uniqueness. Business rules validate in the service,
 * with no backstop CHECKs. The `entity`/`relation` `type_key` columns get
 * no FK to the schema tables: deleting a type deliberately orphans its
 * instances. The `embedding` columns are dimensionless, so init is
 * provider-independent — the width lives only in the HNSW indexes (M4).
 */

import { withTransaction } from "./errors.js";

/** Executed in order at adapter init, idempotent. */
const DDL_STATEMENTS: string[] = [
  `CREATE EXTENSION IF NOT EXISTS vector`,

  // --- Schema side -------------------------------------------------------

  `CREATE TABLE IF NOT EXISTS ontology (
  ontology_id  uuid        CONSTRAINT ontology_pk PRIMARY KEY,   -- caller-supplied, no default
  key          text        NOT NULL CONSTRAINT ontology_key_unique  UNIQUE,
  name         text        NOT NULL CONSTRAINT ontology_name_unique UNIQUE,
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

  `CREATE TABLE IF NOT EXISTS ontology_includes (
  ontology_id      uuid   NOT NULL CONSTRAINT ontology_includes_ontology_fk
                          REFERENCES ontology (ontology_id) ON DELETE CASCADE,
  entity_type_id   uuid   CONSTRAINT ontology_includes_entity_type_fk
                          REFERENCES entity_type (entity_type_id) ON DELETE CASCADE,
  relation_type_id uuid   CONSTRAINT ontology_includes_relation_type_fk
                          REFERENCES relation_type (relation_type_id) ON DELETE CASCADE,
  properties       text[],  -- NULL = all properties; '{}' = none. The distinction is contract.
  CONSTRAINT ontology_includes_one_type CHECK (num_nonnulls(entity_type_id, relation_type_id) = 1),
  CONSTRAINT ontology_includes_entity_unique   UNIQUE (ontology_id, entity_type_id),
  CONSTRAINT ontology_includes_relation_unique UNIQUE (ontology_id, relation_type_id)
)`, // no timestamps, no PK

  `CREATE TABLE IF NOT EXISTS ai_agent_config (
  agent_config_id uuid        CONSTRAINT ai_agent_config_pk PRIMARY KEY,
  ontology_id     uuid        NOT NULL CONSTRAINT ai_agent_config_ontology_fk
                              REFERENCES ontology (ontology_id) ON DELETE CASCADE,
  key             text        NOT NULL,
  name            text        NOT NULL,
  description     text,
  system_prompt   text,
  tools           text[],     -- NULL = all tools
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agent_config_key_unique UNIQUE (ontology_id, key)   -- upsert arbiter
)`,

  `CREATE TABLE IF NOT EXISTS saved_query (
  saved_query_id uuid        CONSTRAINT saved_query_pk PRIMARY KEY,
  ontology_id    uuid        NOT NULL CONSTRAINT saved_query_ontology_fk
                             REFERENCES ontology (ontology_id) ON DELETE CASCADE,
  ontology_key   text,       -- denormalized (normative, Part 1); nullable
  key            text        NOT NULL,
  name           text        NOT NULL,
  description    text        NOT NULL,
  steps          text        NOT NULL,  -- opaque serialized JSON — the store does not interpret it
  parameters     text        NOT NULL,  -- same
  embedding      vector,                -- description embedding; width policed by the index
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_query_key_unique UNIQUE (ontology_id, key)        -- upsert arbiter
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

/** All ten tables, for `wipe()` — kept in step with the DDL above. */
const ALL_TABLES = [
  "ontology",
  "entity_type",
  "relation_type",
  "property_def",
  "ontology_includes",
  "ai_agent_config",
  "saved_query",
  "entity",
  "relation",
  "document_chunk",
];

/** Create every table and index if absent, in one transaction. */
export async function initSchema(): Promise<void> {
  await withTransaction(async (querier) => {
    for (const statement of DDL_STATEMENTS) {
      await querier.query(statement);
    }
  });
}

/**
 * Delete all stored data: one `TRUNCATE` across all ten tables plus a
 * drop of every `vec_`-prefixed index, in one transaction. The index
 * drop is load-bearing: a re-created type key gets a fresh uuid-named
 * index while an orphan's `WHERE type_key = …` predicate would still
 * match new rows. The five fixed B-tree indexes and the two fixed vector
 * indexes survive — neither carries the `vec_` prefix.
 */
export async function wipe(): Promise<void> {
  await withTransaction(async (querier) => {
    await querier.query(`TRUNCATE ${ALL_TABLES.join(", ")}`);
    const result = await querier.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema() AND indexname LIKE 'vec\\_%'`,
    );
    for (const row of result.rows) {
      const name = row["indexname"] as string;
      await querier.query(`DROP INDEX IF EXISTS "${name.replaceAll('"', '""')}"`);
    }
  });
}
