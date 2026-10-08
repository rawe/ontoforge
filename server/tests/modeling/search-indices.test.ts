/**
 * Search indices in modeling over a mocked store: custom-index CRUD with
 * definition issues as `details.fields` by dotted path, managed keys
 * reserved and managed indices only switched, the preview (never a 422,
 * the full-build estimate), status and rebuild shapes, index deletion
 * under the cascade protocol, the cascade schema removals apply to custom
 * indices (`affectedIndices`), and FEATURE_DISABLED without search
 * indices.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IndexContentRequest,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchQueueStats,
  SearchSettings,
} from "../../src/core/ports.js";
import { SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore; indices: ReturnType<typeof fakeIndexStore> | null } = {
  store: createMockModelingStore(),
  indices: null,
};

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getRuntimeStore: async () => ({}),
  getSearchIndexStore: async () => holder.indices,
}));

const reconcile = vi.hoisted(() => vi.fn(async () => []));
const rebuild = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../src/runtime/indexing/generations.js", () => ({
  reconcileSearchGenerations: reconcile,
  rebuildSearchIndex: rebuild,
}));
const sync = vi.hoisted(() => vi.fn(async () => ({ created: [], updated: [], deleted: [], refreshed: [] })));
vi.mock("../../src/runtime/indexing/managed.js", () => ({ syncManagedSearchIndices: sync }));

const MODEL = "/api/ontologies/onto/model";
const INDICES = `${MODEL}/search-indices`;

type Row = Record<string, unknown>;

const prop = (key: string, dataType: string): Row => ({
  key,
  displayName: key[0]!.toUpperCase() + key.slice(1),
  dataType,
  required: false,
});

/** The full schema as the store reads it. */
const RAW_SCHEMA = {
  entityTypes: [
    { key: "person", displayName: "Person", nameProperty: "name", properties: [prop("name", "string"), prop("bio", "document")] },
    { key: "company", displayName: "Company", nameProperty: "name", properties: [prop("name", "string")] },
  ],
  relationTypes: [
    {
      key: "works_for",
      displayName: "Works for",
      sourceKey: "person",
      targetKey: "company",
      properties: [prop("role", "string")],
    },
  ],
};

