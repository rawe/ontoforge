/**
 * PostgreSQL persistence adapter.
 *
 * Implements the persistence port (see `core/ports.ts`) on PostgreSQL
 * with pgvector. Everything PostgreSQL-specific — the `pg` pool, SQL
 * text, physical naming, index DDL — lives inside this package and must
 * not be imported from anywhere else in the server.
 *
 * M1 skeleton state: lifecycle, init DDL, the error/transaction doors,
 * and `wipe()` are complete; store operations throw until they land
 * (M2.5 modeling, M3 runtime CRUD, M4 vectors and documents).
 */

import { initSchema, wipe as wipeAll } from "./ddl.js";
import { closePool, initPool } from "./errors.js";
import { PostgresModelingStore } from "./modelingStore.js";
import { PostgresRuntimeStore } from "./runtimeStore.js";

/** Initialize the PostgreSQL adapter and return `[modelingStore, runtimeStore]`. */
export async function createStores(): Promise<[PostgresModelingStore, PostgresRuntimeStore]> {
  await initPool();
  await initSchema();
  return [new PostgresModelingStore(), new PostgresRuntimeStore()];
}

export async function closeStores(): Promise<void> {
  await closePool();
}

/**
 * Deliberate no-op until M4.2's index lifecycle lands, so the server
 * boots cleanly against PostgreSQL with an embedding provider
 * configured — the one sanctioned exception to "stubs throw".
 */
export async function ensureSemanticIndexes(_dimensions: number): Promise<void> {
  // No-op until M4.2.
}

/** Delete all stored data. Test support only — never used by the app. */
export async function wipe(): Promise<void> {
  await wipeAll();
}
