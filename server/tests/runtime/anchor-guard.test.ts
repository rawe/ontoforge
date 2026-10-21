/**
 * The anchor rule of a ruleset mount over a mocked store: opening it
 * from the ruleset (plain lens, no anchor, unknown, deleted, hidden by the
 * lens), the anchor's hierarchy (the parent relations around the
 * anchor entity's type; other trees free), "covered", and every rule of the
 * create, update, delete and relation checks with its field key.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { RulesetRecord, WriteAccess } from "../../src/core/ports.js";
import { AnchorGuard, anchorState } from "../../src/runtime/anchorGuard.js";
import type { LoadedSchema, RelationTypeDef, SchemaCacheValue } from "../../src/runtime/schemaCache.js";
import { asRuntimeStore, createMockRuntimeStore, type MockRuntimeStore } from "./helpers.js";

const entityType = (key: string) => ({ key, displayName: key, description: null, nameProperty: null, properties: {} });
const relationType = (key: string, from: string, to: string, parent: "source" | "target" | null): RelationTypeDef => ({
  key,
  displayName: key,
  description: null,
  fromEntityTypeKey: from,
  toEntityTypeKey: to,
  parent,
  properties: {},
});

/** The development fixture's shape. */
const ENTITY_TYPES = ["customer", "project", "task", "milestone", "person", "status"];
const RELATION_TYPES = [
  relationType("has_project", "customer", "project", "source"),
  relationType("has_task", "project", "task", "source"),
  relationType("has_subtask", "task", "task", "source"),
  relationType("belongs_to", "milestone", "project", "target"),
  relationType("manages", "person", "person", "source"),
  relationType("assigned_to", "task", "person", null),
  relationType("mentors", "person", "person", null),
];
const HIERARCHY_READINGS = { has_project: "source", has_task: "source", has_subtask: "source", belongs_to: "target" };

function schemaValue(lensKey: string, entityTypes: string[], relationTypes: RelationTypeDef[]): SchemaCacheValue {
  return {
    lensId: lensKey,
    lensKey,
    lensName: lensKey,
    lensDescription: null,
    entityTypes: Object.fromEntries(entityTypes.map((key) => [key, entityType(key)])),
    relationTypes: Object.fromEntries(relationTypes.map((rt) => [rt.key, rt])),
  };
}

function loaded(lensKey = "all", visible = ENTITY_TYPES): LoadedSchema {
  const scopedRelations = RELATION_TYPES.filter(
    (rt) => visible.includes(rt.fromEntityTypeKey) && visible.includes(rt.toEntityTypeKey),
  );
  return {
    scoped: schemaValue(lensKey, visible, scopedRelations),
    full: schemaValue("all", ENTITY_TYPES, RELATION_TYPES),
    agentConfigs: {},
    savedQueries: {},
    searchIndexScope: { scoped: false, includedIndices: [] },
  };
}

/** ACME › P1 › T1 › T1a, ACME › P2 › T4, M1 › P1 (belongs_to); Lea › Ben. */
const ANCESTORS: Record<string, string[]> = {
  P1: ["ACME"],
  P2: ["ACME"],
  T1: ["P1", "ACME"],
  T1a: ["T1", "P1", "ACME"],
  T4: ["P2", "ACME"],
  M1: ["P1", "ACME"],
  Ben: ["Lea"],
};

let store: MockRuntimeStore;

function anchorAt(
  entity: { type: string; id: string } | null,
  anchorFound = entity !== null,
  writeAccess: WriteAccess = "full",
): void {
  store.rulesetStore.get.mockResolvedValue({ key: "agent-a", anchor: entity, anchorFound, writeAccess });
}

async function open(lens = loaded()): Promise<AnchorGuard> {
  const guard = await AnchorGuard.open("agent-a", lens, asRuntimeStore(store));
  expect(guard).not.toBeNull();
  return guard!;
}

/** The field errors of a refusal thrown by `run`. */
async function refusal(run: () => Promise<unknown>): Promise<Record<string, string>> {
  const error = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).details!.fields as Record<string, string>;
}

beforeEach(() => {
  store = createMockRuntimeStore();
  store.getAncestors.mockImplementation(async (id: string) =>
    (ANCESTORS[id] ?? []).map((ancestor) => ({ type: "x", id: ancestor })),
  );
  store.getEntity.mockImplementation(async (_type: string, id: string) => ({ _id: id }));
  anchorAt({ type: "project", id: "P1" });
});

