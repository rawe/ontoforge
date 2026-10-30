/**
 * Named searches at run time, against a fake search-index store: the
 * query in place of `$query`, the listing, the run's refusals — an unknown
 * key, an empty query, a tree the lens no longer fits — the run's `filter`
 * as one restrict under the root cut (types that drop out, a key no type
 * resolves, no type left), a semantic node without an embedding provider,
 * and the match from the query text an item ranked best in, named only
 * when the tree searches several texts; the shapes the executor does
 * not run, refused at their path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { withQuery, type StoredSearchNode } from "../../src/core/namedSearch.js";
import type {
  RankedSearchEntry,
  SearchEntryQuery,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../src/core/ports.js";
import { deriveManagedIndices } from "../../src/core/searchIndex.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  compileNamedSearch,
  listNamedSearches,
  namedSearchLens,
  runNamedSearch,
  type NamedSearchLens,
} from "../../src/runtime/search/namedSearch.js";
import { createMockRuntimeStore, makeFullSchema } from "./helpers.js";

const MODEL = "fake:hash:2";

type Row = Record<string, unknown>;

const PROPERTY = (key: string) => ({ key, displayName: key, dataType: "string" as const });
const INDICES: SearchIndexRecord[] = deriveManagedIndices({
  entityTypes: Object.fromEntries(
    [
      ["person", ["name", "email"]],
      ["company", ["name"]],
      ["department", ["name", "code"]],
    ].map(([key, properties]) => [
      key as string,
      {
        key: key as string,
        displayName: key as string,
        nameProperty: "name",
        properties: Object.fromEntries((properties as string[]).map((p) => [p, PROPERTY(p)])),
      },
    ]),
  ),
  relationTypes: {},
}).map((m) => ({
  searchIndexId: `id-${m.definition.key}`,
  key: m.definition.key,
  kind: m.kind,
  definition: m.definition,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}));

function generation(index: SearchIndexRecord, representation: "semantic" | "keyword"): SearchGenerationRecord {
  return {
    generationId: `${index.key}/${representation}`,
    searchIndexId: index.searchIndexId,
    representation,
    definitionHash: "h",
    modelId: representation === "semantic" ? MODEL : null,
    dimensions: representation === "semantic" ? 2 : null,
    languages: representation === "keyword" ? ["english"] : null,
    state: "ready",
    total: 0,
    done: 0,
    failed: 0,
    createdAt: new Date(0),
    readyAt: new Date(0),
  };
}

function entry(entityId: string, score: number): RankedSearchEntry {
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
  };
}

const kw = (index: string, text: string): StoredSearchNode => ({ kind: "keywordSearch", index, text });
const sem = (index: string, text: string): StoredSearchNode => ({ kind: "semanticSearch", index, text });
const group = (input: StoredSearchNode): StoredSearchNode => ({ kind: "group", key: "entity", input });
const fuse = (...inputs: StoredSearchNode[]): StoredSearchNode => ({ kind: "fuse", inputs });
const cut = (input: StoredSearchNode, limit = 10): StoredSearchNode => ({ kind: "cut", input, limit });

let runtime: ReturnType<typeof createMockRuntimeStore>;
/** Ranked entries per generation and query text (`<generation> <text>`). */
let lists: Record<string, RankedSearchEntry[]>;
let rank: ReturnType<typeof vi.fn<(query: SearchEntryQuery) => Promise<RankedSearchEntry[]>>>;
let stored: Row[];

beforeEach(() => {
  invalidateLoadedSchemaCache();
  setEmbeddingProvider({ dimensions: 2, modelId: MODEL, embed: async () => [1, 0], embedBatch: async () => [] });
  runtime = createMockRuntimeStore();
  runtime.supportsKeywordRanking.mockReturnValue(true);
  runtime.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "all" }));
  runtime.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { _id: id, _entityTypeKey: "person", name: `N-${id}` }])),
  );
  stored = [];
  runtime.getNamedSearches.mockImplementation(async () => stored);
  lists = {};
  rank = vi.fn(async (query: SearchEntryQuery) =>
    (lists[`${query.generationId} ${query.text ?? "(vector)"}`] ?? []).slice(0, query.limit),
  );
  const generations = INDICES.flatMap((index) => [generation(index, "semantic"), generation(index, "keyword")]);
  const indexStore = {
    ontologyKey: "test_ont",
    listIndices: async () => INDICES,
    getSearchSettings: async () => ({ keywordLanguages: ["english"], disabledDefaults: {} }),
    listGenerations: async () => generations,
    rankEntries: rank,
  } as unknown as SearchIndexStore;
  (runtime as unknown as { searchIndices: () => SearchIndexStore }).searchIndices = () => indexStore;
});

