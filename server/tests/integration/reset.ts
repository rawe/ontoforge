/**
 * Two-level test reset — harness code, deliberately outside the
 * persistence port: the adapter ships no test-only surface, so the reset
 * lives here.
 *
 * - `hardReset` — run once per suite invocation by `global-setup.ts`,
 *   before any test file: a virgin database, so nothing an earlier
 *   invocation left behind — the width imprint of a fixed vector index,
 *   for one — can leak into this one. It drops and recreates the
 *   database and runs the boot DDL.
 * - `wipeDatabase` — the per-file fast reset every integration file runs
 *   between tests. It needs the adapter initialized (`initStores`) and
 *   deletes all stored data while keeping schema objects.
 */

import pg from "pg";

import { initSchema } from "../../src/adapters/postgres/ddl.js";
import { closePool, initPool, withTransaction } from "../../src/adapters/postgres/errors.js";
import { quoteIdent } from "../../src/adapters/postgres/oql/bindings.js";
import { settings } from "../../src/config.js";

/**
 * All ontology-scoped state lives inside `ont_*` namespaces, so the wipe
 * is: every `ont_*` namespace drops in one cascade each — tables, data,
 * every vector index and its width imprint with it — and the registry
 * (`public.ontology`, the only stateful server-wide table) truncates.
 */
export async function wipeDatabase(): Promise<void> {
  await withTransaction(async (querier) => {
    const namespaces = await querier.query(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ont\\_%'`,
    );
    for (const row of namespaces.rows) {
      await querier.query(
        `DROP SCHEMA IF EXISTS ${quoteIdent(row["nspname"] as string)} CASCADE`,
      );
    }
    await querier.query(`TRUNCATE public.ontology`);
  });
}

/**
 * `DROP DATABASE … WITH (FORCE)` + `CREATE DATABASE` on a maintenance
 * connection to the `postgres` database, then the boot DDL with the
 * adapter pool opened and closed around it. Runs before any worker opens
 * a pool, so no connection of ours holds the database being dropped;
 * FORCE clears out anything else.
 */
export async function hardReset(): Promise<void> {
  const url = new URL(settings.DB_URI);
  const database = url.pathname.replace(/^\//, "");
  const maintenance = new pg.Client({
    host: url.hostname,
    port: url.port === "" ? 5432 : Number(url.port),
    database: "postgres",
    user: settings.DB_USER,
    password: settings.DB_PASSWORD,
  });
  await maintenance.connect();
  try {
    await maintenance.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
    await maintenance.query(`CREATE DATABASE ${quoteIdent(database)}`);
  } finally {
    await maintenance.end();
  }
  await initPool();
  try {
    await initSchema();
  } finally {
    await closePool();
  }
}