describe("anchorState", () => {
  const record = (anchor: RulesetRecord["anchor"], anchorFound: boolean): RulesetRecord => ({
    key: "k",
    anchor,
    anchorFound,
    writeAccess: "full",
  });
  const types = loaded().full.entityTypes;

  it("no anchor (null), found, deleted by entity and by type", () => {
    expect(anchorState(record(null, false), types)).toBeNull();
    expect(anchorState(record({ type: "project", id: "P1" }, true), types)).toBe("found");
    expect(anchorState(record({ type: "project", id: "P1" }, false), types)).toBe("deleted");
    expect(anchorState(record({ type: "gone", id: "P1" }, true), types)).toBe("deleted");
  });
});

describe("opening the guard", () => {
  it("the plain lens has no guard and reads no anchor", async () => {
    expect(await AnchorGuard.open(null, loaded(), asRuntimeStore(store))).toBeNull();
    expect(store.rulesetStore.get).not.toHaveBeenCalled();
  });

  it("unanchored has no guard: the plain lens", async () => {
    anchorAt(null);
    expect(await AnchorGuard.open("agent-a", loaded(), asRuntimeStore(store))).toBeNull();
  });

  it("an unknown key is not found", async () => {
    store.rulesetStore.get.mockResolvedValue(null);
    await expect(AnchorGuard.open("agent-a", loaded(), asRuntimeStore(store))).rejects.toThrow(NotFoundError);
  });

  it("dangling, by a deleted entity or a deleted type: 409 with v1's text", async () => {
    const dangling = new ConflictError(
      "Anchor 'agent-a' is dangling: its entity no longer exists, so every write is refused until a person re-anchors it",
    );
    anchorAt({ type: "project", id: "P1" }, false);
    await expect(AnchorGuard.open("agent-a", loaded(), asRuntimeStore(store))).rejects.toThrow(dangling);
    anchorAt({ type: "gone", id: "P1" }, true);
    await expect(AnchorGuard.open("agent-a", loaded(), asRuntimeStore(store))).rejects.toThrow(dangling);
  });

  it("an anchored entity the lens hides: 409 naming only the anchor and the lens", async () => {
    const error = await AnchorGuard.open(
      "agent-a",
      loaded("no_projects", ["customer", "task", "milestone"]),
      asRuntimeStore(store),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    const message = (error as ConflictError).message;
    expect(message).toBe("Anchor 'agent-a' points at an entity that lens 'no_projects' does not show, so every write is refused");
  });
});

describe("write access is not the guard's (writeAccess.ts)", () => {
  it("propose or none, the guard judges the anchor alone", async () => {
    for (const writeAccess of ["none", "propose"] as const) {
      const at = (anchor: RulesetRecord["anchor"], anchorFound: boolean) =>
        store.rulesetStore.get.mockResolvedValue({ key: "agent-a", anchor, anchorFound, writeAccess });
      at({ type: "project", id: "P1" }, true);
      expect(await open(), writeAccess).toBeInstanceOf(AnchorGuard);
      at(null, false);
      expect(await AnchorGuard.open("agent-a", loaded(), asRuntimeStore(store)), writeAccess).toBeNull();
      at({ type: "project", id: "P1" }, false);
      await expect(AnchorGuard.open("agent-a", loaded(), asRuntimeStore(store))).rejects.toThrow(/is dangling/);
    }
  });
});

describe("the staging check (R10)", () => {
  const check = (rulesetKey: string | null, lens = loaded()) =>
    AnchorGuard.checkStaging(rulesetKey, lens, asRuntimeStore(store)).then(
      () => null,
      (e: unknown) => e as Error,
    );

  it("the plain lens reads no anchor", async () => {
    expect(await check(null)).toBeNull();
    expect(store.rulesetStore.get).not.toHaveBeenCalled();
  });

  it("write access 'propose', with or without an anchor, may stage", async () => {
    anchorAt({ type: "project", id: "P1" }, true, "propose");
    expect(await check("agent-a")).toBeNull();
    anchorAt(null, false, "propose");
    expect(await check("agent-a")).toBeNull();
  });

  it("dangling, or an anchored entity the lens hides, is a 409 with no fix hint; an unknown key is not found", async () => {
    anchorAt({ type: "project", id: "P1" }, false, "propose");
    expect(await check("agent-a")).toEqual(new ConflictError("Anchor 'agent-a' is dangling"));
    anchorAt({ type: "project", id: "P1" }, true);
    expect(await check("agent-a", loaded("no_projects", ["customer", "task", "milestone"]))).toEqual(
      new ConflictError("Anchor 'agent-a' points at an entity that lens 'no_projects' does not show"),
    );
    store.rulesetStore.get.mockResolvedValue(null);
    expect(await check("agent-a")).toBeInstanceOf(NotFoundError);
  });
});

describe("entity create", () => {
  it("a hierarchy type under a covered parent passes; the walk follows the hierarchy's parent relations only", async () => {
    const errors: Record<string, string> = {};
    await (await open()).checkCreate("task", { parentId: "T1" }, errors);
    expect(errors).toEqual({});
    expect(store.getAncestors).toHaveBeenCalledWith("T1", HIERARCHY_READINGS);
  });

  it("the anchor entity itself is a covered parent, without a walk", async () => {
    const errors: Record<string, string> = {};
    await (await open()).checkCreate("task", { parentId: "P1" }, errors);
    expect(errors).toEqual({});
    expect(store.getAncestors).not.toHaveBeenCalled();
  });

  it("a parent outside the subtree: parentRelation.parentId", async () => {
    const errors: Record<string, string> = {};
    await (await open()).checkCreate("task", { parentId: "P2" }, errors);
    expect(errors).toEqual({ "parentRelation.parentId": "Entity 'P2' is not under anchor 'agent-a'" });
  });

  it("no parent relation: parentRelation", async () => {
    const errors: Record<string, string> = {};
    await (await open()).checkCreate("task", null, errors);
    expect(Object.keys(errors)).toEqual(["parentRelation"]);
  });

  it("a parent relation validation already refused is not walked", async () => {
    const errors: Record<string, string> = { "parentRelation.type": "Relation type 'x' not found" };
    await (await open()).checkCreate("task", { parentId: "P2" }, errors);
    expect(Object.keys(errors)).toEqual(["parentRelation.type"]);
    expect(store.getAncestors).not.toHaveBeenCalled();
  });

  it("a type with no parent relation into it, or only hidden ones: entityTypeKey, the same text", async () => {
    const customer: Record<string, string> = {};
    await (await open()).checkCreate("customer", null, customer);
    expect(customer).toEqual({ entityTypeKey: "Entity type 'customer' cannot be placed under anchor 'agent-a'" });

    anchorAt({ type: "customer", id: "ACME" });
    const milestone: Record<string, string> = {};
    await (await open(loaded("no_projects", ["customer", "task", "milestone"]))).checkCreate(
      "milestone",
      { parentId: "P1" },
      milestone,
    );
    expect(milestone).toEqual({ entityTypeKey: "Entity type 'milestone' cannot be placed under anchor 'agent-a'" });
  });

  it("free types, another hierarchy's among them, are created as on the plain lens", async () => {
    const guard = await open();
    for (const type of ["person", "status"]) {
      const errors: Record<string, string> = {};
      await guard.checkCreate(type, null, errors);
      expect(errors).toEqual({});
    }
  });
});

describe("entity update, edit and delete", () => {
  it("covered and free entities pass", async () => {
    const guard = await open();
    expect(await guard.entityError("project", "P1")).toBeNull();
    expect(await guard.entityError("task", "T1a")).toBeNull();
    expect(await guard.entityError("person", "Ben")).toBeNull();
  });

  it("a hierarchy entity outside the subtree, above it included: entityId", async () => {
    const guard = await open();
    expect(await refusal(() => guard.checkEntity("task", "T4"))).toEqual({
      entityId: "Entity 'T4' is not under anchor 'agent-a'",
    });
    expect(await refusal(() => guard.checkEntity("customer", "ACME"))).toEqual({
      entityId: "Entity 'ACME' is not under anchor 'agent-a'",
    });
  });

  it("a missing hierarchy entity stays not found", async () => {
    store.getEntity.mockResolvedValue(null);
    await expect((await open()).checkEntity("task", "nope")).rejects.toThrow(NotFoundError);
  });

  it("delete: outside wins over frozen", async () => {
    store.rulesetStore.list.mockResolvedValue([{ key: "agent-b", anchor: { type: "task", id: "T4" }, anchorFound: true }]);
    expect(await refusal(async () => (await open()).checkDelete("task", "T4"))).toEqual({
      entityId: "Entity 'T4' is not under anchor 'agent-a'",
    });
  });

  it("delete: an entity any anchor points at is frozen, a free one too", async () => {
    store.rulesetStore.list.mockResolvedValue([
      { key: "agent-a", anchor: { type: "project", id: "P1" }, anchorFound: true },
      { key: "agent-b", anchor: { type: "person", id: "Ben" }, anchorFound: true },
    ]);
    const guard = await open();
    for (const [type, id] of [
      ["project", "P1"],
      ["person", "Ben"],
    ]) {
      const fields = await refusal(() => guard.checkDelete(type!, id!));
      expect(fields.entityId).toBe(`Entity '${id}' is anchored and cannot be deleted on an anchored connection`);
    }
    await guard.checkDelete("task", "T1a");
  });
});

describe("relation create", () => {
  const rt = (key: string) => RELATION_TYPES.find((r) => r.key === key)!;

  it("a standalone parent relation of the hierarchy: relationTypeKey", async () => {
    const errors: Record<string, string> = {};
    await (await open()).checkRelationCreate(rt("has_subtask"), "T1", "R2", errors);
    expect(Object.keys(errors)).toEqual(["relationTypeKey"]);
  });

  it("covered → free and free → free pass; another hierarchy's parent relation is free", async () => {
    const guard = await open();
    const errors: Record<string, string> = {};
    await guard.checkRelationCreate(rt("assigned_to"), "T1", "Kim", errors);
    await guard.checkRelationCreate(rt("mentors"), "Ben", "Ana", errors);
    await guard.checkRelationCreate(rt("manages"), "Lea", "Neu", errors);
    expect(errors).toEqual({});
  });

  it("an end outside the subtree: fromEntityId or toEntityId", async () => {
    const errors: Record<string, string> = {};
    await (await open()).checkRelationCreate(rt("assigned_to"), "T4", "Kim", errors);
    expect(errors).toEqual({ fromEntityId: "Entity 'T4' is not under anchor 'agent-a'" });
  });

  it("an end with an endpoint fault is not walked", async () => {
    const errors: Record<string, string> = { fromEntityId: "Source entity 'T4' not found" };
    await (await open()).checkRelationCreate(rt("assigned_to"), "T4", "Kim", errors);
    expect(errors).toEqual({ fromEntityId: "Source entity 'T4' not found" });
  });
});

describe("relation update and delete", () => {
  const rt = (key: string) => RELATION_TYPES.find((r) => r.key === key)!;
  const relation = (fromEntityId: string, toEntityId: string) =>
    store.getRelation.mockResolvedValue({ _id: "r1", fromEntityId, toEntityId });

  it("a hierarchy parent relation: update when its child is covered", async () => {
    const guard = await open();
    relation("P1", "T1");
    expect(await guard.relationError(rt("has_task"), "r1", "update")).toBeNull();
    relation("P2", "T4");
    expect(await guard.relationError(rt("has_task"), "r1", "update")).toBe("Relation 'r1' is not under anchor 'agent-a'");
    // Up-pointing: the child is the source.
    relation("M1", "P1");
    expect(await guard.relationError(rt("belongs_to"), "r1", "update")).toBeNull();
  });

  it("a hierarchy parent relation is never deleted: relationId", async () => {
    relation("P1", "T1");
    expect(Object.keys(await refusal(async () => (await open()).checkRelationDelete(rt("has_task"), "r1")))).toEqual([
      "relationId",
    ]);
  });

  it("an ordinary relation: each end free or covered", async () => {
    const guard = await open();
    relation("T1", "Kim");
    expect(await guard.relationError(rt("assigned_to"), "r1", "delete")).toBeNull();
    relation("T4", "Kim");
    expect(await guard.relationError(rt("assigned_to"), "r1", "update")).toBe("Relation 'r1' is not under anchor 'agent-a'");
    relation("Lea", "Ben");
    await guard.checkRelationDelete(rt("manages"), "r1");
  });

  it("a missing relation stays not found", async () => {
    store.getRelation.mockResolvedValue(null);
    await expect((await open()).checkRelationDelete(rt("assigned_to"), "r1")).rejects.toThrow(NotFoundError);
  });
});
