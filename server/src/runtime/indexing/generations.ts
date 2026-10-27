/**
 * Generation reconciliation: every index has, per enabled representation,
 * a generation that matches what it should hold — building or ready.
 *
 * A generation is identified by the definition hash and, for semantic
 * entries, the provider's model id and width, for keyword entries the
 * ontology's keyword language set. Whenever none matches, a new one is
 * created (superseding one still building) with a full backfill: every
 * entity of the root type queued. The ready generation keeps serving
 * until the new one is finished. That covers every trigger — an index
 * created, imported or edited, a managed definition changed by the
 * schema, the language set or the embedding model changed — as long as
 * the caller reconciles after the change:
 *
 * - the worker, at start (model change, language change, upgrade) and
 *   whenever an ontology's design revision moved since it last
 *   reconciled it (a post-commit reconcile that failed, `afterCommit`);
 * - modeling, after index CRUD, search-settings changes, schema changes
 *   and imports (`reconcileSearchGenerations`);
 * - a manual rebuild, which forces new generations (`rebuildSearchIndex`).
 *
 * Changes that alter rendered text without changing a definition —
 * display names, the name property behind a default header — re-queue
 * the index's entities into its current generations instead
 * (`refreshSearchIndex`).
 *
 * A switched-off representation keeps no generation, and neither does a
 * switched-off managed index (search settings). Semantic entries
 * need an embedding provider: without one no semantic generation is
 * created, and existing ones are left as they are.
 *
 * A reconciliation reads the design revision before anything else and
 * creates and retires only while the design is still that revision: what
 * it read can then be no older than the revision, and a design change
 * committed meanwhile reconciles again after its own commit. Two
 * processes reconciling the same revision create one generation: the
 * second finds the first's match.
 */

import { randomUUID } from "node:crypto";

import { getEmbeddingProvider } from "../../core/embedding.js";
import { ConflictError, NotFoundError } from "../../core/exceptions.js";
import {
  getSearchIndexStore,
  type DesignRevision,
  type NewSearchGeneration,
  type SearchGenerationRecord,
  type SearchIndexRecord,
  type SearchIndexStore,
} from "../../core/ports.js";
import type { KeywordLanguageSet } from "../../core/keywordLanguage.js";
import { definitionHash, type SearchRepresentation } from "../../core/searchIndex.js";
import { disabledIndexKeys } from "../../core/searchPipeline.js";

const REPRESENTATIONS: readonly SearchRepresentation[] = ["keyword", "semantic"];

/** One generation a reconciliation started or retired. */
export interface GenerationChange {
  indexKey: string;
  representation: SearchRepresentation;
  action: "created" | "retired";
  generationId: string;
}

/**
 * Bring every index of an ontology to matching generations (see the
 * module comment). The representations `force` names per index key get
 * new generations whether or not one matches. Returns what changed.
 */
export async function reconcileSearchGenerations(
  ontologyKey: string,
  force: ReadonlyMap<string, ReadonlySet<SearchRepresentation>> = new Map(),
): Promise<GenerationChange[]> {
  const store = await getSearchIndexStore(ontologyKey);
  const design = await store.designRevision();
  const [indices, generations, settings] = await Promise.all([
    store.listIndices(),
    store.listGenerations(),
    store.getSearchSettings(),
  ]);
  const disabled = disabledIndexKeys(settings);
  const changes: GenerationChange[] = [];
  for (const index of indices) {
    const live = generations.filter(
      (g) => g.searchIndexId === index.searchIndexId && (g.state === "building" || g.state === "ready"),
    );
    changes.push(
      ...(await reconcileIndex(store, index, live, {
        design,
        keywordLanguages: settings.keywordLanguages,
        force: force.get(index.key) ?? new Set(),
        disabled: disabled.has(index.key),
      })),
    );
  }
  return changes;
}

/**
 * Run the work that follows a committed design change — sweeping,
 * reconciling, refreshing — as best effort: the change stands, so a
 * failure (a lock wait over the timeout, a storage error) is logged, not
 * answered. The worker reconciles every ontology whose design revision
 * moved since it last did (`worker.ts`), which heals a failed or cut-off
 * run.
 */
export async function afterCommit(ontologyKey: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (exc) {
    console.warn(
      `Search work after a design change of ontology '${ontologyKey}' failed; the worker reconciles later: ` +
        (exc instanceof Error ? exc.message : String(exc)),
    );
  }
}

/** Force new generations of one index — every enabled representation —
 * and rebuild them from scratch. Retries what failed. Unknown key ->
 * not found; a switched-off managed index -> conflict. A design change
 * committed meanwhile refuses a forced creation (its own reconcile does
 * not force): the rebuild then runs again for the representations still
 * missing, and after three tries it is a conflict. */
