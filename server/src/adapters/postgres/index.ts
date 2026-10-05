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

import type { KeywordLanguage } from "../../core/keywordLanguage.js";

import { reportEnsureFailed } from "../../core/vectorDrift.js";
import { ensureVectorIndexes, initSchema, reportPgvectorVersion } from "./ddl.js";
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
export function createModelingStore(ontologyKey: string, language: KeywordLanguage): PostgresModelingStore {
  return new PostgresModelingStore(ontologyNamespace(ontologyKey), language);
}

/** A runtime store bound to one ontology's namespace. */
export function createRuntimeStore(ontologyKey: string, language: KeywordLanguage): PostgresRuntimeStore {
  return new PostgresRuntimeStore(ontologyKey, ontologyNamespace(ontologyKey), language);
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

export function supportsKeywordRanking(): boolean { return PostgresRuntimeStore.prototype.supportsKeywordRanking(); }

/** Search indices are stored in the ontology namespace. */
export function supportsSearchIndices(): boolean { return true; }