afterEach(() => setEmbeddingProvider(null));

const save = (key: string, tree: StoredSearchNode, name = key) =>
  stored.push({ key, name, description: `About ${key}`, tree });
const run = (key: string, request: Parameters<typeof runNamedSearch>[2]) =>
  runNamedSearch("all", key, request, runtime);

describe("the query", () => {
  it("goes in place of every $query, as written; other texts stay", () => {
    const tree = cut(fuse(group(kw("person~default", "$query and $query")), group(kw("person~default", "fixed"))));
    expect(withQuery(tree, "a $& b")).toEqual(
      cut(fuse(group(kw("person~default", "a $& b and a $& b")), group(kw("person~default", "fixed")))),
    );
  });

  it("reaches every search node of the run, filled in", async () => {
    save("people", cut(fuse(group(kw("person~default", "$query")), group(kw("company~default", "$query inc")))));
    await run("people", { query: "acme" });
    expect(rank.mock.calls.map(([query]) => [query.generationId, query.text]).sort()).toEqual([
      ["company~default/keyword", "acme inc"],
      ["person~default/keyword", "acme"],
    ]);
  });
});

describe("the listing", () => {
  it("lists by key: result, and the sorted root types of the indices the lens can search; no tree", async () => {
    save("zeta", cut({ kind: "group", key: "passage", input: kw("person~default", "$query") }), "A first");
    save("alpha", cut(fuse(group(kw("person~default", "$query")), group(kw("company~default", "$query")))));
    expect(await listNamedSearches("all", runtime)).toEqual([
      { key: "alpha", name: "alpha", description: "About alpha", result: "entities", types: ["company", "person"] },
      { key: "zeta", name: "A first", description: "About zeta", result: "passages", types: ["person"] },
    ]);
  });

  it("leaves out an index the lens can no longer search", async () => {
    save("both", cut(fuse(group(kw("person~default", "$query")), group(kw("company~default", "$query")))));
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue({
      ...makeFullSchema({ lensKey: "all", entityInclusions: [{ key: "person", properties: null }] }),
      searchIndexInclusions: ["person~default"],
    });
    expect((await listNamedSearches("all", runtime))[0]!.types).toEqual(["person"]);
  });
});

describe("refusals", () => {
  it("an unknown key is not found; an empty query is refused at query", async () => {
    save("people", cut(group(kw("person~default", "$query"))));
    await expect(run("nope", { query: "x" })).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Named search 'nope' not found",
    });
    await expect(run("people", { query: "  " })).rejects.toMatchObject({
      details: { fields: { query: "Required non-empty query" } },
    });
  });

  it("a tree the lens no longer fits is refused, naming the search and every path; nothing runs", async () => {
    save("both", cut(fuse(group(kw("person~default", "$query")), group(kw("company~default", "$query")))));
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue({
      ...makeFullSchema({ lensKey: "all", entityInclusions: [{ key: "person", properties: null }] }),
      searchIndexInclusions: ["person~default"],
    });
    await expect(run("both", { query: "x" })).rejects.toMatchObject({
      message: "Named search 'both' validation failed",
      details: {
        errors: ["tree.input.inputs.1.input.index: Search index 'company~default' is not searchable in this lens"],
      },
    });
    expect(rank).not.toHaveBeenCalled();
  });

  it("a passage group over a document the lens hides is refused at its index; nothing runs", async () => {
    const notes: SearchIndexRecord = {
      searchIndexId: "id-person~notes",
      key: "person~notes",
      kind: "passage",
      definition: { ...INDICES.find((index) => index.key === "person~default")!.definition, key: "person~notes", fields: ["notes"], header: null },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const base = runtime.searchIndices();
    (runtime as unknown as { searchIndices: () => SearchIndexStore }).searchIndices = () => ({
      ...base,
      listIndices: async () => [...INDICES, notes],
    });
    const schema = (properties: string[] | null) => {
      const full = makeFullSchema({ lensKey: "all", entityInclusions: [{ key: "person", properties }] });
      const person = (full.entityTypes as Row[])[0]!;
      person.properties = [
        ...(person.properties as Row[]),
        { key: "notes", displayName: "Notes", dataType: "document", required: false, defaultValue: null },
      ];
      return { ...full, searchIndexInclusions: ["person~notes"] };
    };
    save("notes", cut({ kind: "group", key: "passage", input: kw("person~notes", "$query") }));

    runtime.getFullSchemaWithLensInclusions.mockResolvedValue(schema(["name"]));
    await expect(run("notes", { query: "x" })).rejects.toMatchObject({
      message: "Named search 'notes' validation failed",
      details: { errors: ["tree.input.input.index: Search index 'person~notes' reads no document this lens shows"] },
    });
    expect(rank).not.toHaveBeenCalled();

    invalidateLoadedSchemaCache();
    runtime.getFullSchemaWithLensInclusions.mockResolvedValue(schema(["name", "notes"]));
    await expect(run("notes", { query: "x" })).resolves.toMatchObject({ items: [] });
  });
});

