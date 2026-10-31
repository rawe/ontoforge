/**
 * Schema proposals over REST on PostgreSQL: a check writes nothing and
 * runs no after-commit work; it is refused on a store already inside a
 * design change; apply commits every step or none, against the revision
 * it expects, and runs the after-commit work once on a fresh store; two
 * applies of one checked revision commit once; a step that needs cascade
 * is a refusal; validation splits introduced from pre-existing issues.
 * Authorization is in `access-authorization.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, getModelingStore, initStores } from "../../src/core/ports.js";
import { checkProposal } from "../../src/modeling/proposals/check.js";
import { afterDesignChange } from "../../src/runtime/indexing/managed.js";
import { wipeDatabase } from "./reset.js";

vi.mock("../../src/runtime/indexing/managed.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/runtime/indexing/managed.js")>();
  return { ...original, afterDesignChange: vi.fn(original.afterDesignChange) };
});

type Row = Record<string, any>;

const O = "proposals";
const MODEL = `/api/ontologies/${O}/model`;
const CHECK = `${MODEL}/proposals/check`;
const APPLY = `${MODEL}/proposals/apply`;

let app: FastifyInstance;

async function ok(method: "GET" | "POST" | "DELETE", url: string, payload?: object): Promise<Row> {
  const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res.statusCode === 204 ? {} : res.json();
}
const post = (url: string, payload: object) => ok("POST", url, payload);
const inject = (url: string, payload: object) => app.inject({ method: "POST", url, payload });

const revision = async () => (await getModelingStore(O)).searchIndices().designRevision();
const entityTypeKeys = async () => (await ok("GET", `${MODEL}/entity-types`)).map((t: Row) => t.key).sort();
const relationTypeKeys = async () => (await ok("GET", `${MODEL}/relation-types`)).map((t: Row) => t.key).sort();

/** An additive proposal: a new type with a property, a relation to it, a description. */
const ADD_PROJECTS = {
  summary: "Track the projects people work on",
  steps: [
    { id: "s1", op: "create_entity_type", key: "project", name: "Project", description: "A piece of work" },
    { id: "s2", op: "add_property", entityType: "project", key: "budget", name: "Budget", dataType: "float" },
    { id: "s3", op: "create_relation_type", key: "works_on", name: "Works on", source: "person", target: "project" },
    { id: "s4", op: "set_description", entityType: "person", property: "email", description: "Where to reach them" },
  ],
};

/** Its third step adds a required property without a default to a type a lens lists properties of. */
const NEEDS_CASCADE = {
  steps: [
    { id: "a", op: "create_entity_type", key: "team", name: "Team" },
    { id: "b", op: "create_relation_type", key: "member_of", name: "Member of", source: "person", target: "team" },
    { id: "c", op: "add_property", entityType: "person", key: "badge", name: "Badge", dataType: "string", required: true },
  ],
};

let personId: string;

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.ready();
  await post("/api/ontologies", { key: O });
  await post(`${MODEL}/lenses`, { key: "all", name: "All" });
  const staff = await post(`${MODEL}/lenses`, { key: "staff", name: "Staff" });
  const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
  personId = person.entityTypeId;
  await post(`${MODEL}/entity-types/${personId}/properties`, { key: "email", displayName: "Email", dataType: "string" });
  const nickname = await post(`${MODEL}/entity-types/${personId}/properties`, { key: "nickname", displayName: "Nickname", dataType: "string" });
  await post(`${MODEL}/lenses/${staff.lensId}/includes/entity-types`, { key: "person", properties: ["name", "email", "nickname"] });
  // A pre-existing validation error: the staff lens lists a property that is gone.
  await ok("DELETE", `${MODEL}/entity-types/${personId}/properties/${nickname.propertyId}`);
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(() => {
  vi.mocked(afterDesignChange).mockClear();
});

