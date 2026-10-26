/**
 * Staging into a changeset over mocked stores: the binding and expiry of a
 * changeset, the anchor refusal, the immediate write's checks, minted ids,
 * how each call merges into the set (one object per entity or relation,
 * one value per property), the before at first touch, document edits on
 * the staged text, the delete cascade, the caps, and unstage, cut, rebase
 * and discard.
 */

import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { settings } from "../../src/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { ChangesetRecord, StagedObjectRecord } from "../../src/core/ports.js";
import {
  MAX_STAGED_OBJECTS,
  discardChangeset,
  rebase,
  recordedBefore,
  recordedDocument,
  stage,
  startChangeset,
  unstage,
  valueBytes,
  type StagedWrite,
} from "../../src/runtime/changesets.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import type { DocumentEditBody } from "../../src/runtime/service.js";
import {
  NOW,
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeRelation,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, any>;

const CS = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222";
const ACME = "33333333-3333-4333-8333-333333333333";
const R1 = "44444444-4444-4444-8444-444444444444";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The helper schema (lens `full_lens`, id `lens-1`), with `belongs_to`
 * (department → company) as a parent relation whose parent is the target,
 * with a string property `since`, and a type `note` with a document
 * property. */
function schema(): Row {
  const full = makeUnscopedSchema() as Row;
  const belongsTo = full.relationTypes.find((rt: Row) => rt.key === "belongs_to");
  belongsTo.parent = "target";
  belongsTo.properties = [
    { key: "since", displayName: "Since", dataType: "string", required: false, defaultValue: null },
  ];
  full.entityTypes.push({
    entityTypeId: "et-9",
    key: "note",
    displayName: "Note",
    description: null,
    nameProperty: "name",
    properties: [
      { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
      { key: "body", displayName: "Body", dataType: "document", required: false, defaultValue: null },
    ],
  });
  return full;
}

function changeset(overrides: Partial<ChangesetRecord> = {}): ChangesetRecord {
  return {
    id: CS,
    lensId: "lens-1",
    number: 1,
    rulesetKey: null,
    version: 3,
    note: null,
    submittedAt: null,
    createdAt: NOW,
    lastChangeAt: new Date(),
    objectCount: 0,
    ...overrides,
  };
}

/** A staged object as the store keeps it. */
function staged(overrides: Partial<StagedObjectRecord>): StagedObjectRecord {
  return {
    objectId: P1,
    kind: "entity",
    typeKey: "person",
    action: "create",
    fromId: null,
    toId: null,
    identity: null,
    firstTouchedAt: NOW,
    values: [],
    ...overrides,
  };
}

/** A staged value as the store keeps it. */
function value(propertyKey: string, v: unknown, before: Row | null = null) {
  return { propertyKey, value: v, before, bytes: valueBytes(v, before) };
}

let store: MockRuntimeStore;

beforeEach(() => {
  invalidateLoadedSchemaCache();
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema());
  store.changesetStore.seed(changeset());
});

function stageOn(write: StagedWrite, rulesetKey: string | null = null) {
  return stage("full_lens", rulesetKey, CS, write, asRuntimeStore(store));
}

/** The staged objects now, by first touch. */
function objects(): StagedObjectRecord[] {
  return store.changesetStore.stored(CS);
}

/** The one staged object. */
function only(): StagedObjectRecord {
  const all = objects();
  expect(all).toHaveLength(1);
  return all[0]!;
}

/** The version the store holds now. */
async function version(): Promise<number> {
  return (await store.changesetStore.get(CS, "lens-1", null))!.version;
}

/** A department created under the company ACME. */
const UNDER_ACME: StagedWrite = {
  operation: "create_entity",
  typeKey: "department",
  properties: { name: "R&D" },
  parentRelation: { type: "belongs_to", parentId: ACME, properties: { since: "2020" } },
};

const ANN = makeEntity({ name: "Ann", age: 41, email: null, active: true }, "person", P1);

function expectNothingWritten(): void {
  expect(store.changesetStore.apply).not.toHaveBeenCalled();
  for (const method of [
    "createEntity",
    "createEntityWithParent",
    "updateEntity",
    "deleteEntity",
    "createRelation",
    "updateRelation",
    "deleteRelation",
  ] as const) {
    expect(store[method]).not.toHaveBeenCalled();
  }
}

describe("start", () => {
  it("binds the lens id and the ruleset key of the URL, sweeps expired changesets, answers draft", async () => {
    store.rulesetStore.get.mockResolvedValue({ key: "agent-a", anchor: null, anchorFound: false });
    const started = await startChangeset("full_lens", "agent-a", "g1", asRuntimeStore(store));
    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);
    expect(store.changesetStore.sweep).toHaveBeenCalledWith(7 * 24 * 3_600_000);
    const [input] = store.changesetStore.start.mock.calls[0]!;
    expect(input).toMatchObject({ lensId: "lens-1", rulesetKey: "agent-a", note: "g1" });
    expect(input.id).toMatch(UUID);
    expect(started).toMatchObject({ state: "draft", version: 1, note: "g1", ruleset: "agent-a", objectCount: 0 });
  });

  it("an unknown ruleset is not found; a note over 1000 characters is a 422; neither starts one", async () => {
    await expect(startChangeset("full_lens", "nope", null, asRuntimeStore(store))).rejects.toThrow(
      new NotFoundError("Ruleset 'nope' not found"),
    );
    const promise = startChangeset("full_lens", null, "x".repeat(1001), asRuntimeStore(store));
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ details: { fields: { note: expect.stringContaining("1000") } } });
    await expect(startChangeset("full_lens", null, "x".repeat(1000), asRuntimeStore(store))).resolves.toMatchObject({
      state: "draft",
    });
    expect(store.changesetStore.start).toHaveBeenCalledTimes(1);
  });
});

