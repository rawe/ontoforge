/**
 * The search-index engine against a fake search-index store: index
 * resolution and validation, which generations rank, the lens's hidden
 * relation and target types as ranking restrictions, the similarity
 * floor, the bounded over-fetch, and what `matched` describes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { NotFoundError } from "../../src/core/exceptions.js";
import type {
  RankedSearchEntry,
  SearchEntryQuery,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../src/core/ports.js";
import { deriveManagedIndices, SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { searchByIndices } from "../../src/runtime/search/indexSearch.js";
import { createMockRuntimeStore, makeFullSchema } from "./helpers.js";

const MODEL = "fake:hash:2";

function record(kind: SearchIndexRecord["kind"], definition: SearchIndexDefinition): SearchIndexRecord {
  return {
    searchIndexId: `id-${definition.key}`,
    key: definition.key,
    kind,
    definition,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const EMPLOYMENT = SearchIndexDefinition.parse({
  key: "employment",
  name: "Employment",
  description: "People by employer",
  entityType: "person",
  fields: ["name"],
  relations: [
    { relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name"] } },
  ],
});

function generation(
  index: SearchIndexRecord,
  representation: "semantic" | "keyword",
  overrides: Partial<SearchGenerationRecord> = {},
): SearchGenerationRecord {
  return {
    generationId: `${index.key}/${representation}`,
    searchIndexId: index.searchIndexId,
    representation,
    definitionHash: "h",
    modelId: representation === "semantic" ? MODEL : null,
    dimensions: representation === "semantic" ? 2 : null,
    languages: representation === "keyword" ? ["german", "english"] : null,
    state: "ready",
    total: 0,
    done: 0,
    failed: 0,
    createdAt: new Date(0),
    readyAt: new Date(0),
    ...overrides,
  };
}

function entry(entityId: string, score: number, overrides: Partial<RankedSearchEntry> = {}): RankedSearchEntry {
  return {
    entityId,
    partKind: "self",
    groupNo: 0,
    partId: "",
    relationType: null,
    targetType: null,
    targetId: null,
    startChar: null,
    charLength: null,
    text: `Person: ${entityId}`,
    score,
    ...overrides,
  };
}

let runtime: ReturnType<typeof createMockRuntimeStore>;
let indices: SearchIndexRecord[];
let generations: SearchGenerationRecord[];
let disabled: Record<string, unknown>;
let rank: ReturnType<typeof vi.fn<(query: SearchEntryQuery) => Promise<RankedSearchEntry[]>>>;

beforeEach(() => {
  invalidateLoadedSchemaCache();
  setEmbeddingProvider({
    dimensions: 2,
    modelId: MODEL,
    embed: async () => [1, 0],
    embedBatch: async (texts) => texts.map(() => [1, 0]),
  });
  const schema = makeFullSchema({ lensKey: "all" });
  runtime = createMockRuntimeStore();
  runtime.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
  runtime.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { _id: id, _entityTypeKey: "person", name: `N-${id}`, age: 3 }])),
  );
  indices = [
    ...deriveManagedIndices({
      entityTypes: {
        person: {
          key: "person",
          displayName: "Person",
          nameProperty: "name",
          properties: {
            name: { key: "name", displayName: "Name", dataType: "string" },
            email: { key: "email", displayName: "Email", dataType: "string" },
          },
        },
        company: {
          key: "company",
          displayName: "Company",
          nameProperty: "name",
          properties: { name: { key: "name", displayName: "Name", dataType: "string" } },
        },
      },
      relationTypes: {},
    }).map((m) => record(m.kind, m.definition)),
    record("custom", EMPLOYMENT),
  ];
  generations = indices.flatMap((index) => [generation(index, "semantic"), generation(index, "keyword")]);
  disabled = {};
  rank = vi.fn(async () => []);
  const indexStore = {
    ontologyKey: "test_ont",
    listIndices: async () => indices,
    getSearchSettings: async () => ({ keywordLanguages: ["german", "english"], disabledDefaults: disabled }),
    listGenerations: async () => generations,
    rankEntries: rank,
  } as unknown as SearchIndexStore;
  (runtime as unknown as { searchIndices: () => SearchIndexStore }).searchIndices = () => indexStore;
});

afterEach(() => setEmbeddingProvider(null));

const search = (request: Parameters<typeof searchByIndices>[1]) => searchByIndices("all", request, runtime);

describe("index resolution", () => {
  it("searches every index the lens may search when none is named", async () => {
    await search({ query: "x", mode: "keyword" });
    expect(rank.mock.calls.map(([q]) => q.generationId).sort()).toEqual([
      "company~default/keyword",
      "employment/keyword",
      "person~default/keyword",
    ]);
  });

  it("an unknown index is not found; one the lens may not search is a validation error", async () => {
    await expect(search({ query: "x", indices: ["ghost"] })).rejects.toBeInstanceOf(NotFoundError);
    disabled = { "company~default": true };
    await expect(search({ query: "x", indices: ["person~default", "company~default"] })).rejects.toMatchObject({
      details: { fields: { "indices.1": expect.stringContaining("not available") } },
    });
  });

  it("a scoped lens searches only the indices it includes", async () => {
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue({
      ...makeFullSchema({ lensKey: "all", entityInclusions: [{ key: "person", properties: null }] }),
      searchIndexInclusions: ["person~default"],
    });
    await search({ query: "x", mode: "keyword" });
    expect(rank.mock.calls.map(([q]) => q.generationId)).toEqual(["person~default/keyword"]);
    await expect(search({ query: "x", indices: ["employment"] })).rejects.toMatchObject({
      details: { fields: { "indices.0": expect.any(String) } },
    });
  });

  it("collects invalid dimensions; a mode without its provider is a disabled feature", async () => {
    await expect(
      search({ query: " ", limit: 0, mode: "keyword", minScore: 0.5, relations: ["ghost"], filters: { nope: "1" } }),
    ).rejects.toMatchObject({
      details: {
        fields: {
          query: expect.any(String),
          limit: expect.any(String),
          minScore: expect.stringContaining("semantically"),
          "relations.0": expect.any(String),
          nope: expect.any(String),
        },
      },
    });
    setEmbeddingProvider(null);
    await expect(search({ query: "x", mode: "semantic" })).rejects.toMatchObject({
      details: { code: "FEATURE_DISABLED" },
    });
    expect((await search({ query: "x" })).mode).toBe("keyword");
  });
});

describe("rankings", () => {
  it("ranks only ready generations of the model in use; hybrid is the default", async () => {
    generations = generations.map((g) =>
      g.generationId === "person~default/keyword"
        ? { ...g, state: "building" }
        : g.generationId === "company~default/semantic"
          ? { ...g, modelId: "other:model:2" }
          : g,
    );
    const response = await search({ query: "x" });
    expect(response.mode).toBe("hybrid");
    expect(rank.mock.calls.map(([q]) => q.generationId).sort()).toEqual([
      "company~default/keyword",
      "employment/keyword",
      "employment/semantic",
      "person~default/semantic",
    ]);
    const semantic = rank.mock.calls.find(([q]) => q.generationId === "employment/semantic")![0];
    expect(semantic).toMatchObject({ vector: [1, 0] });
    expect(semantic).not.toHaveProperty("text");
    const keyword = rank.mock.calls.find(([q]) => q.generationId === "employment/keyword")![0];
    expect(keyword).toMatchObject({ text: "x", matching: "any" });
  });

  it("hides the lens's relation and target types and narrows to the chosen relations", async () => {
    await search({ query: "x", indices: ["employment"], mode: "keyword" });
    expect(rank.mock.calls[0]![0]).toMatchObject({ relationTypes: null, targetTypes: null });

    runtime.getFullSchemaWithLensInclusions.mockResolvedValue({
      ...makeFullSchema({
        lensKey: "all",
        entityInclusions: [{ key: "person", properties: null }, { key: "department", properties: null }],
      }),
      searchIndexInclusions: ["employment"],
    });
    invalidateLoadedSchemaCache();
    rank.mockClear();
    await search({ query: "x", indices: ["employment"], mode: "keyword" });
    // Companies are hidden: works_for (person → company) is not inferred.
    expect(rank.mock.calls[0]![0]).toMatchObject({
      relationTypes: [],
      targetTypes: ["person", "department"],
    });

    invalidateLoadedSchemaCache();
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "all" }));
    rank.mockClear();
    await search({ query: "x", indices: ["employment"], mode: "keyword", relations: ["belongs_to"] });
    expect(rank.mock.calls[0]![0]).toMatchObject({ relationTypes: ["belongs_to"], targetTypes: null });
  });

  it("passes the exact filters of the root type into the ranking", async () => {
    await search({ query: "x", indices: ["person~default"], mode: "keyword", filters: { age__gte: "20" } });
    expect(rank.mock.calls[0]![0].conditions).toEqual([
      expect.objectContaining({ kind: "property", propertyKey: "age", op: "gte", value: 20 }),
    ]);
  });

  it("floors semantic entries before grouping and leaves keyword entries alone", async () => {
    rank.mockImplementation(async (query) =>
      query.generationId.endsWith("semantic")
        ? [entry("a", 0.9), entry("b", 0.6)]
        : [entry("c", 3)],
    );
    const response = await search({ query: "x", indices: ["person~default"], minScore: 0.7 });
    expect(response.hits.map((h) => h.entity._id)).toEqual(["a", "c"]);
  });

  it("over-fetches limit × 4 entries and fetches once more, up to the cap, when entities run short", async () => {
    // Many passages of one entity fill the first page.
    rank.mockImplementation(async (query) =>
      Array.from({ length: query.limit }, (_, i) => entry(i < 8 ? "a" : `e${i}`, 1 - i / 2000, { partId: String(i) })),
    );
    const response = await search({ query: "x", indices: ["person~default"], mode: "semantic", limit: 2 });
    expect(rank.mock.calls.map(([q]) => q.limit)).toEqual([8, 1000]);
    expect(response.hits.map((h) => h.entity._id)).toEqual(["a", "e8"]);
  });

  it("does not fetch again when a ranking ran out", async () => {
    rank.mockImplementation(async () => [entry("a", 0.9)]);
    await search({ query: "x", indices: ["person~default"], mode: "semantic", limit: 5 });
    expect(rank.mock.calls.map(([q]) => q.limit)).toEqual([20]);
  });
});

describe("matched", () => {
  it("describes a relation entry with its relation, target and label, and a self entry plainly", async () => {
    runtime.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { _id: id, _entityTypeKey: "person", name: `N-${id}` }])),
    );
    rank.mockImplementation(async (query) =>
      query.generationId === "employment/keyword"
        ? [
            entry("a", 5, {
              partKind: "relation",
              groupNo: 0,
              partId: "rel-1",
              relationType: "works_for",
              targetType: "company",
              targetId: "co-1",
              text: "Ada\nCTO\nACME",
            }),
          ]
        : [],
    );
    const response = await search({ query: "cto acme", indices: ["employment"], mode: "keyword" });
    expect(response.hits).toEqual([
      {
        entity: { _id: "a", _entityTypeKey: "person", name: "N-a" },
        relativeScore: 1,
        matched: {
          index: "employment",
          partKind: "relation",
          relationType: "works_for",
          relationId: "rel-1",
          target: { id: "co-1", type: "company", label: "N-co-1" },
          snippet: "Ada CTO ACME",
          charOffset: null,
          charLength: null,
        },
      },
    ]);
  });

  it("withholds the snippet when the index reads a property the lens hides", async () => {
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue({
      ...makeFullSchema({ lensKey: "all", entityInclusions: [{ key: "person", properties: ["name"] }] }),
      searchIndexInclusions: ["person~default"],
    });
    rank.mockImplementation(async () => [entry("a", 3, { text: "Ada secret@example.com" })]);
    const response = await search({ query: "ada", mode: "keyword" });
    expect(response.hits[0]!.matched.snippet).toBe("");
    // Projected through the lens.
    expect(response.hits[0]!.entity).toEqual({ _id: "a", _entityTypeKey: "person", name: "N-a" });
  });
});
