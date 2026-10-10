/**
 * Retrieval of a plan over a mocked search engine: what each search is
 * asked (indices, relations per index, the threshold as `(1 + t) / 2`,
 * entity restrictions from filters), how sub-queries fuse per entity,
 * listing without a query, and the evidence and diagnostics shapes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ rankThroughIndices: vi.fn(), describeMatches: vi.fn() }));
vi.mock("../../../../src/runtime/search/indexSearch.js", () => engine);

import type { RuntimeStore, SearchIndexRecord, SearchIndexStore } from "../../../../src/core/ports.js";
import type { LoadedSchema } from "../../../../src/runtime/schemaCache.js";
import type { Plan } from "../../../../src/runtime/assistants/retrievers/plan.js";
import {
  answerSearches,
  boundContext,
  CONTEXT_CHARACTERS,
  diagnosticResults,
  filterValues,
  fuseRankings,
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

const scope = (): RetrievalScope => ({
  config: CONFIG,
  lens: LENS,
  loaded: { scoped: SCHEMA, full: SCHEMA, searchIndexScope: { scoped: false, includedIndices: [] } } as unknown as LoadedSchema,
  store,
  indexStore: {} as SearchIndexStore,
  records: CATALOG.map((entry) => record(entry.key)),
  signal: new AbortController().signal,
});

/** An engine hit whose matched entry is a relation entry of `index`. */
const hit = (entityId: string, index: string, text: string) => ({
  entityId,
  entityType: "person",
  score: 1,
  matched: {
    index: record(index),
    entry: { entityId, partKind: "relation", groupNo: 0, partId: "r", relationType: "works_for", targetType: "company", targetId: "c", startChar: null, charLength: null, text, score: 1 },
  },
  indices: [],
});

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
  engine.describeMatches.mockImplementation(async (_l: unknown, _s: unknown, hits: ReturnType<typeof hit>[]) =>
    new Map(hits.map((h) => [h.entityId, { index: h.matched.index.key, partKind: "relation", relationType: "works_for", relationId: "r", target: { id: "c", type: "company", label: "ACME" }, snippet: h.matched.entry.text, charOffset: null, charLength: null }])),
  );
});