describe("the run's filter", () => {
  const both = () =>
    save("both", cut(fuse(group(kw("person~default", "$query")), group(kw("department~default", "$query")))));

  it("restricts each type that resolves every key; a type that does not finds nothing", async () => {
    both();
    lists["department~default/keyword x"] = [entry("d1", 1)];
    await run("both", { query: "x", filter: { email: "a@b.c" } });
    const byGeneration = Object.fromEntries(rank.mock.calls.map(([query]) => [query.generationId, query]));
    expect(byGeneration["person~default/keyword"]!.conditions).toEqual([
      expect.objectContaining({ propertyKey: "email", value: "a@b.c" }),
    ]);
    expect(byGeneration["person~default/keyword"]!.entityIds).toBeNull();
    expect(byGeneration["department~default/keyword"]!.entityIds).toEqual([]);
  });

  it("is AND-ed with a stored restrict", async () => {
    save(
      "restricted",
      cut({
        kind: "restrict",
        input: group(kw("person~default", "$query")),
        filters: [{ kind: "filter", entityType: "person", conditions: { name: "Ann" } }],
      }),
    );
    await run("restricted", { query: "x", filter: { email: "a@b.c" } });
    const keys = rank.mock.calls[0]![0].conditions.map((condition) => ("propertyKey" in condition ? condition.propertyKey : null));
    expect(keys.sort()).toEqual(["email", "name"]);
  });

  it("a key no type resolves is refused at filter.<key>; no type left is an empty result and a limitation", async () => {
    both();
    await expect(run("both", { query: "x", filter: { nope: "1" } })).rejects.toMatchObject({
      details: { fields: { "filter.nope": expect.stringContaining("nope") } },
    });
    expect(await run("both", { query: "x", filter: { email: "a@b.c", code: "D1" } })).toEqual({
      ran: [],
      items: [],
      limitations: [
        {
          code: "filter-excludes-all-types",
          message: "No searched entity type declares every filter key",
          types: ["department", "person"],
        },
      ],
    });
    expect(rank).not.toHaveBeenCalled();
  });
});

describe("without an embedding provider", () => {
  it("a semantic node runs nothing and is a limitation; keyword nodes still run", async () => {
    setEmbeddingProvider(null);
    save("hybrid", cut(fuse(group(sem("person~default", "$query")), group(kw("person~default", "$query")))));
    lists["person~default/keyword x"] = [entry("a", 2)];
    const response = await run("hybrid", { query: "x" });
    expect(response.ran).toEqual(["keyword"]);
    expect(response.items.map((item) => item.entity._id)).toEqual(["a"]);
    expect(response.limitations).toEqual([
      {
        code: "no-provider",
        message: "Semantic search needs an embedding provider; none is installed",
        method: "semantic",
        indices: ["person~default"],
      },
    ]);
  });
});

describe("the match", () => {
  it("comes from the text the item ranked best in, ties to the earlier text, and names it", async () => {
    save("two", cut(fuse(group(kw("person~default", "$query")), group(kw("person~default", "$query extra")))));
    // a ranks 1 / 3, b 3 / 1, c 2 / 2.
    lists["person~default/keyword x"] = [entry("a", 9), entry("c", 8), entry("b", 7)];
    lists["person~default/keyword x extra"] = [entry("b", 6), entry("c", 5), entry("a", 4)];
    const response = await run("two", { query: "x" });
    const matches = Object.fromEntries(
      response.items.map((item) => [item.entity._id, "match" in item ? item.match : null]),
    );
    expect(matches["a"]).toMatchObject({ queryText: "x", scores: { keyword: 9 } });
    expect(matches["b"]).toMatchObject({ queryText: "x extra", scores: { keyword: 6 } });
    expect(matches["c"]).toMatchObject({ queryText: "x", scores: { keyword: 8 } });
  });

  it("a tree of one text answers as the entity search: no queryText", async () => {
    save("one", cut(fuse(group(sem("person~default", "$query")), group(kw("person~default", "$query")))));
    lists["person~default/keyword x"] = [entry("a", 2)];
    const response = await run("one", { query: "x" });
    expect(response.items).toHaveLength(1);
    expect("queryText" in (response.items[0] as { match: object }).match).toBe(false);
  });

  it("two texts that the query makes equal are one text", async () => {
    save("same", cut(fuse(group(kw("person~default", "$query")), group(sem("person~default", "x")))));
    lists["person~default/keyword x"] = [entry("a", 2)];
    const response = await run("same", { query: "x" });
    expect("queryText" in (response.items[0] as { match: object }).match).toBe(false);
  });
});

