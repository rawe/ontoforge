/**
 * Managed search indices: per entity type a default index over its own
 * string properties, per document property a passage index
 * (`deriveManagedIndices`). They follow the schema silently — their
 * definitions change in the same design change as the schema
 * (`syncManagedDefinitions`), and the generations follow after its commit
 * (`afterDesignChange`); the worker syncs both at start
 * (`syncManagedSearchIndices`):
 *
 * - a derived index without a row gets one, and is included in every
 *   scoped lens that exposes its root type (a passage index: its
 *   document property too), so scoped lenses stay searchable as the
 *   schema grows without finding entities by hidden text (the storage
 *   upgrade includes the existing ones the same way);
 * - a row whose derived definition changed is updated — a changed hash
 *   then yields a new generation;
 * - a row nothing derives any more is deleted;
 * - then the generations are reconciled.
 *
 * Text a definition does not capture — display names, the name property
 * behind a passage header — is refreshed by re-queueing the entities of
 * every index that reads the changed type, in the design change itself
 * (`refreshReaders`): the queue commits with the change or not at all.
 *
 * A managed index can be switched off (search settings, `settings.ts`):
 * its row stays, it keeps no generations and no lens can search it.
 */

import { randomUUID } from "node:crypto";

import { getModelingStore, type SearchIndexStore } from "../../core/ports.js";
import {
  definitionsEqual,
  deriveManagedIndices,
  type SearchIndexDefinition,
  type SearchIndexKind,
} from "../../core/searchIndex.js";
import { disabledDefaultsOf, disabledIndexKeys } from "../../core/searchPipeline.js";
import { loadSearchContextUncached } from "../schemaCache.js";
import { reconcileSearchGenerations, requeueIndex } from "./generations.js";

/** What one sync changed, by index key. */
export interface ManagedSync {
  created: string[];
  updated: string[];
  deleted: string[];
}

/** What bringing the managed rows in step with the schema would do. */
interface ManagedPlan {
  create: { kind: SearchIndexKind; definition: SearchIndexDefinition }[];
  update: SearchIndexDefinition[];
  delete: string[];
  /** The switched-off keys to keep, when some name an index that is gone. */
  disabled: string[] | null;
}

/** Plan the managed rows against the schema, as read now through `store`. */
async function planManaged(store: SearchIndexStore): Promise<ManagedPlan> {
  const { schema, indices } = await loadSearchContextUncached(store);
  const settings = await store.getSearchSettings();
  const existing = new Map(
    indices.filter((index) => index.kind !== "custom").map((index) => [index.key, index] as const),
  );
  const plan: ManagedPlan = { create: [], update: [], delete: [], disabled: null };
  const derived = deriveManagedIndices(schema);
  for (const { kind, definition } of derived) {
    const row = existing.get(definition.key);
    existing.delete(definition.key);
    if (row === undefined) {
      plan.create.push({ kind, definition });
    } else if (!definitionsEqual(row.definition, definition)) {
      plan.update.push(definition);
    }
  }
  plan.delete = [...existing.keys()];
  // Switches of indices that no longer exist go with them.
  const managedKeys = new Set(derived.map((m) => m.definition.key));
  const disabled = [...disabledIndexKeys(settings)];
  if (disabled.some((key) => !managedKeys.has(key))) {
    plan.disabled = disabled.filter((key) => managedKeys.has(key));
  }
  return plan;
}

function isEmpty(plan: ManagedPlan): boolean {
  return plan.create.length + plan.update.length + plan.delete.length === 0 && plan.disabled === null;
}

/**
 * Bring the managed index rows of an ontology in step with its schema:
 * the part of a schema change that belongs to its design change — `store`
 * is that change's search-index store. The generations follow after the
 * commit (`afterDesignChange`).
 */
export async function syncManagedDefinitions(store: SearchIndexStore): Promise<ManagedSync> {
  const plan = await planManaged(store);
  const result: ManagedSync = { created: [], updated: [], deleted: [] };
  for (const { kind, definition } of plan.create) {
    // Null when its root type is gone. No other process creates it
    // meanwhile: the design change holds the design exclusively.
    if ((await store.createIndex(randomUUID(), kind, definition)) !== null) {
      await store.includeIndexInScopedLenses(definition.key);
      result.created.push(definition.key);
    }
  }
  for (const definition of plan.update) {
    await store.updateIndexDefinition(definition.key, definition);
    result.updated.push(definition.key);
  }
  for (const key of plan.delete) {
    await store.deleteIndex(key);
    result.deleted.push(key);
  }
  if (plan.disabled !== null) {
    const settings = await store.getSearchSettings();
    await store.setSearchSettings({ ...settings, disabledDefaults: disabledDefaultsOf(plan.disabled) });
  }
  return result;
}

/**
 * After a design change committed: collect the tables of the generations
 * it removed (an entity type deletion takes its indices by cascade) and
 * reconcile every index's generations.
 */
export async function afterDesignChange(store: SearchIndexStore): Promise<void> {
  await store.sweepGenerations();
  await reconcileSearchGenerations(store.ontologyKey);
}

/**
 * Within a design change, through its `store`: re-queue the entities of
 * every index that reads any of `types` (entity or relation type keys
 * whose display names or name property change). Returns the keys refreshed.
 */
export async function refreshReaders(store: SearchIndexStore, types: readonly string[]): Promise<string[]> {
  const refreshed: string[] = [];
  const wanted = new Set(types);
  if (wanted.size === 0) return refreshed;
  for (const index of await store.listIndices()) {
    if (readsType(index.definition, wanted)) {
      await requeueIndex(store, index);
      refreshed.push(index.key);
    }
  }
  return refreshed;
}

/**
 * The worker's sync at start: bring the managed rows in step with the
 * schema — as a design change of its own, only when they differ, so
 * processes starting together change them once — then sweep and
 * reconcile (`afterDesignChange`).
 */
export async function syncManagedSearchIndices(store: SearchIndexStore): Promise<ManagedSync> {
  let result: ManagedSync = { created: [], updated: [], deleted: [] };
  if (!isEmpty(await planManaged(store))) {
    const modeling = await getModelingStore(store.ontologyKey);
    // Planned again under the exclusive hold: another process may have
    // synced meanwhile.
    result = await modeling.changeDesign((change) => syncManagedDefinitions(change.searchIndices()));
  }
  await afterDesignChange(store);
  return result;
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