describe("sub-query search", () => {
  it("asks the engine with the retriever's relations, the threshold floor and one call per query text", async () => {
    engine.rankThroughIndices.mockResolvedValue([hit("ada", "person_employment", "Employment Role: CTO Company: ACME")]);
    const plan: Plan = { subQueries: [subQuery({ indices: ["person_employment", "person_home"], variants: ["chief technology officer ACME"] })], unsupportedReason: null };
    const retrieval = await retrieve(scope(), plan);
    expect(retrieval.searchCalls).toBe(2);
    const request = engine.rankThroughIndices.mock.calls[0]![2];
    expect(request).toMatchObject({ query: "CTO at ACME", mode: "hybrid", matching: "any", relations: null, limit: 30 });
    expect(request.minScore).toBeCloseTo(0.675);
    // Per index: the retriever's relation subset (works_for), all groups (null) for person_home.
    expect(request.targets.map((t: { index: { key: string }; relations: unknown; entityIds: unknown }) => [t.index.key, t.relations, t.entityIds])).toEqual([
      ["person_employment", ["works_for"], null],
      ["person_home", null, null],
    ]);
    expect(engine.rankThroughIndices.mock.calls[1]![2].query).toBe("chief technology officer ACME");
    expect(retrieval.items).toEqual([
      {
        entityId: "ada",
        entityType: "person",
        label: "Ada",
        fields: { name: "Ada", email: "ada@acme.test" },
        matches: [{ subQuery: 0, matched: expect.objectContaining({ index: "person_employment" }), text: "Employment Role: CTO Company: ACME", conditions: [] }],
      },
    ]);
  });

  it("keyword mode passes no floor; the planner's relations narrow within the retriever's", async () => {
    engine.rankThroughIndices.mockResolvedValue([]);
    await retrieve(scope(), { subQueries: [subQuery({ mode: "keyword", indices: ["person_home"], relations: ["lives_in"] })], unsupportedReason: null });
    const request = engine.rankThroughIndices.mock.calls[0]![2];
    expect(request.minScore).toBeNull();
    expect(request.targets[0].relations).toEqual(["lives_in"]);
  });

  it("a filter restricts the search to the entities it reaches, by normalized exact value", async () => {
    engine.rankThroughIndices.mockResolvedValue([]);
    await retrieve(scope(), {
      subQueries: [subQuery({ filters: [{ id: "city", value: "berlin", quote: "Berlin" }] })],
      unsupportedReason: null,
    });
    // "Berlin-Mitte" contains the value but does not equal it.
    expect(engine.rankThroughIndices.mock.calls[0]![2].targets[0].entityIds.sort()).toEqual(["ada", "eve"]);
    engine.rankThroughIndices.mockResolvedValue([hit("ada", "person_employment", "CTO at ACME")]);
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
    engine.rankThroughIndices.mockResolvedValue([hit("eve", "person_employment", "Employment ACME")]);
    const retrieval = await retrieve(scope(), {
      subQueries: [subQuery({ query: "works at ACME", mode: "semantic", filters: [{ id: "city", value: "Berlin", quote: "lives in Berlin" }] })],
      unsupportedReason: null,
    });
    const request = engine.rankThroughIndices.mock.calls[0]![2];
    expect(request.minScore).toBeNull();
    expect(request.targets[0].entityIds.sort()).toEqual(["ada", "eve"]);
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
    expect(engine.rankThroughIndices).not.toHaveBeenCalled();
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
    engine.rankThroughIndices
      .mockResolvedValueOnce([hit("bob", "person_employment", "CTO at ACME"), hit("ada", "person_employment", "CTO at ACME")])
      .mockResolvedValueOnce([hit("eve", "person_home", "Home Berlin"), hit("ada", "person_home", "Home Berlin")]);
    const retrieval = await retrieve(scope(), {
      subQueries: [subQuery({}), subQuery({ indices: ["person_home"], query: "lives in Berlin" })],
      unsupportedReason: null,
    });
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

  it("notes indices that are not fully built and the planner's unsupported reason", async () => {
    engine.rankThroughIndices.mockResolvedValue([]);
    const building = { ...scope(), lens: { ...LENS, catalog: CATALOG.map((e) => (e.key === "person_employment" ? { ...e, status: "building" as const } : e)) } };
    const retrieval = await retrieve(building, { subQueries: [subQuery({})], unsupportedReason: "No salaries." });
    expect(retrieval.limitations).toEqual([
      "No salaries.",
      "Search indices not fully built (person_employment); results may be incomplete.",
    ]);
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
    engine.rankThroughIndices
      .mockResolvedValueOnce([hit("bob", "person_employment", "CTO at ACME"), hit("eve", "person_employment", "CTO at ACME")])
      .mockResolvedValueOnce([hit("eve", "person_home", "Home Berlin")]);
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
  it("fuses rankings by reciprocal rank; one ranking keeps its order", () => {
    const a = [{ entityId: "x" }, { entityId: "y" }];
    expect(fuseRankings([a])).toEqual(a);
    expect(fuseRankings([[{ entityId: "x" }, { entityId: "y" }], [{ entityId: "z" }, { entityId: "y" }]]).map((r) => r.entityId)).toEqual(["y", "x", "z"]);
  });

  it("keeps the answer context within its budget and counts what did not fit", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      entityId: `e${i}`,
      entityType: "person",
      label: null,
      fields: { name: "n".repeat(400) },
      matches: [{ subQuery: 0, matched: null, text: null, conditions: [] }],
    }));
    const plan: Plan = { subQueries: [subQuery({})], unsupportedReason: null };
    const context = boundContext({ items, limitations: [], searchCalls: 0, searchMs: 0, cutFields: [] }, plan, LENS, CONFIG);
    expect(JSON.stringify({ results: context.results }).length).toBeLessThanOrEqual(CONTEXT_CHARACTERS);
    expect(context.results.length + context.omitted).toBe(40);
    expect(context.omitted).toBeGreaterThan(0);
    expect(context.limitations.at(-1)).toContain(`${context.omitted} technically selected candidates were omitted`);
    expect(context.results[0]).toEqual({ type: "Person", label: null, fields: { Name: "n".repeat(400) }, matches: [{ search: "CTO at ACME" }] });
  });

  it("gives the answer model display names and plain conditions: no entity ids, keys, filter ids or paths", async () => {
    engine.rankThroughIndices.mockResolvedValue([hit("eve", "person_employment", "Employment Role: CTO Company: ACME")]);
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
