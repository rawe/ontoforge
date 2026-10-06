/**
 * The build status of search indices: per index and enabled
 * representation `ready`, `building` (done/total), `stale` (pending),
 * `failed` (count, last errors) or `unavailable`, or `disabled` for a
 * switched-off managed index — derived from the generations and their
 * queues (`core/searchPipeline.ts`).
 */

import { settings } from "../../config.js";
import { getEmbeddingProvider } from "../../core/embedding.js";
import { NotFoundError } from "../../core/exceptions.js";
import {
  getSearchIndexStore,
  type SearchGenerationRecord,
  type SearchIndexRecord,
  type SearchQueueStats,
} from "../../core/ports.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";
import {
  deriveIndexStatus,
  deriveRepresentationStatus,
  disabledIndexKeys,
  disabledIndexStatus,
  type SearchIndexStatus,
} from "../../core/searchPipeline.js";

export interface SearchIndexStatusEntry extends SearchIndexStatus {
  key: string;
}

/** The status of every index of an ontology, in key order. */
export async function listSearchIndexStatuses(ontologyKey: string): Promise<SearchIndexStatusEntry[]> {
  const store = await getSearchIndexStore(ontologyKey);
  const [indices, generations, queue, searchSettings] = await Promise.all([
    store.listIndices(),
    store.listGenerations(),
    store.queueStats(settings.SEARCH_MAX_ATTEMPTS),
    store.getSearchSettings(),
  ]);
  const disabled = disabledIndexKeys(searchSettings);
  return indices.map((index) => ({
    key: index.key,
    ...statusOf(index, generations, queue, disabled),
  }));
}

/** The status of one index. Unknown key -> not found. */
export async function getSearchIndexStatus(
  ontologyKey: string,
  indexKey: string,
): Promise<SearchIndexStatusEntry> {
  const store = await getSearchIndexStore(ontologyKey);
  const index = await store.getIndex(indexKey);
  if (index === null) {
    throw new NotFoundError(`Search index '${indexKey}' not found`);
  }
  const [generations, queue, searchSettings] = await Promise.all([
    store.listGenerations(index.searchIndexId),
    store.queueStats(settings.SEARCH_MAX_ATTEMPTS),
    store.getSearchSettings(),
  ]);
  return {
    key: index.key,
    ...statusOf(index, generations, queue, disabledIndexKeys(searchSettings)),
  };
}

function statusOf(
  index: SearchIndexRecord,
  generations: SearchGenerationRecord[],
  queue: SearchQueueStats[],
  disabled: ReadonlySet<string>,
): SearchIndexStatus {
  if (disabled.has(index.key)) return disabledIndexStatus();
  const live = generations.filter(
    (g) => g.searchIndexId === index.searchIndexId && (g.state === "building" || g.state === "ready"),
  );
  const representation = (rep: SearchRepresentation) =>
    deriveRepresentationStatus({
      representation: rep,
      enabled: index.definition[rep].enabled,
      available: rep === "keyword" || getEmbeddingProvider() !== null,
      generations: live.filter((g) => g.representation === rep),
      queue,
    });
  // A representation the definition switches off is not reported.
  return deriveIndexStatus(
    (["keyword", "semantic"] as const).filter((rep) => index.definition[rep].enabled).map(representation),
  );
}
