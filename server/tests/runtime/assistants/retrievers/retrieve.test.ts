/**
 * Retrieval of a plan over a fake search-index store: the tree the plan
 * compiles into (indices, relations per index, the threshold as
 * `(1 + t) / 2`, entity restrictions from filters and previous results),
 * what its searches ask the store, how sub-queries fuse per entity,
 * listing without a query, the evidence and diagnostics shapes, and the
 * cards of the results handed to the answer model.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The trees retrieval runs, as it runs them; what matched is described by a stub.
const engine = vi.hoisted(() => ({ trees: [] as unknown[], describeMatches: vi.fn() }));
vi.mock("../../../../src/runtime/search/indexSearch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/runtime/search/indexSearch.js")>();
  return {
    ...original,
    describeMatches: engine.describeMatches,
    runSearchTree: (...args: Parameters<typeof original.runSearchTree>) => {
      engine.trees.push(args[3]);
      return original.runSearchTree(...args);
    },
  };
});

import { setEmbeddingProvider } from "../../../../src/core/embedding.js";
import type {
  RankedSearchEntry,
  RuntimeStore,
  SearchEntryQuery,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../../../src/core/ports.js";
import { printSearchTree, type TreeNode } from "../../../../src/core/searchTree.js";
import type { EngineHit } from "../../../../src/runtime/search/indexSearch.js";
import type { LoadedSchema } from "../../../../src/runtime/schemaCache.js";
import type { Plan } from "../../../../src/runtime/assistants/retrievers/plan.js";
import {
  answerSearches,
  boundContext,
  CONTEXT_CHARACTERS,
  diagnosticResults,
  entityCards,
  filterValues,
  retrieve,
  retrievedResults,
  type RetrievalScope,
} from "../../../../src/runtime/assistants/retrievers/retrieve.js";
import { CATALOG, CONFIG, LENS, SCHEMA } from "./fixture.js";

const record = (key: string): SearchIndexRecord => {
  const entry = CATALOG.find((candidate) => candidate.key === key)!;
  return {
    searchIndexId: `id-${key}`,
    key,
    kind: entry.kind,
    createdAt: new Date(),
    updatedAt: new Date(),
    definition: {
      key,
      name: key,
      description: entry.description,
      entityType: entry.entityType,
      fields: entry.fields,
      header: null,
      relations: entry.relations.map((group) => ({
        relationType: group.relationType,
        direction: group.direction,
        fields: ["role"],
        target: { [group.relationType === "works_for" ? "company" : "city"]: ["name"] },
        label: group.label,
        template: null,
      })),
      semantic: { enabled: true, template: null },
      keyword: { enabled: true },
    },
  };
};

const PEOPLE: Record<string, Record<string, unknown>> = {
  ada: { _id: "ada", name: "Ada", email: "ada@acme.test" },
  bob: { _id: "bob", name: "Bob", email: "x".repeat(900) },
  eve: { _id: "eve", name: "Eve", email: "eve@foo.test" },
};
const CITIES = [{ _id: "berlin", name: "Berlin" }, { _id: "berlin-mitte", name: "Berlin-Mitte" }];
const LIVES_IN = [
  { fromEntityId: "ada", toEntityId: "berlin" },
  { fromEntityId: "eve", toEntityId: "berlin" },
  { fromEntityId: "bob", toEntityId: "berlin-mitte" },
];

const store = {
  ontologyKey: "o",
  listEntities: vi.fn(async (type: string, _defs: unknown, conditions: { value: string }[]) => {
    const rows = type === "city" ? CITIES : Object.values(PEOPLE);
    const needle = conditions[0]!.value.toLowerCase();
    const found = rows.filter((row) => String(row.name).toLowerCase().includes(needle));
    return [found, found.length];
  }),
  listRelations: vi.fn(async (_type: string, _defs: unknown, _f: unknown, from: string | null, to: string | null) => {
    const found = LIVES_IN.filter((r) => (from === null || r.fromEntityId === from) && (to === null || r.toEntityId === to));
    return [found, found.length];
  }),
  getEntitiesByIds: vi.fn(async (ids: string[]) => Object.fromEntries(ids.filter((id) => PEOPLE[id]).map((id) => [id, PEOPLE[id]]))),
} as unknown as RuntimeStore;

// Every index ready in both methods; each query text embeds as its
// position among the texts embedded.
const generation = (key: string, representation: "semantic" | "keyword"): SearchGenerationRecord => ({
  generationId: `${key}/${representation}`,
  searchIndexId: `id-${key}`,
  representation,
  definitionHash: "h",
  modelId: representation === "semantic" ? "fake" : null,
  dimensions: null,
  languages: null,
  state: "ready",
  total: 0,
  done: 0,
  failed: 0,
  createdAt: new Date(0),
  readyAt: new Date(0),
});
const embedded: string[] = [];
/** Per index and query text, the entries its searches find, best first. */
let lists: Record<string, Record<string, RankedSearchEntry[]>>;
const rankEntries = vi.fn(async (query: SearchEntryQuery) => {
  const key = query.generationId.split("/")[0]!;
  const text = query.text ?? embedded[query.vector![0]!]!;
  // As the database: the restriction is part of the query.
  return (lists[key]?.[text] ?? [])
    .filter((entry) => query.entityIds == null || query.entityIds.includes(entry.entityId))
    .slice(0, query.limit);
});
const indexStore = {
  listGenerations: async () => CATALOG.flatMap((entry) => [generation(entry.key, "semantic"), generation(entry.key, "keyword")]),
  rankEntries,
} as unknown as SearchIndexStore;

