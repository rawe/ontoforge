/**
 * Shared unit-test support for the runtime surface: a fully mocked runtime
 * store and the canonical schema fixtures.
 */

import { vi, type Mock } from "vitest";

import type {
  RankedSearchEntry,
  RuntimeStore,
  SearchEntryQuery,
  SearchGenerationRecord,
  SearchIndexRecord,
  StagedObjectRecord,
} from "../../src/core/ports.js";
import { deriveManagedIndices, type SearchIndexSchema } from "../../src/core/searchIndex.js";
import { recordedDocument, valueBytes } from "../../src/runtime/changesets.js";
import { createMockRulesetStore, type MockRulesetStore } from "../mockRulesetStore.js";
import { createMockChangesetStore, type MockChangesetStore } from "../mockChangesetStore.js";
import { createMockNavigatorStore, type MockNavigatorStore } from "../mockNavigatorStore.js";
import { createMockSearchIndexStore, type MockSearchIndexStore } from "../mockSearchIndexStore.js";

export const NOW = new Date("2025-01-01T12:00:00.000Z");

type Row = Record<string, unknown>;

interface InclusionRow {
  key: string;
  properties: string[] | null;
}

/**
 * Build a full-schema payload as returned by the runtime store's
 * `getFullSchemaWithLensInclusions`. With no inclusions the lens is fully unscoped.
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
        nameProperty: "name",
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
        nameProperty: "name",
        properties: [
          { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
        ],
      },
      {
        entityTypeId: "et-3",
        key: "department",
        displayName: "Department",
        description: null,
        nameProperty: "name",
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
 * one non-method member, the store's ontology binding, stays a value; the
 * search-index, navigator, ruleset and changeset stores it hands out are
 * mocks too (`indices`, `navigatorStore`, `rulesetStore`, `changesetStore`).
 * `transaction` hands its work the mock itself. */
export type MockRuntimeStore = {
  [K in Exclude<keyof RuntimeStore, "ontologyKey">]: Mock;
} & {
  ontologyKey: string;
  indices: MockSearchIndexStore;
  navigatorStore: MockNavigatorStore;
  rulesetStore: MockRulesetStore;
  changesetStore: MockChangesetStore;
};

/** A mock store whose reads default to "nothing stored". */
export function createMockRuntimeStore(ontologyKey = "test_ont"): MockRuntimeStore {
  const indices = createMockSearchIndexStore(ontologyKey);
  const navigatorStore = createMockNavigatorStore();
  const rulesetStore = createMockRulesetStore();
  const changesetStore = createMockChangesetStore();
  const store: MockRuntimeStore = {
    ontologyKey,
    indices,
    navigatorStore,
    rulesetStore,
    changesetStore,
    searchIndices: vi.fn(() => indices),
    navigators: vi.fn(() => navigatorStore),
    rulesets: vi.fn(() => rulesetStore),
    changesets: vi.fn(() => changesetStore),
    transaction: vi.fn(async (work: (bound: RuntimeStore) => Promise<unknown>) => work(store)),
    supportsKeywordRanking: vi.fn(() => false),
    supportsSearchPathConditions: vi.fn(() => false),
    getFullSchemaWithLensInclusions: vi.fn(async () => null),
    getAgentConfigs: vi.fn(async () => []),
    getSavedQueries: vi.fn(async () => []),
    createEntity: vi.fn(),
    listEntities: vi.fn(async () => [[], 0]),
    getEntity: vi.fn(async () => null),
    getEntityById: vi.fn(async () => null),
    updateEntity: vi.fn(async () => null),
    deleteEntity: vi.fn(async () => false),
    getEntitiesByIds: vi.fn(async () => ({})),
    searchSavedQueries: vi.fn(async () => []),
    createRelation: vi.fn(),
    listRelations: vi.fn(async () => [[], 0]),
    getRelation: vi.fn(async () => null),
    updateRelation: vi.fn(async () => null),
    deleteRelation: vi.fn(async () => false),
    getNeighbors: vi.fn(async () => []),
    distinctEntityValues: vi.fn(async () => []),
    executeOql: vi.fn(async () => [[], []]),
    getAncestors: vi.fn(async () => []),
    hasChildren: vi.fn(async () => false),
    createEntityWithParent: vi.fn(),
    parentsOf: vi.fn(async () => []),
    childrenOf: vi.fn(async () => []),
    getEntitiesByIdsHashed: vi.fn(async () => ({})),
    getRelationsByIds: vi.fn(async () => ({})),
    getEntityTypes: vi.fn(async () => ({})),
    lockTargets: vi.fn(async () => []),
  };
  return store;
}

