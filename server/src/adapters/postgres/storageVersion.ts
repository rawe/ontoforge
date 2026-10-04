/**
 * The storage version and the whole upgrade path
 * (`docs/decisions.md#storage`).
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
 * major release deletes every step and raises `OLDEST_UPGRADABLE_VERSION`
 * to `STORAGE_VERSION`.
 */

import type { Querier } from "./errors.js";
import { searchPathStatement } from "./errors.js";

/** The layout this code creates and serves. */
export const STORAGE_VERSION = 2;

/** The version the previous major line ended on; older storage is refused. */
export const OLDEST_UPGRADABLE_VERSION = 1;

/** Storage that predates the version table: the 5.x layout without retrievers. */
const UNVERSIONED = 1;

/** One upgrade step: statements run inside every ontology namespace to
 * bring it from `to - 1` to `to`. */
interface Step {
  to: number;
  statements: string[];
}

const STEPS: Step[] = [
  {
    to: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS retriever_config (
  retriever_config_id uuid CONSTRAINT retriever_config_pk PRIMARY KEY,
  lens_id uuid NOT NULL CONSTRAINT retriever_config_lens_fk REFERENCES lens(lens_id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  config_version integer NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retriever_config_key_unique UNIQUE(lens_id, key)
)`,
    ],
  },
];

/** Serializes the boot DDL and upgrade of every server on one database. */
const LOCK = `SELECT pg_advisory_xact_lock(hashtextextended('ontoforge.storage', 0))`;

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
  await querier.query(LOCK);
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
      for (const statement of step.statements) {
        await querier.query(statement);
      }
    }
  }
  await querier.query(`SET LOCAL search_path TO public`);
  await recordVersion(querier, STORAGE_VERSION);
}
