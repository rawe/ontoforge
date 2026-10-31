/**
 * Schema proposals without a database: the shape (the v1 steps only, no
 * cascade or consent field, the step cap), the cheap checks against a
 * design as read, and the Studio tool: a later call replaces the turn's
 * proposal, a failed one leaves none, an expected modeling error is the
 * model's result, a storage error is not.
 */

import { describe, expect, it, vi } from "vitest";

import { ConflictError, StoreError, ValidationError } from "../../src/core/exceptions.js";
import type { ModelingStore } from "../../src/core/ports.js";
import { proposeSchemaChangeTool, turnArtifacts, type StudioTurn } from "../../src/modeling/helper/propose.js";
import { cheapRefusals, type CheckResult } from "../../src/modeling/proposals/check.js";
import { MAX_PROPOSAL_STEPS, Proposal } from "../../src/modeling/proposals/proposal.js";

const DESIGN = {
  entityTypes: [{ key: "person", properties: [{ key: "name" }, { key: "email" }] }],
  relationTypes: [{ key: "knows", properties: [] }],
  lenses: [],
};

const refusals = (steps: object[]) =>
  cheapRefusals(Proposal.parse({ steps }), DESIGN).map((r) => [r.stepId, r.code]);

describe("a proposal's shape", () => {
  const step = { id: "s1", op: "create_entity_type", key: "team", name: "Team" };

  it("takes the four v1 steps", () => {
    expect(Proposal.safeParse({
      summary: "s",
      steps: [
        step,
        { id: "s2", op: "create_relation_type", key: "in_team", name: "In team", source: "person", target: "team" },
        { id: "s3", op: "add_property", entityType: "team", key: "size", name: "Size", dataType: "integer", required: false },
        { id: "s4", op: "set_description", relationType: "knows", description: "Who knows whom", reason: "clarity" },
      ],
    }).success).toBe(true);
  });

  it("refuses other ops, a cascade or consent field, an empty description and a bad key", () => {
    for (const steps of [
      [{ ...step, op: "delete_entity_type" }],
      [{ ...step, cascade: true }],
      [{ id: "s", op: "set_description", entityType: "person", description: "  " }],
      [{ ...step, key: "Team" }],
      [],
    ]) expect(Proposal.safeParse({ steps }).success).toBe(false);
    expect(Proposal.safeParse({ steps: [step], consent: true }).success).toBe(false);
  });

  it(`takes at most ${MAX_PROPOSAL_STEPS} steps`, () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ ...step, id: `s${i}`, key: `t${i}` }));
    expect(Proposal.safeParse({ steps: steps(MAX_PROPOSAL_STEPS) }).success).toBe(true);
    expect(Proposal.safeParse({ steps: steps(MAX_PROPOSAL_STEPS + 1) }).success).toBe(false);
  });
});

