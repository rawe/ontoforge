/**
 * The storage version and the whole upgrade path
 * (`docs/storage-adapters/contract.md#lifecycle`).
 *
 * One number in `public.storage_version` covers the whole server. The
 * boot transaction reads it under a database-wide advisory lock — so
 * several servers starting against one database upgrade it once — and
 * brings older storage up to date before the server serves requests:
 * every ontology namespace together, the number last. Any failure rolls
 * the whole upgrade back and stops the boot.
 *
 * New storage never runs a step: the ontology DDL in `ddl.ts` is always
 * the current layout, and an empty database is recorded at
 * `STORAGE_VERSION` directly.
 *
 * Changing the layout within a major line: change the ontology DDL, add
 * one step that only adds (tables, columns with a default, indexes) and
 * raise `STORAGE_VERSION` to its `to`. A released step is frozen — it
 * carries its own statements, never a constant shared with the DDL. A
 * major release deletes the steps of the previous major line and sets
 * `OLDEST_UPGRADABLE_VERSION` to the version that line ended on; its one
 * major step may also rewrite data, so a step's action is a statement or
 * a function over the namespace.
 *
 * The 7.x line ended on version 8, the oldest version this major line
 * upgrades from; its steps start there. Older storage, and storage from
 * before the version table, is refused.
 */

import { convertLegacySearchSteps } from "../../core/legacySearchStep.js";
import type { Row } from "../../core/ports.js";
import type { Querier } from "./errors.js";
import { searchPathStatement } from "./errors.js";

/** The layout this code creates and serves. */
export const STORAGE_VERSION = 15;

/** The version the previous major line ended on; older storage is refused. */
export const OLDEST_UPGRADABLE_VERSION = 8;

/** Storage that predates the version table (the 5.x line) counts as this. */
const UNVERSIONED = 1;

/** One action of a step inside an ontology namespace: a statement, or work
 * that needs code between statements (a backfill). */
type Action = string | ((querier: Querier) => Promise<void>);

/** One upgrade step: actions run, in order, inside every ontology
 * namespace to bring it from `to - 1` to `to`; then the server-wide
 * statements run once, in `public`, after every namespace's actions. */
interface Step {
  to: number;
  actions: Action[];
  serverStatements?: string[];
}

/**
 * Make every stored saved query's `search` steps entity searches
 * (`core/legacySearchStep.ts`). A saved query that cannot be converted —
 * a step binds a field of a search step other than a reference — is
 * deleted, and named in the log.
 */
async function convertSearchSteps(querier: Querier): Promise<void> {
  const rows = (await querier.query(`SELECT saved_query_id, lens_key, key, steps FROM saved_query ORDER BY key`)).rows;
  for (const row of rows) {
    const steps = JSON.parse(row["steps"] as string) as Row[];
    if (!steps.some((step) => step.type === "search")) continue;
    const converted = convertLegacySearchSteps(steps);
    if (converted === null) {
      console.log(
        `Deleting saved query '${row["key"] as string}' of lens '${row["lens_key"] as string}': ` +
          "it binds a field a search step no longer yields.",
      );
      await querier.query(`DELETE FROM saved_query WHERE saved_query_id = $1`, [row["saved_query_id"]]);
    } else {
      await querier.query(`UPDATE saved_query SET steps = $2 WHERE saved_query_id = $1`, [
        row["saved_query_id"],
        JSON.stringify(converted),
      ]);
    }
  }
}

