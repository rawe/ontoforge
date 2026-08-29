/**
 * Shared unit-test support for the modeling surface: a fully mocked
 * modeling store and the canonical fixture rows.
 */

import { vi, type Mock } from "vitest";

import type { ModelingStore } from "../../src/core/ports.js";

export const NOW = new Date("2025-01-01T12:00:00.000Z");

export const RESERVED_ENTITY_TYPE_KEYS = [
  "ontology",
  "entity_type",
  "relation_type",
  "property_definition",
  "ai_agent_config",
  "saved_query",
];

export const RESERVED_RELATION_TYPE_KEYS = [
  "includes_type",
  "has_property",
  "relates_from",
  "relates_to",
  "has_ai_agent",
  "has_saved_query",
];

/** Every port method as a mock — completeness is compiler-enforced. */
export type MockModelingStore = { [K in keyof ModelingStore]: Mock };

/**
 * A mock store whose reads default to "nothing stored" and whose reserved
 * sets are the adapter's real ones. Tests override per scenario.
 */
export function createMockModelingStore(): MockModelingStore {
  return {
    reservedEntityTypeKeys: vi.fn(() => new Set(RESERVED_ENTITY_TYPE_KEYS)),
    reservedRelationTypeKeys: vi.fn(() => new Set(RESERVED_RELATION_TYPE_KEYS)),
    findReservedTypeKeysInUse: vi.fn(async () => []),
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
    createRelationType: vi.fn(),
    listRelationTypes: vi.fn(async () => []),
    getRelationType: vi.fn(async () => null),
    getRelationTypeByKey: vi.fn(async () => null),
    updateRelationType: vi.fn(async () => null),
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
    deleteChunksForTypeProperty: vi.fn(async () => undefined),
    listAiAgents: vi.fn(async () => []),
    listAiAgentsForExport: vi.fn(async () => []),
    upsertAiAgent: vi.fn(),
    deleteAiAgent: vi.fn(async () => false),
    listSavedQueries: vi.fn(async () => []),
    listSavedQueriesForExport: vi.fn(async () => []),
    upsertSavedQuery: vi.fn(),
    deleteSavedQuery: vi.fn(async () => false),
    getFullSchema: vi.fn(async () => ({ entityTypes: [], relationTypes: [], lenses: [] })),
    getEntityTypesWithProperties: vi.fn(async () => []),
    setEntityEmbedding: vi.fn(async () => undefined),
    listSavedQueryRefs: vi.fn(async () => []),
    setSavedQueryEmbedding: vi.fn(async () => undefined),
    createVectorIndex: vi.fn(async () => undefined),
    dropVectorIndex: vi.fn(async () => undefined),
    rebuildVectorIndex: vi.fn(async () => undefined),
    createDocumentVectorIndex: vi.fn(async () => undefined),
    dropDocumentVectorIndex: vi.fn(async () => undefined),
    ensureSavedQueryVectorIndex: vi.fn(async () => undefined),
    ensureVectorIndexes: vi.fn(async () => undefined),
  };
}

export function asModelingStore(mock: MockModelingStore): ModelingStore {
  return mock;
}