describe("the cheap checks", () => {
  it("accept references to existing types and properties and to earlier steps", () => {
    expect(refusals([
      { id: "a", op: "create_entity_type", key: "team", name: "Team" },
      { id: "b", op: "add_property", entityType: "team", key: "size", name: "Size", dataType: "integer" },
      { id: "c", op: "create_relation_type", key: "in_team", name: "In team", source: "person", target: "team" },
      { id: "d", op: "add_property", relationType: "in_team", key: "since", name: "Since", dataType: "date" },
      { id: "e", op: "set_description", entityType: "team", property: "name", description: "The team's name" },
      { id: "f", op: "set_description", entityType: "person", property: "email", description: "Mail" },
      { id: "g", op: "set_description", relationType: "knows", description: "Acquaintance" },
    ])).toEqual([]);
  });

  it("refuse duplicates, unknown references, an unnamed or doubly named type, a document on a relation type", () => {
    expect(refusals([
      { id: "a", op: "create_entity_type", key: "person", name: "Person" },
      { id: "b", op: "create_entity_type", key: "team", name: "Team" },
      { id: "b", op: "create_entity_type", key: "squad", name: "Squad" },
      { id: "c", op: "create_entity_type", key: "team", name: "Team again" },
      { id: "d", op: "create_relation_type", key: "knows", name: "Knows", source: "person", target: "person" },
      { id: "e", op: "create_relation_type", key: "leads", name: "Leads", source: "person", target: "nobody" },
      { id: "f", op: "add_property", entityType: "person", key: "email", name: "Email", dataType: "string" },
      { id: "g", op: "add_property", key: "x", name: "X", dataType: "string" },
      { id: "h", op: "add_property", entityType: "person", relationType: "knows", key: "x", name: "X", dataType: "string" },
      { id: "i", op: "add_property", relationType: "knows", key: "notes", name: "Notes", dataType: "document" },
      { id: "j", op: "set_description", entityType: "ghost", description: "Boo" },
      { id: "k", op: "set_description", entityType: "person", property: "phone", description: "Phone" },
      // A refused relation type is known from there on: no second refusal for it.
      { id: "l", op: "add_property", relationType: "leads", key: "since", name: "Since", dataType: "date" },
    ])).toEqual([
      ["a", "ALREADY_EXISTS"], ["b", "DUPLICATE_STEP_ID"], ["c", "ALREADY_EXISTS"], ["d", "ALREADY_EXISTS"],
      ["e", "NOT_FOUND"], ["f", "ALREADY_EXISTS"], ["g", "INVALID"], ["h", "INVALID"], ["i", "INVALID"],
      ["j", "NOT_FOUND"], ["k", "NOT_FOUND"],
    ]);
  });
});

describe("the propose_schema_change tool", () => {
  const CHECK = { ok: true } as CheckResult;

  /** A store whose design is DESIGN and whose rolled-back design change answers CHECK. */
  function store(): ModelingStore {
    return {
      getFullSchema: vi.fn(async () => DESIGN),
      changeDesign: vi.fn(async () => CHECK),
    } as unknown as ModelingStore;
  }

  it("is serial, and a later call replaces the turn's proposal", async () => {
    const tool = proposeSchemaChangeTool(store());
    expect(tool.serial).toBe(true);
    const turn: StudioTurn = { proposal: null };
    expect(turnArtifacts(turn)).toEqual([]);
    const first = { steps: [{ id: "s1", op: "create_entity_type", key: "team", name: "Team" }] };
    const second = { summary: "Teams", steps: [{ id: "s1", op: "create_entity_type", key: "squad", name: "Squad" }] };
    expect(await tool.run(first, turn)).toBe(CHECK);
    expect(await tool.run(second, turn)).toBe(CHECK);
    expect(turnArtifacts(turn)).toEqual([{ type: "proposal", version: 1, value: { proposal: second, check: CHECK } }]);
  });

  it("leaves the turn no proposal when the replacing call fails", async () => {
    const failing = store();
    vi.mocked(failing.changeDesign)
      .mockResolvedValueOnce(CHECK)
      .mockRejectedValueOnce(new ConflictError("Another operation holds this data; try again"));
    const tool = proposeSchemaChangeTool(failing);
    const turn: StudioTurn = { proposal: null };
    const proposal = { steps: [{ id: "s1", op: "create_entity_type", key: "team", name: "Team" }] };
    expect(await tool.run(proposal, turn)).toBe(CHECK);
    const error = await tool.run(proposal, turn).catch((e: unknown) => e);
    expect(tool.expected(error)).toEqual({ error: expect.objectContaining({ code: "RESOURCE_CONFLICT" }) });
    expect(turnArtifacts(turn)).toEqual([]);
  });

  it("hands an expected modeling error to the model, never a storage error", () => {
    const tool = proposeSchemaChangeTool(store());
    expect(tool.expected(new ConflictError("Another operation holds this data; try again"))).toEqual({
      error: { code: "RESOURCE_CONFLICT", message: "Another operation holds this data; try again" },
    });
    expect(tool.expected(new ValidationError("bad"))).toBeDefined();
    expect(tool.expected(new StoreError())).toBeUndefined();
    expect(tool.expected(new Error("bug"))).toBeUndefined();
  });
});