describe("checking a proposal", () => {
  it("writes nothing and runs no after-commit work", async () => {
    const before = await revision();
    const res = await inject(CHECK, { proposal: ADD_PROJECTS });
    expect(res.statusCode, res.body).toBe(200);
    const check = res.json();
    expect(check).toMatchObject({ ok: true, baseRevision: before, refusals: [] });
    expect(await revision()).toEqual(before);
    expect(await entityTypeKeys()).toEqual(["person"]);
    expect(await relationTypeKeys()).toEqual([]);
    const person = await ok("GET", `${MODEL}/entity-types/${personId}/properties`);
    expect(person.find((p: Row) => p.key === "email").description).toBeNull();
    expect(afterDesignChange).not.toHaveBeenCalled();
  });

  it("splits validation, names the impact and states its limits", async () => {
    const check = (await inject(CHECK, { proposal: ADD_PROJECTS })).json();
    expect(check.validation.introduced).toEqual([]);
    expect(check.validation.preExisting).toEqual([
      { path: "lenses.staff.includes.entityTypes.person.properties", message: "Property 'nickname' does not exist on entity type 'person'" },
    ]);
    // The unscoped lens shows everything; the staff lens shows the email it lists.
    expect(check.impact.lenses).toEqual(["all", "staff"]);
    expect(check.impact.indices).toEqual(expect.arrayContaining(["project~default"]));
    expect(check.limits.length).toBeGreaterThan(0);
    expect(check.limits.join(" ")).toContain("commit");
  });

  it("refuses cheaply what the design as read refuses, naming each step, without running the steps", async () => {
    const check = (await inject(CHECK, {
      proposal: {
        steps: [
          { id: "x", op: "create_entity_type", key: "person", name: "Person again" },
          { id: "y", op: "create_relation_type", key: "manages", name: "Manages", source: "person", target: "nope" },
          { id: "y", op: "set_description", entityType: "person", description: "Twice" },
          { id: "z", op: "add_property", entityType: "person", relationType: "manages", key: "since", name: "Since", dataType: "date" },
        ],
      },
    })).json();
    expect(check.ok).toBe(false);
    expect(check.refusals.map((r: Row) => [r.stepId, r.code])).toEqual([
      ["x", "ALREADY_EXISTS"], ["y", "NOT_FOUND"], ["y", "DUPLICATE_STEP_ID"], ["z", "INVALID"],
    ]);
    expect(check.limits).toEqual([expect.stringContaining("did not run")]);
  });

  it("refuses a step that needs cascade, naming it (D9)", async () => {
    const check = (await inject(CHECK, { proposal: NEEDS_CASCADE })).json();
    expect(check.ok).toBe(false);
    expect(check.refusals).toEqual([expect.objectContaining({
      stepId: "c", code: "CASCADE_REQUIRED", details: { affectedLenses: ["staff"], affectedIndices: [] },
    })]);
    expect(check.refusals[0].message).not.toContain("cascade=true");
  });

  it("refuses a proposal with a cascade or consent field, or no steps", async () => {
    const cascade = { steps: [{ ...NEEDS_CASCADE.steps[2], cascade: true }] };
    expect((await inject(CHECK, { proposal: cascade })).statusCode).toBe(422);
    expect((await inject(CHECK, { proposal: { ...ADD_PROJECTS, consent: true } })).statusCode).toBe(422);
    expect((await inject(CHECK, { proposal: { steps: [] } })).statusCode).toBe(422);
  });

  it("is refused on a store already inside a design change", async () => {
    const store = await getModelingStore(O);
    const before = await revision();
    await expect(store.changeDesign((s) => checkProposal(s, ADD_PROJECTS as never))).rejects.toThrow(/inside another/);
    expect(await revision()).toEqual(before);
    expect(await entityTypeKeys()).toEqual(["person"]);
  });
});

