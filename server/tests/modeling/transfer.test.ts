/**
 * Schema transfer (export / import) over a mocked store, including the two
 * import guarantees: key patterns are validated, and import is
 * validate-then-write with collect-all reporting — a rejected payload
 * writes NOTHING.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getRuntimeStore: async () => ({}),
}));

// A store with search indices syncs them after an import; the sync itself
// is the pipeline's business, covered by the PostgreSQL tier.
vi.mock("../../src/runtime/indexing/managed.js", () => ({
  syncManagedSearchIndices: vi.fn(async () => undefined),
}));

const FULL_SCHEMA = {
  entityTypes: [
    {
      entityTypeId: "et-1",
      key: "person",
      displayName: "Person",
      description: null,
      nameProperty: "full_name",
      properties: [
        {
          propertyId: "p-1",
          key: "full_name",
          displayName: "Full Name",
          dataType: "string",
          required: true,
          defaultValue: null,
        },
      ],
    },
    {
      entityTypeId: "et-2",
      key: "company",
      displayName: "Company",
      description: null,
      nameProperty: "name",
      properties: [
        {
          propertyId: "p-2",
          key: "name",
          displayName: "Name",
          dataType: "string",
          required: false,
          defaultValue: null,
        },
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
      properties: [],
    },
  ],
  lenses: [
    {
      lensId: "lens-1",
      key: "test_lens",
      name: "Test Lens",
      description: null,
      createdAt: NOW,
      updatedAt: NOW,
      entityInclusions: [
        { key: "person", properties: ["full_name"] },
        { key: "company", properties: null },
      ],
      relationInclusions: [{ key: "works_for", properties: null }],
    },
  ],
};

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
});

afterEach(() => {
  setEmbeddingProvider(null);
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** The mock store with a search-index store whose settings it records. */
/** A custom index as stored: every default applied. */
const PEOPLE_INDEX = {
  key: "people",
  name: "People",
  description: "People by name",
  entityType: "person",
  fields: ["name"],
  header: null,
  relations: [],
  semantic: { enabled: true, template: null },
  keyword: { enabled: true },
};

function withSearchIndices() {
  const settings = { keywordLanguages: ["german", "english"], disabledDefaults: { "x~default": true } };
  const indices = {
    ontologyKey: "onto",
    getSearchSettings: vi.fn(async () => settings),
    setSearchSettings: vi.fn(async (next: unknown) => next),
    listIndices: vi.fn(async () => [
      { key: "x~default", kind: "default", definition: { key: "x~default" } },
      { key: "people", kind: "custom", definition: PEOPLE_INDEX },
    ]),
    getIndex: vi.fn(async () => null),
    createIndex: vi.fn(async () => ({})),
    // What the schema sync included on its own, by lens id.
    listLensIndexInclusions: vi.fn(async (_lensId: string): Promise<string[]> => []),
    includeIndexInLens: vi.fn(async () => true),
    excludeIndexFromLens: vi.fn(async () => true),
    listRetrieverAgents: vi.fn(async (_lensId: string): Promise<unknown[]> => []),
    saveRetrieverAgent: vi.fn(async () => [{}, true]),
  };
  (holder.store as unknown as { searchIndices: () => unknown }).searchIndices = () => indices;
  return indices;
}

