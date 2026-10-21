/**
 * Staging into a changeset over mocked stores: the binding and expiry of a
 * changeset, the anchor refusal, the immediate write's checks, minted ids,
 * the journal lookup of a staged create, the before of an update, the caps,
 * and unstage and discard.
 */

import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { settings } from "../../src/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { ChangesetRecord, ChangesetWriteRecord } from "../../src/core/ports.js";
import {
  MAX_STAGED_WRITES,
  recordedValues,
  discardChangeset,
  getChangeset,
  stage,
  startChangeset,
  unstage,
  writeBytes,
  type StagedWrite,
} from "../../src/runtime/changesets.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
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
    anchorKey: null,
    version: 3,
    note: null,
    submittedAt: null,
    createdAt: NOW,
    lastChangeAt: new Date(),
    writeCount: 2,
    ...overrides,
  };
}

function journalRow(overrides: Partial<ChangesetWriteRecord>): ChangesetWriteRecord {
  return {
    seq: 1,
    operation: "create_entity",
    arguments: {},
    mintedId: null,
    typeKey: "person",
    targetId: null,
    before: null,
    createdAt: NOW,
    ...overrides,
  };
}

let store: MockRuntimeStore;

beforeEach(() => {
  invalidateLoadedSchemaCache();
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema());
  store.changesetStore.get.mockResolvedValue(changeset());
  store.changesetStore.append.mockResolvedValue([3]);
});

function stageOn(write: StagedWrite, anchorKey: string | null = null) {
  return stage("full_lens", anchorKey, CS, write, asRuntimeStore(store));
}

/** The rows of the one `append`, each handed over with its bytes. */
function appendedRows(): Row[] {
  expect(store.changesetStore.append).toHaveBeenCalledTimes(1);
  const [id, writes] = store.changesetStore.append.mock.calls[0]!;
  expect(id).toBe(CS);
  for (const { write, bytes } of writes) expect(bytes).toBe(writeBytes(write));
  return writes.map((entry: Row) => entry.write);
}

/** The one row handed to `append`. */
function appended(): Row {
  const rows = appendedRows();
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** A department created under the company ACME. */
const UNDER_ACME: StagedWrite = {
  operation: "create_entity",
  typeKey: "department",
  properties: { name: "R&D" },
  parentRelation: { type: "belongs_to", parentId: ACME, properties: { since: "2020" } },
};

function expectNothingWritten(): void {
  expect(store.changesetStore.append).not.toHaveBeenCalled();
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
  it("binds the lens id and the anchor key of the URL, sweeps expired changesets, answers draft", async () => {
    store.anchorStore.getAnchor.mockResolvedValue({ key: "agent-a", entity: null, entityFound: false });
    store.changesetStore.start.mockImplementation(async (cs: Row) => changeset({ ...cs, version: 1, writeCount: 0 }));

    const started = await startChangeset("full_lens", "agent-a", "g1", asRuntimeStore(store));

    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);
    const [cutoff] = store.changesetStore.sweep.mock.calls[0]!;
    expect(Date.now() - (cutoff as Date).getTime()).toBeGreaterThanOrEqual(7 * 24 * 3_600_000 - 1_000);
    const [input] = store.changesetStore.start.mock.calls[0]!;
    expect(input).toMatchObject({ lensId: "lens-1", anchorKey: "agent-a", note: "g1" });
    expect(input.id).toMatch(UUID);
    expect(started).toMatchObject({ state: "draft", version: 1, note: "g1", anchor: "agent-a", writeCount: 0 });
  });

  it("an unknown anchor is not found; a note over 1000 characters is a 422; neither starts one", async () => {
    store.changesetStore.start.mockImplementation(async (cs: Row) => changeset({ ...cs, version: 1, writeCount: 0 }));
    await expect(startChangeset("full_lens", "nope", null, asRuntimeStore(store))).rejects.toThrow(
      new NotFoundError("Anchor 'nope' not found"),
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
  it("loads through the lens id and the URL's anchor key; null is the one not-found text", async () => {
    store.changesetStore.get.mockResolvedValue(null);
    await expect(
      stageOn({ operation: "delete_entity", typeKey: "person", id: P1 }, null),
    ).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    expect(store.changesetStore.get).toHaveBeenCalledWith(CS, "lens-1", null);
    expectNothingWritten();
  });

  it("an expired draft changeset is swept and not found; a submitted one of the same age is kept", async () => {
    const old = new Date(Date.now() - 8 * 24 * 3_600_000);
    store.changesetStore.get.mockResolvedValue(changeset({ lastChangeAt: old }));
    await expect(getChangeset("full_lens", null, CS, 0, 100, asRuntimeStore(store))).rejects.toThrow(
      `Changeset '${CS}' not found`,
    );
    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);

    store.changesetStore.get.mockResolvedValue(changeset({ lastChangeAt: old, submittedAt: NOW }));
    await expect(getChangeset("full_lens", null, CS, 0, 100, asRuntimeStore(store))).resolves.toMatchObject({
      state: "submitted",
    });
    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);
  });
});