describe("shapes the executor runs, checked at save and run", () => {
  const lens = {
    loaded: { scoped: { entityTypes: { person: { properties: {} } } } },
    indices: new Set(["person~default", "person~notes", "person~memo"]),
    hiddenDocuments: new Set(["person~memo"]),
    store: { supportsSearchPathConditions: () => false },
  } as unknown as NamedSearchLens;
  const passage = (input: StoredSearchNode): StoredSearchNode => ({ kind: "group", key: "passage", input });
  const errors = (tree: StoredSearchNode) => compileNamedSearch(tree, lens).errors;

  it("a search node below a passage group counts passage entries: by default, or refused at its parts", () => {
    const one = compileNamedSearch(cut(passage(kw("person~notes", "q"))), lens).tree!;
    expect(one).toMatchObject({ input: { input: { parts: ["passage"] } } });
    const entity = compileNamedSearch(cut(group(kw("person~notes", "q"))), lens).tree!;
    expect((entity as { input: { input: object } }).input.input).not.toHaveProperty("parts");
    expect(errors(cut(passage({ kind: "keywordSearch", index: "person~notes", text: "q", parts: ["passage", "self"] })))).toEqual([
      "tree.input.input.parts: A passage group counts passage entries only",
    ]);
    expect(errors(cut(passage({ kind: "keywordSearch", index: "person~notes", text: "q", parts: ["passage"] })))).toEqual([]);
  });

  it("a search below a passage group over a document the lens hides is refused at its index; above an entity group not", () => {
    expect(errors(cut(fuse(passage(kw("person~notes", "q")), passage(sem("person~memo", "q")))))).toEqual([
      "tree.input.inputs.1.input.index: Search index 'person~memo' reads no document this lens shows",
    ]);
    expect(errors(cut(group(kw("person~memo", "q"))))).toEqual([]);
  });

  it("the lens's hidden documents: indices whose document the lens hides, not those without one", () => {
    const type = (properties: Record<string, string>) => ({
      key: "person",
      properties: Object.fromEntries(Object.entries(properties).map(([key, dataType]) => [key, { key, dataType }])),
    });
    const record = (key: string, fields: string[]) =>
      ({ key, definition: { key, entityType: "person", fields } }) as unknown as SearchIndexRecord;
    const loaded = {
      full: { entityTypes: { person: type({ name: "string", notes: "document", memo: "document" }) }, relationTypes: {} },
      scoped: { entityTypes: { person: type({ name: "string", notes: "document" }) }, relationTypes: {} },
    } as unknown as Parameters<typeof namedSearchLens>[0];
    const indices = [record("person~default", ["name"]), record("person~notes", ["notes"]), record("person~memo", ["memo"])];
    const built = namedSearchLens(loaded, indices, lens.store);
    expect([...built.indices]).toEqual(["person~default", "person~notes", "person~memo"]);
    expect([...built.hiddenDocuments]).toEqual(["person~memo"]);
  });

  it("a merge combines search entries, never grouped rankings", () => {
    expect(errors(cut({ kind: "merge", inputs: [group(kw("person~default", "q")), group(kw("person~notes", "q"))] }))).toEqual([
      "tree.input: A merge combines the entries of search nodes; fuse grouped rankings instead",
    ]);
    expect(errors(cut(group({ kind: "merge", inputs: [kw("person~default", "q"), kw("person~notes", "q")] })))).toEqual([]);
  });

  it("passages fuse straight from their groups: not from a fuse, not from a cut; entities may", () => {
    const methods = () => fuse(passage(kw("person~notes", "q")), passage(sem("person~notes", "q")));
    expect(errors(cut(fuse(methods(), methods())))).toEqual([
      "tree.input: Passages fuse straight from their groups, not from a fuse or a cut",
    ]);
    expect(errors(cut(fuse(cut(passage(kw("person~notes", "q"))), passage(kw("person~notes", "v")))))).toEqual([
      "tree.input: Passages fuse straight from their groups, not from a fuse or a cut",
    ]);
    expect(errors(cut(methods()))).toEqual([]);
    const entities = () => fuse(group(kw("person~notes", "q")), group(sem("person~notes", "q")));
    expect(errors(cut(fuse(entities(), cut(entities()))))).toEqual([]);
  });
});
