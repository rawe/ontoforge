/**
 * Managed search indices: per entity type a default index over its own
 * string properties, per document property a passage index
 * (`deriveManagedIndices`). They follow the schema silently — the modeling
 * service syncs them after every schema change, the worker at start:
 *
 * - a derived index without a row gets one, and is included in every
 *   scoped lens that exposes its root type, so scoped lenses stay
 *   searchable as the schema grows (the storage upgrade includes the
 *   existing ones the same way);
 * - a row whose derived definition changed is updated — a changed hash
 *   then yields a new generation;
 * - a row nothing derives any more is deleted;
 * - then the generations are reconciled.
 *
 * Text a definition does not capture — display names, the name property
 * behind a passage header — is refreshed by re-queueing the entities of
 * every index that reads the changed type (`refreshTypes`).
 *
 * A managed index can be switched off (search settings, `settings.ts`):
 * its row stays, it keeps no generations and no lens can search it.
 */

import { randomUUID } from "node:crypto";

import { ConflictError } from "../../core/exceptions.js";
import type { SearchIndexRecord, SearchIndexStore } from "../../core/ports.js";
import {
  definitionsEqual,
  deriveManagedIndices,
  type SearchIndexDefinition,
  type SearchIndexKind,
} from "../../core/searchIndex.js";
import { disabledDefaultsOf, disabledIndexKeys } from "../../core/searchPipeline.js";
import { invalidateSearchContext, loadSearchContextUncached } from "../schemaCache.js";
import { reconcileSearchGenerations, refreshSearchIndex } from "./generations.js";

/** What one sync changed, by index key. */
export interface ManagedSync {
  created: string[];
  updated: string[];
  deleted: string[];
  refreshed: string[];
}

/**
 * Bring the managed index rows of an ontology in step with its schema,
 * reconcile every index's generations, and refresh the indices that read
 * any of `refreshTypes` (entity or relation type keys whose display
 * names or name property changed).
 */
export async function syncManagedSearchIndices(
  store: SearchIndexStore,
  options: { refreshTypes?: readonly string[] } = {},
): Promise<ManagedSync> {
  const ontologyKey = store.ontologyKey;
  const { schema, indices } = await loadSearchContextUncached(store);
  const existing = new Map(
    indices.filter((index) => index.kind !== "custom").map((index) => [index.key, index] as const),
  );
  const result: ManagedSync = { created: [], updated: [], deleted: [], refreshed: [] };

  const derived = deriveManagedIndices(schema);
  for (const { kind, definition } of derived) {
    const row = existing.get(definition.key);
    existing.delete(definition.key);
    if (row === undefined) {
      if ((await createUnlessTaken(store, kind, definition)) !== null) {
        await store.includeIndexInScopedLenses(definition.key);
        result.created.push(definition.key);
      }
    } else if (!definitionsEqual(row.definition, definition)) {
      await store.updateIndexDefinition(definition.key, definition);
      result.updated.push(definition.key);
    }
  }
  for (const key of existing.keys()) {
    await store.deleteIndex(key);
    result.deleted.push(key);
  }

  // Switches of indices that no longer exist go with them.
  const settings = await store.getSearchSettings();
  const managedKeys = new Set(derived.map((m) => m.definition.key));
  const disabled = disabledIndexKeys(settings);
  if ([...disabled].some((key) => !managedKeys.has(key))) {
    await store.setSearchSettings({
      ...settings,
      disabledDefaults: disabledDefaultsOf([...disabled].filter((key) => managedKeys.has(key))),
    });
  }

  // An entity type deletion takes its indices by cascade; their tables
  // are collected here.
  await store.sweepGenerations();
  invalidateSearchContext(ontologyKey);
  await reconcileSearchGenerations(ontologyKey);

  const refreshTypes = new Set(options.refreshTypes ?? []);
  if (refreshTypes.size > 0) {
    for (const index of await store.listIndices()) {
      if (readsType(index.definition, refreshTypes)) {
        await refreshSearchIndex(ontologyKey, index.key);
        result.refreshed.push(index.key);
      }
    }
  }
  return result;
}

/** Create a managed index row; null when its root type is gone or a
 * concurrent sync (another server process) created it first. */
async function createUnlessTaken(
  store: SearchIndexStore,
  kind: SearchIndexKind,
  definition: SearchIndexDefinition,
): Promise<SearchIndexRecord | null> {
  try {
    return await store.createIndex(randomUUID(), kind, definition);
  } catch (exc) {
    if (exc instanceof ConflictError) return null;
    throw exc;
  }
}

/** Whether an index renders anything of one of the types: its root, a
 * grouped relation type or a group's target type. */
function readsType(definition: SearchIndexDefinition, types: ReadonlySet<string>): boolean {
  return (
    types.has(definition.entityType) ||
    definition.relations.some(
      (group) =>
        types.has(group.relationType) || Object.keys(group.target).some((target) => types.has(target)),
    )
  );
}