describe("staging checks", () => {
  it("a dangling anchor, or one at an entity the lens hides, is a 409 with nothing appended", async () => {
    store.anchorStore.getAnchor.mockResolvedValue({
      key: "agent-a",
      entity: { type: "company", id: ACME },
      entityFound: false,
    });
    await expect(
      stageOn({ operation: "update_entity", typeKey: "company", id: ACME, properties: { name: "X" } }, "agent-a"),
    ).rejects.toBeInstanceOf(ConflictError);
    expectNothingWritten();
  });

  it("an anchored URL runs no coverage rule: a write outside the anchor is staged", async () => {
    store.anchorStore.getAnchor.mockResolvedValue({
      key: "agent-a",
      entity: { type: "company", id: ACME },
      entityFound: true,
    });
    const answer = await stageOn(
      {
        operation: "create_entity",
        typeKey: "department",
        properties: { name: "R&D" },
        parentRelation: null,
      },
      "agent-a",
    );
    expect(answer.seq).toBe(3);
    expect(store.getAncestors).not.toHaveBeenCalled();
  });

  it("the immediate write's 422 field errors, collected, and nothing appended", async () => {
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
    await expect(
      stageOn({ operation: "update_relation", typeKey: "ghost", id: P1, properties: {} }),
    ).rejects.toThrow(new NotFoundError("Relation type 'ghost' not found"));
    expectNothingWritten();
  });

  it("the cap: a full changeset is a 409, nothing appended", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ writeCount: MAX_STAGED_WRITES }));
    await expect(
      stageOn({ operation: "create_entity", typeKey: "person", properties: { name: "A" }, parentRelation: null }),
    ).rejects.toThrow(new ConflictError(`Changeset '${CS}' is full: at most 10000 staged writes`));
    expectNothingWritten();
  });

  it("the cap counts both rows of a create with a parent relation: one short of it, the pair is a 409", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ writeCount: MAX_STAGED_WRITES - 1 }));
    await expect(stageOn(UNDER_ACME)).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is full: at most 10000 staged writes`),
    );
    expectNothingWritten();

    await stageOn({ operation: "create_entity", typeKey: "department", properties: { name: "R&D" }, parentRelation: null });
    expect(appended()).toMatchObject({ operation: "create_entity" });

    store.changesetStore.append.mockClear();
    store.changesetStore.append.mockResolvedValue([3, 4]);
    store.changesetStore.get.mockResolvedValue(changeset({ writeCount: MAX_STAGED_WRITES - 2 }));
    await stageOn(UNDER_ACME);
    expect(appendedRows()).toHaveLength(2);
  });

  it("the byte cap sums both rows of a create with a parent relation", async () => {
    store.changesetStore.append.mockResolvedValue([3, 4]);
    const write: StagedWrite = {
      ...UNDER_ACME,
      parentRelation: { type: "belongs_to", parentId: ACME, properties: { since: "x".repeat(5000) } },
    };
    await stageOn(write);
    const [entity, relation] = appendedRows();
    const bytes = writeBytes(entity!) + writeBytes(relation!);
    expect(writeBytes(relation!)).toBeGreaterThan(5000);

    store.changesetStore.append.mockClear();
    store.changesetStore.stagedBytes.mockResolvedValue(settings.CHANGESET_MAX_BYTES - bytes);
    await stageOn(write);
    expect(store.changesetStore.append).toHaveBeenCalledTimes(1);

    store.changesetStore.append.mockClear();
    // The entity's row alone would fit; the pair does not.
    store.changesetStore.stagedBytes.mockResolvedValue(settings.CHANGESET_MAX_BYTES - bytes + 1);
    await expect(stageOn(write)).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is full: at most ${settings.CHANGESET_MAX_BYTES} bytes of staged writes`),
    );
    expectNothingWritten();
  });

  it("the byte cap: a write that would pass it is a 409, nothing appended; one that reaches it is staged", async () => {
    const write: StagedWrite = {
      operation: "create_entity",
      typeKey: "note",
      properties: { name: "N", body: "ä".repeat(1000) },
      parentRelation: null,
    };
    await stageOn(write);
    const [{ write: row, bytes }] = store.changesetStore.append.mock.calls[0]![1];
    // Document text counts as UTF-8: two bytes per "ä".
    expect(bytes).toBe(writeBytes(row));
    expect(bytes).toBeGreaterThan(2000);
    expect(store.changesetStore.stagedBytes).toHaveBeenCalledWith(CS);

    store.changesetStore.append.mockClear();
    store.changesetStore.stagedBytes.mockResolvedValue(settings.CHANGESET_MAX_BYTES - bytes);
    await stageOn(write);
    expect(store.changesetStore.append).toHaveBeenCalledTimes(1);

    store.changesetStore.append.mockClear();
    store.changesetStore.stagedBytes.mockResolvedValue(settings.CHANGESET_MAX_BYTES - bytes + 1);
    await expect(stageOn(write)).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is full: at most ${settings.CHANGESET_MAX_BYTES} bytes of staged writes`),
    );
    expectNothingWritten();
  });

  it("writeBytes: the UTF-8 bytes of the arguments and the before as JSON", () => {
    const row = { operation: "update_entity", typeKey: "person", mintedId: null, targetId: P1 };
    expect(writeBytes({ ...row, arguments: { properties: { name: "é" } }, before: null })).toBe(
      '{"properties":{"name":"é"}}'.length + 1,
    );
    expect(writeBytes({ ...row, arguments: {}, before: { name: "A" } })).toBe('{}{"name":"A"}'.length);
  });

  it("a changeset gone at the append is not found", async () => {
    store.changesetStore.append.mockResolvedValue(null);
    await expect(
      stageOn({ operation: "create_entity", typeKey: "person", properties: { name: "A" }, parentRelation: null }),
    ).rejects.toThrow(`Changeset '${CS}' not found`);
  });
});

describe("creates: minted ids", () => {
  it("an entity create mints its final id and keeps the payload as sent, after coercion", async () => {
    const answer = await stageOn({
      operation: "create_entity",
      typeKey: "person",
      properties: { name: "Ann", age: "41" },
      parentRelation: null,
    });
    const row = appended();
    expect(row).toMatchObject({
      operation: "create_entity",
      typeKey: "person",
      targetId: null,
      before: null,
      // Defaults are left to the replay: `active` was not sent.
      arguments: { properties: { name: "Ann", age: 41 } },
    });
    expect(Object.keys(row.arguments)).toEqual(["properties"]);
    expect(row.mintedId).toMatch(UUID);
    expect(answer).toEqual({ seq: 3, id: row.mintedId });
    expect(store.createEntity).not.toHaveBeenCalled();
  });

  it("with a parent relation, two rows in one append: the entity's create, then the relation's; the parent end is not checked here", async () => {
    store.changesetStore.append.mockResolvedValue([3, 4]);
    const answer = await stageOn(UNDER_ACME);
    const [entity, relation] = appendedRows();
    expect(entity).toEqual({
      operation: "create_entity",
      typeKey: "department",
      mintedId: expect.stringMatching(UUID),
      targetId: null,
      before: null,
      arguments: { properties: { name: "R&D" } },
    });
    // Oriented by the parent end: the parent ACME is the target.
    expect(relation).toEqual({
      operation: "create_relation",
      typeKey: "belongs_to",
      mintedId: expect.stringMatching(UUID),
      targetId: null,
      before: null,
      arguments: { fromEntityId: entity!.mintedId, toEntityId: ACME, properties: { since: "2020" } },
    });
    expect(relation!.mintedId).not.toBe(entity!.mintedId);
    expect(answer).toEqual({ seq: 3, id: entity!.mintedId, relation: { seq: 4, id: relation!.mintedId } });
    expect(store.getEntityById).not.toHaveBeenCalled();

    // The relation's row is the one a staged create_relation of it gets.
    store.changesetStore.append.mockClear();
    store.changesetStore.append.mockResolvedValue([5]);
    await stageOn({
      operation: "create_relation",
      typeKey: "belongs_to",
      fromEntityId: entity!.mintedId,
      toEntityId: ACME,
      properties: { since: "2020" },
    });
    expect(JSON.stringify({ ...appended(), mintedId: null })).toBe(JSON.stringify({ ...relation, mintedId: null }));
  });

  it("a parent relation's faults are the immediate write's, under parentRelation.*", async () => {
    const promise = stageOn({
      operation: "create_entity",
      typeKey: "department",
      properties: { name: "R&D" },
      parentRelation: { type: "works_for", parentId: ACME },
    });
    await expect(promise).rejects.toMatchObject({
      details: { fields: { "parentRelation.type": "Relation type 'works_for' is not a parent relation" } },
    });
  });

  it("a relation create mints its id; its ends are not read", async () => {
    const answer = await stageOn({
      operation: "create_relation",
      typeKey: "works_for",
      fromEntityId: P1,
      toEntityId: ACME,
      properties: { role: "dev" },
    });
    const row = appended();
    expect(row).toMatchObject({
      operation: "create_relation",
      typeKey: "works_for",
      targetId: null,
      before: null,
      arguments: { fromEntityId: P1, toEntityId: ACME, properties: { role: "dev" } },
    });
    expect(answer.id).toBe(row.mintedId);
    expect(store.getEntityById).not.toHaveBeenCalled();
    expect(store.getEntity).not.toHaveBeenCalled();
  });
});

describe("updates and deletes: the target and the before", () => {
  it("a stored target: one read, and the before of exactly the patched keys, absent kept absent", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Ann", age: 41, email: null, active: true }, "person", P1));
    const answer = await stageOn({
      operation: "update_entity",
      typeKey: "person",
      id: P1,
      properties: { age: 42, email: "a@b.c" },
    });
    const row = appended();
    expect(row).toMatchObject({
      operation: "update_entity",
      typeKey: "person",
      mintedId: null,
      targetId: P1,
      arguments: { properties: { age: 42, email: "a@b.c" } },
    });
    expect(row.before).toEqual({ age: 41, email: null });
    expect(answer).toEqual({ seq: 3, id: P1 });
    expect(store.getEntity).toHaveBeenCalledWith("person", P1);

    store.changesetStore.append.mockClear();
    store.getEntity.mockResolvedValue(makeEntity({ name: "Ann" }, "person", P1));
    await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { age: null } });
    const removal = appended();
    expect(removal.arguments).toEqual({ properties: { age: null } });
    expect(removal.before).toEqual({});
  });

  it("a document value in before is its hash and its length in characters", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "N", body: "old text 😀" }, "note", P1));
    await stageOn({ operation: "update_entity", typeKey: "note", id: P1, properties: { body: "new text" } });
    const hash = createHash("sha256").update("old text 😀").digest("hex");
    expect(appended()).toMatchObject({ arguments: { properties: { body: "new text" } } });
    expect(appended().before).toEqual({ body: { sha256: hash, length: 10 } });
  });

  it("a relation update reads its target; the endpoint keys are dropped as on the immediate write", async () => {
    store.getRelation.mockResolvedValue(makeRelation({ role: "dev" }, { relationId: P1 }));
    await stageOn({
      operation: "update_relation",
      typeKey: "works_for",
      id: P1,
      properties: { role: "lead", fromEntityId: ACME },
    });
    expect(appended()).toMatchObject({
      targetId: P1,
      arguments: { properties: { role: "lead" } },
      before: { role: "dev" },
    });
    expect(store.getRelation).toHaveBeenCalledWith("works_for", P1);
  });

  it("a target minted by a staged create in the journal is accepted without a read and without a before", async () => {
    store.changesetStore.findMinted.mockResolvedValue(journalRow({ operation: "create_entity", mintedId: P1 }));
    await stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { name: "B" } });
    expect(appended()).toMatchObject({ targetId: P1, before: null });
    expect(store.changesetStore.findMinted).toHaveBeenCalledWith(CS, P1);
    expect(store.getEntity).not.toHaveBeenCalled();

    store.changesetStore.append.mockClear();
    await stageOn({ operation: "delete_entity", typeKey: "person", id: P1 });
    expect(appended()).toMatchObject({ operation: "delete_entity", targetId: P1, before: null, arguments: {} });
    expect(store.getEntity).not.toHaveBeenCalled();
  });

  it("a journal row of another type or kind does not count: the target is read and missing", async () => {
    store.changesetStore.findMinted.mockResolvedValue(journalRow({ operation: "create_entity", mintedId: P1 }));
    await expect(stageOn({ operation: "delete_entity", typeKey: "company", id: P1 })).rejects.toThrow(
      new NotFoundError(`Entity '${P1}' not found`),
    );
    await expect(stageOn({ operation: "delete_relation", typeKey: "works_for", id: P1 })).rejects.toThrow(
      new NotFoundError(`Relation '${P1}' not found`),
    );
    expectNothingWritten();
  });

  it("a missing target is the immediate write's 404, after the field errors", async () => {
    await expect(
      stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { name: "B" } }),
    ).rejects.toThrow(new NotFoundError(`Entity '${P1}' not found`));
    await expect(
      stageOn({ operation: "update_entity", typeKey: "person", id: P1, properties: { name: null } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expectNothingWritten();
  });

  it("a delete of a stored target reads it and has no before", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Ann" }, "person", P1));
    await stageOn({ operation: "delete_entity", typeKey: "person", id: P1 });
    expect(appended()).toMatchObject({ operation: "delete_entity", targetId: P1, before: null, mintedId: null });
  });
});

describe("recordedValues", () => {
  it("keeps raw values, a stored null, and leaves absent keys out", () => {
    expect(recordedValues({ a: 1, b: null, c: { x: 1 } }, ["a", "b", "c", "d"], {})).toEqual({ a: 1, b: null, c: { x: 1 } });
  });
});

describe("read, unstage, discard", () => {
  it("get answers the changeset and a page of its writes by seq", async () => {
    store.changesetStore.page.mockResolvedValue([
      journalRow({ seq: 1, mintedId: P1, arguments: { properties: { name: "A" } } }),
      journalRow({ seq: 4, operation: "delete_entity", typeKey: "company", targetId: ACME }),
    ]);
    const read = await getChangeset("full_lens", null, CS, 0, 100, asRuntimeStore(store));
    expect(store.changesetStore.page).toHaveBeenCalledWith(CS, 0, 100);
    expect(read).toMatchObject({ id: CS, state: "draft", version: 3, writeCount: 2, offset: 0, limit: 100 });
    expect(read.writes).toEqual([
      {
        seq: 1,
        operation: "create_entity",
        type: "person",
        id: P1,
        createdAt: NOW,
        name: "A",
        before: null,
        current: null,
        after: { name: "A" },
        markers: [],
      },
      {
        seq: 4,
        operation: "delete_entity",
        type: "company",
        id: ACME,
        createdAt: NOW,
        name: null,
        before: null,
        current: null,
        after: null,
        markers: [],
      },
    ]);
  });

  it("unstage removes a seq; an unknown seq is not found; a dangling anchor does not stop it", async () => {
    store.anchorStore.getAnchor.mockResolvedValue({ key: "a", entity: { type: "company", id: ACME }, entityFound: false });
    store.changesetStore.unstage.mockResolvedValue(true);
    await unstage("full_lens", "a", CS, 2, asRuntimeStore(store));
    expect(store.changesetStore.unstage).toHaveBeenCalledWith(CS, 2);

    store.changesetStore.unstage.mockResolvedValue(false);
    await expect(unstage("full_lens", "a", CS, 9, asRuntimeStore(store))).rejects.toThrow(
      new NotFoundError(`Staged write 9 not found in changeset '${CS}'`),
    );
  });

  it("discard deletes a draft changeset", async () => {
    store.changesetStore.discard.mockResolvedValue(true);
    await discardChangeset("full_lens", null, CS, asRuntimeStore(store));
    expect(store.changesetStore.discard).toHaveBeenCalledWith(CS);
  });

  it("discard refuses a submitted changeset, also one submitted after the read (the store's delete is draft only)", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW }));
    await expect(discardChangeset("full_lens", null, CS, asRuntimeStore(store))).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is submitted; unsubmit it first`),
    );
    expect(store.changesetStore.discard).not.toHaveBeenCalled();

    store.changesetStore.get
      .mockResolvedValueOnce(changeset())
      .mockResolvedValueOnce(changeset({ submittedAt: NOW }));
    store.changesetStore.discard.mockResolvedValue(false);
    await expect(discardChangeset("full_lens", null, CS, asRuntimeStore(store))).rejects.toBeInstanceOf(ConflictError);

    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(null);
    await expect(discardChangeset("full_lens", null, CS, asRuntimeStore(store))).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' not found`),
    );
  });
});
