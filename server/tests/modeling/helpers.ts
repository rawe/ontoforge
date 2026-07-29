/**
 * Shared unit-test support for the modeling surface: a fully mocked
 * modeling store (the Python suite's equivalent of patching the adapter
 * query module) and the canonical fixture rows.
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

export interface MockModelingStore {
  reservedEntityTypeKeys: Mock;
  reservedRelationTypeKeys: Mock;
  findReservedTypeKeysInUse: Mock;
  createOntology: Mock;
  listOntologies: Mock;
  getOntology: Mock;
  getOntologyByName: Mock;
  getOntologyByKey: Mock;
  updateOntology: Mock;
  deleteOntology: Mock;
  addIncludesType: Mock;
  listIncludesTypes: Mock;
  getIncludesType: Mock;
  updateIncludesType: Mock;
  removeIncludesType: Mock;
  createEntityType: Mock;
  listEntityTypes: Mock;
  getEntityType: Mock;
  getEntityTypeByKey: Mock;
  updateEntityType: Mock;
  deleteEntityType: Mock;
  isEntityTypeReferenced: Mock;
  createRelationType: Mock;
  listRelationTypes: Mock;
  getRelationType: Mock;
  getRelationTypeByKey: Mock;
  updateRelationType: Mock;
  deleteRelationType: Mock;
  createProperty: Mock;
  listProperties: Mock;
  getProperty: Mock;
  getPropertyByKey: Mock;
  updateProperty: Mock;
  deleteProperty: Mock;
  removeAllIncludesForType: Mock;
  findOntologiesIncludingType: Mock;
  findOntologiesWithExplicitProperty: Mock;
  addPropertyToIncludesLists: Mock;
  removePropertyFromIncludesLists: Mock;
  deleteChunksForTypeProperty: Mock;
  listAiAgents: Mock;
  upsertAiAgent: Mock;
  deleteAiAgent: Mock;
  listSavedQueries: Mock;
  upsertSavedQuery: Mock;
  deleteSavedQuery: Mock;
  getFullSchema: Mock;
  getEntityTypesWithProperties: Mock;
  setEntityEmbedding: Mock;
  listSavedQueryRefs: Mock;
  setSavedQueryEmbedding: Mock;
  createVectorIndex: Mock;
  dropVectorIndex: Mock;
  rebuildVectorIndex: Mock;
  createDocumentVectorIndex: Mock;
  dropDocumentVectorIndex: Mock;
  ensureSavedQueryVectorIndex: Mock;
  ensureVectorIndexes: Mock;
}

/**
 * A mock store whose reads default to "nothing stored" and whose reserved
 * sets are the adapter's real ones. Tests override per scenario.
 */
export function createMockModelingStore(): MockModelingStore {
  return {
    reservedEntityTypeKeys: vi.fn(() => new Set(RESERVED_ENTITY_TYPE_KEYS)),
    reservedRelationTypeKeys: vi.fn(() => new Set(RESERVED_RELATION_TYPE_KEYS)),
    findReservedTypeKeysInUse: vi.fn(async () => []),
    createOntology: vi.fn(),
    listOntologies: vi.fn(async () => []),
    getOntology: vi.fn(async () => null),
    getOntologyByName: vi.fn(async () => null),
    getOntologyByKey: vi.fn(async () => null),
    updateOntology: vi.fn(async () => null),
    deleteOntology: vi.fn(async () => false),
    addIncludesType: vi.fn(async () => null),
    listIncludesTypes: vi.fn(async () => []),
    getIncludesType: vi.fn(async () => null),
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
    findOntologiesIncludingType: vi.fn(async () => []),
    findOntologiesWithExplicitProperty: vi.fn(async () => []),
    addPropertyToIncludesLists: vi.fn(async () => 0),
    removePropertyFromIncludesLists: vi.fn(async () => 0),
    deleteChunksForTypeProperty: vi.fn(async () => undefined),
    listAiAgents: vi.fn(async () => []),
    upsertAiAgent: vi.fn(),
    deleteAiAgent: vi.fn(async () => false),
    listSavedQueries: vi.fn(async () => []),
    upsertSavedQuery: vi.fn(),
    deleteSavedQuery: vi.fn(async () => false),
    getFullSchema: vi.fn(async () => ({ entityTypes: [], relationTypes: [], ontologies: [] })),
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
  return mock as unknown as ModelingStore;
}
