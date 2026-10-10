/**
 * The planner's contract: its input (the retriever's catalog entries, its
 * filters, the modes) and the checks on its sub-queries before anything
 * is searched — verbatim evidence, the retriever's indices and relations,
 * filters on the sub-query's result types, previous-result references.
 */

import { describe, expect, it } from "vitest";

import {
  PLANNER,
  PLANNER_RESPONSE_FORMAT,
  plannerInput,
  validatePlan,
  type Plan,
  type Previous,
} from "../../../../src/runtime/assistants/retrievers/plan.js";
import { parsePlannerOutput } from "../../../../src/runtime/assistants/retrievers/plannerOutput.js";
import { CONFIG, LENS } from "./fixture.js";

const sub = (overrides: Record<string, unknown> = {}) => ({
  indices: ["person_employment"],
  relations: ["works_for"],
  query: "CTO at ACME",
  variants: [],
  mode: "keyword",
  filters: [],
  previous: null,
  ...overrides,
});
const QUESTION = "Who is CTO at ACME and lives in Berlin?";
const check = (subQueries: unknown[], message = QUESTION, previous?: Previous, modes = ["keyword"] as const) =>
  validatePlan({ subQueries, unsupportedReason: null }, CONFIG, LENS, [...modes], message, [], previous);

describe("planner output", () => {
  it("parses a two-relation question as two sub-queries", () => {
    const raw = JSON.stringify({
      subQueries: [sub(), sub({ indices: ["person_home"], relations: ["lives_in"], query: "lives in Berlin" })],
      unsupportedReason: null,
    });
    const { plan, notes } = validatePlan(parsePlannerOutput(raw), CONFIG, LENS, ["keyword"], QUESTION, [], undefined);
    expect(plan.subQueries.map((q) => [q.indices, q.relations, q.query])).toEqual([
      [["person_employment"], ["works_for"], "CTO at ACME"],
      [["person_home"], ["lives_in"], "lives in Berlin"],
    ]);
    expect(notes).toEqual([]);
  });

  it("accepts one sub-query plus a filter; filter values become strings", () => {
    const { plan } = check([sub({ filters: [{ id: "city", value: "Berlin", quote: "lives in Berlin" }] })]);
    expect(plan.subQueries[0]!.filters).toEqual([{ id: "city", value: "Berlin", quote: "lives in Berlin" }]);
    const numeric = check([sub({ filters: [{ id: "city", value: 10115, quote: "10115" }] })], "People in 10115 CTO at ACME");
    expect(numeric.plan.subQueries[0]!.filters[0]!.value).toBe("10115");
  });

  it("needs sub-queries or an unsupported-data explanation", () => {
    expect(() => check([])).toThrow("unsupported-data explanation");
    const { plan } = validatePlan(
      { subQueries: [], unsupportedReason: "No salaries." }, CONFIG, LENS, ["keyword"], QUESTION, [], undefined,
    );
    expect(plan.unsupportedReason).toBe("No salaries.");
    expect(() => validatePlan({ steps: [] }, CONFIG, LENS, ["keyword"], QUESTION, [], undefined)).toThrow("invalid format");
  });

  it("leaves out an index or relation the retriever does not allow, and drops a sub-query left without index", () => {
    const { plan, notes } = check([
      sub({ indices: ["person_employment", "company~default"], relations: ["works_for", "lives_in"] }),
      sub({ indices: ["ghost"] }),
    ]);
    expect(plan.subQueries).toHaveLength(1);
    expect(plan.subQueries[0]).toMatchObject({ indices: ["person_employment"], relations: ["works_for"] });
    expect(notes).toEqual([
      "The index company~default is not one this retriever searches; it was left out of a search.",
      "The relation lives in is not allowed for the chosen indices; it was left out of a search.",
      "An index this retriever does not search was left out of a search.",
      "A search was dropped: it named no index of this retriever.",
    ]);
  });

  it("takes the planner's own query words; only filter values need a verbatim user quote", () => {
    // BUG 2a: a paraphrased query never fails the turn.
    const paraphrase = check([sub({ query: "events about artificial intelligence" })], "Which events are about artificial intelligence?");
    expect(paraphrase.plan.subQueries[0]!.query).toBe("events about artificial intelligence");
    expect(paraphrase.notes).toEqual([]);
    // A filter whose quote is not a user's is not applied, and that is a limitation.
    const { plan, notes } = check([
      sub({ filters: [{ id: "city", value: "Paris", quote: "lives in Berlin" }, { id: "city", value: "Berlin", quote: "in Berlin, Germany" }] }),
    ]);
    expect(plan.subQueries[0]!.filters).toEqual([]);
    expect(notes).toEqual([
      'The condition "lives in City Name: Paris" was not applied: the value is not stated verbatim in a user message.',
      'The condition "lives in City Name: Berlin" was not applied: the value is not stated verbatim in a user message.',
    ]);
    // An earlier user message is evidence; assistant text is not.
    const history = [
      { role: "user" as const, content: "People in Hamburg?" },
      { role: "assistant" as const, content: "Try Berlin." },
    ];
    const earlier = validatePlan(
      { subQueries: [sub({ filters: [{ id: "city", value: "Hamburg", quote: "Hamburg" }, { id: "city", value: "Berlin", quote: "Berlin" }] })] },
      CONFIG, LENS, ["keyword"], "And their roles?", history, undefined,
    );
    expect(earlier.plan.subQueries[0]!.filters.map((f) => f.value)).toEqual(["Hamburg"]);
    // Case and spacing do not matter for the quote.
    expect(check([sub({ filters: [{ id: "city", value: "berlin", quote: "LIVES  in berlin" }] })]).plan.subQueries[0]!.filters).toHaveLength(1);
  });

  it("does not apply a filter the retriever lacks or one on another result type", () => {
    const { plan, notes } = check([sub({ filters: [{ id: "ghost", value: "Berlin", quote: "Berlin" }] })]);
    expect(plan.subQueries[0]!.filters).toEqual([]);
    expect(notes).toEqual(["A filter this retriever does not allow for the searched type was not applied."]);
  });

  it("an empty query needs an applied filter or previous reference and drops variants", () => {
    const empty = check([sub({ query: "" })]);
    expect(empty.plan.subQueries).toEqual([]);
    expect(empty.notes).toEqual(["A search was dropped: without a query it needs an applied filter or previous results."]);
    const { plan } = check(
      [sub({ query: " ", variants: ["x"], filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] })],
      "Everyone in Berlin",
    );
    expect(plan.subQueries[0]).toMatchObject({ query: "", variants: [] });
  });

  it("keeps at most three variants and drops empty ones instead of failing the plan", () => {
    const { plan } = check([sub({ variants: ["a", " ", "b", "c", "d", "x".repeat(300)] })]);
    expect(plan.subQueries[0]!.variants).toEqual(["a", "b", "c"]);
    expect(check([sub({ variants: ["x".repeat(300)] })]).plan.subQueries[0]!.variants[0]).toHaveLength(200);
  });

  it("replaces an unavailable mode with the first available one and says so", () => {
    const { plan, notes } = check([sub({ mode: "semantic" })]);
    expect(plan.subQueries[0]!.mode).toBe("keyword");
    expect(notes).toEqual(["Search mode semantic is unavailable; keyword was searched instead."]);
  });

  it("honours a previous reference only to an exact, complete previous result of one type; else ignores it", () => {
    const exactPlan: Plan = {
      subQueries: [{ ...sub({ query: "", filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] }), mode: "keyword" } as Plan["subQueries"][number]],
      unsupportedReason: null,
    };
    const previous: Previous = { complete: true, plan: exactPlan, results: [{ entityType: "person", ids: ["p1", "p2"] }] };
    const followUp = [sub({ query: "CTO", previous: { filterId: null, quote: "these people" } })];
    const honoured = check(followUp, "Which of these people is CTO?", previous);
    expect(honoured.plan.subQueries[0]!.previous).toEqual({ filterId: null, quote: "these people" });
    expect(honoured.notes).toEqual([]);
    const ignored = (message: string, prior: Previous | undefined, subs = followUp) => {
      const { plan, notes } = check(subs, message, prior);
      expect(plan.subQueries[0]!.previous).toBeNull();
      expect(plan.subQueries[0]!.query).toBe("CTO");
      return notes[0];
    };
    expect(ignored("Is this person CTO?", previous, [sub({ query: "CTO", previous: { filterId: null, quote: "this person" } })])).toContain("ambiguous");
    expect(ignored("Which of these people is CTO?", undefined)).toContain("no verified previous results");
    expect(ignored("Which of these people is CTO?", { ...previous, complete: false })).toContain("incomplete");
    // BUG 2b: a follow-up on a searched turn runs as a fresh search.
    const searched = { ...previous, plan: { ...exactPlan, subQueries: [sub() as Plan["subQueries"][number]] } };
    expect(ignored("Which of these people is CTO?", searched)).toBe(
      "The reference to previous results was ignored (previous search results are candidates, " +
        "not verified results); it ran as a fresh search.",
    );
    expect(ignored("Which of these people is CTO?", previous, [sub({ query: "CTO", previous: { filterId: "ghost", quote: "these people" } })])).toContain(
      "no allowed relation path",
    );
    // Assistant words are no reference.
    expect(ignored("CTO?", previous, [sub({ query: "CTO", previous: { filterId: null, quote: "these people" } })])).toContain("no user words");
    // A query-less sub-query whose reference is ignored has nothing left: dropped.
    const dropped = check([sub({ query: "", previous: { filterId: null, quote: "these" } })], "And these?", searched);
    expect(dropped.plan.subQueries).toEqual([]);
  });
});