const STEPS: Step[] = [
  {
    // The design revision: the ontology's id and the number every design
    // change advances, starting at 1.
    to: 9,
    actions: [
      `CREATE TABLE design_revision (
  singleton   boolean NOT NULL DEFAULT true CONSTRAINT design_revision_pk PRIMARY KEY
                      CONSTRAINT design_revision_singleton CHECK (singleton),
  ontology_id uuid    NOT NULL,
  revision    integer NOT NULL
)`,
      `INSERT INTO design_revision (ontology_id, revision)
  SELECT ontology_id, 1 FROM public.ontology WHERE namespace = current_schema()`,
    ],
  },
  {
    // Entity identity: a type's identity properties and an entity's
    // derived identity, unique within its type.
    to: 10,
    actions: [
      `ALTER TABLE entity_type ADD COLUMN identity_properties text[]`,
      `ALTER TABLE entity ADD COLUMN identity text`,
      `ALTER TABLE entity ADD CONSTRAINT entity_identity_unique UNIQUE (type_key, identity)
  DEFERRABLE INITIALLY IMMEDIATE`,
    ],
  },
  {
    // Relation rules: one per pair on a relation type; staged values found
    // by value, for puts.
    to: 11,
    actions: [
      `ALTER TABLE relation_type ADD COLUMN one_per_pair boolean NOT NULL DEFAULT false`,
      `CREATE INDEX changeset_value_match_idx ON changeset_value (changeset_id, property_key, md5(value::text))`,
    ],
  },
  {
    // 8.0, a data rewrite: a saved query's search step is an entity
    // search; a saved query binding what it no longer yields goes.
    to: 12,
    actions: [convertSearchSteps],
  },
  {
    // The first table of search trees stored per lens; step 14 replaces it.
    to: 13,
    actions: [
      `CREATE TABLE named_search (
  named_search_id uuid        CONSTRAINT named_search_pk PRIMARY KEY,
  lens_id         uuid        NOT NULL CONSTRAINT named_search_lens_fk
                              REFERENCES lens (lens_id) ON DELETE CASCADE,
  key             text        NOT NULL,
  name            text        NOT NULL,
  description     text        NOT NULL,
  tree            jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT named_search_key_unique UNIQUE (lens_id, key)
)`,
    ],
  },
  {
    // Search profiles: the table of search trees stored per lens,
    // replacing step 13's.
    to: 14,
    actions: [
      `DROP TABLE IF EXISTS named_search`,
      `CREATE TABLE search_profile (
  search_profile_id uuid        CONSTRAINT search_profile_pk PRIMARY KEY,
  lens_id           uuid        NOT NULL CONSTRAINT search_profile_lens_fk
                                REFERENCES lens (lens_id) ON DELETE CASCADE,
  key               text        NOT NULL,
  name              text        NOT NULL,
  description       text        NOT NULL,
  tree              jsonb       NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_profile_key_unique UNIQUE (lens_id, key)
)`,
    ],
  },
  {
    // Runtime skills: lens-owned records a lens's runtime MCP mount serves.
    to: 15,
    actions: [
      `CREATE TABLE runtime_skill (
  runtime_skill_id uuid        CONSTRAINT runtime_skill_pk PRIMARY KEY,
  lens_id          uuid        NOT NULL CONSTRAINT runtime_skill_lens_fk
                               REFERENCES lens (lens_id) ON DELETE CASCADE,
  key              text        NOT NULL,
  description      text        NOT NULL,
  content          text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_skill_key_unique UNIQUE (lens_id, key)
)`,
    ],
  },
];

/** Serializes the boot DDL and upgrade of every server on one database. */
const LOCK_KEY = `hashtextextended('ontoforge.storage', 0)`;

/** The recorded version; `null` for an empty database. */
async function recordedVersion(querier: Querier): Promise<number | null> {
  const found = await querier.query(
    `SELECT to_regclass('public.storage_version') IS NOT NULL AS versioned,
            to_regclass('public.ontology') IS NOT NULL AS registry`,
  );
  const { versioned, registry } = found.rows[0]!;
  if (versioned) {
    const row = (await querier.query(`SELECT version FROM public.storage_version`)).rows[0];
    if (row !== undefined) return row["version"] as number;
  }
  return registry ? UNVERSIONED : null;
}

async function recordVersion(querier: Querier, version: number): Promise<void> {
  await querier.query(`DELETE FROM public.storage_version`);
  await querier.query(`INSERT INTO public.storage_version (version) VALUES ($1)`, [version]);
}

/**
 * Run the server-wide DDL and bring the storage to `STORAGE_VERSION`,
 * inside the caller's boot transaction. Throws — leaving the storage
 * untouched once the transaction rolls back — for storage newer than the
 * code or older than `OLDEST_UPGRADABLE_VERSION`.
 */
export async function bringStorageUpToDate(
  querier: Querier,
  serverDdl: readonly string[],
): Promise<void> {
  const free = await querier.query(`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`);
  if (free.rows[0]!["locked"] !== true) {
    console.log("Waiting for another server to bring the storage up to date.");
    await querier.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
  }
  const recorded = await recordedVersion(querier);
  if (recorded !== null && recorded > STORAGE_VERSION) {
    throw new Error(
      `Storage is version ${recorded}; this release supports up to version ` +
        `${STORAGE_VERSION}. Use a newer release.`,
    );
  }
  if (recorded !== null && recorded < OLDEST_UPGRADABLE_VERSION) {
    throw new Error(
      `Storage is version ${recorded}; this release upgrades from version ` +
        `${OLDEST_UPGRADABLE_VERSION} on. Upgrade through the last release of ` +
        `the previous major line first.`,
    );
  }
  for (const statement of serverDdl) {
    await querier.query(statement);
  }
  if (recorded === null) {
    await recordVersion(querier, STORAGE_VERSION);
    return;
  }
  if (recorded === STORAGE_VERSION) return;

  // No ontology may be created underneath the upgrade.
  await querier.query(`LOCK TABLE public.ontology IN SHARE MODE`);
  const namespaces = (await querier.query(`SELECT namespace FROM public.ontology ORDER BY key`))
    .rows.map((row) => row["namespace"] as string);
  console.log(
    `Upgrading storage from version ${recorded} to ${STORAGE_VERSION} ` +
      `(${namespaces.length} ontologies).`,
  );
  for (const step of STEPS.filter((candidate) => candidate.to > recorded)) {
    for (const namespace of namespaces) {
      await querier.query(searchPathStatement(namespace));
      for (const action of step.actions) {
        if (typeof action === "string") {
          await querier.query(action);
        } else {
          await action(querier);
        }
      }
    }
    await querier.query(`SET LOCAL search_path TO public`);
    for (const statement of step.serverStatements ?? []) {
      await querier.query(statement);
    }
  }
  await recordVersion(querier, STORAGE_VERSION);
}