describe("binding and expiry", () => {
  it("loads through the lens id and the URL's ruleset key; unknown is the one not-found text", async () => {
    store.rulesetStore.get.mockResolvedValue({ key: "agent-a", anchor: null, anchorFound: false });
    await expect(stageOn({ operation: "delete_entity", typeKey: "person", id: P1 }, "agent-a")).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' not found`),
    );
    expect(store.changesetStore.get).toHaveBeenCalledWith(CS, "lens-1", "agent-a");
    expectNothingWritten();
  });

  it("an expired draft changeset is swept and not found; a submitted one of the same age is kept", async () => {
    const old = new Date(Date.now() - 8 * 24 * 3_600_000);
    store.changesetStore.seed(changeset({ lastChangeAt: old }));
    await expect(stageOn({ operation: "delete_entity", typeKey: "person", id: P1 })).rejects.toThrow(
      `Changeset '${CS}' not found`,
    );
    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);
    expect(await store.changesetStore.get(CS, "lens-1", null)).toBeNull();

    store.changesetStore.seed(changeset({ lastChangeAt: old, submittedAt: NOW }));
    await expect(stageOn({ operation: "delete_entity", typeKey: "person", id: P1 })).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is submitted; unsubmit it first`),
    );
    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);
  });
});

describe("staging checks", () => {
  it("a deleted anchor, or one at an entity the lens hides, is a 409 with nothing staged", async () => {
    store.rulesetStore.get.mockResolvedValue({ key: "agent-a", anchor: { type: "company", id: ACME }, anchorFound: false });
    store.changesetStore.seed(changeset({ rulesetKey: "agent-a" }));
    await expect(
      stageOn({ operation: "update_entity", typeKey: "company", id: ACME, properties: { name: "X" } }, "agent-a"),
    ).rejects.toBeInstanceOf(ConflictError);
    expectNothingWritten();
  });

  it("a ruleset URL runs no coverage rule: a create outside the anchor is staged", async () => {
    store.rulesetStore.get.mockResolvedValue({ key: "agent-a", anchor: { type: "company", id: ACME }, anchorFound: true });
    store.changesetStore.seed(changeset({ rulesetKey: "agent-a" }));
    const answer = await stageOn(
      { operation: "create_entity", typeKey: "department", properties: { name: "R&D" }, parentRelation: null },
      "agent-a",
    );
    expect(answer.id).toMatch(UUID);
    expect(store.getAncestors).not.toHaveBeenCalled();
  });

  it("the immediate write's 422 field errors, collected, and nothing staged", async () => {
    const promise = stageOn({
      operation: "create_entity",
      typeKey: "person",
      properties: { age: "old", bogus: 1 },
      parentRelation: null,
    });
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({
      message: "Instance validation failed",
      details: {
        fields: {
          bogus: "Unknown property: not defined in type 'person'",
          name: "Required property missing",
          age: expect.stringContaining("Expected integer"),
        },
      },
    });
    expectNothingWritten();
  });

  it("an unknown type is the immediate write's 404", async () => {
    await expect(stageOn({ operation: "delete_entity", typeKey: "ghost", id: P1 })).rejects.toThrow(
      new NotFoundError("Entity type 'ghost' not found"),
    );
    await expect(stageOn({ operation: "update_relation", typeKey: "ghost", id: P1, properties: {} })).rejects.toThrow(
      new NotFoundError("Relation type 'ghost' not found"),
    );
    expectNothingWritten();
  });

  it("the object cap: an object past it is a 409; a merge into a staged object is not", async () => {
    store.changesetStore.seed(changeset(), [staged({ action: "create", values: [value("name", "A")] })]);
    store.changesetStore.get.mockResolvedValue(changeset({ objectCount: MAX_STAGED_OBJECTS }));
    await expect(
      stageOn({ operation: "create_entity", typeKey: "person", properties: { name: "B" }, parentRelation: null }),
    ).rejects.toThrow(new ConflictError(`Changeset '${CS}' is full: at most 10000 staged objects`));
    await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { age: 3 } });
    expect(only().values.map((v) => v.propertyKey)).toEqual(["age", "name"]);
  });

  it("the object cap counts both objects of a create with a parent relation", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ objectCount: MAX_STAGED_OBJECTS - 1 }));
    await expect(stageOn(UNDER_ACME)).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is full: at most 10000 staged objects`),
    );
    expectNothingWritten();
    await stageOn({ operation: "create_entity", typeKey: "department", properties: { name: "R&D" }, parentRelation: null });
    expect(objects()).toHaveLength(1);
  });

  it("the byte cap counts the current bytes of the values: a merge past it is a 409, one reaching it is staged", async () => {
    const body = "ä".repeat(1000);
    const write: StagedWrite = { operation: "create_entity", typeKey: "note", properties: { name: "N", body }, parentRelation: null };
    const bytes = valueBytes("N", null) + valueBytes(body, null);
    // Document text counts as UTF-8: two bytes per "ä".
    expect(valueBytes(body, null)).toBe(2002);
    store.changesetStore.stagedBytes.mockResolvedValue(settings.CHANGESET_MAX_BYTES - bytes + 1);
    await expect(stageOn(write)).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is full: at most ${settings.CHANGESET_MAX_BYTES} bytes of staged values`),
    );
    expectNothingWritten();
    store.changesetStore.stagedBytes.mockResolvedValue(settings.CHANGESET_MAX_BYTES - bytes);
    const { id } = await stageOn(write);
    expect(store.changesetStore.stagedBytes).toHaveBeenCalledWith(CS);

    // Replacing the document counts only what it adds over the old value.
    store.changesetStore.stagedBytes.mockResolvedValue(settings.CHANGESET_MAX_BYTES);
    await stageOn({ operation: "update_entity", typeKey: "note", id, properties: { body: "short" } });
    await expect(
      stageOn({ operation: "update_entity", typeKey: "note", id, properties: { body: body + "x" } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("valueBytes: the UTF-8 bytes of the value and the before as JSON", () => {
    expect(valueBytes("é", null)).toBe('"é"'.length + 1);
    expect(valueBytes(null, { value: "A" })).toBe('null{"value":"A"}'.length);
  });

  it("a change landing between the read and the write is a 409, nothing written; gone is not found", async () => {
    store.changesetStore.get.mockResolvedValueOnce(changeset({ version: 2 }));
    await expect(
      stageOn({ operation: "create_entity", typeKey: "person", properties: { name: "A" }, parentRelation: null }),
    ).rejects.toThrow(new ConflictError(`Changeset '${CS}' changed meanwhile; try again`));
    expect(objects()).toEqual([]);

    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(null);
    store.changesetStore.apply.mockResolvedValueOnce(null);
    await expect(
      stageOn({ operation: "create_entity", typeKey: "person", properties: { name: "A" }, parentRelation: null }),
    ).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
  });

  it("a submit landing after the read: the store refuses, and it is a 409", async () => {
    store.changesetStore.get
      .mockResolvedValueOnce(changeset())
      .mockResolvedValueOnce(changeset({ submittedAt: NOW }));
    store.changesetStore.apply.mockResolvedValueOnce(null);
    await expect(
      stageOn({ operation: "create_entity", typeKey: "person", properties: { name: "A" }, parentRelation: null }),
    ).rejects.toThrow(new ConflictError(`Changeset '${CS}' is submitted; unsubmit it first`));
  });
});

describe("creates", () => {
  it("an entity create: one object with a final id, one value per key sent, after coercion, no before, no defaults", async () => {
    const before = await version();
    const answer = await stageOn({
      operation: "create_entity",
      typeKey: "person",
      properties: { name: "Ann", age: "41" },
      parentRelation: null,
    });
    const object = only();
    expect(object).toMatchObject({ kind: "entity", typeKey: "person", action: "create", fromId: null, toId: null });
    expect(object.objectId).toMatch(UUID);
    // Defaults are left to the commit: `active` was not sent.
    expect(object.values).toEqual([value("age", 41), value("name", "Ann")]);
    expect(answer).toEqual({ id: object.objectId });
    expect(await version()).toBe(before + 1);
    expect(store.createEntity).not.toHaveBeenCalled();
  });

  it("with a parent relation: two objects, the entity first, the relation oriented by its parent end", async () => {
    const answer = await stageOn(UNDER_ACME);
    const [entity, relation] = objects();
    expect(entity).toMatchObject({ kind: "entity", typeKey: "department", action: "create", values: [value("name", "R&D")] });
    // The parent ACME is the target.
    expect(relation).toMatchObject({
      kind: "relation",
      typeKey: "belongs_to",
      action: "create",
      fromId: entity!.objectId,
      toId: ACME,
      values: [value("since", "2020")],
    });
    expect(answer).toEqual({ id: entity!.objectId, relation: { id: relation!.objectId } });
    expect(store.getEntityById).not.toHaveBeenCalled();
  });

  it("a parent relation's faults are the immediate write's, under parentRelation.*", async () => {
    await expect(
      stageOn({
        operation: "create_entity",
        typeKey: "department",
        properties: { name: "R&D" },
        parentRelation: { type: "works_for", parentId: ACME },
      }),
    ).rejects.toMatchObject({
      details: { fields: { "parentRelation.type": "Relation type 'works_for' is not a parent relation" } },
    });
  });

  it("a relation create records its ends; they are not read", async () => {
    const answer = await stageOn({
      operation: "create_relation",
      typeKey: "works_for",
      fromEntityId: P1,
      toEntityId: ACME,
      properties: { role: "dev" },
    });
    expect(only()).toMatchObject({ kind: "relation", action: "create", fromId: P1, toId: ACME, values: [value("role", "dev")] });
    expect(answer.id).toBe(only().objectId);
    expect(store.getEntity).not.toHaveBeenCalled();
  });
});

describe("updates of a stored object: the before at first touch", () => {
  it("one update object; each key's before is the stored value, absent kept apart from null", async () => {
    store.getEntity.mockResolvedValue(ANN);
    const answer = await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { age: 42, email: "a@b.c" } });
    expect(answer).toEqual({ id: P1 });
    expect(only()).toMatchObject({ objectId: P1, kind: "entity", action: "update" });
    expect(only().values).toEqual([value("age", 42, { value: 41 }), value("email", "a@b.c", { value: null })]);
    expect(store.getEntity).toHaveBeenCalledWith("person", P1);
  });

  it("a later update replaces the staged value and keeps the first before; a new key records the stored value now", async () => {
    store.getEntity.mockResolvedValue(ANN);
    await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { age: 42 } });
    // Someone changes the stored entity meanwhile.
    store.getEntity.mockResolvedValue({ ...ANN, age: 50 });
    await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { age: 43, name: "Anna" } });
    expect(only().values).toEqual([value("age", 43, { value: 41 }), value("name", "Anna", { value: "Ann" })]);
  });

  it("a null removes the property: staged as JSON null with its before; a key the target lacks has the empty before", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Ann" }, "person", P1));
    await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { age: null } });
    expect(only().values).toEqual([value("age", null, {})]);
  });

  it("a document before is its hash and its length in characters", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "N", body: "old text 😀" }, "note", P1));
    await stageOn({ operation: "update_entity", typeKey: "note", id: P1, properties: { body: "new text" } });
    const hash = createHash("sha256").update("old text 😀").digest("hex");
    expect(only().values).toEqual([value("body", "new text", { value: { sha256: hash, length: 10 } })]);
  });

  it("a relation update records the stored ends; the endpoint keys are dropped as on the immediate write", async () => {
    store.getRelation.mockResolvedValue(makeRelation({ role: "dev" }, { relationId: R1, fromEntityId: P1, toEntityId: ACME }));
    await stageOn({ operation: "update_relation", typeKey: "works_for", id: R1, properties: { role: "lead", fromEntityId: ACME } });
    expect(only()).toMatchObject({ objectId: R1, kind: "relation", action: "update", fromId: P1, toId: ACME });
    expect(only().values).toEqual([value("role", "lead", { value: "dev" })]);
    expect(store.getRelation).toHaveBeenCalledWith("works_for", R1);
  });

  it("an update that changes nothing stages nothing and leaves the version", async () => {
    store.getEntity.mockResolvedValue(ANN);
    const before = await version();
    await expect(stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: {} })).resolves.toEqual({ id: P1 });
    expect(objects()).toEqual([]);
    expect(await version()).toBe(before);
  });

  it("a missing target is the immediate write's 404, after the field errors; an object of another type is not the target", async () => {
    await expect(stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { name: "B" } })).rejects.toThrow(
      new NotFoundError(`Entity '${P1}' not found`),
    );
    await expect(stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { name: null } })).rejects.toBeInstanceOf(
      ValidationError,
    );
    store.changesetStore.seed(changeset(), [staged({ action: "create", values: [value("name", "A")] })]);
    await expect(stageOn({ operation: "delete_entity", typeKey: "company", id: P1 })).rejects.toThrow(
      new NotFoundError(`Entity '${P1}' not found`),
    );
    await expect(stageOn({ operation: "delete_relation", typeKey: "works_for", id: P1 })).rejects.toThrow(
      new NotFoundError(`Relation '${P1}' not found`),
    );
    expectNothingWritten();
  });
});

describe("merging into a create, and deletes", () => {
  beforeEach(() => {
    store.changesetStore.seed(changeset(), [
      staged({ action: "create", values: [value("age", 3), value("name", "A")] }),
    ]);
  });

  it("an update of an object created here merges into its values with no before; a null removes a value; nothing is read", async () => {
    await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { name: "B", age: null, email: "e" } });
    expect(only()).toMatchObject({ action: "create" });
    expect(only().values).toEqual([value("email", "e"), value("name", "B")]);
    expect(store.getEntity).not.toHaveBeenCalled();
  });

  it("a delete of an object created here takes it out of the set", async () => {
    await expect(stageOn({ operation: "delete_entity", typeKey: "person", id: P1 })).resolves.toEqual({ id: P1 });
    expect(objects()).toEqual([]);
  });

  it("a delete of a stored object: its object becomes a delete and its values are dropped", async () => {
    store.changesetStore.seed(changeset(), [staged({ action: "update", values: [value("age", 4, { value: 41 })] })]);
    store.getEntity.mockResolvedValue(ANN);
    await stageOn({ operation: "delete_entity", typeKey: "person", id: P1 });
    expect(only()).toMatchObject({ objectId: P1, action: "delete", values: [] });

    store.getRelation.mockResolvedValue(makeRelation({}, { relationId: R1, fromEntityId: P1, toEntityId: ACME }));
    await stageOn({ operation: "delete_relation", typeKey: "works_for", id: R1 });
    expect(objects()[1]).toMatchObject({ objectId: R1, kind: "relation", action: "delete", fromId: P1, toId: ACME });
  });

  it("an update, delete or edit of an object deleted here is the immediate write's 404", async () => {
    store.changesetStore.seed(changeset(), [staged({ action: "delete" })]);
    store.getEntity.mockResolvedValue(ANN);
    for (const write of [
      { operation: "update_entity", typeKey: "person", id: P1, properties: { name: "B" } },
      { operation: "delete_entity", typeKey: "person", id: P1 },
    ] as StagedWrite[]) {
      await expect(stageOn(write)).rejects.toThrow(new NotFoundError(`Entity '${P1}' not found`));
    }
    expect(only()).toMatchObject({ action: "delete" });
  });

  it("an entity delete takes out every staged relation at that entity and answers their ids as cascaded", async () => {
    const OTHER = "55555555-5555-4555-8555-555555555555";
    store.changesetStore.seed(changeset(), [
      staged({ action: "create", values: [value("name", "A")] }),
      staged({ objectId: R1, kind: "relation", typeKey: "works_for", action: "create", fromId: P1, toId: ACME }),
      staged({ objectId: OTHER, kind: "relation", typeKey: "works_for", action: "update", fromId: ACME, toId: P1, values: [value("role", "x", {})] }),
      staged({ objectId: ACME, typeKey: "company", action: "update", values: [value("name", "Acme", { value: "A" })] }),
    ]);
    const answer = await stageOn({ operation: "delete_entity", typeKey: "person", id: P1 });
    expect(answer).toEqual({ id: P1, cascaded: [R1, OTHER] });
    expect(objects().map((o) => o.objectId)).toEqual([ACME]);

    // A stored entity: the delete stays, the relations at it go.
    store.changesetStore.seed(changeset(), [
      staged({ objectId: R1, kind: "relation", typeKey: "works_for", action: "create", fromId: P1, toId: ACME }),
    ]);
    store.getEntity.mockResolvedValue(ANN);
    expect(await stageOn({ operation: "delete_entity", typeKey: "person", id: P1 })).toEqual({ id: P1, cascaded: [R1] });
    expect(only()).toMatchObject({ objectId: P1, action: "delete" });
  });
});

describe("edit_document", () => {
  const NOTE = makeEntity({ name: "N", body: "Hello world" }, "note", P1);
  const edit = (body: Row, id = P1): StagedWrite => ({
    operation: "edit_document",
    typeKey: "note",
    id,
    propertyKey: "body",
    edit: body as DocumentEditBody,
  });

  it("applies str_replace to the stored text and stages the whole result, the before the stored hash", async () => {
    store.getEntity.mockResolvedValue(NOTE);
    const answer = await stageOn(edit({ op: "str_replace", oldString: "world", newString: "there" }));
    expect(answer).toEqual({
      id: P1,
      propertyKey: "body",
      totalLength: 11,
      editedRange: { offset: 6, length: 5 },
      replacements: 1,
      context: "Hello there",
      contextOffset: 0,
    });
    expect(only()).toMatchObject({ action: "update" });
    expect(only().values).toEqual([value("body", "Hello there", { value: recordedDocument("Hello world") })]);
    expect(store.updateEntity).not.toHaveBeenCalled();
  });

  it("a second edit applies to the staged text; the before stays the first touch's", async () => {
    store.getEntity.mockResolvedValue(NOTE);
    await stageOn(edit({ op: "str_replace", oldString: "world", newString: "there" }));
    store.getEntity.mockResolvedValue({ ...NOTE, body: "changed meanwhile" });
    await stageOn(edit({ op: "replace_range", offset: 11, length: 0, content: "!" }));
    expect(only().values).toEqual([value("body", "Hello there!", { value: recordedDocument("Hello world") })]);
  });

  it("on an entity created here: the staged text, or the empty text without one; no before", async () => {
    store.changesetStore.seed(changeset(), [staged({ typeKey: "note", values: [value("name", "N")] })]);
    await stageOn(edit({ op: "replace_range", offset: 0, length: 0, content: "Draft" }));
    await stageOn(edit({ op: "str_replace", oldString: "Draft", newString: "Final" }));
    expect(only()).toMatchObject({ action: "create" });
    expect(only().values).toEqual([value("body", "Final"), value("name", "N")]);
    expect(store.getEntity).not.toHaveBeenCalled();
  });

  it("the immediate edit's faults: a miss is a 422, an expect mismatch a 409; nothing staged", async () => {
    store.getEntity.mockResolvedValue(NOTE);
    await expect(stageOn(edit({ op: "str_replace", oldString: "nope", newString: "x" }))).rejects.toThrow(
      new ValidationError("oldString not found in document"),
    );
    await expect(stageOn(edit({ op: "replace_range", offset: 0, length: 5, content: "x", expect: "Howdy" }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(stageOn(edit({ op: "replace_range", offset: 99, length: 0, content: "x" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expectNothingWritten();
  });

  it("the document read's 404s: a type, a property that is no document, an entity missing or deleted here", async () => {
    await expect(stageOn({ ...edit({ op: "str_replace" }), typeKey: "ghost" })).rejects.toThrow(
      new NotFoundError("Entity type 'ghost' not found"),
    );
    await expect(stageOn({ ...edit({ op: "str_replace" }), propertyKey: "name" } as StagedWrite)).rejects.toThrow(
      new NotFoundError("Document property 'name' not found on entity type 'note'"),
    );
    await expect(stageOn(edit({ op: "str_replace", oldString: "a", newString: "b" }))).rejects.toThrow(
      new NotFoundError(`Entity '${P1}' not found`),
    );
    store.changesetStore.seed(changeset(), [staged({ typeKey: "note", action: "delete" })]);
    store.getEntity.mockResolvedValue(NOTE);
    await expect(stageOn(edit({ op: "str_replace", oldString: "world", newString: "x" }))).rejects.toThrow(
      new NotFoundError(`Entity '${P1}' not found`),
    );
  });

  it("read-modify-write: another change between the read and the write is a 409, nothing written", async () => {
    store.getEntity.mockResolvedValue(NOTE);
    store.changesetStore.get.mockResolvedValueOnce(changeset({ version: 2 }));
    await expect(stageOn(edit({ op: "str_replace", oldString: "world", newString: "there" }))).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' changed meanwhile; try again`),
    );
    expect(objects()).toEqual([]);
  });
});

