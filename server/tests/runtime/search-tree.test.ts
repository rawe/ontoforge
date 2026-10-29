/**
 * The search tree at run time: the trees today's searches compile into
 * (canonical printouts), and the executor against a fake search-index
 * store — single-method raw scores, fusion and its ties, `matched`, the
 * refetch, the similarity floor, restrictions pushed into the leaves, one
 * embedding per text.
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
import { SearchIndexDefinition, type SearchIndexSchema } from "../../src/core/searchIndex.js";
import { RRF_K } from "../../src/core/searchQuery.js";
import { printSearchTree, type RankNode, type SearchNode } from "../../src/core/searchTree.js";
import { invalidateLoadedSchemaCache, type LoadedSchema } from "../../src/runtime/schemaCache.js";
import { search } from "../../src/runtime/search/entry.js";
import { executeSearchTree } from "../../src/runtime/search/executor.js";
import { searchByIndices } from "../../src/runtime/search/indexSearch.js";
import { createMockRuntimeStore, makeUnscopedSchema, withManagedIndices } from "./helpers.js";

// Every tree the searches compile, as they compile it.
const compiled = vi.hoisted(() => ({ trees: [] as unknown[] }));
vi.mock("../../src/core/searchCompile.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/searchCompile.js")>();
  return {
    ...original,
    compileEntitySearch: (request: Parameters<typeof original.compileEntitySearch>[0]) => {
      const tree = original.compileEntitySearch(request);
      compiled.trees.push(tree);
      return tree;
    },
  };
});

const MODEL = "fake:hash:2";

afterEach(() => setEmbeddingProvider(null));

describe("the trees today's searches compile", () => {
  const INDEX_SCHEMA: SearchIndexSchema = {
    entityTypes: {
      person: {
        key: "person",
        displayName: "Person",
        nameProperty: "name",
        properties: {
          name: { key: "name", displayName: "Name", dataType: "string" },
          body: { key: "body", displayName: "Body", dataType: "document" },
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
  };
  let store: ReturnType<typeof createMockRuntimeStore>;

  beforeEach(() => {
    compiled.trees = [];
    invalidateLoadedSchemaCache();
    setEmbeddingProvider({ dimensions: 2, modelId: MODEL, embed: async () => [1, 0], embedBatch: async () => [] });
    store = createMockRuntimeStore();
    // As the PostgreSQL adapter: keyword ranking, so hybrid is the default.
    store.supportsKeywordRanking.mockReturnValue(true);
    const schema = makeUnscopedSchema();
    (schema.entityTypes as { properties: unknown[] }[])[0]!.properties.push({
      key: "body",
      displayName: "Body",
      dataType: "document",
    });
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    withManagedIndices(store, INDEX_SCHEMA, MODEL, () => []);
  });

  it("the default search: hybrid over the default index of each type and the passage index", async () => {
    await search("full_lens", { query: "machine learning" }, store);
    expect(printSearchTree(compiled.trees[0] as SearchNode)).toBe(
      [
        "cut(limit 10)",
        "└─ fuse",
        "   ├─ group(entity)",
        "   │  └─ merge",
        '   │     ├─ rank(person~default, semantic {}, "machine learning")',
        '   │     ├─ rank(company~default, semantic {}, "machine learning")',
        '   │     └─ rank(person~body, semantic {}, "machine learning")',
        "   └─ group(entity)",
        "      └─ merge",
        '         ├─ rank(person~default, keyword {"match":"any"}, "machine learning")',
        '         ├─ rank(company~default, keyword {"match":"any"}, "machine learning")',
        '         └─ rank(person~body, keyword {"match":"any"}, "machine learning")',
      ].join("\n"),
    );
  });

  it("an index search by keyword with a filter: the filter as a set per type", async () => {
    await searchByIndices(
      "full_lens",
      { query: "acme", indices: ["person~default", "company~default"], mode: "keyword", filters: { name: "ACME" } },
      store,
    );
    expect(printSearchTree(compiled.trees[0] as SearchNode)).toBe(
      [
        "cut(limit 10)",
        "└─ restrict",
        "   ├─ group(entity)",
        "   │  └─ merge",
        '   │     ├─ rank(person~default, keyword {"match":"any"}, "acme")',
        '   │     └─ rank(company~default, keyword {"match":"any"}, "acme")',
        '   ├─ select(person, where [{"dataType":"string","kind":"property","op":"eq","propertyKey":"name","value":"ACME"}])',
        '   └─ select(company, where [{"dataType":"string","kind":"property","op":"eq","propertyKey":"name","value":"ACME"}])',
      ].join("\n"),
    );
  });

  it("a semantic default search of one type's own fields with a floor", async () => {
    await search(
      "full_lens",
      { query: "ada", type: "person", in: ["properties"], strategy: "semantic", minSimilarity: 0.75 },
      store,
    );
    expect(printSearchTree(compiled.trees[0] as SearchNode)).toBe(
      [
        "cut(limit 10)",
        "└─ group(entity)",
        '   └─ rank(person~default, semantic {"minSimilarity":0.75}, "ada")',
      ].join("\n"),
    );
  });
});

describe("the executor", () => {
  const record = (key: string, entityType: string): SearchIndexRecord => ({
    searchIndexId: `id-${key}`,
    key,
    kind: "custom",
    // Managed keys carry a `~`, which a custom definition's key may not.
    definition: SearchIndexDefinition.parse({
      key: key.replace("~", "_"),
      name: key,
      description: key,
      entityType,
      fields: ["name"],
    }),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const PERSON = record("person~default", "person");
  const NOTES = record("person~notes", "person");
  const COMPANY = record("company~default", "company");
  const indices = new Map([PERSON, NOTES, COMPANY].map((index) => [index.key, index] as const));

  const generation = (index: SearchIndexRecord, representation: "semantic" | "keyword"): SearchGenerationRecord => ({
    generationId: `${index.key}/${representation}`,
    searchIndexId: index.searchIndexId,
    representation,
    definitionHash: "h",
    modelId: representation === "semantic" ? MODEL : null,
    dimensions: null,
    languages: representation === "keyword" ? ["english"] : null,
    state: "ready",
    total: 0,
    done: 0,
    failed: 0,
    createdAt: new Date(0),
    readyAt: new Date(0),
  });
  const entry = (entityId: string, score: number, partId = ""): RankedSearchEntry => ({
    entityId,
    partKind: "self",
    groupNo: 0,
    partId,
    relationType: null,
    targetType: null,
    targetId: null,
    startChar: null,
    charLength: null,
    text: entityId,
    score,
  });

  const loaded = {
    searchIndexScope: { scoped: false, includedIndices: [] },
    scoped: { entityTypes: {}, relationTypes: {} },
  } as unknown as LoadedSchema;
  let generations: SearchGenerationRecord[];
  let lists: Record<string, RankedSearchEntry[]>;
  let rank: ReturnType<typeof vi.fn<(query: SearchEntryQuery) => Promise<RankedSearchEntry[]>>>;
  let embed: ReturnType<typeof vi.fn<(text: string) => Promise<number[] | null>>>;
  let indexStore: SearchIndexStore;

  beforeEach(() => {
    generations = [PERSON, NOTES, COMPANY].flatMap((index) => [
      generation(index, "semantic"),
      generation(index, "keyword"),
    ]);
    lists = {};
    rank = vi.fn(async (query) => (lists[query.generationId] ?? []).slice(0, query.limit));
    embed = vi.fn(async () => [1, 0]);
    setEmbeddingProvider({ dimensions: 2, modelId: MODEL, embed, embedBatch: async () => [] });
    indexStore = { listGenerations: async () => generations, rankEntries: rank } as unknown as SearchIndexStore;
  });

  const sem = (index: string, text = "q", minSimilarity?: number): RankNode => ({
    kind: "rank",
    index,
    text,
    semantic: minSimilarity === undefined ? {} : { minSimilarity },
    relations: null,
  });
  const kw = (index: string, text = "q"): RankNode => ({
    kind: "rank",
    index,
    text,
    keyword: { match: "any" },
    relations: null,
  });
  const group = (input: SearchNode): SearchNode => ({ kind: "group", key: "entity", input });
  const merge = (...inputs: SearchNode[]): SearchNode => ({ kind: "merge", inputs });
  const fuse = (...inputs: SearchNode[]): SearchNode => ({ kind: "fuse", inputs });
  const cut = (input: SearchNode, limit = 10): SearchNode => ({ kind: "cut", input, limit });
  const hybrid = (...keys: string[]) =>
    fuse(group(merge(...keys.map((key) => sem(key)))), group(merge(...keys.map((key) => kw(key)))));
  const run = (tree: SearchNode) => executeSearchTree(loaded, indexStore, indices, tree);
  const rrf = (rank: number) => 1 / (RRF_K + rank);

  it("one method keeps the raw scores, merged across indices; equal scores by entity id", async () => {
    lists["person~default/keyword"] = [entry("p2", 2), entry("p1", 1)];
    lists["company~default/keyword"] = [entry("c1", 2)];
    const hits = await run(cut(group(merge(kw("person~default"), kw("company~default")))));
    expect(hits.map((hit) => [hit.entityId, hit.entityType, hit.score])).toEqual([
      ["c1", "company", 2],
      ["p2", "person", 2],
      ["p1", "person", 1],
    ]);
  });

  it("an entity found by several entries counts once, by its best; the matched entry is that one", async () => {
    lists["person~default/semantic"] = [entry("a", 0.6), entry("b", 0.5)];
    lists["person~notes/semantic"] = [entry("b", 0.9, "3"), entry("a", 0.4, "1")];
    const hits = await run(cut(group(merge(sem("person~default"), sem("person~notes")))));
    expect(hits.map((hit) => [hit.entityId, hit.score])).toEqual([
      ["b", 0.9],
      ["a", 0.6],
    ]);
    expect(hits[0]!.matched).toMatchObject({ index: { key: "person~notes" }, entry: { partId: "3" } });
    // Per index the entry that represents the entity, measured where fetched.
    expect(hits[0]!.indices.map((match) => [match.index.key, match.entry.partId, match.semanticSimilarity])).toEqual([
      ["person~notes", "3", 0.9],
      ["person~default", "", 0.5],
    ]);
  });

  it("two methods fuse by reciprocal rank; equal sums by semantic similarity, matched in the better rank", async () => {
    lists["person~default/semantic"] = [entry("b", 0.9), entry("a", 0.7)];
    lists["person~default/keyword"] = [entry("a", 2), entry("b", 1), entry("c", 0.5)];
    const hits = await run(cut(hybrid("person~default")));
    expect(hits.map((hit) => hit.entityId)).toEqual(["b", "a", "c"]);
    expect(hits[0]!.score).toBeCloseTo(rrf(1) + rrf(2));
    expect(hits[2]!.score).toBeCloseTo(rrf(3));
    // b ranks first semantically, a by keyword; c only by keyword.
    expect(hits.map((hit) => hit.indices[0]!.semanticSimilarity === null)).toEqual([false, false, true]);
    expect(hits[1]!.indices[0]).toMatchObject({ keywordScore: 2, semanticSimilarity: 0.7 });
  });

  it("without a ready generation of one method, a hybrid tree keeps the other method's raw scores", async () => {
    generations = generations.filter((g) => g.representation !== "semantic");
    lists["person~default/keyword"] = [entry("a", 2.5)];
    const hits = await run(cut(hybrid("person~default")));
    expect(hits.map((hit) => [hit.entityId, hit.score])).toEqual([["a", 2.5]]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("a method that runs but finds nothing still fuses: the other's hits score by reciprocal rank", async () => {
    lists["person~default/keyword"] = [entry("a", 2.5)];
    const hits = await run(cut(hybrid("person~default")));
    expect(hits.map((hit) => [hit.entityId, hit.score])).toEqual([["a", rrf(1)]]);
  });

  it("fetches limit × 4 first, then once more up to 1,000 the leaves not yet exhausted", async () => {
    // Many entries of one entity fill the first page.
    lists["person~default/keyword"] = Array.from({ length: 50 }, (_, i) =>
      entry(i < 30 ? "a" : `e${i}`, 100 - i, String(i)),
    );
    lists["company~default/keyword"] = [entry("c", 0.5)];
    const hits = await run(cut(group(merge(kw("person~default"), kw("company~default"))), 3));
    expect(rank.mock.calls.map(([query]) => [query.generationId, query.limit])).toEqual([
      ["person~default/keyword", 12],
      ["company~default/keyword", 12],
      ["person~default/keyword", 1000],
    ]);
    expect(hits.map((hit) => hit.entityId)).toEqual(["a", "e30", "e31"]);
  });

  it("does not fetch again when the root is full, or the first fetch is at the cap", async () => {
    lists["person~default/keyword"] = Array.from({ length: 40 }, (_, i) => entry(`e${i}`, 100 - i));
    await run(cut(group(kw("person~default")), 2));
    await run(cut(group(kw("person~default")), 300));
    expect(rank.mock.calls.map(([query]) => query.limit)).toEqual([8, 1000]);
  });

  it("floors each semantic leaf after its fetch; a leaf past its floor is exhausted", async () => {
    lists["person~default/semantic"] = [entry("a", 0.9), entry("b", 0.6), entry("c", 0.55), entry("d", 0.5)];
    const hits = await run(cut(group(sem("person~default", "q", 0.7)), 1));
    expect(hits.map((hit) => hit.entityId)).toEqual(["a"]);
    await run(cut(group(sem("person~default", "q", 0.7)), 5));
    // Neither fetched again: limit 1 fetched 4, the last below the floor;
    // limit 5 fetched 20 and got 4.
    expect(rank.mock.calls.map(([query]) => query.limit)).toEqual([4, 20]);
  });

  it("pushes the restrictions into every leaf of their type; other types are not restricted", async () => {
    const age = { kind: "property", propertyKey: "age", dataType: "integer", op: "gte", value: 20 } as const;
    const active = { kind: "property", propertyKey: "active", dataType: "boolean", op: "eq", value: true } as const;
    const ranked = group(merge(kw("person~default"), kw("person~notes"), kw("company~default")));
    await run(
      cut({
        kind: "restrict",
        input: {
          kind: "restrict",
          input: ranked,
          sets: [{ kind: "select", entityType: "person", conditions: [age], ids: ["a", "b"] }],
        },
        sets: [
          {
            kind: "intersect",
            inputs: [
              { kind: "select", entityType: "person", conditions: [active], ids: null },
              { kind: "select", entityType: "person", conditions: [], ids: ["b", "c"] },
            ],
          },
        ],
      }),
    );
    expect(rank.mock.calls.map(([query]) => [query.generationId, query.conditions, query.entityIds])).toEqual([
      ["person~default/keyword", [active, age], ["b"]],
      ["person~notes/keyword", [active, age], ["b"]],
      ["company~default/keyword", [], null],
    ]);
  });

  it("embeds each text once, whatever the number of leaves; no leaf to run embeds nothing", async () => {
    await run(cut(fuse(group(merge(sem("person~default"), sem("company~default"))), group(sem("person~notes", "v1")))));
    expect(embed.mock.calls.map(([text]) => text)).toEqual(["q", "v1"]);
    generations = [];
    expect(await run(cut(hybrid("person~default")))).toEqual([]);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("refuses what it cannot run yet", async () => {
    lists["person~default/keyword"] = [entry("a", 1)];
    const append: SearchNode = {
      kind: "append",
      input: group(kw("person~default")),
      set: { kind: "select", entityType: "person", conditions: [], ids: ["b"] },
    };
    await expect(run(cut(append))).rejects.toThrow("cannot run yet");
  });
});