describe("planner prompt", () => {
  it("prefers a filter over splitting an AND-question into sub-queries", () => {
    expect(PLANNER).toContain("Prefer filters over splitting");
    expect(PLANNER).toContain('"filters":[{"id":"city","value":"Berlin","quote":"lives in Berlin"}]');
  });

  it("resolves a follow-up's pronoun to the latest exchange — the latest answer's entity when the question named none", () => {
    expect(PLANNER).toContain("from the last exchange of the history alone");
    expect(PLANNER).toContain("when it asked for one without naming it, the one that answer named; never one of an earlier exchange");
    expect(PLANNER).toContain('"Where was he born?" → query "Vincent van Gogh birthplace"');
    expect(PLANNER).toContain('"When was it published?" after "Which novel did Jane Austen write first?"');
    expect(PLANNER).not.toContain("Since when?");
  });

  it("lets queries use assistant text; only filter quotes need the user's words", () => {
    expect(PLANNER).toContain("queries may use ASSISTANT text; only filter values need user quotes");
    expect(PLANNER).toContain("Never use ASSISTANT text as filter evidence — this concerns filter quotes only, never the query.");
  });

  it("restates an unresolvable reference to earlier results as a fresh search with all constraints, never as unsupported", () => {
    expect(PLANNER).toContain(
      "A reference to earlier results while previousVerifiedResults is null is still answerable: " +
        "never answer it with unsupportedReason or subQueries:[]",
    );
    expect(PLANNER).toContain("carries all of its constraints and the new condition — drop none");
    expect(PLANNER).toContain('"query":"speaks Spanish","variants":[],"mode":"<first mode>","filters":[{"id":"city","value":"Lisbon","quote":"lives in Lisbon"}]');
    expect(PLANNER).toContain("a follow-up or a reference to earlier results is never such a case");
  });
});