describe("applying a proposal", () => {
  it("refuses a stale expected revision with the current one, writing nothing", async () => {
    const current = await revision();
    for (const expected of [{ ...current, revision: current.revision - 1 }, { ...current, ontologyId: "00000000-0000-0000-0000-000000000000" }]) {
      const res = await inject(APPLY, { proposal: ADD_PROJECTS, expected });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details).toEqual({ code: "DESIGN_CHANGED", current });
    }
    expect(await revision()).toEqual(current);
    expect(await entityTypeKeys()).toEqual(["person"]);
  });

  it("writes none of a proposal whose third step is refused", async () => {
    const before = await revision();
    const res = await inject(APPLY, { proposal: NEEDS_CASCADE, expected: before });
    expect(res.statusCode).toBe(409);
    const { details } = res.json().error;
    expect(details.code).toBe("PROPOSAL_REFUSED");
    expect(details.check.refusals.map((r: Row) => [r.stepId, r.code])).toEqual([["c", "CASCADE_REQUIRED"]]);
    expect(await revision()).toEqual(before);
    expect(await entityTypeKeys()).toEqual(["person"]);
    expect(await relationTypeKeys()).toEqual([]);
    expect(afterDesignChange).not.toHaveBeenCalled();
  });

  it("commits once of two applies against one checked revision", async () => {
    const proposal = { steps: [{ id: "s1", op: "create_entity_type", key: "skill", name: "Skill" }] };
    const expected = (await inject(CHECK, { proposal })).json().baseRevision;
    const answers = await Promise.all([inject(APPLY, { proposal, expected }), inject(APPLY, { proposal, expected })]);
    expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    const refused = answers.find((res) => res.statusCode === 409)!.json();
    expect(refused.error.details).toEqual({ code: "DESIGN_CHANGED", current: { ...expected, revision: expected.revision + 1 } });
    expect(await revision()).toEqual({ ...expected, revision: expected.revision + 1 });
    expect(await entityTypeKeys()).toEqual(["person", "skill"]);
  });

  it("commits every step at once, runs the after-commit work once on a fresh store, and answers a receipt", async () => {
    const expected = (await inject(CHECK, { proposal: ADD_PROJECTS })).json().baseRevision;
    vi.mocked(afterDesignChange).mockClear();
    const res = await inject(APPLY, { proposal: ADD_PROJECTS, expected });
    expect(res.statusCode, res.body).toBe(200);
    const receipt = res.json();
    expect(receipt.revision).toEqual({ ...expected, revision: expected.revision + 1 });
    expect(await revision()).toEqual(receipt.revision);

    const types = await ok("GET", `${MODEL}/entity-types`);
    const project = types.find((t: Row) => t.key === "project");
    expect(project.description).toBe("A piece of work");
    const projectProperties = await ok("GET", `${MODEL}/entity-types/${project.entityTypeId}/properties`);
    const worksOn = (await ok("GET", `${MODEL}/relation-types`)).find((t: Row) => t.key === "works_on");
    expect(worksOn).toMatchObject({ sourceEntityTypeKey: "person", targetEntityTypeKey: "project" });
    const email = (await ok("GET", `${MODEL}/entity-types/${personId}/properties`)).find((p: Row) => p.key === "email");
    expect(email.description).toBe("Where to reach them");
    expect(receipt.created).toEqual({
      "entityTypes.project": project.entityTypeId,
      "entityTypes.project.properties.name": projectProperties.find((p: Row) => p.key === "name").propertyId,
      "entityTypes.project.properties.budget": projectProperties.find((p: Row) => p.key === "budget").propertyId,
      "relationTypes.works_on": worksOn.relationTypeId,
    });

    expect(afterDesignChange).toHaveBeenCalledTimes(1);
    const store = vi.mocked(afterDesignChange).mock.calls[0]![0] as unknown as Row;
    expect(store.ontologyKey).toBe(O);
    expect(store.bound).toBeUndefined();

    // Applied again, the same proposal is refused: its keys exist now.
    const again = await inject(APPLY, { proposal: ADD_PROJECTS, expected: receipt.revision });
    expect(again.json().error.details.check.refusals.map((r: Row) => r.code)).toContain("ALREADY_EXISTS");
  });
});
