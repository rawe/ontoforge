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

  it("refuses an index or a relation the agent does not allow", () => {
    expect(() => check([sub({ indices: ["company~default"] })])).toThrow("does not search");
    // The agent restricts person_employment to works_for; person~default has no groups.
    expect(() => check([sub({ indices: ["person~default"], relations: ["works_for"] })])).toThrow("none of its indices allows");
    expect(() => check([sub({ relations: ["lives_in"] })])).toThrow("none of its indices allows");
  });

  it("needs verbatim user evidence for queries and filter values", () => {
    expect(() => check([sub({ query: "chief technology officer" })])).toThrow("verbatim user evidence");
    expect(() => check([sub({ filters: [{ id: "city", value: "Paris", quote: "lives in Berlin" }] })])).toThrow(
      "Exact filter value has no verbatim user evidence",
    );
    expect(() => check([sub({ filters: [{ id: "city", value: "Berlin", quote: "in Berlin, Germany" }] })])).toThrow(
      "Exact filter value has no verbatim user evidence",
    );
    // Case and spacing do not matter.
    expect(check([sub({ query: "cto  AT acme" })]).plan.subQueries[0]!.query).toBe("cto  AT acme");
  });

  it("refuses a filter the agent lacks or one on another result type", () => {
    expect(() => check([sub({ filters: [{ id: "ghost", value: "Berlin", quote: "Berlin" }] })])).toThrow("not allowed");
  });

  it("an empty query needs a filter or a previous reference and drops variants", () => {
    expect(() => check([sub({ query: "" })])).toThrow("neither a query nor a filter");
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

  it("allows a previous reference only to an exact, complete previous result of one type", () => {
    const exactPlan: Plan = {
      subQueries: [{ ...sub({ query: "", filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] }), mode: "keyword" } as Plan["subQueries"][number]],
      unsupportedReason: null,
    };
    const previous: Previous = { complete: true, plan: exactPlan, results: [{ entityType: "person", ids: ["p1", "p2"] }] };
    const followUp = [sub({ query: "CTO", previous: { filterId: null, quote: "these people" } })];
    expect(check(followUp, "Which of these people is CTO?", previous).plan.subQueries[0]!.previous).toEqual({
      filterId: null,
      quote: "these people",
    });
    // A singular reference needs exactly one previous entity.
    expect(() => check([sub({ query: "CTO", previous: { filterId: null, quote: "this person" } })], "Is this person CTO?", previous)).toThrow(
      "ambiguous",
    );
    expect(() => check(followUp, "Which of these people is CTO?", undefined)).toThrow("no user evidence");
    expect(() => check(followUp, "Which of these people is CTO?", { ...previous, complete: false })).toThrow("incomplete");
    const searched = { ...previous, plan: { ...exactPlan, subQueries: [sub() as Plan["subQueries"][number]] } };
    expect(() => check(followUp, "Which of these people is CTO?", searched)).toThrow("candidates, not verified");
    expect(() => check([sub({ query: "CTO", previous: { filterId: "ghost", quote: "these people" } })], "Which of these people is CTO?", previous)).toThrow(
      "no allowed relation path",
    );
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