const EMPLOYMENT = {
  key: "employment",
  name: "People by employment",
  description: "People with their roles at companies",
  entityType: "person",
  fields: ["name", "bio"],
  relations: [
    { relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name"] } },
  ],
};

function record(kind: SearchIndexRecord["kind"], definition: Row): SearchIndexRecord {
  return {
    searchIndexId: `id-${definition.key as string}`,
    key: definition.key as string,
    kind,
    definition: SearchIndexDefinition.parse({ ...definition, key: kind === "custom" ? definition.key : "managed" }),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function generation(id: string, index: string, representation: "keyword" | "semantic"): SearchGenerationRecord {
  return {
    generationId: id,
    searchIndexId: `id-${index}`,
    representation,
    definitionHash: "h",
    modelId: null,
    dimensions: null,
    languages: null,
    state: "ready",
    total: 4,
    done: 4,
    failed: 0,
    createdAt: NOW,
    readyAt: NOW,
  };
}

/** An in-memory search-index store: one managed index (switched off) and
 * the custom `employment`. */
function fakeIndexStore() {
  const managed = record("default", { key: "person~default", name: "Person — default", description: "d", entityType: "person", fields: ["name"], header: [] });
  managed.key = "person~default";
  managed.definition = { ...managed.definition, key: "person~default" };
  const indices = new Map<string, SearchIndexRecord>([
    [managed.key, managed],
    ["employment", record("custom", EMPLOYMENT)],
  ]);
  let settings: SearchSettings = { keywordLanguages: ["german", "english"], disabledDefaults: { "person~default": true } };
  const queue: SearchQueueStats[] = [
    {
      generationId: "g-kw",
      pending: 0,
      failed: 1,
      lastErrors: [{ entityId: "e-1", partKind: "relation", message: "boom", at: NOW }],
    },
  ];
  // Index inclusions by lens id.
  const inclusions = new Map<string, Set<string>>();
  return {
    ontologyKey: "onto",
    inclusions,
    listLensIndexInclusions: vi.fn(async (lensId: string) => [...(inclusions.get(lensId) ?? [])].sort()),
    includeIndexInLens: vi.fn(async (lensId: string, key: string) => {
      if (!indices.has(key)) return false;
      inclusions.set(lensId, new Set([...(inclusions.get(lensId) ?? []), key]));
      return true;
    }),
    excludeIndexFromLens: vi.fn(async (lensId: string, key: string) => inclusions.get(lensId)?.delete(key) ?? false),
    getSearchSettings: vi.fn(async () => settings),
    setSearchSettings: vi.fn(async (next: SearchSettings) => (settings = next)),
    readFullSchema: vi.fn(async () => RAW_SCHEMA),
    listIndices: vi.fn(async () => [...indices.values()].sort((a, b) => a.key.localeCompare(b.key))),
    getIndex: vi.fn(async (key: string) => indices.get(key) ?? null),
    createIndex: vi.fn(async (id: string, kind: SearchIndexRecord["kind"], definition: SearchIndexDefinition) => {
      const created = { ...record(kind, definition), searchIndexId: id };
      indices.set(definition.key, created);
      return created;
    }),
    updateIndexDefinition: vi.fn(async (key: string, definition: SearchIndexDefinition) => {
      const updated = { ...indices.get(key)!, definition };
      indices.set(key, updated);
      return updated;
    }),
    deleteIndex: vi.fn(async (key: string) => indices.delete(key)),
    findLensesIncludingIndex: vi.fn(async (_key: string): Promise<string[]> => []),
    measureIndexContent: vi.fn(async (_request: IndexContentRequest) => ({
      entities: 10,
      selfEntries: 10,
      relationEntries: 25,
      passageEntries: 15,
    })),
    listGenerations: vi.fn(async () => [generation("g-kw", "employment", "keyword")]),
    queueStats: vi.fn(async () => queue),
  };
}

function withSearchIndices() {
  holder.indices = fakeIndexStore();
  (holder.store as unknown as { searchIndices: () => unknown }).searchIndices = () => holder.indices;
  return holder.indices;
}

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  holder.store = createMockModelingStore();
  holder.indices = null;
  reconcile.mockClear();
  rebuild.mockClear();
  sync.mockClear();
});

describe("reads", () => {
  it("lists managed and custom indices in key order with status", async () => {
    withSearchIndices();
    const res = await app.inject({ url: INDICES });
    expect(res.statusCode, res.body).toBe(200);
    const [employment, managed] = res.json();
    expect(employment).toMatchObject({
      key: "employment",
      kind: "custom",
      enabled: true,
      documentProperty: "bio",
      definition: { ...EMPLOYMENT, header: null, semantic: { enabled: true, template: null } },
      status: {
        // Semantic without a provider; keyword items failed for good.
        state: "failed",
        representations: [
          { representation: "keyword", state: "failed", done: 0, total: 0, pending: 0, failed: 1 },
          { representation: "semantic", state: "unavailable" },
        ],
        lastErrors: [{ entityId: "e-1", partKind: "relation", message: "boom", at: NOW.toISOString() }],
      },
      createdAt: NOW.toISOString(),
    });
    expect(managed).toMatchObject({
      key: "person~default",
      kind: "default",
      enabled: false,
      documentProperty: null,
      status: { state: "disabled", representations: [], lastErrors: [] },
    });
  });

  it("reads one index and its status; an unknown key is not found", async () => {
    withSearchIndices();
    expect((await app.inject({ url: `${INDICES}/employment` })).json().key).toBe("employment");
    const status = await app.inject({ url: `${INDICES}/employment/status` });
    expect(status.statusCode).toBe(200);
    expect(status.json().state).toBe("failed");
    expect((await app.inject({ url: `${INDICES}/nope` })).statusCode).toBe(404);
    expect((await app.inject({ url: `${INDICES}/nope/status` })).statusCode).toBe(404);
  });

  it("answers FEATURE_DISABLED on an adapter without search indices", async () => {
    for (const [method, url] of [
      ["GET", INDICES],
      ["POST", `${INDICES}/preview`],
      ["POST", INDICES],
      ["GET", `${INDICES}/x`],
      ["DELETE", `${INDICES}/x`],
      ["POST", `${INDICES}/x/rebuild`],
    ] as const) {
      const res = await app.inject({ method, url, ...(method === "POST" ? { payload: EMPLOYMENT } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(422);
      expect(res.json().error.details).toEqual({ code: "FEATURE_DISABLED" });
    }
  });
});

describe("create", () => {
  it("creates a custom index and reconciles its generations", async () => {
    const indices = withSearchIndices();
    const res = await app.inject({
      method: "POST",
      url: INDICES,
      payload: { ...EMPLOYMENT, key: "staff", relations: [] },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ key: "staff", kind: "custom", enabled: true });
    expect(indices.createIndex).toHaveBeenCalledWith(expect.any(String), "custom", expect.objectContaining({ key: "staff" }));
    expect(reconcile).toHaveBeenCalledWith("onto");
  });

  it("reports schema issues as details.fields by dotted path", async () => {
    const indices = withSearchIndices();
    const res = await app.inject({
      method: "POST",
      url: INDICES,
      payload: {
        ...EMPLOYMENT,
        key: "staff",
        fields: ["name", "nope"],
        relations: [{ relationType: "works_for", direction: "outgoing", fields: [], target: { city: ["name"] } }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.details.fields).toEqual({
      "fields.1": "Property 'nope' does not exist on entity type 'person'",
      "relations.0.target.city": "Entity type 'city' is not on the other end of relation type 'works_for'",
      "relations.0": "A relation group needs at least one relation or target field",
    });
    expect(indices.createIndex).not.toHaveBeenCalled();
  });

  it("reports shape issues the same way", async () => {
    withSearchIndices();
    const res = await app.inject({
      method: "POST",
      url: INDICES,
      payload: { ...EMPLOYMENT, key: "staff", description: "", relations: [{ relationType: "works_for", direction: "sideways" }] },
    });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().error.details.fields).sort()).toEqual(["description", "relations.0.direction"]);
  });

  it("rejects a managed key and a taken key", async () => {
    withSearchIndices();
    const managed = await app.inject({ method: "POST", url: INDICES, payload: { ...EMPLOYMENT, key: "person~x" } });
    expect(managed.statusCode).toBe(422);
    expect(managed.json().error.details.fields).toEqual({
      key: "Keys with '~' are reserved for managed search indices",
    });
    const taken = await app.inject({ method: "POST", url: INDICES, payload: EMPLOYMENT });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: "RESOURCE_CONFLICT" });
    expect(taken.json().error.message).toContain("'employment'");
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("preview", () => {
  it("never answers 422: an invalid draft comes back with its issues and no estimate", async () => {
    withSearchIndices();
    const res = await app.inject({
      method: "POST",
      url: `${INDICES}/preview`,
      payload: { ...EMPLOYMENT, key: undefined, fields: ["nope"], semantic: { enabled: false }, keyword: { enabled: false } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      valid: false,
      issues: [
        { path: "semantic.enabled", message: "At least one of semantic and keyword must be enabled" },
        { path: "fields.0", message: "Property 'nope' does not exist on entity type 'person'" },
      ],
      estimate: null,
      // Well-shaped: outlined as far as it composes — 'nope' reads nothing,
      // so no self entry.
      outline: [expect.objectContaining({ partKind: "relation", groupNo: 0 })],
    });
    const shape = await app.inject({ method: "POST", url: `${INDICES}/preview`, payload: { name: 3 } });
    expect(shape.statusCode).toBe(200);
    expect(shape.json().valid).toBe(false);
    expect(shape.json().outline).toBeNull();
    // A draft still missing its name and description is outlined.
    const unnamed = await app.inject({
      method: "POST",
      url: `${INDICES}/preview`,
      payload: { ...EMPLOYMENT, key: undefined, name: "", description: undefined },
    });
    expect(unnamed.json().issues.map((i: { path: string }) => i.path)).toEqual(["name", "description"]);
    expect(unnamed.json().outline.map((p: { partKind: string }) => p.partKind)).toEqual(["self", "relation", "passage"]);
    expect(shape.json().issues.map((i: { path: string }) => i.path)).toContain("name");
  });

  it("estimates a full build of a draft without a key from the stored content", async () => {
    const indices = withSearchIndices();
    const { key: _key, ...draft } = EMPLOYMENT;
    const res = await app.inject({ method: "POST", url: `${INDICES}/preview`, payload: draft });
    expect(res.statusCode, res.body).toBe(200);
    // No embedding provider in the unit environment: keyword only.
    expect(res.json()).toEqual({
      valid: true,
      issues: [],
      estimate: {
        entities: 10,
        entries: 50,
        seconds: 0.1,
        perRepresentation: [{ representation: "keyword", entries: 50, seconds: 0.1, measured: false }],
      },
      outline: [
        expect.objectContaining({ partKind: "self", semanticText: "Person: ⟦root.name⟧" }),
        expect.objectContaining({
          partKind: "relation",
          semanticText: "Person: ⟦root.name⟧\nWorks for\nRole: ⟦relation.role⟧\nCompany: ⟦target.name⟧",
          keywordText: "⟦root.name⟧\n⟦relation.role⟧\n⟦target.name⟧",
        }),
        expect.objectContaining({ partKind: "passage", semanticText: "Person: ⟦root.name⟧\n⟦passage⟧" }),
      ],
    });
    expect(indices.measureIndexContent).toHaveBeenCalledWith({
      entityType: "person",
      selfEntries: true,
      passages: { property: "bio", chunkSize: expect.any(Number), chunkOverlap: expect.any(Number) },
      groups: [{ relationType: "works_for", owner: "from", targetTypes: ["company"] }],
    });
  });
});

describe("update", () => {
  it("replaces a custom definition and reconciles", async () => {
    const indices = withSearchIndices();
    const res = await app.inject({
      method: "PUT",
      url: `${INDICES}/employment`,
      payload: { ...EMPLOYMENT, fields: ["name"] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().definition.fields).toEqual(["name"]);
    expect(indices.updateIndexDefinition).toHaveBeenCalledWith("employment", expect.objectContaining({ fields: ["name"] }));
    expect(reconcile).toHaveBeenCalledWith("onto");
  });

  it("requires the path's key, refuses managed indices and unknown keys", async () => {
    const indices = withSearchIndices();
    const mismatch = await app.inject({ method: "PUT", url: `${INDICES}/employment`, payload: { ...EMPLOYMENT, key: "other" } });
    expect(mismatch.statusCode).toBe(422);
    expect(Object.keys(mismatch.json().error.details.fields)).toEqual(["key"]);
    const managed = await app.inject({ method: "PUT", url: `${INDICES}/person~default`, payload: EMPLOYMENT });
    expect(managed.statusCode).toBe(409);
    expect(managed.json().error.message).toContain("managed indices can only be switched");
    expect((await app.inject({ method: "PUT", url: `${INDICES}/nope`, payload: EMPLOYMENT })).statusCode).toBe(404);
    expect(indices.updateIndexDefinition).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("an index a lens includes needs cascade; with it the index goes", async () => {
    const indices = withSearchIndices();
    indices.findLensesIncludingIndex.mockResolvedValue(["hr", "sales"]);
    const refused = await app.inject({ method: "DELETE", url: `${INDICES}/employment` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: "CASCADE_REQUIRED",
      details: { affectedLenses: ["hr", "sales"], affectedIndices: [] },
    });
    expect(indices.deleteIndex).not.toHaveBeenCalled();

    const res = await app.inject({ method: "DELETE", url: `${INDICES}/employment?cascade=true` });
    expect(res.statusCode).toBe(204);
    expect(indices.deleteIndex).toHaveBeenCalledWith("employment");
    expect(reconcile).toHaveBeenCalledWith("onto");
  });

  it("refuses managed indices", async () => {
    withSearchIndices();
    const res = await app.inject({ method: "DELETE", url: `${INDICES}/person~default` });
    expect(res.statusCode).toBe(409);
  });
});

describe("rebuild", () => {
  it("answers 202 with the status", async () => {
    withSearchIndices();
    const res = await app.inject({ method: "POST", url: `${INDICES}/employment/rebuild` });
    expect(res.statusCode, res.body).toBe(202);
    expect(rebuild).toHaveBeenCalledWith("onto", "employment");
    expect(res.json().state).toBe("failed");
  });
});

describe("the cascade of schema removals", () => {
  const ET_PERSON = { entityTypeId: "et-p", key: "person", displayName: "Person", nameProperty: "name", description: null, createdAt: NOW, updatedAt: NOW };
  const RT_WORKS = { relationTypeId: "rt-w", key: "works_for", displayName: "Works for", description: null, sourceEntityTypeKey: "person", targetEntityTypeKey: "company", createdAt: NOW, updatedAt: NOW };
  const ROLE = { propertyId: "p-role", key: "role", displayName: "Role", description: null, dataType: "string", required: false, defaultValue: null, createdAt: NOW, updatedAt: NOW };

  it("deleting the root type of a custom index needs cascade, naming the index", async () => {
    const indices = withSearchIndices();
    holder.store.getEntityType.mockResolvedValue(ET_PERSON);
    indices.findLensesIncludingIndex.mockResolvedValue(["people"]);
    const refused = await app.inject({ method: "DELETE", url: `${MODEL}/entity-types/et-p` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ affectedLenses: ["people"], affectedIndices: ["employment"] });
    expect(refused.json().error.message).toContain("custom search index(es) (employment)");
    expect(holder.store.deleteEntityType).not.toHaveBeenCalled();

    holder.store.deleteEntityType.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: `${MODEL}/entity-types/et-p?cascade=true` });
    expect(res.statusCode, res.body).toBe(204);
    expect(indices.deleteIndex).toHaveBeenCalledWith("employment");
    expect(sync).toHaveBeenCalled();
  });

  it("deleting a grouped relation type removes the group", async () => {
    const indices = withSearchIndices();
    holder.store.getRelationType.mockResolvedValue(RT_WORKS);
    const refused = await app.inject({ method: "DELETE", url: `${MODEL}/relation-types/rt-w` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ affectedLenses: [], affectedIndices: ["employment"] });

    holder.store.deleteRelationType.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: `${MODEL}/relation-types/rt-w?cascade=true` });
    expect(res.statusCode, res.body).toBe(204);
    expect(indices.updateIndexDefinition).toHaveBeenCalledWith(
      "employment",
      expect.objectContaining({ fields: ["name", "bio"], relations: [] }),
    );
    expect(sync).toHaveBeenCalled();
  });

  it("deleting a property a custom index reads is a new trigger; lenses listing it are named", async () => {
    const indices = withSearchIndices();
    holder.store.getRelationType.mockResolvedValue(RT_WORKS);
    holder.store.getProperty.mockResolvedValue(ROLE);
    holder.store.findLensesIncludingType.mockResolvedValue(["hr", "sales"]);
    holder.store.getLensByKey.mockImplementation(async (key: string) => ({ lensId: `l-${key}`, key }));
    holder.store.listIncludesTypes.mockImplementation(async (lensId: string) => [
      { key: "works_for", properties: lensId === "l-hr" ? ["role"] : null },
    ]);
    const url = `${MODEL}/relation-types/rt-w/properties/p-role`;
    const refused = await app.inject({ method: "DELETE", url });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ affectedLenses: ["hr"], affectedIndices: ["employment"] });
    expect(holder.store.deleteProperty).not.toHaveBeenCalled();

    holder.store.deleteProperty.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: `${url}?cascade=true` });
    expect(res.statusCode, res.body).toBe(204);
    expect(indices.updateIndexDefinition).toHaveBeenCalledWith(
      "employment",
      expect.objectContaining({
        relations: [expect.objectContaining({ fields: [], target: { company: ["name"] } })],
      }),
    );
    expect(holder.store.removePropertyFromIncludesLists).toHaveBeenCalled();
  });

  it("a property no custom index reads still deletes without cascade", async () => {
    withSearchIndices();
    holder.store.getEntityType.mockResolvedValue({ ...ET_PERSON, key: "company" });
    holder.store.getProperty.mockResolvedValue({ ...ROLE, key: "founded" });
    holder.store.deleteProperty.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: `${MODEL}/entity-types/et-c/properties/p-f` });
    expect(res.statusCode, res.body).toBe(204);
  });
});

describe("lens index inclusions", () => {
  const LENS = { lensId: "l-1", key: "people", name: "People", description: null, createdAt: NOW, updatedAt: NOW };
  const LENS_INDICES = `${MODEL}/lenses/l-1/includes/search-indices`;

  function withLens(entityTypes: string[] = [], relationTypes: string[] = []) {
    holder.store.getLens.mockImplementation(async (id: string) => (id === "l-1" ? LENS : null));
    holder.store.listIncludesTypes.mockImplementation(async (_id: string, kind: string) =>
      (kind === "EntityType" ? entityTypes : relationTypes).map((key) => ({ key, properties: null })),
    );
  }

  it("includes, lists and removes an index by key", async () => {
    const indices = withSearchIndices();
    withLens(["person"]);
    const created = await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "employment" } });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toEqual({ key: "employment" });
    expect(indices.includeIndexInLens).toHaveBeenCalledWith("l-1", "employment");
    await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "person~default" } });

    expect((await app.inject({ url: LENS_INDICES })).json()).toEqual([
      { key: "employment" },
      { key: "person~default" },
    ]);

    const removed = await app.inject({ method: "DELETE", url: `${LENS_INDICES}/person~default` });
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await app.inject({ url: LENS_INDICES })).json()).toEqual([{ key: "employment" }]);
    const again = await app.inject({ method: "DELETE", url: `${LENS_INDICES}/person~default` });
    expect(again.statusCode).toBe(404);
  });

  it("a scoped lens must include the index's root type", async () => {
    const indices = withSearchIndices();
    withLens(["company"]);
    const res = await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "employment" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe(
      "Root entity type 'person' of search index 'employment' is not included in this lens",
    );
    expect(res.json().error.details.fields).toEqual({ key: "Include entity type 'person' first" });
    expect(indices.includeIndexInLens).not.toHaveBeenCalled();
  });

  it("a lens scoped by relation types only, or an unscoped lens, takes any index", async () => {
    withSearchIndices();
    withLens([], ["works_for"]);
    expect((await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "employment" } })).statusCode).toBe(201);
    withSearchIndices();
    withLens();
    expect((await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "employment" } })).statusCode).toBe(201);
  });

  it("answers 409 for an index already included, 404 for an unknown index or lens", async () => {
    withSearchIndices();
    withLens(["person"]);
    await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "employment" } });
    const twice = await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "employment" } });
    expect(twice.statusCode).toBe(409);
    const unknown = await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "nope" } });
    expect(unknown.statusCode).toBe(404);
    const noLens = `${MODEL}/lenses/l-2/includes/search-indices`;
    expect((await app.inject({ url: noLens })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: noLens, payload: { key: "employment" } })).statusCode).toBe(404);
  });

  it("every change forgets the cached lens schemas", async () => {
    const schemaCache = await import("../../src/runtime/schemaCache.js");
    const invalidate = vi.spyOn(schemaCache, "invalidateLoadedSchemaCache");
    withSearchIndices();
    withLens(["person"]);
    await app.inject({ method: "POST", url: LENS_INDICES, payload: { key: "employment" } });
    expect(invalidate).toHaveBeenCalledTimes(1);
    await app.inject({ method: "DELETE", url: `${LENS_INDICES}/employment` });
    expect(invalidate).toHaveBeenCalledTimes(2);
    invalidate.mockRestore();
  });

  it("answers FEATURE_DISABLED on an adapter without search indices", async () => {
    withLens(["person"]);
    for (const [method, url] of [
      ["GET", LENS_INDICES],
      ["POST", LENS_INDICES],
      ["DELETE", `${LENS_INDICES}/employment`],
    ] as const) {
      const res = await app.inject({ method, url, ...(method === "POST" ? { payload: { key: "employment" } } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(422);
      expect(res.json().error.details).toEqual({ code: "FEATURE_DISABLED" });
    }
  });
});

describe("lens validation warnings", () => {
  const LENS = { lensId: "l-1", key: "people", name: "People", description: null, createdAt: NOW, updatedAt: NOW };

  function lensSchema(entityInclusions: Row[], relationInclusions: Row[] = []) {
    holder.store.getLens.mockResolvedValue(LENS);
    holder.store.listLenses.mockResolvedValue([LENS]);
    holder.store.getFullSchema.mockResolvedValue({
      ...RAW_SCHEMA,
      lenses: [{ ...LENS, entityInclusions, relationInclusions }],
    });
  }

  it("warns about hidden properties, not about skipped groups; the lens stays valid", async () => {
    const indices = withSearchIndices();
    indices.inclusions.set("l-1", new Set(["employment", "person~default"]));
    // Bio hidden; without company the inferred lens shows no works_for.
    lensSchema([{ key: "person", properties: ["name"] }]);
    const res = await app.inject({ method: "POST", url: `${MODEL}/lenses/l-1/validate` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      valid: true,
      errors: [],
      warnings: [
        {
          path: "lenses.people.includes.searchIndices.employment.fields.1",
          message: "Search index 'employment' reads property 'bio' of entity type 'person', which this lens hides",
        },
      ],
    });
  });

  it("keeps an index whose root type the lens no longer includes, and warns", async () => {
    const indices = withSearchIndices();
    indices.inclusions.set("l-1", new Set(["employment"]));
    lensSchema([{ key: "company", properties: null }]);
    const res = await app.inject({ method: "POST", url: `${MODEL}/lenses/l-1/validate` });
    expect(res.json()).toEqual({
      valid: true,
      errors: [],
      warnings: [
        {
          path: "lenses.people.includes.searchIndices.employment.entityType",
          message:
            "Search index 'employment' is not searchable in this lens: its root entity type 'person' is not included",
        },
      ],
    });
    // Schema-wide validation aggregates the lens warnings.
    const all = await app.inject({ method: "POST", url: `${MODEL}/schema/validate` });
    expect(all.json()).toMatchObject({ valid: true, errors: [], warnings: [{ path: "lenses.people.includes.searchIndices.employment.entityType" }] });
  });

  it("an unscoped lens, or one showing everything an index reads, gets none", async () => {
    const indices = withSearchIndices();
    indices.inclusions.set("l-1", new Set(["employment"]));
    lensSchema([]);
    expect((await app.inject({ method: "POST", url: `${MODEL}/lenses/l-1/validate` })).json().warnings).toEqual([]);
    lensSchema([{ key: "person", properties: null }, { key: "company", properties: null }]);
    expect((await app.inject({ method: "POST", url: `${MODEL}/lenses/l-1/validate` })).json().warnings).toEqual([]);
  });
});

describe("property deletion names the lenses of indices it deletes", () => {
  it("affectedLenses joins the lenses listing the property and those including a deleted index", async () => {
    const indices = withSearchIndices();
    await indices.createIndex(
      "id-roles",
      "custom",
      SearchIndexDefinition.parse({
        key: "roles",
        name: "Roles",
        description: "People by role",
        entityType: "person",
        fields: [],
        relations: [{ relationType: "works_for", direction: "outgoing", fields: ["role"], target: {} }],
      }),
    );
    indices.findLensesIncludingIndex.mockImplementation(async (key: string) => (key === "roles" ? ["staff", "hr"] : []));
    holder.store.getRelationType.mockResolvedValue({
      relationTypeId: "rt-w",
      key: "works_for",
      displayName: "Works for",
      description: null,
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "company",
      createdAt: NOW,
      updatedAt: NOW,
    });
    holder.store.getProperty.mockResolvedValue({ propertyId: "p-role", key: "role", displayName: "Role", dataType: "string", required: false });
    holder.store.findLensesIncludingType.mockResolvedValue(["hr"]);
    holder.store.getLensByKey.mockImplementation(async (key: string) => ({ lensId: `l-${key}`, key }));
    holder.store.listIncludesTypes.mockResolvedValue([{ key: "works_for", properties: ["role"] }]);
    const url = `${MODEL}/relation-types/rt-w/properties/p-role`;
    const refused = await app.inject({ method: "DELETE", url });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ affectedLenses: ["hr", "staff"], affectedIndices: ["employment", "roles"] });

    holder.store.deleteProperty.mockResolvedValue(true);
    expect((await app.inject({ method: "DELETE", url: `${url}?cascade=true` })).statusCode).toBe(204);
    expect(indices.deleteIndex).toHaveBeenCalledWith("roles");
  });
});
