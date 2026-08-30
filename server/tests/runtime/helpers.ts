/**
 * Shared unit-test support for the runtime surface: a fully mocked runtime
 * store and the canonical schema fixtures.
 */

import { vi, type Mock } from "vitest";

import type { RuntimeStore } from "../../src/core/ports.js";

export const NOW = new Date("2025-01-01T12:00:00.000Z");

type Row = Record<string, unknown>;

interface InclusionRow {
  key: string;
  properties: string[] | null;
}

/**
 * Build a full-schema payload as returned by the runtime store's
 * `getFullSchema`. With no inclusions the lens is fully unscoped.
 */
export function makeFullSchema(options?: {
  lensKey?: string;
  lensName?: string;
  entityInclusions?: InclusionRow[];
  relationInclusions?: InclusionRow[];
}): Row {
  return {
    lens: {
      lensId: "lens-1",
      key: options?.lensKey ?? "hr_view",
      name: options?.lensName ?? "HR View",
      description: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    entityTypes: [
      {
        entityTypeId: "et-1",
        key: "person",
        displayName: "Person",
        description: null,
        properties: [
          { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
          { key: "age", displayName: "Age", dataType: "integer", required: false, defaultValue: null },
          { key: "email", displayName: "Email", dataType: "string", required: false, defaultValue: null },
          { key: "active", displayName: "Active", dataType: "boolean", required: false, defaultValue: "true" },
        ],
      },
      {
        entityTypeId: "et-2",
        key: "company",
        displayName: "Company",
        description: null,
        properties: [
          { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
        ],
      },
      {
        entityTypeId: "et-3",
        key: "department",
        displayName: "Department",
        description: null,
        properties: [
          { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
          { key: "code", displayName: "Code", dataType: "string", required: false, defaultValue: null },
        ],
      },
    ],
    relationTypes: [
      {
        relationTypeId: "rt-1",
        key: "works_for",
        displayName: "Works For",
        description: null,
        sourceKey: "person",
        targetKey: "company",
        properties: [
          { key: "role", displayName: "Role", dataType: "string", required: false, defaultValue: null },
          { key: "since", displayName: "Since", dataType: "date", required: false, defaultValue: null },
        ],
      },
      {
        relationTypeId: "rt-2",
        key: "belongs_to",
        displayName: "Belongs To",
        description: null,
        sourceKey: "department",
        targetKey: "company",
        properties: [],
      },
    ],
    entityInclusions: options?.entityInclusions ?? [],
    relationInclusions: options?.relationInclusions ?? [],
  };
}

/**
 * The scoped fixture (`hr_view`): person narrowed to name+email, company
 * whole, department excluded, works_for explicitly included, belongs_to
 * absent.
 */
export function makeScopedSchema(): Row {
  return makeFullSchema({
    lensKey: "hr_view",
    lensName: "HR View",
    entityInclusions: [
      { key: "person", properties: ["name", "email"] },
      { key: "company", properties: null },
    ],
    relationInclusions: [{ key: "works_for", properties: null }],
  });
}

/** The unscoped fixture (`full_lens`): everything visible. */
export function makeUnscopedSchema(): Row {
  return makeFullSchema({
    lensKey: "full_lens",
    lensName: "Full Lens",
    entityInclusions: [],
    relationInclusions: [],
  });
}

/** Build a raw entity row as returned by the adapter. */
export function makeEntity(
  userProps: Row = {},
  entityTypeKey = "person",
  entityId = "ent-1",
): Row {
  return {
    _id: entityId,
    _entityTypeKey: entityTypeKey,
    _createdAt: NOW,
    _updatedAt: NOW,
    ...userProps,
  };
}

/** Build a raw relation row as returned by the adapter. */
export function makeRelation(
  userProps: Row = {},
  options?: {
    relationTypeKey?: string;
    relationId?: string;
    fromEntityId?: string;
    toEntityId?: string;
  },
): Row {
  return {
    _id: options?.relationId ?? "rel-1",
    _relationTypeKey: options?.relationTypeKey ?? "works_for",
    _createdAt: NOW,
    _updatedAt: NOW,
    fromEntityId: options?.fromEntityId ?? "ent-1",
    toEntityId: options?.toEntityId ?? "ent-2",
    ...userProps,
  };
}

/** Every port method as a mock — completeness is compiler-enforced. The
 * one non-method member, the store's ontology binding, stays a value. */
export type MockRuntimeStore = {
  [K in Exclude<keyof RuntimeStore, "ontologyKey">]: Mock;
} & { ontologyKey: string };

/** A mock store whose reads default to "nothing stored". */
export function createMockRuntimeStore(ontologyKey = "test_ont"): MockRuntimeStore {
  return {
    ontologyKey,
    getFullSchema: vi.fn(async () => null),
    getAiAgentConfigs: vi.fn(async () => []),
    getSavedQueries: vi.fn(async () => []),
    createEntity: vi.fn(),
    listEntities: vi.fn(async () => [[], 0]),
    getEntity: vi.fn(async () => null),
    getEntityById: vi.fn(async () => null),
    updateEntity: vi.fn(async () => null),
    deleteEntity: vi.fn(async () => false),
    getChunkEmbeddingsForEntityProperty: vi.fn(async () => ({})),
    deleteChunksForEntityProperty: vi.fn(async () => undefined),
    createDocumentChunks: vi.fn(async () => undefined),
    validateVectorIndexedProperties: vi.fn(() => undefined),
    searchDocumentChunks: vi.fn(async () => []),
    getEntitiesByIds: vi.fn(async () => ({})),
    semanticSearch: vi.fn(async () => []),
    semanticSearchAll: vi.fn(async () => []),
    searchSavedQueries: vi.fn(async () => []),
    createRelation: vi.fn(),
    listRelations: vi.fn(async () => [[], 0]),
    getRelation: vi.fn(async () => null),
    updateRelation: vi.fn(async () => null),
    deleteRelation: vi.fn(async () => false),
    getNeighbors: vi.fn(async () => []),
    executeOql: vi.fn(async () => [[], []]),
  };
}

export function asRuntimeStore(mock: MockRuntimeStore): RuntimeStore {
  return mock;
}
