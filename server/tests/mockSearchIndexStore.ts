/**
 * A fully mocked search-index store for unit tests: every method a mock
 * whose default answers "nothing stored" — no indices, no generations, an
 * empty schema — so a schema change or a write plans no search work unless
 * a test says otherwise.
 */

import { vi, type Mock } from "vitest";

import type { SearchIndexStore } from "../src/core/ports.js";

/** Every method as a mock — completeness is compiler-enforced. */
export type MockSearchIndexStore = {
  [K in Exclude<keyof SearchIndexStore, "ontologyKey">]: Mock;
} & { ontologyKey: string };

export function createMockSearchIndexStore(ontologyKey = "test_ont"): MockSearchIndexStore {
  return {
    ontologyKey,
    getSearchSettings: vi.fn(async () => ({ keywordLanguages: ["german", "english"], disabledDefaults: {} })),
    setSearchSettings: vi.fn(async (settings: unknown) => settings),
    createIndex: vi.fn(async () => null),
    listIndices: vi.fn(async () => []),
    getIndex: vi.fn(async () => null),
    updateIndexDefinition: vi.fn(async () => null),
    deleteIndex: vi.fn(async () => false),
    includeIndexInScopedLenses: vi.fn(async () => 0),
    listLensIndexInclusions: vi.fn(async () => []),
    includeIndexInLens: vi.fn(async () => false),
    excludeIndexFromLens: vi.fn(async () => false),
    listRetrievers: vi.fn(async () => []),
    getRetriever: vi.fn(async () => null),
    saveRetriever: vi.fn(),
    deleteRetriever: vi.fn(async () => false),
    transferRetriever: vi.fn(),
    createGeneration: vi.fn(async () => null),
    getGeneration: vi.fn(async () => null),
    listGenerations: vi.fn(async () => []),
    recordGenerationProgress: vi.fn(async () => undefined),
    finishGeneration: vi.fn(async () => false),
    failGeneration: vi.fn(async () => false),
    retireGeneration: vi.fn(async () => false),
    sweepGenerations: vi.fn(async () => undefined),
    upsertEntries: vi.fn(async () => false),
    readEntryHashes: vi.fn(async () => []),
    deleteEntries: vi.fn(async () => 0),
    deleteEntityPartsExcept: vi.fn(async () => 0),
    deleteEntriesOfEntity: vi.fn(async () => 0),
    deleteEntriesOfRelation: vi.fn(async () => 0),
    rankEntries: vi.fn(async () => []),
    readFullSchema: vi.fn(async () => ({ entityTypes: [], relationTypes: [] })),
    enqueueEntityType: vi.fn(async () => 0),
    claimQueueItems: vi.fn(async () => []),
    completeQueueItems: vi.fn(async () => undefined),
    failQueueItems: vi.fn(async () => undefined),
    queueStats: vi.fn(async () => []),
    findLensesIncludingIndex: vi.fn(async () => []),
    measureIndexContent: vi.fn(async () => ({
      entities: 0,
      selfEntries: 0,
      relationEntries: 0,
      passageEntries: 0,
    })),
  };
}