export function asRuntimeStore(mock: MockRuntimeStore): RuntimeStore {
  return mock;
}

/** Staged values by key: `[after]` on a create, `[after, before]` on an
 * update, a before `undefined` for a key the target lacked. */
export type StagedValues = Record<string, [unknown] | [unknown, unknown]>;

/** A staged object as the changeset store keeps it: a relation when it has
 * `ends`. */
export function stagedObject(
  objectId: string,
  action: StagedObjectRecord["action"],
  typeKey: string,
  values: StagedValues = {},
  ends?: [string, string],
): StagedObjectRecord {
  return {
    objectId,
    kind: ends === undefined ? "entity" : "relation",
    typeKey,
    action,
    fromId: ends?.[0] ?? null,
    toId: ends?.[1] ?? null,
    firstTouchedAt: NOW,
    values: Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([propertyKey, pair]) => {
        const before = pair.length === 1 ? null : pair[1] === undefined ? {} : { value: pair[1] };
        return { propertyKey, value: pair[0], before, bytes: valueBytes(pair[0], before) };
      }),
  };
}

/** `objects` first touched one second apart, in this order. */
export function inTouchOrder(objects: StagedObjectRecord[]): StagedObjectRecord[] {
  return objects.map((object, i) => ({ ...object, firstTouchedAt: new Date(NOW.getTime() + i * 1000) }));
}

/** `props` with each string under a document key of `typeKey` as its
 * fingerprint, as the fingerprinting reads return it. */
export function fingerprinted(props: Row, typeKey: string, documentKeys: Record<string, string[]>): Row {
  const row = { ...props };
  for (const key of documentKeys[typeKey] ?? []) {
    if (typeof row[key] === "string") row[key] = recordedDocument(row[key] as string);
  }
  return row;
}

/** `getEntitiesByIdsHashed` over the entities of `rows`, by id. */
export function hashedById(rows: Record<string, Row>, ids: string[], documentKeys: Record<string, string[]>): Record<string, Row> {
  return Object.fromEntries(
    ids
      .filter((id) => id in rows)
      .map((id) => [id, fingerprinted(rows[id]!, rows[id]!._entityTypeKey as string, documentKeys)]),
  );
}

/**
 * Let the store's search indices answer through the managed indices of
 * `schema`: each has a ready generation of both representations — the
 * semantic one of `modelId` — and `rank` answers every ranking. Index
 * `<type>~default` ranks a type's own fields, `<type>~<property>` the
 * passages of a document property.
 */
export function withManagedIndices(
  store: MockRuntimeStore,
  schema: SearchIndexSchema,
  modelId: string | undefined,
  rank: (query: SearchEntryQuery) => RankedSearchEntry[],
): void {
  const records: SearchIndexRecord[] = deriveManagedIndices(schema).map(({ kind, definition }) => ({
    searchIndexId: `id-${definition.key}`,
    key: definition.key,
    kind,
    definition,
    createdAt: NOW,
    updatedAt: NOW,
  }));
  const generations: SearchGenerationRecord[] = records.flatMap((index) =>
    (["semantic", "keyword"] as const).map((representation) => ({
      generationId: `${index.key}/${representation}`,
      searchIndexId: index.searchIndexId,
      representation,
      definitionHash: "h",
      modelId: representation === "semantic" ? (modelId as string) : null,
      dimensions: null,
      languages: representation === "keyword" ? ["german", "english"] : null,
      state: "ready" as const,
      total: 0,
      done: 0,
      failed: 0,
      createdAt: NOW,
      readyAt: NOW,
    })),
  );
  store.indices.listIndices.mockResolvedValue(records);
  store.indices.listGenerations.mockResolvedValue(generations);
  store.indices.rankEntries.mockImplementation(async (query: SearchEntryQuery) => rank(query));
}

/** One ranked entry: an entity's own fields, or — with `passage` — one
 * passage of a document. */
export function rankedEntry(
  entityId: string,
  score: number,
  passage?: { startChar: number; charLength: number; text: string },
): RankedSearchEntry {
  return {
    entityId,
    partKind: passage === undefined ? "self" : "passage",
    groupNo: 0,
    partId: passage === undefined ? "" : "0",
    relationType: null,
    targetType: null,
    targetId: null,
    startChar: passage?.startChar ?? null,
    charLength: passage?.charLength ?? null,
    text: passage?.text ?? entityId,
    score,
  };
}
