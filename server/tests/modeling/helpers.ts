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
  getFullSchema: Mock;
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
    getFullSchema: vi.fn(async () => ({ entityTypes: [], relationTypes: [], ontologies: [] })),
  };
}

export function asModelingStore(mock: MockModelingStore): ModelingStore {
  return mock as unknown as ModelingStore;
}
