/**
 * PostgreSQL persistence adapter.
 *
 * Implements the persistence port (see `core/ports.ts`) on PostgreSQL
 * with pgvector. Everything PostgreSQL-specific — the `pg` pool, SQL
 * text, physical naming, index DDL — lives inside this package and must
 * not be imported from anywhere else in the server.
 *
 * One ontology lives in one PG namespace (`ont_<key>`); a bound store is
 * an ordinary store instance carrying that namespace, applied per
 * statement through the doors' `SET LOCAL search_path`. The registry
 * (`public.ontology`) provisions and drops namespaces; `public` holds
 * only the server-wide objects.
 */

import { reportEnsureFailed } from "../../core/vectorDrift.js";
import { ensureVectorIndexes, initSchema } from "./ddl.js";
import { closePool, initPool } from "./errors.js";
import { PostgresModelingStore } from "./modelingStore.js";
import {
  listOntologyBindings,
  ontologyNamespace,
  PostgresOntologyRegistry,
} from "./registry.js";
import { PostgresRuntimeStore } from "./runtimeStore.js";

/** Initialize the PostgreSQL adapter: the pool and the server-wide DDL. */
export async function initAdapter(): Promise<void> {
  await initPool();
  await initSchema();
}

/** A modeling store bound to one ontology's namespace. The caller (the
 * port accessor) has already verified the ontology exists. */
export function createModelingStore(ontologyKey: string): PostgresModelingStore {
  return new PostgresModelingStore(ontologyNamespace(ontologyKey));
}

/** A runtime store bound to one ontology's namespace. */
export function createRuntimeStore(ontologyKey: string): PostgresRuntimeStore {
  return new PostgresRuntimeStore(ontologyKey, ontologyNamespace(ontologyKey));
}

/** The ontology registry over the pool `initAdapter` opened. */
export function createRegistry(): PostgresOntologyRegistry {
  return new PostgresOntologyRegistry();
}

export async function closeStores(): Promise<void> {
  await closePool();
}

/**
 * Ensure every ontology's vector indexes exist for the configured
 * dimensions, walking the registry — the authoritative ontology list —
 * one namespace at a time. Zero ontologies: nothing to do.
 *
 * The startup path: width mismatches are REPORTED and nothing is
 * repaired — only the rebuild operation drops a drifted index, and it
 * regenerates the vectors before building it again
 * (`docs/decisions.md#behaviour`).
 *
 * One ontology cannot stop the others, and none of them can stop the
 * boot. An unfinished rebuild leaves vectors of mixed width behind, over
 * which no index can be built; failing to start would take away the
 * server the operator needs to finish that rebuild.
 */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  for (const binding of await listOntologyBindings()) {
    try {
      await ensureVectorIndexes(dimensions, binding.namespace);
    } catch {
      reportEnsureFailed(binding.key);
    }
  }
}
