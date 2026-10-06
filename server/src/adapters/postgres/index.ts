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
import { ensureSavedQueryVectorIndex, initSchema, reportPgvectorVersion } from "./ddl.js";
import type { SearchWorkSubscription } from "../../core/ports.js";
import { closePool, initPool, listen } from "./errors.js";
import { PostgresModelingStore } from "./modelingStore.js";
import {
  listOntologyBindings,
  ontologyNamespace,
  PostgresOntologyRegistry,
} from "./registry.js";
import { PostgresRuntimeStore } from "./runtimeStore.js";
import { PostgresSearchIndexStore, SEARCH_WORK_CHANNEL } from "./searchIndexStore.js";

/** Initialize the PostgreSQL adapter: the pool, the pgvector version
 * report (before the upgrade, which needs `halfvec`) and the server-wide
 * DDL. */
export async function initAdapter(): Promise<void> {
  await initPool();
  await reportPgvectorVersion();
  await initSchema();
}

/** A modeling store bound to one ontology's namespace. The caller (the
 * port accessor) has already verified the ontology exists. */
export function createModelingStore(ontologyKey: string): PostgresModelingStore {
  return new PostgresModelingStore(ontologyNamespace(ontologyKey), ontologyKey);
}

/** A runtime store bound to one ontology's namespace. */
export function createRuntimeStore(ontologyKey: string): PostgresRuntimeStore {
  return new PostgresRuntimeStore(ontologyKey, ontologyNamespace(ontologyKey));
}

/** A search-index store bound to one ontology's namespace. */
export function createSearchIndexStore(ontologyKey: string): PostgresSearchIndexStore {
  return new PostgresSearchIndexStore(ontologyNamespace(ontologyKey), ontologyKey);
}

/** Wake-ups for queued search work: `LISTEN` on the channel every
 * enqueue notifies, on a connection of its own. */
export function subscribeSearchWork(
  onWake: (ontologyKey: string) => void,
): Promise<SearchWorkSubscription> {
  return listen(SEARCH_WORK_CHANNEL, onWake);
}

/** The ontology registry over the pool `initAdapter` opened. */
export function createRegistry(): PostgresOntologyRegistry {
  return new PostgresOntologyRegistry();
}

export async function closeStores(): Promise<void> {
  await closePool();
}

/**
 * Ensure every ontology's saved-query description index exists for the
 * configured dimensions, walking the registry — the authoritative
 * ontology list — one namespace at a time. Zero ontologies: nothing to
 * do. Search indices need no such step: each generation records its own
 * model and width, and the worker builds new ones on a switch.
 *
 * The startup path: a width mismatch is REPORTED and nothing is repaired
 * (`docs/decisions.md#behaviour`).
 *
 * One ontology cannot stop the others, and none of them can stop the
 * boot: descriptions of mixed width leave an index that cannot be built,
 * and failing to start would take away the server the operator needs.
 */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  for (const binding of await listOntologyBindings()) {
    try {
      await ensureSavedQueryVectorIndex(dimensions, binding.namespace);
    } catch {
      reportEnsureFailed(binding.key);
    }
  }
}

export function supportsKeywordRanking(): boolean { return PostgresRuntimeStore.prototype.supportsKeywordRanking(); }

/** Search indices are stored in the ontology namespace. */
export function supportsSearchIndices(): boolean { return true; }
