/**
 * Shared unit-test support for the modeling surface: a fully mocked
 * modeling store and the canonical fixture rows.
 */

import { vi, type Mock } from "vitest";

import type { ModelingStore } from "../../src/core/ports.js";
import { createMockNavigatorStore, type MockNavigatorStore } from "../mockNavigatorStore.js";
import { createMockSearchIndexStore, type MockSearchIndexStore } from "../mockSearchIndexStore.js";

export const NOW = new Date("2025-01-01T12:00:00.000Z");

/** Every port method as a mock — completeness is compiler-enforced. The
 * search-index and navigator stores it hands out are mocks too (`indices`,
 * `navigatorStore`). */
export type MockModelingStore = {
  [K in keyof ModelingStore]: Mock;
} & { indices: MockSearchIndexStore; navigatorStore: MockNavigatorStore };

/**
 * A mock store whose reads default to "nothing stored". Tests override
 * per scenario.
 */
export function createMockModelingStore(): MockModelingStore {
  const indices = createMockSearchIndexStore();
  const navigatorStore = createMockNavigatorStore();
  const store: MockModelingStore = {
    indices,
    navigatorStore,
    searchIndices: vi.fn(() => indices),
    navigators: vi.fn(() => navigatorStore),
    // A design change hands its work the mock itself.
    changeDesign: vi.fn(async (work: (store: ModelingStore) => Promise<unknown>) => work(store)),
    createLens: vi.fn(),
    listLenses: vi.fn(async () => []),
    getLens: vi.fn(async () => null),
    getLensByName: vi.fn(async () => null),
    getLensByKey: vi.fn(async () => null),
    updateLens: vi.fn(async () => null),
    deleteLens: vi.fn(async () => false),
    addIncludesType: vi.fn(async () => null),
    listIncludesTypes: vi.fn(async () => []),
    updateIncludesType: vi.fn(async () => null),
    removeIncludesType: vi.fn(async () => false),
    createEntityType: vi.fn(),
    listEntityTypes: vi.fn(async () => []),
    getEntityType: vi.fn(async () => null),
    getEntityTypeByKey: vi.fn(async () => null),
    updateEntityType: vi.fn(async () => null),
    deleteEntityType: vi.fn(async () => false),
    isEntityTypeReferenced: vi.fn(async () => false),
    // A write, not a refusal: import goes on with the next type.
    createRelationType: vi.fn(async () => ({ row: {} })),
    listRelationTypes: vi.fn(async () => []),
    getRelationType: vi.fn(async () => null),
    getRelationTypeByKey: vi.fn(async () => null),
    updateRelationType: vi.fn(async () => null),
    setRelationTypeRules: vi.fn(async () => null),
    findRelationRuleViolations: vi.fn(async () => []),
    deleteRelationType: vi.fn(async () => false),
    createProperty: vi.fn(),
    listProperties: vi.fn(async () => []),
    getProperty: vi.fn(async () => null),
    getPropertyByKey: vi.fn(async () => null),
    updateProperty: vi.fn(async () => null),
    deleteProperty: vi.fn(async () => false),
    removeAllIncludesForType: vi.fn(async () => 0),
    findLensesIncludingType: vi.fn(async () => []),
    findLensesWithExplicitProperty: vi.fn(async () => []),
    addPropertyToIncludesLists: vi.fn(async () => 0),
    removePropertyFromIncludesLists: vi.fn(async () => 0),
    listAgents: vi.fn(async () => []),
    listAgentsForExport: vi.fn(async () => []),
    upsertAgent: vi.fn(),
    deleteAgent: vi.fn(async () => false),
    listSavedQueries: vi.fn(async () => []),
    listSavedQueriesForExport: vi.fn(async () => []),
    upsertSavedQuery: vi.fn(),
    deleteSavedQuery: vi.fn(async () => false),
    getFullSchema: vi.fn(async () => ({ entityTypes: [], relationTypes: [], lenses: [] })),
    listSavedQueryRefs: vi.fn(async () => []),
    setSavedQueryEmbedding: vi.fn(async () => undefined),
    ensureSavedQueryVectorIndex: vi.fn(async () => undefined),
    dropMismatchedVectorIndexes: vi.fn(async () => undefined),
    ensureVectorIndexes: vi.fn(async () => undefined),
  };
  return store;
}

export function asModelingStore(mock: MockModelingStore): ModelingStore {
  return mock;
}