describe("recordedBefore", () => {
  it("keeps raw values and a stored null; an absent key is the empty before; a document is its fingerprint", () => {
    expect(recordedBefore({ a: 1, b: null, c: { x: 1 } }, "c", {})).toEqual({ value: { x: 1 } });
    expect(recordedBefore({ b: null }, "b", {})).toEqual({ value: null });
    expect(recordedBefore({}, "d", {})).toEqual({});
    const defs = { body: { key: "body", displayName: "Body", dataType: "document", required: false, defaultValue: null } };
    expect(recordedBefore({ body: "text" }, "body", defs as never)).toEqual({ value: recordedDocument("text") });
  });
});

describe("unstage, cut, rebase", () => {
  const unstageOn = (objectId: string, property: string | null = null, rulesetKey: string | null = null) =>
    unstage("full_lens", rulesetKey, CS, objectId, property, asRuntimeStore(store));
  const rebaseOn = (objectId: string, properties: string[] | null = null) =>
    rebase("full_lens", null, CS, objectId, properties, asRuntimeStore(store));

  beforeEach(() => {
    store.changesetStore.seed(changeset(), [
      staged({ action: "create", values: [value("age", 3), value("name", "A")] }),
      staged({ objectId: ACME, typeKey: "company", action: "update", values: [value("name", "Acme", { value: "Old" })] }),
    ]);
  });

  it("unstage takes an object out with its values and raises the version; a deleted anchor does not stop it", async () => {
    store.rulesetStore.get.mockResolvedValue({ key: "a", anchor: { type: "company", id: ACME }, anchorFound: false });
    store.changesetStore.seed(changeset({ rulesetKey: "a" }), store.changesetStore.stored(CS));
    const before = await version();
    await unstageOn(P1, null, "a");
    expect(objects().map((o) => o.objectId)).toEqual([ACME]);
    expect(await version()).toBe(before + 1);
  });

  it("an object or value not staged is not found", async () => {
    await expect(unstageOn(R1)).rejects.toThrow(new NotFoundError(`Object '${R1}' is not staged in changeset '${CS}'`));
    await expect(unstageOn(P1, "email")).rejects.toThrow(
      new NotFoundError(`No value of 'email' is staged for object '${P1}' in changeset '${CS}'`),
    );
    expect(store.changesetStore.apply).not.toHaveBeenCalled();
  });

  it("cut takes one value out; an update left without values goes too, a create stays", async () => {
    await unstageOn(P1, "age");
    expect(objects()[0]!.values).toEqual([value("name", "A")]);
    await unstageOn(P1, "name");
    expect(objects()[0]).toMatchObject({ objectId: P1, action: "create", values: [] });
    await unstageOn(ACME, "name");
    expect(objects().map((o) => o.objectId)).toEqual([P1]);
  });

  it("unstaging a delete brings nothing back", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Old" }, "company", ACME));
    await stageOn({ operation: "delete_entity", typeKey: "company", id: ACME });
    await unstageOn(ACME);
    expect(objects().map((o) => o.objectId)).toEqual([P1]);
  });

  it("rebase: the before of the named values becomes the stored value now, the staged values stay", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Newer" }, "company", ACME));
    store.getEntitiesByIdsHashed.mockResolvedValue({ [ACME]: makeEntity({ name: "Newer" }, "company", ACME) });
    const view = await rebaseOn(ACME);
    expect(objects()[1]!.values).toEqual([value("name", "Acme", { value: "Newer" })]);
    expect(view).toMatchObject({
      id: ACME,
      action: "update",
      markers: [],
      values: [{ property: "name", before: "Newer", current: "Newer", after: "Acme", markers: [] }],
    });
  });

  it("rebase of a create or delete is a 409; a key not staged or a target gone is not found", async () => {
    await expect(rebaseOn(P1)).rejects.toThrow(
      new ConflictError("Only an update of a stored object can be rebased; this object is a create"),
    );
    await expect(rebaseOn(ACME, ["code"])).rejects.toThrow(
      new NotFoundError(`No value of 'code' is staged for object '${ACME}' in changeset '${CS}'`),
    );
    await expect(rebaseOn(ACME)).rejects.toThrow(new NotFoundError(`Entity '${ACME}' not found`));
    expect(store.changesetStore.apply).not.toHaveBeenCalled();
  });

  it("all three are a 409 while submitted", async () => {
    store.changesetStore.seed(changeset({ submittedAt: NOW }), store.changesetStore.stored(CS));
    const submitted = new ConflictError(`Changeset '${CS}' is submitted; unsubmit it first`);
    await expect(unstageOn(P1)).rejects.toThrow(submitted);
    await expect(unstageOn(P1, "age")).rejects.toThrow(submitted);
    await expect(rebaseOn(ACME)).rejects.toThrow(submitted);
  });
});

describe("discard", () => {
  it("deletes a draft changeset", async () => {
    await discardChangeset("full_lens", null, CS, asRuntimeStore(store));
    expect(store.changesetStore.discard).toHaveBeenCalledWith(CS);
    expect(await store.changesetStore.get(CS, "lens-1", null)).toBeNull();
  });

  it("refuses a submitted changeset, also one submitted after the read (the store's delete is draft only)", async () => {
    store.changesetStore.seed(changeset({ submittedAt: NOW }));
    await expect(discardChangeset("full_lens", null, CS, asRuntimeStore(store))).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is submitted; unsubmit it first`),
    );
    expect(store.changesetStore.discard).toHaveBeenCalledTimes(0);

    store.changesetStore.get.mockResolvedValueOnce(changeset());
    await expect(discardChangeset("full_lens", null, CS, asRuntimeStore(store))).rejects.toBeInstanceOf(ConflictError);

    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(null);
    store.changesetStore.discard.mockResolvedValueOnce(false);
    await expect(discardChangeset("full_lens", null, CS, asRuntimeStore(store))).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' not found`),
    );
  });
});