const scope = (): RetrievalScope => ({
  config: CONFIG,
  lens: LENS,
  loaded: { scoped: SCHEMA, full: SCHEMA, searchIndexScope: { scoped: false, includedIndices: [] } } as unknown as LoadedSchema,
  store,
  indexStore,
  records: CATALOG.map((entry) => record(entry.key)),
  signal: new AbortController().signal,
});

/** What the searches of `index` find for `query`: these entities, each by
 * a relation entry with the text, best first. */
const finds = (index: string, query: string, ...found: [entityId: string, text: string][]) => {
  lists[index] = {
    ...lists[index],
    [query]: found.map(([entityId, text], i) => ({ entityId, partKind: "relation", groupNo: 0, partId: "r", relationType: "works_for", targetType: "company", targetId: "c", startChar: null, charLength: null, text, score: 0.9 - i / 10 })),
  };
};

const tree = (i = 0) => printSearchTree(engine.trees[i] as TreeNode);

const subQuery = (overrides: Partial<Plan["subQueries"][number]>): Plan["subQueries"][number] => ({
  indices: ["person_employment"],
  relations: [],
  query: "CTO at ACME",
  variants: [],
  mode: "hybrid",
  filters: [],
  previous: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  engine.trees = [];
  lists = {};
  embedded.length = 0;
  setEmbeddingProvider({
    dimensions: 1,
    modelId: "fake",
    embed: async (text) => [embedded.push(text) - 1],
    embedBatch: async () => [],
  });
  engine.describeMatches.mockImplementation(async (_l: unknown, _s: unknown, hits: EngineHit[]) =>
    new Map(hits.map((h) => [h.entityId, { index: h.matched.index.key, partKind: "relation", relationType: "works_for", relationId: "r", target: { id: "c", type: "company", label: "ACME" }, snippet: h.matched.entry.text, charOffset: null, charLength: null }])),
  );
});

afterEach(() => setEmbeddingProvider(null));