describe("export", () => {
  it("exports the whole design in the transfer format", async () => {
    holder.store.getFullSchema.mockResolvedValue(FULL_SCHEMA);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.formatVersion).toBe("6.0");
    expect(body.entityTypes).toHaveLength(2);
    expect(body.relationTypes).toHaveLength(1);
    expect(body.lenses).toHaveLength(1);
    const person = body.entityTypes[0];
    expect(person.key).toBe("person");
    expect(person.nameProperty).toBe("full_name");
    expect(person.properties).toHaveLength(1);
    expect(person.properties[0].key).toBe("full_name");
    const rt = body.relationTypes[0];
    expect(rt.fromEntityTypeKey).toBe("person");
    expect(rt.toEntityTypeKey).toBe("company");
    const lens = body.lenses[0];
    expect(lens.key).toBe("test_lens");
    expect(lens.includes.entityTypes[0].key).toBe("person");
    expect(lens.includes.relationTypes[0].key).toBe("works_for");
    // No timestamps, no internal ids anywhere.
    expect(lens.lensId).toBeUndefined();
    expect(lens.createdAt).toBeUndefined();
    expect(person.entityTypeId).toBeUndefined();
    expect(person.properties[0].propertyId).toBeUndefined();
  });

  it("exports an empty design", async () => {
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      lenses: [],
    });
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.statusCode).toBe(200);
    // An adapter without search indices exports the set a new ontology
    // starts with, and no search-index part.
    expect(res.json()).toEqual({
      formatVersion: "6.0",
      keywordLanguages: ["german", "english"],
      entityTypes: [],
      relationTypes: [],
      lenses: [],
    });
  });

  it("exports the ontology's keyword language set", async () => {
    withSearchIndices();
    holder.store.getFullSchema.mockResolvedValue({ entityTypes: [], relationTypes: [], lenses: [] });
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.statusCode).toBe(200);
    expect(res.json().keywordLanguages).toEqual(["german", "english"]);
    expect(res.json()).not.toHaveProperty("textSearchLanguage");
  });

  it("exports the custom index definitions and the switched-off managed indices", async () => {
    withSearchIndices();
    holder.store.getFullSchema.mockResolvedValue({ entityTypes: [], relationTypes: [], lenses: [] });
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.statusCode).toBe(200);
    expect(res.json().searchIndices).toEqual({ custom: [PEOPLE_INDEX], disabled: ["x~default"] });
  });

  it("omits the includes key entirely for an unscoped lens", async () => {
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      lenses: [
        {
          lensId: "lens-1",
          key: "everything",
          name: "Everything",
          description: null,
          entityInclusions: [],
          relationInclusions: [],
        },
      ],
    });
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.statusCode).toBe(200);
    const lens = res.json().lenses[0];
    expect("includes" in lens).toBe(false);
    expect(lens.aiAgents).toEqual([]);
    expect(lens.savedQueries).toEqual([]);
  });

  it("nests agents and saved queries in their lens, steps with explicit nulls", async () => {
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      lenses: [
        {
          lensId: "lens-1",
          key: "hr_view",
          name: "HR View",
          description: "HR lens",
          entityInclusions: [],
          relationInclusions: [],
        },
      ],
    });
    holder.store.listAiAgentsForExport.mockResolvedValue([
      {
        key: "assistant",
        name: "Assistant",
        description: "Helps",
        systemPrompt: null,
        tools: ["query", "get_entity"],
      },
    ]);
    holder.store.listSavedQueriesForExport.mockResolvedValue([
      {
        key: "find-people",
        name: "Find People",
        description: "Find people by name",
        steps: JSON.stringify([
          { name: "main", type: "oql", oql: "MATCH (p:person) RETURN p", limit: 5 },
        ]),
        parameters: JSON.stringify([
          { name: "q", description: "Query", dataType: "string" },
        ]),
      },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.statusCode).toBe(200);
    const lens = res.json().lenses[0];
    expect(lens.aiAgents).toEqual([
      {
        key: "assistant",
        name: "Assistant",
        description: "Helps",
        systemPrompt: null,
        tools: ["query", "get_entity"],
      },
    ]);
    expect(lens.savedQueries).toEqual([
      {
        key: "find-people",
        name: "Find People",
        description: "Find people by name",
        steps: [
          {
            name: "main",
            type: "oql",
            oql: "MATCH (p:person) RETURN p",
            entityTypeKey: null,
            query: null,
            limit: 5,
            bindings: null,
          },
        ],
        parameters: [{ name: "q", description: "Query", dataType: "string" }],
      },
    ]);
    expect(holder.store.listAiAgentsForExport).toHaveBeenCalledWith("lens-1");
    expect(holder.store.listSavedQueriesForExport).toHaveBeenCalledWith("lens-1");
  });
});

// ---------------------------------------------------------------------------
// Import — happy path
// ---------------------------------------------------------------------------

const LENS_DATA = {
  lensId: "lens-new",
  key: "imported",
  name: "Imported",
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function importPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: "6.0",
    entityTypes: [
      {
        key: "person",
        displayName: "Person",
        nameProperty: "full_name",
        properties: [
          { key: "full_name", displayName: "Full Name", dataType: "string", required: true },
        ],
      },
    ],
    relationTypes: [
      {
        key: "works_for",
        displayName: "Works For",
        fromEntityTypeKey: "person",
        toEntityTypeKey: "person",
        properties: [],
      },
    ],
    lenses: [
      {
        key: "imported",
        name: "Imported",
        includes: {
          entityTypes: [{ key: "person" }],
          relationTypes: [{ key: "works_for" }],
        },
      },
    ],
    ...overrides,
  };
}

/** A 6.0 entity type whose name property is a `name` string property. */
function entityType(
  key: string,
  displayName: string,
  properties: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    key,
    displayName,
    nameProperty: "name",
    properties: [
      { key: "name", displayName: "Name", dataType: "string", required: false },
      ...properties,
    ],
  };
}

async function postImport(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/ontologies/onto/model/import", payload: { keywordLanguages: ["german", "english"], ...payload } });
}