export async function rebuildSearchIndex(
  ontologyKey: string,
  indexKey: string,
): Promise<GenerationChange[]> {
  const store = await getSearchIndexStore(ontologyKey);
  if ((await store.getIndex(indexKey)) === null) {
    throw new NotFoundError(`Search index '${indexKey}' not found`);
  }
  if (disabledIndexKeys(await store.getSearchSettings()).has(indexKey)) {
    throw new ConflictError(`Search index '${indexKey}' is switched off`);
  }
  const rebuilt = new Set<SearchRepresentation>();
  const changes: GenerationChange[] = [];
  for (let attempt = 1; ; attempt++) {
    const before = await store.designRevision();
    // Read again each time: a design change meanwhile may have switched a representation.
    const index = await store.getIndex(indexKey);
    if (index === null) return changes;
    const missing = new Set(rebuildable(index).filter((representation) => !rebuilt.has(representation)));
    if (missing.size === 0) return changes;
    const round = await reconcileSearchGenerations(ontologyKey, new Map([[indexKey, missing]]));
    changes.push(...round);
    for (const change of round) {
      if (change.indexKey === indexKey && change.action === "created") rebuilt.add(change.representation);
    }
    if ([...missing].every((representation) => rebuilt.has(representation))) return changes;
    if ((await store.designRevision()).revision === before.revision) return changes;
    if (attempt === 3) {
      throw new ConflictError(`The design of ontology '${ontologyKey}' kept changing; rebuild again`);
    }
  }
}

/** Re-queue every entity of an index into its current generations — for
 * changes of rendered text that leave the definition alone (display
 * names, the name property). Unchanged entries cost no embedding. The
 * count of items queued; unknown key -> not found. */
export async function refreshSearchIndex(ontologyKey: string, indexKey: string): Promise<number> {
  const store = await getSearchIndexStore(ontologyKey);
  const index = await store.getIndex(indexKey);
  if (index === null) {
    throw new NotFoundError(`Search index '${indexKey}' not found`);
  }
  return requeueIndex(store, index);
}

/** Re-queue every entity of `index` into its current generations through
 * `store` — a design change's own store queues in that change. */
export async function requeueIndex(store: SearchIndexStore, index: SearchIndexRecord): Promise<number> {
  const live = (await store.listGenerations(index.searchIndexId))
    .filter((g) => g.state === "building" || g.state === "ready")
    .map((g) => g.generationId);
  return store.enqueueEntityType(live, index.definition.entityType);
}

async function reconcileIndex(
  store: SearchIndexStore,
  index: SearchIndexRecord,
  live: SearchGenerationRecord[],
  { design, keywordLanguages, force, disabled }: {
    design: DesignRevision;
    keywordLanguages: KeywordLanguageSet;
    /** The representations to build anew whether or not one matches. */
    force: ReadonlySet<SearchRepresentation>;
    disabled: boolean;
  },
): Promise<GenerationChange[]> {
  const changes: GenerationChange[] = [];
  const change = (
    representation: SearchRepresentation,
    action: GenerationChange["action"],
    generationId: string,
  ) => changes.push({ indexKey: index.key, representation, action, generationId });
  const provider = getEmbeddingProvider();

  for (const representation of REPRESENTATIONS) {
    const generations = live.filter((g) => g.representation === representation);
    if (disabled || !index.definition[representation].enabled) {
      for (const generation of generations) {
        if (await store.retireGeneration(generation.generationId, design)) {
          change(representation, "retired", generation.generationId);
        }
      }
      continue;
    }
    if (representation === "semantic" && provider === null) continue;

    const wanted: NewSearchGeneration = {
      generationId: randomUUID(),
      searchIndexId: index.searchIndexId,
      representation,
      definitionHash: definitionHash(index.definition, representation),
      modelId: representation === "semantic" ? provider!.modelId : null,
      dimensions: representation === "semantic" ? provider!.dimensions : null,
      languages: representation === "keyword" ? keywordLanguages : null,
    };
    const building = generations.find((g) => g.state === "building");
    const ready = generations.find((g) => g.state === "ready");
    const forced = force.has(representation);
    if (!forced) {
      if (building !== undefined && matches(building, wanted)) continue;
      if (ready !== undefined && matches(ready, wanted)) {
        // The active generation is current: a build towards something
        // else (a definition since changed back) is not wanted.
        if (building !== undefined && (await store.retireGeneration(building.generationId, design))) {
          change(representation, "retired", building.generationId);
        }
        continue;
      }
    }
    const created = await store.createGeneration(wanted, {
      design,
      backfillEntityType: index.definition.entityType,
      force: forced,
    });
    if (created !== null) change(representation, "created", created.generationId);
  }
  return changes;
}

/** The representations of `index` that have generations: the enabled
 * ones, semantic only with an embedding provider. */
function rebuildable(index: SearchIndexRecord): SearchRepresentation[] {
  const provider = getEmbeddingProvider();
  return REPRESENTATIONS.filter(
    (representation) =>
      index.definition[representation].enabled && (representation === "keyword" || provider !== null),
  );
}

/** Whether a generation holds what `wanted` describes. */
function matches(generation: SearchGenerationRecord, wanted: NewSearchGeneration): boolean {
  return (
    generation.definitionHash === wanted.definitionHash &&
    generation.modelId === wanted.modelId &&
    generation.dimensions === wanted.dimensions &&
    (generation.languages ?? []).join(",") === (wanted.languages ?? []).join(",")
  );
}