describe("sub-query search", () => {
  it("searches each query text with the retriever's relations and the threshold floor, 30 entities each", async () => {
    finds("person_employment", "CTO at ACME", ["ada", "Employment Role: CTO Company: ACME"]);
    finds("person_employment", "chief technology officer ACME", ["ada", "Employment Role: CTO Company: ACME"]);
    const plan: Plan = { subQueries: [subQuery({ indices: ["person_employment", "person_home"], variants: ["chief technology officer ACME"] })], unsupportedReason: null };
    const retrieval = await retrieve(scope(), plan);
    expect(retrieval.searchCalls).toBe(2);
    // Per index: the retriever's relation subset (works_for), all groups for person_home.
    expect(tree()).toBe(
      [
        "fuse",
        "├─ cut(limit 30)",
        "│  └─ fuse",
        "│     ├─ group(entity)",
        "│     │  └─ merge",
        '│     │     ├─ semanticSearch(person_employment, "CTO at ACME", minSimilarity 0.675, relations ["works_for"], sub-query 0)',
        '│     │     └─ semanticSearch(person_home, "CTO at ACME", minSimilarity 0.675, sub-query 0)',
        "│     └─ group(entity)",
        "│        └─ merge",
        '│           ├─ keywordSearch(person_employment, "CTO at ACME", match any, relations ["works_for"], sub-query 0)',
        '│           └─ keywordSearch(person_home, "CTO at ACME", match any, sub-query 0)',
        "└─ cut(limit 30)",
        "   └─ fuse",
        "      ├─ group(entity)",
        "      │  └─ merge",
        '      │     ├─ semanticSearch(person_employment, "chief technology officer ACME", minSimilarity 0.675, relations ["works_for"], sub-query 0)',
        '      │     └─ semanticSearch(person_home, "chief technology officer ACME", minSimilarity 0.675, sub-query 0)',
        "      └─ group(entity)",
        "         └─ merge",
        '            ├─ keywordSearch(person_employment, "chief technology officer ACME", match any, relations ["works_for"], sub-query 0)',
        '            └─ keywordSearch(person_home, "chief technology officer ACME", match any, sub-query 0)',
      ].join("\n"),
    );
    expect(retrieval.items).toEqual([
      {
        entityId: "ada",
        entityType: "person",
        label: "Ada",
        fields: { name: "Ada", email: "ada@acme.test" },
        matches: [{ subQuery: 0, matched: expect.objectContaining({ index: "person_employment" }), text: "Employment Role: CTO Company: ACME", conditions: [] }],
        entity: { _id: "ada", name: "Ada", email: "ada@acme.test" },
      },
    ]);
  });

  it("keyword mode passes no floor; the planner's relations narrow within the retriever's", async () => {
    await retrieve(scope(), { subQueries: [subQuery({ mode: "keyword", indices: ["person_home"], relations: ["lives_in"] })], unsupportedReason: null });
    expect(tree()).toBe(
      ["cut(limit 30)", "└─ group(entity)", '   └─ keywordSearch(person_home, "CTO at ACME", match any, relations ["lives_in"], sub-query 0)'].join("\n"),
    );
  });

  it("a filter restricts the search to the entities it reaches, by normalized exact value", async () => {
    await retrieve(scope(), {
      subQueries: [subQuery({ filters: [{ id: "city", value: "berlin", quote: "Berlin" }] })],
      unsupportedReason: null,
    });
    // "Berlin-Mitte" contains the value but does not equal it; every search is restricted.
    expect(rankEntries.mock.calls.map(([query]) => [...query.entityIds!].sort())).toEqual([["ada", "eve"], ["ada", "eve"]]);
    finds("person_employment", "CTO at ACME", ["ada", "CTO at ACME"]);
    const plan: Plan = {
      subQueries: [subQuery({ filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] })],
      unsupportedReason: null,
    };
    const searched = await retrieve(scope(), plan);
    expect(boundContext(searched, plan, LENS, CONFIG).results[0]!.matches[0]).toEqual({
      search: "CTO at ACME",
      entry: "Employment",
      related: "ACME",
      relatedType: "Company",
      text: "CTO at ACME",
      filters: ["lives in City Name: Berlin"],
    });
  });

  it("a filtered sub-query is not cut by the threshold and keeps the filtered entities the search did not rank", async () => {
    // "Who works at ACME and lives in Berlin?": one sub-query plus the city filter.
    finds("person_employment", "works at ACME", ["eve", "Employment ACME"]);
    const retrieval = await retrieve(scope(), {
      subQueries: [subQuery({ query: "works at ACME", mode: "semantic", filters: [{ id: "city", value: "Berlin", quote: "lives in Berlin" }] })],
      unsupportedReason: null,
    });
    // No floor; the restriction pushed into the search, the restricted entities appended.
    expect(tree()).toBe(
      [
        "append(until 100, sub-query 0)",
        "├─ restrict",
        "│  ├─ cut(limit 30)",
        "│  │  └─ group(entity)",
        '│  │     └─ semanticSearch(person_employment, "works at ACME", relations ["works_for"], sub-query 0)',
        '│  └─ filter(person, ids ["ada","eve"])',
        '└─ filter(person, ids ["ada","eve"])',
      ].join("\n"),
    );
    expect([...rankEntries.mock.calls[0]![0].entityIds!].sort()).toEqual(["ada", "eve"]);
    // Eve ranked by the search, Ada kept after her.
    expect(retrieval.items.map((item) => [item.entityId, item.matches[0]!.matched === null])).toEqual([
      ["eve", false],
      ["ada", true],
    ]);
  });

  it("a sub-query without query lists the filtered entities without searching", async () => {
    const plan: Plan = {
      subQueries: [subQuery({ query: "", filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] })],
      unsupportedReason: null,
    };
    const retrieval = await retrieve(scope(), plan);
    expect(rankEntries).not.toHaveBeenCalled();
    expect(retrieval.searchCalls).toBe(0);
    // Each result carries the filter it satisfies, for the answer model.
    const fact = "lives in City Name: Berlin";
    const condition = { filter: "city", value: "Berlin", text: fact };
    expect(retrieval.items.map((item) => [item.entityId, item.matches])).toEqual([
      ["ada", [{ subQuery: 0, matched: null, text: null, conditions: [condition] }]],
      ["eve", [{ subQuery: 0, matched: null, text: null, conditions: [condition] }]],
    ]);
    expect(boundContext(retrieval, plan, LENS, CONFIG).results[0]!.matches).toEqual([{ search: "", filters: [fact] }]);
  });

  it("fuses two sub-queries per entity: found by both ranks first and keeps both matches", async () => {
    finds("person_employment", "CTO at ACME", ["bob", "CTO at ACME"], ["ada", "CTO at ACME"]);
    finds("person_home", "lives in Berlin", ["eve", "Home Berlin"], ["ada", "Home Berlin"]);
    const retrieval = await retrieve(scope(), {
      subQueries: [subQuery({}), subQuery({ indices: ["person_home"], query: "lives in Berlin" })],
      unsupportedReason: null,
    });
    // Bob and Eve tie exactly (each first in one sub-query) and are equally similar: the earlier sub-query wins.
    expect(retrieval.items.map((item) => item.entityId)).toEqual(["ada", "bob", "eve"]);
    expect(retrieval.items[0]!.matches.map((m) => [m.subQuery, m.text])).toEqual([
      [0, "CTO at ACME"],
      [1, "Home Berlin"],
    ]);
    // Bob's long email is cut to the retriever's characters, and the answer model is told.
    expect(String(retrieval.items[1]!.fields.email)).toHaveLength(800 + " [truncated]".length);
    expect(retrieval.cutFields).toEqual(["Email"]);
    expect(retrieval.limitations).toEqual([]);
    expect(boundContext(retrieval, { subQueries: [], unsupportedReason: null }, LENS, CONFIG).limitations).toContain(
      "Answer fields cut to 800 characters: Email.",
    );
    const rows = diagnosticResults(retrieval);
    expect(rows.map((row) => [row.entityId, row.subQuery])).toEqual([["ada", 0], ["ada", 1], ["bob", 0], ["eve", 1]]);
    expect(rows[0]).toEqual({
      entityId: "ada",
      entityType: "person",
      label: "Ada",
      subQuery: 0,
      matched: expect.objectContaining({ index: "person_employment", partKind: "relation" }),
      answerFields: { name: "Ada", email: "ada@acme.test" },
    });
  });

  it("compiles the whole plan into one tree: variants fused, a filter and a previous reference pushed down and appended", async () => {
    const plan: Plan = {
      subQueries: [
        subQuery({ variants: ["chief technology officer"], filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] }),
        subQuery({ indices: ["person_home"], query: "near the river", mode: "keyword", previous: { filterId: null, quote: "these" } }),
      ],
      unsupportedReason: null,
    };
    const previous = { complete: true, plan, results: [{ entityType: "person", ids: ["bob", "ada"] }] };
    await retrieve(scope(), plan, previous);
    expect(engine.trees).toHaveLength(1);
    expect(tree()).toBe(
      [
        "fuse",
        "├─ append(until 100, sub-query 0)",
        "│  ├─ restrict",
        "│  │  ├─ fuse",
        "│  │  │  ├─ cut(limit 30)",
        "│  │  │  │  └─ fuse",
        "│  │  │  │     ├─ group(entity)",
        '│  │  │  │     │  └─ semanticSearch(person_employment, "CTO at ACME", relations ["works_for"], sub-query 0)',
        "│  │  │  │     └─ group(entity)",
        '│  │  │  │        └─ keywordSearch(person_employment, "CTO at ACME", match any, relations ["works_for"], sub-query 0)',
        "│  │  │  └─ cut(limit 30)",
        "│  │  │     └─ fuse",
        "│  │  │        ├─ group(entity)",
        '│  │  │        │  └─ semanticSearch(person_employment, "chief technology officer", relations ["works_for"], sub-query 0)',
        "│  │  │        └─ group(entity)",
        '│  │  │           └─ keywordSearch(person_employment, "chief technology officer", match any, relations ["works_for"], sub-query 0)',
        '│  │  └─ filter(person, ids ["ada","eve"])',
        '│  └─ filter(person, ids ["ada","eve"])',
        "└─ append(until 100, sub-query 1)",
        "   ├─ restrict",
        "   │  ├─ cut(limit 30)",
        "   │  │  └─ group(entity)",
        '   │  │     └─ keywordSearch(person_home, "near the river", match any, sub-query 1)',
        '   │  └─ filter(person, ids ["ada","bob"])',
        '   └─ filter(person, ids ["ada","bob"])',
      ].join("\n"),
    );
  });

  it("notes the indices a search node could not run on for want of a ready generation, and the planner's unsupported reason", async () => {
    // person_employment's semantic generation is still building.
    const generations = CATALOG.flatMap((entry) => [generation(entry.key, "semantic"), generation(entry.key, "keyword")]).map((g) =>
      g.generationId === "person_employment/semantic" ? { ...g, state: "building" as const } : g,
    );
    const building = { ...scope(), indexStore: { ...indexStore, listGenerations: async () => generations } as SearchIndexStore };
    const retrieval = await retrieve(building, { subQueries: [subQuery({})], unsupportedReason: "No salaries." });
    expect(retrieval.limitations).toEqual([
      "No salaries.",
      "Search indices not fully built (person_employment); results may be incomplete.",
    ]);
    // A catalog status other than ready, with every search node run: no note.
    const statusOnly = { ...scope(), lens: { ...LENS, catalog: CATALOG.map((e) => (e.key === "person_employment" ? { ...e, status: "building" as const } : e)) } };
    expect((await retrieve(statusOnly, { subQueries: [subQuery({})], unsupportedReason: null })).limitations).toEqual([]);
  });
});