describe("import", () => {
  it("imports types, lenses and inclusions; answers 201 with the created lenses", async () => {
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    holder.store.addIncludesType.mockResolvedValue({ key: "person", properties: null });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.lenses).toHaveLength(1);
    expect(body.lenses[0].key).toBe("imported");
    expect(holder.store.createEntityType).toHaveBeenCalledTimes(1);
    // The name property is created with its type, not separately.
    expect(holder.store.createEntityType.mock.calls[0]![4]).toMatchObject({
      key: "full_name",
      displayName: "Full Name",
      dataType: "string",
      required: true,
    });
    expect(holder.store.createProperty).not.toHaveBeenCalled();
    expect(holder.store.createRelationType).toHaveBeenCalledTimes(1);
    expect(holder.store.createLens).toHaveBeenCalledTimes(1);
    expect(holder.store.addIncludesType).toHaveBeenCalledTimes(2);
    // No provider: no vector-index DDL at all.
    expect(holder.store.createVectorIndex).not.toHaveBeenCalled();
    expect(holder.store.createDocumentVectorIndex).not.toHaveBeenCalled();
    expect(holder.store.ensureSavedQueryVectorIndex).not.toHaveBeenCalled();
  });

  it("regenerates internal identifiers — the payload never carries one", async () => {
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    holder.store.addIncludesType.mockResolvedValue({ key: "person", properties: null });
    await postImport(importPayload());
    const etId = holder.store.createEntityType.mock.calls[0]![0] as string;
    expect(etId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reads a missing format version as the current one", async () => {
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    holder.store.addIncludesType.mockResolvedValue({ key: "person", properties: null });
    const payload = importPayload();
    delete payload.formatVersion;
    const res = await postImport(payload);
    expect(res.statusCode).toBe(201);
    expect(holder.store.createEntityType.mock.calls[0]![4]).toMatchObject({ key: "full_name" });
  });

  it("rejects a format version other than 6.0 and 5.0 and writes nothing", async () => {
    for (const version of ["2.0", "4.0", "unknown-version"]) {
      holder.store = createMockModelingStore();
      const res = await postImport(importPayload({ formatVersion: version }));
      expect(res.statusCode, `version ${version}`).toBe(422);
      expect(res.json().error.details.fields.formatVersion).toContain("6.0, 5.0");
      expect(holder.store.createEntityType).not.toHaveBeenCalled();
    }
  });

  it("rejects a 3.0 document by shape — ontologies[] where lenses[] is required", async () => {
    const payload = importPayload({ formatVersion: "3.0" });
    payload.ontologies = payload.lenses;
    delete payload.lenses;
    const res = await postImport(payload);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createLens).not.toHaveBeenCalled();
  });

  it("does NOT check property data types against the enum (preserved gap)", async () => {
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await postImport({
      entityTypes: [
        {
          key: "person",
          displayName: "Person",
          nameProperty: "name",
          properties: [
            { key: "name", displayName: "Name", dataType: "string", required: false },
            { key: "age", displayName: "Age", dataType: "invalid_type", required: false },
          ],
        },
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.createProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createProperty.mock.calls[0]![6]).toBe("invalid_type");
  });
});

// ---------------------------------------------------------------------------
// Import — name properties
// ---------------------------------------------------------------------------

describe("import keyword languages", () => {
  const empty = { entityTypes: [], relationTypes: [], lenses: [] };

  it("6.0: the payload's set becomes the target's, in canonical order", async () => {
    const indices = withSearchIndices();
    const res = await postImport({ ...empty, keywordLanguages: ["english", "german"] });
    expect(res.statusCode, res.body).toBe(201);
    expect(indices.setSearchSettings).toHaveBeenCalledWith({
      keywordLanguages: ["german", "english"],
      disabledDefaults: { "x~default": true },
    });
  });

  it("5.0: the one text-search language becomes the whole set", async () => {
    const indices = withSearchIndices();
    const res = await postImport({ ...empty, formatVersion: "5.0", textSearchLanguage: "german" });
    expect(res.statusCode, res.body).toBe(201);
    expect(indices.setSearchSettings.mock.calls[0]![0]).toMatchObject({ keywordLanguages: ["german"] });
  });

  it("each version requires its own field; an invalid set is rejected; nothing is written", async () => {
    const indices = withSearchIndices();
    const missing6 = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/import",
      payload: { ...empty, textSearchLanguage: "english", entityTypes: [entityType("paper", "Paper")] },
    });
    expect(missing6.statusCode).toBe(422);
    expect(missing6.json().error.details.fields).toEqual({ keywordLanguages: "Required" });
    const missing5 = await postImport({ ...empty, formatVersion: "5.0" });
    expect(missing5.statusCode).toBe(422);
    expect(missing5.json().error.details.fields).toEqual({ textSearchLanguage: "Required" });
    for (const keywordLanguages of [[], ["french"], ["german", "german"]]) {
      const res = await postImport({ ...empty, keywordLanguages });
      expect(res.statusCode, JSON.stringify(keywordLanguages)).toBe(422);
    }
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(indices.setSearchSettings).not.toHaveBeenCalled();
  });

  it("an adapter without search indices checks the set and keeps nothing of it", async () => {
    const res = await postImport({ ...empty, keywordLanguages: ["english"] });
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe("import search indices", () => {
  const person = entityType("person", "Person", [{ key: "bio", displayName: "Bio", dataType: "document", required: false }]);
  const payload = (searchIndices: unknown, formatVersion = "6.0") => ({
    formatVersion,
    entityTypes: [person],
    relationTypes: [],
    lenses: [],
    searchIndices,
    ...(formatVersion === "5.0" ? { textSearchLanguage: "german" } : {}),
  });

  it("6.0: creates the custom definitions and adds the switches to the target's", async () => {
    const indices = withSearchIndices();
    const res = await postImport(payload({ custom: [PEOPLE_INDEX], disabled: ["person~bio"] }));
    expect(res.statusCode, res.body).toBe(201);
    expect(indices.createIndex).toHaveBeenCalledWith(expect.any(String), "custom", PEOPLE_INDEX);
    expect(indices.setSearchSettings).toHaveBeenLastCalledWith({
      keywordLanguages: ["german", "english"],
      disabledDefaults: { "person~bio": true, "x~default": true },
    });
  });

  it("validates each definition against the payload's schema and each switch; writes nothing", async () => {
    const indices = withSearchIndices();
    const res = await postImport(
      payload({ custom: [{ ...PEOPLE_INDEX, fields: ["nope"] }], disabled: ["person~default", "x~gone"] }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.errors).toEqual([
      "Import error: search index 'people' is invalid at fields.0: Property 'nope' does not exist on entity type 'person'",
      "Import error: switched-off search index 'x~gone' is not a managed index of the payload",
    ]);
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(indices.createIndex).not.toHaveBeenCalled();
  });

  it("a custom key the target holds, or held twice by the payload, conflicts", async () => {
    const indices = withSearchIndices();
    indices.getIndex.mockResolvedValueOnce({ key: "people" } as never);
    const res = await postImport(payload({ custom: [PEOPLE_INDEX, { ...PEOPLE_INDEX, key: "staff" }, { ...PEOPLE_INDEX, key: "staff" }] }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe(
      "Search index with key 'people' already exists; Search index with key 'staff' already exists",
    );
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("5.0 carries no indices; an adapter without search indices validates and keeps nothing", async () => {
    const indices = withSearchIndices();
    const legacy = await postImport(payload({ custom: [{ ...PEOPLE_INDEX, fields: ["nope"] }] }, "5.0"));
    expect(legacy.statusCode, legacy.body).toBe(201);
    expect(indices.createIndex).not.toHaveBeenCalled();

    delete (holder.store as unknown as { searchIndices?: unknown }).searchIndices;
    holder.store.createEntityType.mockClear();
    const kept = await postImport(payload({ custom: [PEOPLE_INDEX], disabled: [] }));
    expect(kept.statusCode, kept.body).toBe(201);
    const invalid = await postImport(payload({ custom: [{ ...PEOPLE_INDEX, entityType: "ghost" }] }));
    expect(invalid.statusCode).toBe(422);
  });
});

describe("lens index inclusions", () => {
  const person = entityType("person", "Person", [{ key: "bio", displayName: "Bio", dataType: "document", required: false }]);
  const company = entityType("company", "Company");
  const lens = (indexInclusions?: string[]) => ({
    key: "people",
    name: "People",
    includes: { entityTypes: [{ key: "company" }], relationTypes: [] },
    ...(indexInclusions === undefined ? {} : { indexInclusions }),
  });
  const payload = (lenses: unknown[], formatVersion = "6.0") => ({
    formatVersion,
    entityTypes: [person, company],
    relationTypes: [],
    lenses,
    searchIndices: { custom: [PEOPLE_INDEX], disabled: [] },
    ...(formatVersion === "5.0" ? { textSearchLanguage: "german" } : {}),
  });

  it("export lists each lens's index inclusions", async () => {
    const indices = withSearchIndices();
    indices.listLensIndexInclusions.mockImplementation(async (lensId: string) =>
      lensId === "lens-1" ? ["people", "person~default"] : [],
    );
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      lenses: [{ lensId: "lens-1", key: "everything", name: "Everything", entityInclusions: [], relationInclusions: [] }],
    });
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.json().lenses[0].indexInclusions).toEqual(["people", "person~default"]);
    // An adapter without search indices omits the list, so an import into
    // one that has them applies the migration rule.
    delete (holder.store as unknown as { searchIndices?: unknown }).searchIndices;
    const plain = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(plain.json().lenses[0]).not.toHaveProperty("indexInclusions");
  });

  it("6.0: writes each lens's list exactly, once the indices exist — the root rule is not checked", async () => {
    const indices = withSearchIndices();
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    // The schema sync included the managed indices of the exposed types.
    indices.listLensIndexInclusions.mockResolvedValue(["company~default"]);
    // `people` is rooted on person, which the lens does not include: kept.
    const res = await postImport(payload([lens(["people", "person~bio"])]));
    expect(res.statusCode, res.body).toBe(201);
    const lensId = holder.store.createLens.mock.calls[0]![0] as string;
    expect(indices.excludeIndexFromLens).toHaveBeenCalledWith(lensId, "company~default");
    expect(indices.includeIndexInLens.mock.calls).toEqual([
      [lensId, "people"],
      [lensId, "person~bio"],
    ]);
    expect(indices.includeIndexInLens.mock.invocationCallOrder[0]).toBeGreaterThan(
      indices.createIndex.mock.invocationCallOrder[0]!,
    );
  });

  it("6.0 without the field, and 5.0, keep what the schema sync included", async () => {
    const indices = withSearchIndices();
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    expect((await postImport(payload([lens()]))).statusCode).toBe(201);
    const legacy = await postImport(payload([lens(["nope"])], "5.0"));
    expect(legacy.statusCode, legacy.body).toBe(201);
    expect(indices.listLensIndexInclusions).not.toHaveBeenCalled();
    expect(indices.includeIndexInLens).not.toHaveBeenCalled();
    expect(indices.excludeIndexFromLens).not.toHaveBeenCalled();
  });

  it("rejects an unknown or repeated index key; writes nothing", async () => {
    const indices = withSearchIndices();
    const res = await postImport(payload([lens(["people", "person~default", "company~bio", "people"])]));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.errors).toEqual([
      "Import error: lens 'people' includes unknown search index 'company~bio'",
      "Import error: lens 'people' includes search index 'people' twice",
    ]);
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(indices.includeIndexInLens).not.toHaveBeenCalled();
  });
});

describe("retriever agents", () => {
  const person = entityType("person", "Person", [{ key: "bio", displayName: "Bio", dataType: "document", required: false }]);
  const CONFIG = {
    indices: [{ index: "person~default" }],
    filters: [],
    answerFields: { person: ["name"] },
    threshold: 0.35,
    answerFieldCharacters: 800,
  };
  const agent = (configVersion: number, config: unknown, key = "finder") =>
    ({ key, name: "Finder", description: null, configVersion, config });
  const LEGACY = {
    buckets: [
      {
        entityTypeKey: "person",
        searchFields: ["name", "bio"],
        answerFields: ["name"],
        conditions: [{ id: "c", mode: "soft", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], targetField: "name", textFields: ["name"] }],
      },
    ],
  };
  const payload = (lens: Record<string, unknown>, formatVersion = "6.0") => ({
    formatVersion,
    entityTypes: [person],
    relationTypes: [],
    lenses: [{ key: "all", name: "All", ...lens }],
    ...(formatVersion === "5.0" ? { textSearchLanguage: "german" } : { keywordLanguages: ["german"] }),
  });

  it("export carries each lens's agents in their portable form; an adapter without search indices none", async () => {
    const indices = withSearchIndices();
    const now = new Date("2026-10-06T00:00:00Z");
    indices.listRetrieverAgents.mockResolvedValue([
      { retrieverAgentId: "id", ...agent(2, CONFIG), warnings: ["note"], createdAt: now, updatedAt: now },
    ]);
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      lenses: [{ lensId: "lens-1", key: "all", name: "All", entityInclusions: [], relationInclusions: [] }],
    });
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(res.json().lenses[0].retrieverAgents).toEqual([agent(2, CONFIG)]);
    delete (holder.store as unknown as { searchIndices?: unknown }).searchIndices;
    const plain = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/export" });
    expect(plain.json().lenses[0]).not.toHaveProperty("retrieverAgents");
  });

  it("6.0: stores each agent create-only after the indices; references are not checked", async () => {
    const indices = withSearchIndices();
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const unknownIndex = { ...CONFIG, indices: [{ index: "ghost" }] };
    const res = await postImport(payload({ retrieverAgents: [agent(2, CONFIG), agent(2, unknownIndex, "ghostly")] }));
    expect(res.statusCode, res.body).toBe(201);
    const lensId = holder.store.createLens.mock.calls[0]![0] as string;
    expect(indices.saveRetrieverAgent.mock.calls.map((call) => [call[0], (call[1] as { key: string }).key, call[2]])).toEqual([
      [lensId, "finder", true],
      [lensId, "ghostly", true],
    ]);
    expect((indices.saveRetrieverAgent.mock.calls[0]![1] as { configVersion: number }).configVersion).toBe(2);
  });

  it("5.0: converts each retriever, keeping the conversion's warnings", async () => {
    const indices = withSearchIndices();
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await postImport(payload({ retrievers: [agent(1, LEGACY)] }, "5.0"));
    expect(res.statusCode, res.body).toBe(201);
    const saved = indices.saveRetrieverAgent.mock.calls[0]![1] as Record<string, unknown>;
    expect(saved.configVersion).toBe(2);
    expect(saved.config).toMatchObject({ indices: [{ index: "person~default" }, { index: "person~bio" }] });
    expect(saved.warnings).toEqual([
      "Soft condition 'c' of person was dropped: it needs a custom index with relation group lives_in (outgoing).",
    ]);
  });

  it("5.0: renames a key with '-' under the key rules, unique in the lens, with a warning", async () => {
    const indices = withSearchIndices();
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await postImport(
      payload({ retrievers: [agent(1, LEGACY, "fair-search"), agent(1, LEGACY, "fair_search")] }, "5.0"),
    );
    expect(res.statusCode, res.body).toBe(201);
    const saved = indices.saveRetrieverAgent.mock.calls.map((call) => call[1] as { key: string; warnings: string[] });
    expect(saved.map((agent) => agent.key)).toEqual(["fair_search_2", "fair_search"]);
    expect(saved[0]!.warnings.at(-1)).toBe("Key renamed from 'fair-search' to 'fair_search_2'.");
    expect(saved[1]!.warnings).toHaveLength(1);
  });

  it("each version reads only its own field", async () => {
    const indices = withSearchIndices();
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    expect((await postImport(payload({ retrievers: [agent(1, LEGACY)] }))).statusCode).toBe(201);
    expect((await postImport(payload({ retrieverAgents: [agent(2, CONFIG)] }, "5.0"))).statusCode).toBe(201);
    expect(indices.saveRetrieverAgent).not.toHaveBeenCalled();
  });

  it("rejects a wrong version, a bad shape and a bad key; writes nothing", async () => {
    const indices = withSearchIndices();
    const res = await postImport(
      payload({
        retrieverAgents: [agent(1, LEGACY), agent(2, { indices: [] }, "empty"), agent(2, CONFIG, "Bad-Key")],
      }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.errors).toEqual([
      "Import error: retriever agent 'finder' has no valid configuration of version 2",
      "Import error: retriever agent 'empty' has no valid configuration of version 2",
      "Import error: invalid retriever agent key 'Bad-Key'. Must match pattern: ^[a-z][a-z0-9_]*$",
    ]);
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(indices.saveRetrieverAgent).not.toHaveBeenCalled();
  });

  it("an adapter without search indices checks the agents and keeps none", async () => {
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await postImport(payload({ retrieverAgents: [agent(2, CONFIG)] }));
    expect(res.statusCode, res.body).toBe(201);
    const invalid = await postImport(payload({ retrieverAgents: [agent(2, { indices: [] })] }));
    expect(invalid.statusCode).toBe(422);
  });
});

describe("import name properties", () => {
  it("6.0: rejects an entity type without a name property, or one that is not a string property of it", async () => {
    const res = await postImport({
      entityTypes: [
        {
          key: "person",
          displayName: "Person",
          properties: [{ key: "name", displayName: "Name", dataType: "string", required: false }],
        },
        {
          key: "company",
          displayName: "Company",
          nameProperty: "founded",
          properties: [{ key: "founded", displayName: "Founded", dataType: "date", required: false }],
        },
        { key: "place", displayName: "Place", nameProperty: "title", properties: [] },
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(422);
    const errors = res.json().error.details.errors as string[];
    expect(errors).toEqual([
      "Import error: entity type 'person' has no nameProperty",
      "Import error: name property 'founded' of entity type 'company' is not a string property of that type",
      "Import error: name property 'title' of entity type 'place' is not a string property of that type",
    ]);
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("5.0: derives the name property by the fallback chain, creating one where a type has no string property", async () => {
    const res = await postImport({
      formatVersion: "5.0",
      textSearchLanguage: "english",
      entityTypes: [
        {
          key: "article",
          displayName: "Article",
          properties: [
            { key: "summary", displayName: "Summary", dataType: "string", required: false },
            { key: "label", displayName: "Label", dataType: "string", required: false },
            { key: "title", displayName: "Title", dataType: "string", required: true },
          ],
        },
        {
          key: "note",
          displayName: "Note",
          properties: [
            { key: "body", displayName: "Body", dataType: "document", required: false },
            { key: "summary", displayName: "Summary", dataType: "string", required: false },
          ],
        },
        {
          key: "reading",
          displayName: "Reading",
          properties: [
            { key: "name", displayName: "Name", dataType: "integer", required: false },
          ],
        },
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(201);
    const created = holder.store.createEntityType.mock.calls.map((call) => [call[1], call[4]]);
    expect(created).toEqual([
      ["article", expect.objectContaining({ key: "title", required: true })],
      ["note", expect.objectContaining({ key: "summary" })],
      [
        "reading",
        expect.objectContaining({
          key: "name_2",
          displayName: "name_2",
          dataType: "string",
          required: false,
        }),
      ],
    ]);
    // Every other payload property is created as before.
    const others = holder.store.createProperty.mock.calls.map((call) => call[3]);
    expect(others).toEqual(["summary", "label", "body", "name"]);
  });
});

// ---------------------------------------------------------------------------
// Import — conflicts (all-or-fail, nothing written)
// ---------------------------------------------------------------------------

describe("import conflicts", () => {
  it("an existing entity type key answers 409 and writes nothing", async () => {
    holder.store.getEntityTypeByKey.mockResolvedValue({ entityTypeId: "et-x", key: "person" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(res.json().error.message).toContain("person");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createRelationType).not.toHaveBeenCalled();
    expect(holder.store.createLens).not.toHaveBeenCalled();
  });

  it("an existing relation type key answers 409 and writes nothing", async () => {
    holder.store.getRelationTypeByKey.mockResolvedValue({ relationTypeId: "rt-x", key: "works_for" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("Relation type with key 'works_for' already exists");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("an existing lens key answers 409 and writes nothing", async () => {
    holder.store.getLensByKey.mockResolvedValue({ lensId: "lens-x", key: "imported" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("Lens with key 'imported' already exists");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createLens).not.toHaveBeenCalled();
  });

  it("a mid-payload conflict writes nothing — validate-then-write", async () => {
    // First entity type is clean; the second one already exists.
    holder.store.getEntityTypeByKey.mockImplementation(async (key: string) =>
      key === "company" ? { entityTypeId: "et-x", key: "company" } : null,
    );
    const res = await postImport({
      entityTypes: [
        entityType("person", "Person"),
        entityType("company", "Company"),
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("company");
    // The clean first object was NOT written — no partial import.
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("names EVERY conflicting key in one response", async () => {
    holder.store.getEntityTypeByKey.mockResolvedValue({ entityTypeId: "et-x" });
    holder.store.getRelationTypeByKey.mockResolvedValue({ relationTypeId: "rt-x" });
    holder.store.getLensByKey.mockResolvedValue({ lensId: "lens-x" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    const message = res.json().error.message as string;
    expect(message).toContain("Entity type with key 'person' already exists");
    expect(message).toContain("Relation type with key 'works_for' already exists");
    expect(message).toContain("Lens with key 'imported' already exists");
  });

  it("an intra-payload duplicate key conflicts like the sequential write would have", async () => {
    const res = await postImport({
      entityTypes: [
        entityType("person", "Person"),
        entityType("person", "Person Again"),
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("Entity type with key 'person' already exists");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Import — validations (collected, nothing written)
// ---------------------------------------------------------------------------

describe("import validations", () => {
  it("rejects a reserved entity type key", async () => {
    const res = await postImport({
      entityTypes: [entityType("ontology", "Bad")],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("reserved");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("rejects a relation type endpoint missing from the payload", async () => {
    const res = await postImport({
      entityTypes: [entityType("person", "Person")],
      relationTypes: [
        {
          key: "works_for",
          displayName: "Works For",
          fromEntityTypeKey: "nonexistent",
          toEntityTypeKey: "person",
        },
      ],
      lenses: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("nonexistent");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("rejects a document property on a relation type", async () => {
    const res = await postImport({
      entityTypes: [entityType("person", "Person")],
      relationTypes: [
        {
          key: "knows",
          displayName: "Knows",
          fromEntityTypeKey: "person",
          toEntityTypeKey: "person",
          properties: [
            { key: "notes", displayName: "Notes", dataType: "document", required: false },
          ],
        },
      ],
      lenses: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain(
      "document properties are only supported on entity types",
    );
  });

  it("rejects an agent allowlist naming an unknown tool", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      lenses: [
        {
          key: "lens",
          name: "Lens",
          aiAgents: [
            { key: "helper", name: "Helper", tools: ["query", "not_a_tool"] },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const message = res.json().error.message as string;
    expect(message).toContain("not_a_tool");
    expect(message).toContain("Available tools:");
    expect(holder.store.createLens).not.toHaveBeenCalled();
    expect(holder.store.upsertAiAgent).not.toHaveBeenCalled();
  });

  it("rejects a document saved-query parameter", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      lenses: [
        {
          key: "imported",
          name: "Imported",
          savedQueries: [
            {
              key: "find-people",
              name: "Find People",
              description: "Find people by name",
              steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }],
              parameters: [{ name: "bio", description: "A document", dataType: "document" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("scalar");
    expect(holder.store.upsertSavedQuery).not.toHaveBeenCalled();
  });

  it("rejects an unknown saved-query step type", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      lenses: [
        {
          key: "lens",
          name: "Lens",
          savedQueries: [
            {
              key: "broken",
              name: "Broken",
              description: "Bad step",
              steps: [{ name: "main", type: "sql", oql: "SELECT 1" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.details.errors).toEqual([expect.objectContaining({ path: "/lenses/0/savedQueries/0/steps/0/type" })]);
    expect(holder.store.upsertSavedQuery).not.toHaveBeenCalled();
  });

  it("validates pipelines structurally like definition time — but never against a lens", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      lenses: [
        {
          key: "lens",
          name: "Lens",
          savedQueries: [
            {
              key: "broken",
              name: "Broken",
              description: "Structural problems",
              steps: [
                { name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" },
                { name: "main", type: "oql" },
              ],
              parameters: [{ name: "unused", description: "Never used", dataType: "string" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const message = res.json().error.message as string;
    expect(message).toContain("already used by");
    expect(message).toContain("Required for oql steps");
    expect(message).toContain("unused");
  });

  it("imports a structurally sound pipeline whose OQL names types no lens exposes", async () => {
    // No lens check on import: this pipeline fails at first RUN, not here.
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      lenses: [
        {
          key: "imported",
          name: "Imported",
          savedQueries: [
            {
              key: "find-ghosts",
              name: "Find Ghosts",
              description: "Names a type that exists nowhere",
              steps: [{ name: "main", type: "oql", oql: "MATCH (g:ghost) RETURN g" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.upsertSavedQuery).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Import — key patterns
// ---------------------------------------------------------------------------

describe("import key patterns", () => {
  it("rejects a property named '_id' — the documented identity-overwrite hole", async () => {
    const res = await postImport({
      entityTypes: [
        {
          key: "person",
          displayName: "Person",
          nameProperty: "_id",
          properties: [{ key: "_id", displayName: "Id", dataType: "string", required: false }],
        },
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.message).toContain("'_id'");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createProperty).not.toHaveBeenCalled();
  });

  it("rejects an underscore-leading lens key", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      lenses: [{ key: "_hidden", name: "Hidden" }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("'_hidden'");
    expect(holder.store.createLens).not.toHaveBeenCalled();
  });

  it("collects every offending key across kinds in one response", async () => {
    const res = await postImport({
      entityTypes: [entityType("BadType", "Bad")],
      relationTypes: [
        {
          key: "BAD_REL",
          displayName: "Bad Rel",
          fromEntityTypeKey: "BadType",
          toEntityTypeKey: "BadType",
          properties: [],
        },
      ],
      lenses: [
        {
          key: "lens",
          name: "Lens",
          aiAgents: [{ key: "Bad Agent", name: "Bad" }],
          savedQueries: [
            {
              key: "9bad",
              name: "Bad",
              description: "Bad key",
              steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    const message = body.error.message as string;
    expect(message).toContain("'BadType'");
    expect(message).toContain("'BAD_REL'");
    expect(message).toContain("'Bad Agent'");
    expect(message).toContain("'9bad'");
    expect(body.error.details.errors).toHaveLength(4);
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createLens).not.toHaveBeenCalled();
  });

  // The cap is 64 characters, uniformly on every key kind; import collects
  // every over-long key like it collects pattern violations.
  it("collects every over-long key across kinds in one response, cap stated", async () => {
    const long = (prefix: string): string => prefix + "k".repeat(65 - prefix.length);
    const res = await postImport({
      entityTypes: [
        {
          key: long("et"),
          displayName: "Long ET",
          nameProperty: long("etp"),
          properties: [
            { key: long("etp"), displayName: "Long Prop", dataType: "string", required: false },
          ],
        },
        entityType("anchor", "Anchor"),
      ],
      relationTypes: [
        {
          key: long("rt"),
          displayName: "Long RT",
          fromEntityTypeKey: "anchor",
          toEntityTypeKey: "anchor",
          properties: [
            { key: long("rtp"), displayName: "Long Prop", dataType: "string", required: false },
          ],
        },
      ],
      lenses: [
        {
          key: long("lens"),
          name: "Long Lens",
          aiAgents: [{ key: long("agent"), name: "Long Agent" }],
          savedQueries: [
            {
              key: long("sq"),
              name: "Long Query",
              description: "Long key",
              steps: [{ name: "main", type: "oql", oql: "MATCH (p:anchor) RETURN p" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    const errors = body.error.details.errors as string[];
    expect(errors).toHaveLength(7);
    for (const kind of ["et", "etp", "rt", "rtp", "lens", "agent", "sq"]) {
      expect(errors.some((e) => e.includes(`'${long(kind)}'`))).toBe(true);
    }
    for (const e of errors) {
      expect(e).toContain("64");
    }
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createLens).not.toHaveBeenCalled();
  });

  it("a 64-character key of every kind passes the length check", async () => {
    const exact = (prefix: string): string => prefix + "k".repeat(64 - prefix.length);
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await postImport({
      entityTypes: [entityType(exact("et"), "ET")],
      relationTypes: [],
      lenses: [{ key: exact("lens"), name: "Lens" }],
    });
    expect(res.statusCode).toBe(201);
  });

  it("reports pattern violations, structural rules and reserved keys together", async () => {
    const res = await postImport({
      entityTypes: [entityType("_bad", "Bad")],
      relationTypes: [
        {
          key: "knows",
          displayName: "Knows",
          fromEntityTypeKey: "_bad",
          toEntityTypeKey: "_bad",
          properties: [
            { key: "notes", displayName: "Notes", dataType: "document", required: false },
          ],
        },
      ],
      lenses: [
        {
          key: "lens",
          name: "Lens",
          aiAgents: [{ key: "helper", name: "Helper", tools: ["nope"] }],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    const message = body.error.message as string;
    expect(message).toContain("'_bad'");
    expect(message).toContain("document properties are only supported on entity types");
    expect(message).toContain("nope");
    expect(body.error.details.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Import — side effects with an embedding provider
// ---------------------------------------------------------------------------

describe("import side effects with a provider", () => {
  it("creates vector indexes with filterables, chunk indexes per document property, and embeds saved-query descriptions", async () => {
    const embedded: string[] = [];
    setEmbeddingProvider({
      dimensions: 8,
      embed: async (text: string) => {
        embedded.push(text);
        return [0.1, 0.2];
      },
    });
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await postImport({
      entityTypes: [
        {
          key: "person",
          displayName: "Person",
          nameProperty: "name",
          properties: [
            { key: "name", displayName: "Name", dataType: "string", required: true },
            { key: "bio", displayName: "Bio", dataType: "document", required: false },
          ],
        },
      ],
      relationTypes: [],
      lenses: [
        {
          key: "imported",
          name: "Imported",
          savedQueries: [
            {
              key: "find-people",
              name: "Find People",
              description: "Find people by name",
              steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    // Per-type index with the non-document properties as filterables.
    expect(holder.store.createVectorIndex).toHaveBeenCalledWith("person", 8, ["name"]);
    // One chunk index per document property.
    expect(holder.store.createDocumentVectorIndex).toHaveBeenCalledWith("person", "bio", 8);
    // The description was embedded as written and handed to the store.
    expect(embedded).toEqual(["Find people by name"]);
    expect(holder.store.upsertSavedQuery.mock.calls[0]![8]).toEqual([0.1, 0.2]);
    // The shared saved-query index is ensured once at the end.
    expect(holder.store.ensureSavedQueryVectorIndex).toHaveBeenCalledTimes(1);
    expect(holder.store.ensureSavedQueryVectorIndex).toHaveBeenCalledWith(8);
  });
});