describe("a reference to earlier results without verified previous results", () => {
  const history = [
    { role: "user" as const, content: "Who lives in Berlin?" },
    { role: "assistant" as const, content: "Ada and Bob." },
  ];
  const message = "Which of these work at ACME?";

  it("runs the restated search the prompt asks for: the earlier filter, quoted from the earlier user message", () => {
    const { plan, notes } = validatePlan(
      {
        subQueries: [sub({ query: "works at ACME", filters: [{ id: "city", value: "Berlin", quote: "lives in Berlin" }] })],
        unsupportedReason: null,
      },
      CONFIG, LENS, ["keyword"], message, history, undefined,
    );
    expect(notes).toEqual([]);
    expect(plan.subQueries[0]).toMatchObject({ query: "works at ACME", filters: [{ id: "city", value: "Berlin" }] });
  });

  it("still ignores a previous-result reference there, running the sub-query as a fresh search", () => {
    const { plan, notes } = validatePlan(
      { subQueries: [sub({ query: "works at ACME", previous: { filterId: null, quote: "these" } })], unsupportedReason: null },
      CONFIG, LENS, ["keyword"], message, history, undefined,
    );
    expect(plan.subQueries[0]!.previous).toBeNull();
    expect(notes).toEqual([
      "The reference to previous results was ignored (there are no verified previous results); it ran as a fresh search.",
    ]);
  });
});

