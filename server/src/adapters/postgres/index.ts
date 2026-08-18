/**
 * PostgreSQL persistence adapter.
 *
 * Implements the persistence port (see `core/ports.ts`) on PostgreSQL
 * with pgvector. Everything PostgreSQL-specific — the `pg` pool, SQL
 * text, physical naming, index DDL — lives inside this package and must
 * not be imported from anywhere else in the server.
 *
 * Build state: lifecycle, init DDL, the error/transaction doors,
 * `wipe()`, the modeling store, runtime CRUD, and the vector-index
 * lifecycle are complete; the remaining runtime store operations throw
 * until they land (M4 semantic search and document chunks, M5 OQL).
 */

import { ensureVectorIndexes, initSchema, wipe as wipeAll } from "./ddl.js";
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
 * Ensure all vector indexes exist for the configured dimensions.
 *
 * The startup path: width mismatches are REPORTED and nothing is
 * repaired — only the rebuild operation recreates a drifted index,
 * immediately before regenerating the vectors that fill it
 * (`docs/decisions.md#behaviour`).
 */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  await ensureVectorIndexes(dimensions, false);
}

/** Delete all stored data. Test support only — never used by the app. */
export async function wipe(): Promise<void> {
  await wipeAll();
}
