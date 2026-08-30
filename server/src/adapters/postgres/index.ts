/**
 * PostgreSQL persistence adapter.
 *
 * Implements the persistence port (see `core/ports.ts`) on PostgreSQL
 * with pgvector. Everything PostgreSQL-specific — the `pg` pool, SQL
 * text, physical naming, index DDL — lives inside this package and must
 * not be imported from anywhere else in the server.
 *
 * Build state: complete — lifecycle, init DDL, the error/transaction
 * doors, the modeling store, runtime CRUD, the vector-index lifecycle,
 * semantic search, the document chunks, and the OQL→SQL compiler behind
 * `executeOql`.
 */

import { ensureVectorIndexes, initSchema } from "./ddl.js";
import { closePool, initPool } from "./errors.js";
import { PostgresModelingStore } from "./modelingStore.js";
import { PostgresOntologyRegistry } from "./registry.js";
import { PostgresRuntimeStore } from "./runtimeStore.js";

/** Initialize the PostgreSQL adapter and return `[modelingStore, runtimeStore]`. */
export async function createStores(): Promise<[PostgresModelingStore, PostgresRuntimeStore]> {
  await initPool();
  await initSchema();
  return [new PostgresModelingStore(), new PostgresRuntimeStore()];
}

/** The ontology registry over the pool `createStores` opened. */
export function createRegistry(): PostgresOntologyRegistry {
  return new PostgresOntologyRegistry();
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