describe("planner input", () => {
  it("lists the retriever's indices from the catalog, limited to the retriever's relation groups, and its filters", () => {
    const config = { ...CONFIG, indices: [{ index: "person_employment", relations: ["works_for"] }, { index: "ghost" }] };
    const input = JSON.parse(plannerInput(config, LENS, [], ["hybrid", "keyword"], "Who?", [], undefined));
    expect(input.availableModes).toEqual(["hybrid", "keyword"]);
    expect(input.indices).toEqual([
      {
        key: "person_employment",
        name: "person_employment",
        description: "Finds person",
        entityType: "person",
        entityTypeName: "Person",
        ownEntryHolds: ["Name"],
        relations: [{ relationType: "works_for", direction: "outgoing", label: "Employment", entryHolds: [] }],
        passagesOf: null,
        modes: ["keyword"],
      },
    ]);
    expect(input.filters).toEqual([
      { id: "city", resultType: "person", path: ["lives_in (outgoing)"], comparesType: "city", comparesField: "Name" },
    ]);
    expect(input.previousVerifiedResults).toBeNull();
    expect(input.history).toEqual([]);
  });

  it("passes the history, and previous results only when a follow-up may refer to them", () => {
    const history = [{ role: "user" as const, content: "Who is CTO at ACME?" }, { role: "assistant" as const, content: "Ada." }];
    const exact = { subQueries: [sub({ query: "" })], unsupportedReason: null } as unknown as Plan;
    const searched = { subQueries: [sub()], unsupportedReason: null } as unknown as Plan;
    const results = [{ entityType: "person", ids: ["ada"] }];
    const input = (previous: Previous) => JSON.parse(plannerInput(CONFIG, LENS, [], ["keyword"], "Since when?", history, previous));
    expect(input({ complete: true, plan: searched, results }).history).toEqual(history);
    expect(input({ complete: true, plan: searched, results }).previousVerifiedResults).toBeNull();
    expect(input({ complete: false, plan: exact, results }).previousVerifiedResults).toBeNull();
    expect(input({ complete: true, plan: exact, results }).previousVerifiedResults).toEqual(results);
  });

  it("the provider-enforced schema closes every object and requires every property", () => {
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
      }
      for (const child of Object.values(node)) (Array.isArray(child) ? child : [child]).forEach(inspect);
    };
    inspect(PLANNER_RESPONSE_FORMAT.json_schema.schema);
    const subQuery = PLANNER_RESPONSE_FORMAT.json_schema.schema.properties.subQueries.items.properties;
    expect(subQuery.variants).toEqual({ type: "array", items: { type: "string" } });
    expect(JSON.stringify(PLANNER_RESPONSE_FORMAT)).not.toContain("maxItems");
  });
});

describe("listed filter values", () => {
  // The city filter's field holds few values: the planner sees and picks among them.
  const values = new Map([["city", ["Berlin-Mitte", "Hamburg-Altona"]]]);
  const message = "Who is CTO at ACME in Mitte?";
  const checkListed = (filters: unknown[], question = message) =>
    validatePlan({ subQueries: [sub({ filters })], unsupportedReason: null }, CONFIG, LENS, ["keyword"], question, [], undefined, values);

  it("are part of the planner input, only for the filters that have them", () => {
    const input = JSON.parse(plannerInput(CONFIG, LENS, [], ["keyword"], message, [], undefined, values));
    expect(input.filters[0]).toMatchObject({ id: "city", valuesIn: "city.name" });
    expect(input.storedValues).toEqual({ "city.name": ["Berlin-Mitte", "Hamburg-Altona"] });
    const unlisted = JSON.parse(plannerInput(CONFIG, LENS, [], ["keyword"], message, [], undefined));
    expect(unlisted.filters[0]).not.toHaveProperty("valuesIn");
    expect(unlisted.storedValues).toEqual({});
    expect(PLANNER).toContain("When a filter names a list of stored values (valuesIn, a key of storedValues), value must be one of them");
  });

  it("accept the listed value the user's quoted words name, in its stored spelling, and say how they were read", () => {
    const { plan, notes } = checkListed([{ id: "city", value: "berlin-mitte", quote: "in Mitte" }]);
    expect(plan.subQueries[0]!.filters).toEqual([{ id: "city", value: "Berlin-Mitte", quote: "in Mitte" }]);
    expect(notes).toEqual(['The words "in Mitte" were read as the condition "lives in City Name: Berlin-Mitte".']);
  });

  it("need no note when the user stated the listed value", () => {
    const { plan, notes } = checkListed([{ id: "city", value: "berlin-mitte", quote: "Berlin-Mitte" }], "Who lives in Berlin-Mitte?");
    expect(plan.subQueries[0]!.filters[0]!.value).toBe("Berlin-Mitte");
    expect(notes).toEqual([]);
  });

  it("still need the user's verbatim words, and a value that is neither listed nor stated is dropped", () => {
    expect(checkListed([{ id: "city", value: "Berlin-Mitte", quote: "in the centre" }]).plan.subQueries[0]!.filters).toEqual([]);
    const invented = checkListed([{ id: "city", value: "Munich", quote: "in Mitte" }]);
    expect(invented.plan.subQueries[0]!.filters).toEqual([]);
    expect(invented.notes).toEqual([
      'The condition "lives in City Name: Munich" was not applied: the value is not stated verbatim in a user message.',
    ]);
  });

  it("leave a stated unlisted value as it is: exact, matching nothing rather than dropped", () => {
    const { plan, notes } = checkListed([{ id: "city", value: "Mitte", quote: "in Mitte" }]);
    expect(plan.subQueries[0]!.filters).toEqual([{ id: "city", value: "Mitte", quote: "in Mitte" }]);
    expect(notes).toEqual([]);
  });
});