describe("filter values", () => {
  const twoFilters = {
    ...CONFIG,
    filters: [...CONFIG.filters, { id: "home", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" as const }], field: "name" }],
  };
  const listing = (stored: string[]) => ({
    config: twoFilters,
    loaded: scope().loaded,
    store: { distinctEntityValues: vi.fn(async () => stored) } as unknown as RuntimeStore,
  });

  it("lists a field's distinct stored values, normalized once, reading each compared field once", async () => {
    const lookup = listing(["Berlin", "berlin", "Hamburg"]);
    const values = await filterValues(lookup);
    expect(values.get("city")).toEqual(["Berlin", "Hamburg"]);
    expect(values.get("home")).toEqual(["Berlin", "Hamburg"]);
    expect(lookup.store.distinctEntityValues).toHaveBeenCalledTimes(1);
    expect(lookup.store.distinctEntityValues).toHaveBeenCalledWith("city", "name", 51);
  });

  it("lists nothing for a field with more than 50 values", async () => {
    const values = await filterValues(listing(Array.from({ length: 51 }, (_, i) => `City ${i}`)));
    expect(values.size).toBe(0);
    expect((await filterValues(listing(Array.from({ length: 50 }, (_, i) => `City ${i}`)))).get("city")).toHaveLength(50);
  });
});

describe("retrieved results", () => {
  it("carry each entity's proven conditions, unioned over sub-queries, and the first sub-query's text match", async () => {
    finds("person_employment", "CTO at ACME", ["bob", "CTO at ACME"], ["eve", "CTO at ACME"]);
    finds("person_home", "lives in Berlin", ["eve", "Home Berlin"]);
    const retrieval = await retrieve(scope(), {
      subQueries: [
        // Unfiltered and ranked.
        subQuery({}),
        // Filtered, listed only.
        subQuery({ indices: ["person_home"], query: "", filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] }),
        // Filtered and ranked; the same condition, written differently.
        subQuery({ indices: ["person_home"], query: "lives in Berlin", filters: [{ id: "city", value: "berlin", quote: "Berlin" }] }),
      ],
      unsupportedReason: null,
    });
    const results = retrievedResults(retrieval);
    expect(results.map((result) => result.entityId)).toEqual(retrieval.items.map((item) => item.entityId));
    const byId = Object.fromEntries(results.map((result) => [result.entityId, result]));
    const berlin = { filter: "city", value: "Berlin", text: "lives in City Name: Berlin" };
    // Similarity candidate: no condition, a text match.
    expect(byId.bob).toEqual({
      entityId: "bob",
      entityType: "person",
      label: "Bob",
      conditions: [],
      matched: expect.objectContaining({ index: "person_employment", snippet: "CTO at ACME" }),
    });
    // Proven condition, listed only: no text match.
    expect(byId.ada).toMatchObject({ conditions: [berlin], matched: null });
    // Found by all three: the condition once, the first sub-query's match.
    expect(byId.eve).toMatchObject({ conditions: [berlin], matched: expect.objectContaining({ index: "person_employment" }) });
    expect(Object.keys(byId.eve!)).not.toContain("fields");
  });
});

describe("fusion and context", () => {
  it("keeps the answer context within its budget and counts what did not fit", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      entityId: `e${i}`,
      entityType: "person",
      label: null,
      fields: { name: "n".repeat(400) },
      matches: [{ subQuery: 0, matched: null, text: null, conditions: [] }],
      entity: { _id: `e${i}`, name: "n".repeat(400) },
    }));
    const plan: Plan = { subQueries: [subQuery({})], unsupportedReason: null };
    const context = boundContext({ items, limitations: [], searchCalls: 0, searchMs: 0, cutFields: [] }, plan, LENS, CONFIG);
    expect(JSON.stringify({ results: context.results }).length).toBeLessThanOrEqual(CONTEXT_CHARACTERS);
    expect(context.results.length + context.omitted).toBe(40);
    expect(context.omitted).toBeGreaterThan(0);
    expect(context.included.map((item) => item.entityId)).toEqual(items.slice(0, context.results.length).map((item) => item.entityId));
    expect(context.limitations.at(-1)).toContain(`${context.omitted} technically selected candidates were omitted`);
    expect(context.results[0]).toEqual({ type: "Person", label: null, fields: { Name: "n".repeat(400) }, matches: [{ search: "CTO at ACME" }] });
  });

  it("reports the items that fit, a small one after a skipped big one too, and makes them the turn's evidence cards", () => {
    const item = (id: string, name: string) => ({
      entityId: id,
      entityType: "person",
      label: name.slice(0, 20),
      fields: { name },
      matches: [{ subQuery: 0, matched: null, text: null, conditions: [] }],
      entity: { _id: id, name, email: `${id}@acme.test`, bio: "[document]" },
    });
    const items = [item("ada", "Ada"), item("big", "b".repeat(CONTEXT_CHARACTERS)), item("eve", "Eve")];
    const plan: Plan = { subQueries: [subQuery({})], unsupportedReason: null };
    const context = boundContext({ items, limitations: [], searchCalls: 0, searchMs: 0, cutFields: [] }, plan, LENS, CONFIG);
    expect(context.omitted).toBe(1);
    expect(context.results.map((result) => result.label)).toEqual(["Ada", "Eve"]);
    expect(context.included.map((included) => included.entityId)).toEqual(["ada", "eve"]);
    // The model's context is what it was: the included items stay out of it.
    expect(Object.keys(context.results[0]!)).toEqual(["type", "label", "fields", "matches"]);
    // Document properties are no card fields.
    expect(entityCards(context.included, LENS)).toEqual([
      { ref: "E1", id: "ada", type: "person", typeName: "Person", label: "Ada", fields: [{ name: "Email", value: "ada@acme.test" }], evidence: true },
      { ref: "E2", id: "eve", type: "person", typeName: "Person", label: "Eve", fields: [{ name: "Email", value: "eve@acme.test" }], evidence: true },
    ]);
  });

  it("gives the answer model display names and plain conditions: no entity ids, keys, filter ids or paths", async () => {
    finds("person_employment", "works at ACME", ["eve", "Employment Role: CTO Company: ACME"]);
    const plan: Plan = {
      subQueries: [
        subQuery({ relations: ["works_for"], query: "works at ACME", filters: [{ id: "city", value: "Berlin", quote: "lives in Berlin" }] }),
        subQuery({ indices: ["person_home"], relations: ["lives_in"], query: "", filters: [{ id: "city", value: "Paris", quote: "Paris" }] }),
      ],
      unsupportedReason: null,
    };
    const retrieval = await retrieve(scope(), plan);
    const context = boundContext(retrieval, plan, LENS, CONFIG);
    const payload = JSON.stringify({ searches: answerSearches(plan, CONFIG, LENS), results: context.results, limitations: context.limitations });
    expect(answerSearches(plan, CONFIG, LENS)).toEqual([
      { query: "works at ACME", relations: ["Employment"], filters: ["lives in City Name: Berlin"] },
      { query: "", relations: ["Home"], filters: ["lives in City Name: Paris"] },
    ]);
    expect(context.results.map((result) => [result.type, result.label, Object.keys(result.fields)])).toEqual([
      ["Person", "Eve", ["Name", "Email"]],
      ["Person", "Ada", ["Name", "Email"]],
    ]);
    // Entity ids, relation-type and index keys, filter ids, paths, sub-query numbers.
    for (const internal of ['"eve"', '"ada"', '"c"', "works_for", "lives_in", "person_employment", "person_home", '"city"', "→", "city.name", "subQuery", '"id"', '"path"']) {
      expect(payload).not.toContain(internal);
    }
  });
});
