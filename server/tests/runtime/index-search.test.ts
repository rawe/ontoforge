/**
 * The search-index engine, through the entity search, against a fake
 * search-index store: index resolution and validation, which generations
 * rank, the lens's hidden relation and target types as ranking
 * restrictions, the similarity floor, the bounded over-fetch, what an
 * item's match describes, and the lens's catalog.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import type {
  RankedSearchEntry,
  SearchEntryQuery,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../src/core/ports.js";
import { deriveManagedIndices, SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { searchEntities } from "../../src/runtime/search/entitySearch.js";
import { searchIndexCatalog } from "../../src/runtime/search/indexSearch.js";
import { createMockRuntimeStore, makeFullSchema } from "./helpers.js";

// The catalog reads build states from the status module, which reads the
// adapter's store directly.
const statuses = vi.hoisted(() => ({ list: [] as { key: string; state: string }[] }));
vi.mock("../../src/runtime/indexing/status.js", () => ({
  listSearchIndexStatuses: async () => statuses.list,
}));

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
  // As the PostgreSQL adapter: keyword ranking, so hybrid is the default.
  runtime.supportsKeywordRanking.mockReturnValue(true);
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

const search = (request: Parameters<typeof searchEntities>[1]) => searchEntities("all", request, runtime);

describe("index resolution", () => {
  it("searches every managed index the lens may search when none is named; a custom one only when named", async () => {
    await search({ query: "x", keyword: {} });
    expect(rank.mock.calls.map(([q]) => q.generationId).sort()).toEqual([
      "company~default/keyword",
      "person~default/keyword",
    ]);
    rank.mockClear();
    await search({ query: "x", indices: ["employment"], keyword: {} });
    expect(rank.mock.calls.map(([q]) => q.generationId)).toEqual(["employment/keyword"]);
  });

  it("an unknown index answers exactly as one the lens may not search: a validation error", async () => {
    await expect(search({ query: "x", indices: ["ghost"] })).rejects.toMatchObject({
      details: { fields: { "indices.0": "Search index 'ghost' is not available in this lens" } },
    });
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
    await search({ query: "x", keyword: {} });
    expect(rank.mock.calls.map(([q]) => q.generationId)).toEqual(["person~default/keyword"]);
    await expect(search({ query: "x", indices: ["employment"] })).rejects.toMatchObject({
      details: { fields: { "indices.0": expect.any(String) } },
    });
  });

  it("collects invalid dimensions; a semantic block without its provider is a disabled feature", async () => {
    await expect(
      search({ query: " ", limit: 0, semantic: { minSimilarity: 1.5 }, filter: { nope: "1" } }),
    ).rejects.toMatchObject({
      details: {
        fields: {
          query: expect.any(String),
          limit: expect.any(String),
          "semantic.minSimilarity": expect.any(String),
          "filter.nope": expect.any(String),
        },
      },
    });
    setEmbeddingProvider(null);
    await expect(search({ query: "x", semantic: {} })).rejects.toMatchObject({
      details: { code: "FEATURE_DISABLED" },
    });
    expect((await search({ query: "x" })).ran).toEqual(["keyword"]);
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
    const response = await search({ query: "x", indices: ["person~default", "company~default", "employment"] });
    expect(response.ran).toEqual(["semantic", "keyword"]);
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

  it("hides the lens's relation and target types", async () => {
    await search({ query: "x", indices: ["employment"], keyword: {} });
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
    await search({ query: "x", indices: ["employment"], keyword: {} });
    // Companies are hidden: works_for (person → company) is not inferred.
    expect(rank.mock.calls[0]![0]).toMatchObject({
      relationTypes: [],
      targetTypes: ["person", "department"],
    });
  });

  it("passes the exact filters of the root type into the ranking", async () => {
    await search({ query: "x", indices: ["person~default"], keyword: {}, filter: { age__gte: "20" } });
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
    const response = await search({ query: "x", indices: ["person~default"], semantic: { minSimilarity: 0.7 }, keyword: {} });
    expect(response.items.map((item) => item.entity._id)).toEqual(["a", "c"]);
  });

  it("over-fetches limit × 4 entries and fetches once more, up to the cap, when entities run short", async () => {
    // Many passages of one entity fill the first page.
    rank.mockImplementation(async (query) =>
      Array.from({ length: query.limit }, (_, i) => entry(i < 8 ? "a" : `e${i}`, 1 - i / 2000, { partId: String(i) })),
    );
    const response = await search({ query: "x", indices: ["person~default"], semantic: {}, limit: 2 });
    expect(rank.mock.calls.map(([q]) => q.limit)).toEqual([8, 1000]);
    expect(response.items.map((item) => item.entity._id)).toEqual(["a", "e8"]);
  });

  it("does not fetch again when a ranking ran out", async () => {
    rank.mockImplementation(async () => [entry("a", 0.9)]);
    await search({ query: "x", indices: ["person~default"], semantic: {}, limit: 5 });
    expect(rank.mock.calls.map(([q]) => q.limit)).toEqual([20]);
  });
});

describe("match", () => {
  it("describes a relation entry with its relation type and target", async () => {
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
    const response = await search({ query: "cto acme", indices: ["employment"], keyword: {} });
    expect(response.items).toEqual([
      {
        rank: 1,
        entity: { _id: "a", _entityTypeKey: "person", name: "N-a" },
        match: {
          index: "employment",
          part: "relation",
          snippet: "Ada CTO ACME",
          relationType: "works_for",
          target: { _id: "co-1", _entityTypeKey: "company", name: "N-co-1" },
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
    const response = await search({ query: "ada", keyword: {} });
    expect(response.items[0]!.match.snippet).toBeNull();
    expect(response.items[0]!.entity).toEqual({ _id: "a", _entityTypeKey: "person", name: "N-a" });
  });
});

describe("catalog", () => {
  const catalog = () => searchIndexCatalog("all", runtime);

  beforeEach(() => {
    statuses.list = [
      { key: "person~default", state: "ready" },
      { key: "company~default", state: "building" },
      { key: "employment", state: "stale" },
    ];
  });

  it("lists the searchable indices with fields, relation groups, modes and state", async () => {
    disabled = { "company~default": true };
    expect(await catalog()).toEqual([
      {
        key: "person~default",
        kind: "default",
        name: "Person — default",
        description: "Finds Person entities by their own text properties: Name, Email.",
        entityType: "person",
        fields: ["name", "email"],
        relations: [],
        documentProperty: null,
        modes: ["semantic", "keyword"],
        status: "ready",
      },
      {
        key: "employment",
        kind: "custom",
        name: "Employment",
        description: "People by employer",
        entityType: "person",
        fields: ["name"],
        // No group label: the relation type's display name.
        relations: [{ relationType: "works_for", direction: "outgoing", label: "Works For" }],
        documentProperty: null,
        modes: ["semantic", "keyword"],
        status: "stale",
      },
    ]);
  });

  it("offers semantic only with a provider and only where the index enables it", async () => {
    indices = indices.map((index) =>
      index.key === "employment"
        ? record("custom", { ...index.definition, keyword: { enabled: false }, relations: [{ ...index.definition.relations[0]!, label: "Job" }] })
        : index,
    );
    const employment = (await catalog()).find((entry) => entry.key === "employment")!;
    expect(employment).toMatchObject({ modes: ["semantic"], relations: [{ label: "Job" }] });
    setEmbeddingProvider(null);
    expect((await catalog()).map((entry) => [entry.key, entry.modes])).toEqual([
      ["person~default", ["keyword"]],
      ["company~default", ["keyword"]],
      ["employment", []],
    ]);
  });

  it("projects through a scoped lens: its inclusions, its fields, its relation groups", async () => {
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue({
      ...makeFullSchema({ lensKey: "all", entityInclusions: [{ key: "person", properties: ["name"] }] }),
      searchIndexInclusions: ["person~default", "employment"],
    });
    expect((await catalog()).map(({ key, fields, relations }) => ({ key, fields, relations }))).toEqual([
      // email hidden; companies hidden, so the employment group is skipped.
      { key: "person~default", fields: ["name"], relations: [] },
      { key: "employment", fields: ["name"], relations: [] },
    ]);
  });

  it("names only the properties the lens shows in a managed description, a custom one as written", async () => {
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue({
      ...makeFullSchema({ lensKey: "all", entityInclusions: [{ key: "person", properties: ["name"] }] }),
      searchIndexInclusions: ["person~default", "employment"],
    });
    // The stored description names Email, which this lens hides.
    expect(indices[0]!.definition.description).toContain("Email");
    expect((await catalog()).map(({ key, description }) => ({ key, description }))).toEqual([
      { key: "person~default", description: "Finds Person entities by their own text properties: Name." },
      { key: "employment", description: "People by employer" },
    ]);
  });
});
