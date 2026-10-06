/**
 * The planner's contract: its input (the agent's catalog entries, its
 * filters, the modes) and the checks on its sub-queries before anything
 * is searched — verbatim evidence, the agent's indices and relations,
 * filters on the sub-query's result types, previous-result references.
 */

import { describe, expect, it } from "vitest";

import {
  PLANNER_RESPONSE_FORMAT,
  plannerInput,
  validatePlan,
  type Plan,
  type Previous,
} from "../../../src/runtime/retrieverAgents/plan.js";
import { parsePlannerOutput } from "../../../src/runtime/retrieverAgents/plannerOutput.js";
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

  it("leaves out an index or relation the agent does not allow, and drops a sub-query left without index", () => {
    const { plan, notes } = check([
      sub({ indices: ["person_employment", "company~default"], relations: ["works_for", "lives_in"] }),
      sub({ indices: ["ghost"] }),
    ]);
    expect(plan.subQueries).toHaveLength(1);
    expect(plan.subQueries[0]).toMatchObject({ indices: ["person_employment"], relations: ["works_for"] });
    expect(notes).toEqual([
      "Sub-query 1: index 'company~default' is not one this agent searches; it was left out.",
      "Sub-query 1: relation 'lives_in' is not allowed for its indices; it was left out.",
      "Sub-query 2: index 'ghost' is not one this agent searches; it was left out.",
      "Sub-query 2 was dropped: it named no index of this agent.",
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
      'Sub-query 1: filter \'city\' = "Paris" was not applied: the value is not stated verbatim in a user message.',
      'Sub-query 1: filter \'city\' = "Berlin" was not applied: the value is not stated verbatim in a user message.',
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

  it("does not apply a filter the agent lacks or one on another result type", () => {
    const { plan, notes } = check([sub({ filters: [{ id: "ghost", value: "Berlin", quote: "Berlin" }] })]);
    expect(plan.subQueries[0]!.filters).toEqual([]);
    expect(notes).toEqual(["Sub-query 1: filter 'ghost' is not allowed here; it was not applied."]);
  });

  it("an empty query needs an applied filter or previous reference and drops variants", () => {
    const empty = check([sub({ query: "" })]);
    expect(empty.plan.subQueries).toEqual([]);
    expect(empty.notes).toEqual(["Sub-query 1 was dropped: without a query it needs an applied filter or previous results."]);
    const { plan } = check(
      [sub({ query: " ", variants: ["x"], filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] })],
      "Everyone in Berlin",
    );
    expect(plan.subQueries[0]).toMatchObject({ query: "", variants: [] });
  });

  it("replaces an unavailable mode with the first available one and says so", () => {
    const { plan, notes } = check([sub({ mode: "semantic" })]);
    expect(plan.subQueries[0]!.mode).toBe("keyword");
    expect(notes).toEqual(["Sub-query 1: search mode semantic is unavailable; searched keyword instead."]);
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
      "Sub-query 1: the reference to previous results was ignored (previous search results are candidates, " +
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

describe("planner input", () => {
  it("lists the agent's indices from the catalog, limited to the agent's relation groups, and its filters", () => {
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
  });
});
