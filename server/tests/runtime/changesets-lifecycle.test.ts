/**
 * The lifecycle of a changeset over mocked stores: submit (the lock-free
 * pass, the compare-and-set on the version, the anchor refusal), unsubmit
 * with its required note, the refusals while submitted, the list as the
 * lens shows it, and the review reads: staged objects with names, their
 * values with before, current and after, and markers on objects and values,
 * documents as stubs, the staged document text, one entity as the
 * changeset leaves it, and nothing the lens hides.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { ChangesetRecord, ChangesetSummary, RulesetRecord, StagedObjectRecord } from "../../src/core/ports.js";
import {
  commitChangeset,
  getChangeset,
  getStagedDocument,
  getStagedEntity,
  listChangesets,
  lockFreePass,
  recordedDocument,
  stage,
  submitChangeset,
  unstage,
  unsubmitChangeset,
} from "../../src/runtime/changesets.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext, loadSchema } from "../../src/runtime/schemaCache.js";
import {
  NOW,
  asRuntimeStore,
  createMockRuntimeStore,
  hashedById,
  inTouchOrder,
  makeEntity,
  makeRelation,
  makeScopedSchema,
  makeUnscopedSchema,
  stagedObject,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, any>;

const CS = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const ACME = "33333333-3333-4333-8333-333333333333";
const KIM = "44444444-4444-4444-8444-444444444444";
const R1 = "55555555-5555-4555-8555-555555555555";
const NEWCO = "66666666-6666-4666-8666-666666666666";
const R2 = "77777777-7777-4777-8777-777777777777";
const GHOST = "88888888-8888-4888-8888-888888888888";
const GONE = "99999999-9999-4999-8999-999999999999";
const NOTE1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const R3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const R4 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** The helper schema plus a type `note` with a document `body`; `scoped`
 * is the lens `hr_view` (department, age, active and belongs_to hidden). */
function schema(scoped = false): Row {
  const full = (scoped ? makeScopedSchema() : makeUnscopedSchema()) as Row;
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
    version: 5,
    note: "start note",
    submittedAt: null,
    createdAt: NOW,
    lastChangeAt: new Date(),
    objectCount: 1,
    ...overrides,
  };
}

const object = stagedObject;

const rename = (id: string, name: string, before: string): StagedObjectRecord =>
  object(id, "update", "person", { name: [name, before] });

let store: MockRuntimeStore;
let stored: Record<string, Row>;

/** Seed the changeset with these objects, first touched in this order. */
function seed(objects: StagedObjectRecord[], overrides: Partial<ChangesetRecord> = {}): void {
  store.changesetStore.seed(changeset({ objectCount: objects.length, ...overrides }), inTouchOrder(objects));
}

beforeEach(() => {
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema());
  seed([]);
  stored = {
    [PAT]: makeEntity({ name: "Pat", age: 41 }, "person", PAT),
    [KIM]: makeEntity({ name: "Kim Y" }, "person", KIM),
    [ACME]: makeEntity({ name: "Acme" }, "company", ACME),
    [NOTE1]: makeEntity({ name: "N", body: "old" }, "note", NOTE1),
  };
  store.getEntitiesByIdsHashed.mockImplementation(async (ids: string[], documentKeys: Record<string, string[]>) =>
    hashedById(stored, ids, documentKeys),
  );
  store.getEntityTypes.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in stored).map((id) => [id, stored[id]!._entityTypeKey])),
  );
});

const on = () => asRuntimeStore(store);

function anchorAt(anchor: { type: string; id: string } | null, anchorFound = true): RulesetRecord {
  return { key: "agent-a", anchor, anchorFound } as RulesetRecord;
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

describe("submit", () => {
  it("a clean plan: compare-and-set on the version the pass saw, with the note given", async () => {
    seed([rename(PAT, "Pat B", "Pat")]);
    const view = await submitChangeset("full_lens", null, CS, "please review", on());
    expect(store.changesetStore.submit).toHaveBeenCalledWith(CS, 5, "please review");
    expect(view).toMatchObject({ state: "submitted", version: 6, note: "please review", objectCount: 1 });
    // No lock and no transaction around the pass.
    expect(store.transaction).not.toHaveBeenCalled();
    expect(store.changesetStore.lockForCommit).not.toHaveBeenCalled();
  });

  it("without a note, the stored note stays", async () => {
    await submitChangeset("full_lens", null, CS, undefined, on());
    expect(store.changesetStore.submit).toHaveBeenCalledWith(CS, 5, "start note");
  });

  it("a note over 1,000 characters is a 422", async () => {
    await expect(submitChangeset("full_lens", null, CS, "x".repeat(1001), on())).rejects.toBeInstanceOf(ValidationError);
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("already submitted is a 409", async () => {
    seed([], { submittedAt: NOW });
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is already submitted`),
    );
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("a lock-free fault is a 422 with the violations by object and property, and the changeset stays a draft", async () => {
    seed([rename(KIM, "Kim X", "Kim"), rename(GONE, "x", "x")]);
    const error = await submitChangeset("full_lens", null, CS, "n", on()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("The changeset was not submitted; it stays a draft");
    expect((error as ValidationError).details).toEqual({
      violations: [
        { object: KIM, property: "name", kind: "drift", message: "Changed since it was staged" },
        { object: GONE, kind: "missing", message: "Deleted since it was staged" },
      ],
      total: 2,
    });
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("a version changed since the pass is a 409; a changeset gone meanwhile is not found", async () => {
    store.changesetStore.submit.mockResolvedValueOnce(null);
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' changed during the submit; try again`),
    );
    store.changesetStore.submit.mockResolvedValueOnce(null);
    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(null);
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' not found`),
    );
  });

  it("a ruleset's changeset whose anchor is deleted, or at an entity the lens hides, is a 409 with no fix hint", async () => {
    seed([], { rulesetKey: "agent-a" });
    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    // Through the plain lens URL too: the stored anchor counts.
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError("The anchor of ruleset 'agent-a' no longer exists"),
    );

    invalidateLoadedSchemaCache();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "department", id: DEPT }));
    await expect(submitChangeset("hr_view", "agent-a", CS, "n", on())).rejects.toThrow(
      new ConflictError("The anchor of ruleset 'agent-a' is an entity that lens 'hr_view' does not show"),
    );
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("a ruleset deleted since is left to the commit; one with a found anchor submits", async () => {
    seed([], { rulesetKey: "agent-a" });
    store.rulesetStore.get.mockResolvedValue(null);
    await submitChangeset("full_lens", null, CS, "n", on());
    seed([], { rulesetKey: "agent-a" });
    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "company", id: ACME }));
    await submitChangeset("full_lens", null, CS, "n", on());
    expect(store.changesetStore.submit).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Unsubmit
// ---------------------------------------------------------------------------

describe("unsubmit", () => {
  beforeEach(() => {
    seed([], { submittedAt: NOW });
  });

  it("back to draft, the note replaced, on any URL, a deleted anchor's included", async () => {
    seed([], { submittedAt: NOW, rulesetKey: "agent-a" });
    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    const view = await unsubmitChangeset("full_lens", "agent-a", CS, "fix T2", on());
    expect(store.changesetStore.unsubmit).toHaveBeenCalledWith(CS, "fix T2");
    expect(view).toMatchObject({ state: "draft", version: 6, note: "fix T2", submittedAt: null });
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
    ["of 1,001 characters", "x".repeat(1001)],
  ])("a note %s is a 422 on fields.note", async (_label, note) => {
    const error = await unsubmitChangeset("full_lens", null, CS, note, on()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details).toHaveProperty("fields.note");
    expect(store.changesetStore.unsubmit).not.toHaveBeenCalled();
  });

  it("a draft changeset is a 409, also one unsubmitted after the read; gone is not found", async () => {
    seed([]);
    await expect(unsubmitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is not submitted`),
    );
    expect(store.changesetStore.unsubmit).not.toHaveBeenCalled();

    store.changesetStore.get.mockResolvedValueOnce(changeset({ submittedAt: NOW })).mockResolvedValueOnce(changeset());
    await expect(unsubmitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is not submitted`),
    );
    store.changesetStore.get.mockResolvedValueOnce(changeset({ submittedAt: NOW })).mockResolvedValueOnce(null);
    await expect(unsubmitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' not found`),
    );
  });
});

// ---------------------------------------------------------------------------
// Refused while submitted; commit allowed
// ---------------------------------------------------------------------------

describe("while submitted", () => {
  const submittedText = `Changeset '${CS}' is submitted; unsubmit it first`;

  it("stage is a 409 with nothing staged", async () => {
    seed([], { submittedAt: NOW });
    await expect(
      stage("full_lens", null, CS, { operation: "delete_entity", typeKey: "person", id: PAT }, on()),
    ).rejects.toThrow(new ConflictError(submittedText));
    expect(store.changesetStore.apply).not.toHaveBeenCalled();
  });

  it("unstage is a 409, also when the submit lands after the read", async () => {
    seed([rename(PAT, "Pat B", "Pat")], { submittedAt: NOW });
    await expect(unstage("full_lens", null, CS, PAT, null, on())).rejects.toThrow(new ConflictError(submittedText));
    expect(store.changesetStore.apply).not.toHaveBeenCalled();

    seed([rename(PAT, "Pat B", "Pat")]);
    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(changeset({ submittedAt: NOW }));
    store.changesetStore.apply.mockResolvedValueOnce(null);
    await expect(unstage("full_lens", null, CS, PAT, null, on())).rejects.toThrow(new ConflictError(submittedText));
  });

  it("a submitted changeset older than 7 days is read, not swept", async () => {
    seed([], { submittedAt: NOW, lastChangeAt: new Date(Date.now() - 30 * 24 * 3_600_000) });
    await expect(getChangeset("full_lens", null, CS, 0, 100, on())).resolves.toMatchObject({ state: "submitted" });
    expect(store.changesetStore.sweep).not.toHaveBeenCalled();
  });

  it("a commit with a stale version is a 409 before anything is read or locked", async () => {
    seed([], { submittedAt: NOW });
    await expect(commitChangeset("full_lens", null, CS, 4, on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' changed since you looked: version 5, not 4`),
    );
    expect(store.changesetStore.page).not.toHaveBeenCalled();
    expect(store.transaction).not.toHaveBeenCalled();
    expect(store.changesetStore.touch).not.toHaveBeenCalled();
  });

  it("a rejected commit keeps it as it was: no state or version change, only the last change refreshed", async () => {
    seed([rename(KIM, "Kim X", "Kim")], { submittedAt: NOW });
    await expect(commitChangeset("full_lens", null, CS, 5, on())).rejects.toBeInstanceOf(ValidationError);
    expect(store.changesetStore.touch).toHaveBeenCalledWith(CS);
    expect(await store.changesetStore.get(CS, "lens-1", null)).toMatchObject({ version: 5, submittedAt: expect.any(Date) });
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function summary(overrides: Partial<ChangesetSummary>): ChangesetSummary {
  return { ...changeset(), operations: {}, typeKeys: [], ...overrides };
}

describe("list", () => {
  it("sweeps first, passes the binding, and answers the fields in the store's order", async () => {
    store.rulesetStore.get.mockResolvedValue(anchorAt(null));
    store.changesetStore.list.mockResolvedValue([
      summary({ id: "b", number: 1, submittedAt: NOW, rulesetKey: "agent-a", objectCount: 3, operations: { create_entity: 2, delete_entity: 1 }, typeKeys: ["company", "person"] }),
      summary({ id: "a", number: 2, objectCount: 0 }),
    ]);
    const list = await listChangesets("full_lens", "agent-a", on());
    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);
    expect(store.changesetStore.list).toHaveBeenCalledWith("lens-1", "agent-a");
    expect(list).toEqual([
      {
        id: "b",
        number: 1,
        state: "submitted",
        version: 5,
        note: "start note",
        ruleset: "agent-a",
        objectCount: 3,
        operations: { create_entity: 2, delete_entity: 1 },
        types: ["company", "person"],
        notVisible: 0,
        createdAt: NOW,
        lastChangeAt: expect.any(Date),
        submittedAt: NOW,
      },
      expect.objectContaining({ id: "a", state: "draft", objectCount: 0, operations: {}, types: [], notVisible: 0 }),
    ]);
  });

  it("counts operations from kind and action, as the store hands them", async () => {
    seed([
      object(NEWCO, "create", "company", { name: ["Newco"] }),
      rename(PAT, "Pat B", "Pat"),
      object(R1, "delete", "works_for", {}, [PAT, ACME]),
    ]);
    const [item] = await listChangesets("full_lens", null, on());
    expect(item).toMatchObject({
      objectCount: 3,
      operations: { create_entity: 1, update_entity: 1, delete_relation: 1 },
      types: ["company", "person", "works_for"],
    });
  });

  it("an unknown ruleset is not found", async () => {
    await expect(listChangesets("full_lens", "nope", on())).rejects.toThrow(new NotFoundError("Ruleset 'nope' not found"));
    expect(store.changesetStore.list).not.toHaveBeenCalled();
  });

  it("types apply the lens as it is now: a hidden type key is left out and counted", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    store.changesetStore.list.mockResolvedValue([
      summary({ typeKeys: ["belongs_to", "department", "person", "works_for"], objectCount: 4 }),
    ]);
    const [item] = await listChangesets("hr_view", null, on());
    expect(item!.types).toEqual(["person", "works_for"]);
    expect(item!.notVisible).toBe(2);
    expect(JSON.stringify(item)).not.toMatch(/department|belongs_to/);
  });
});

// ---------------------------------------------------------------------------
// The review read
// ---------------------------------------------------------------------------

/** Every marker of a viewed object, on it and on its values. */
const allMarkers = (view: Row): Row[] => [...view.markers, ...view.values.flatMap((v: Row) => v.markers)];

describe("review read", () => {
  it("objects by first touch: names, values with before, current and after, markers on objects and values", async () => {
    store.getRelationsByIds.mockResolvedValue({
      [R1]: makeRelation({ role: "dev" }, { relationId: R1, fromEntityId: PAT, toEntityId: ACME }),
    });
    seed([
      object(NEWCO, "create", "company", { name: ["Newco"] }),
      rename(PAT, "Pat B", "Pat"),
      object(R2, "create", "works_for", { role: ["dev"] }, [PAT, NEWCO]),
      rename(KIM, "Kim X", "Kim"),
      object(R1, "update", "works_for", { role: ["lead", "dev"] }, [PAT, ACME]),
      object(R3, "create", "works_for", {}, [PAT, GHOST]),
      rename(GONE, "x", "x"),
      object(NOTE1, "update", "note", { body: ["new text", recordedDocument("old")] }),
    ]);

    const read = await getChangeset("full_lens", null, CS, 1, 7, on());
    const byId = Object.fromEntries(read.objects.map((o) => [o.id, o]));

    expect(read).toMatchObject({ id: CS, objectCount: 8, offset: 1, limit: 7 });
    expect(read.objects.map((o) => o.id)).toEqual([PAT, R2, KIM, R1, R3, GONE, NOTE1]);
    // The page alone: one page read, one read of the staged objects at its
    // relation ends, one batched read each of its stored relations and entities.
    expect(store.changesetStore.page).toHaveBeenCalledTimes(1);
    expect(store.changesetStore.objects).toHaveBeenCalledTimes(1);
    expect(store.getRelationsByIds).toHaveBeenCalledTimes(1);
    expect(store.getEntitiesByIdsHashed).toHaveBeenCalledTimes(1);
    expect(store.getEntitiesByIdsHashed.mock.calls[0]![1]).toEqual({ note: ["body"] });
    expect(byId[PAT]).toEqual({
      id: PAT,
      kind: "entity",
      type: "person",
      action: "update",
      firstTouchedAt: new Date(NOW.getTime() + 1000),
      name: "Pat",
      markers: [],
      values: [{ property: "name", before: "Pat", current: "Pat", after: "Pat B", markers: [] }],
    });
    // An end created in this changeset is named by its staged create, even off the page.
    expect(byId[R2]).toMatchObject({
      kind: "relation",
      action: "create",
      from: { id: PAT, name: "Pat" },
      to: { id: NEWCO, name: "Newco" },
      values: [{ property: "role", before: null, current: null, after: "dev", markers: [] }],
    });
    // Drift on the value: current differs from before.
    expect(byId[KIM]).toMatchObject({ name: "Kim Y", markers: [] });
    expect(byId[KIM]!.values).toEqual([
      {
        property: "name",
        before: "Kim",
        current: "Kim Y",
        after: "Kim X",
        markers: [{ kind: "drift", message: "Changed since it was staged" }],
      },
    ]);
    expect(byId[R1]).toMatchObject({
      from: { id: PAT, name: "Pat" },
      to: { id: ACME, name: "Acme" },
      values: [{ property: "role", before: "dev", current: "dev", after: "lead", markers: [] }],
      markers: [],
    });
    expect(byId[R3]).toMatchObject({ to: { id: GHOST, name: null } });
    expect(byId[R3]!.markers).toEqual([{ kind: "dangling", message: "The target end is neither stored nor created in this changeset" }]);
    // A target gone since staging keeps its before; it has no current.
    expect(byId[GONE]).toMatchObject({ name: null, values: [{ property: "name", before: "x", current: null, after: "x" }] });
    expect(byId[GONE]!.markers.map((m) => m.kind)).toEqual(["missing"]);
    // Documents as the reads stub them; no text, no hash.
    expect(byId[NOTE1]).toMatchObject({
      name: "N",
      values: [{ property: "body", before: { document: true, length: 3 }, current: { document: true, length: 3 }, after: { document: true, length: 8 } }],
    });
    const text = JSON.stringify(read);
    expect(text).not.toContain("new text");
    expect(text).not.toContain(recordedDocument("old").sha256 as string);
  });

  it("a document before recorded without a length shows a stub with length null", async () => {
    seed([object(NOTE1, "update", "note", { body: ["new text", { sha256: recordedDocument("old").sha256 }] })]);
    const read = await getChangeset("full_lens", null, CS, 0, 100, on());
    expect(read.objects[0]!.values[0]).toEqual({
      property: "body",
      before: { document: true, length: null },
      current: { document: true, length: 3 },
      after: { document: true, length: 8 },
      markers: [],
    });
  });

  it("a create with its parent relation is two objects, the relation's ends named; a delete has no values", async () => {
    invalidateLoadedSchemaCache();
    const full = schema();
    const belongsTo = full.relationTypes.find((rt: Row) => rt.key === "belongs_to");
    belongsTo.parent = "target";
    belongsTo.properties.push({ key: "since", displayName: "Since", dataType: "string", required: false, defaultValue: null });
    store.getFullSchemaWithLensInclusions.mockResolvedValue(full);
    seed([
      object(DEPT, "create", "department", { name: ["Ops 2"] }),
      object(R2, "create", "belongs_to", { since: ["2020"] }, [DEPT, ACME]),
      object(KIM, "delete", "person"),
    ]);
    const read = await getChangeset("full_lens", null, CS, 0, 100, on());
    expect(read.objects[0]).toMatchObject({ action: "create", id: DEPT, name: "Ops 2", values: [{ property: "name", after: "Ops 2" }] });
    expect(read.objects[1]).toMatchObject({
      action: "create",
      type: "belongs_to",
      id: R2,
      from: { id: DEPT, name: "Ops 2" },
      to: { id: ACME, name: "Acme" },
      values: [{ property: "since", after: "2020" }],
      markers: [],
    });
    expect(read.objects[2]).toMatchObject({ action: "delete", id: KIM, name: "Kim Y", values: [], markers: [] });
  });

  it("a page judges its own objects: at any offset its markers and names are the whole changeset's, and the pass's", async () => {
    store.getRelationsByIds.mockImplementation(async (ids: string[]) =>
      Object.fromEntries(
        ids
          .filter((id) => id === R1)
          .map((id) => [id, makeRelation({ role: "dev" }, { relationId: R1, fromEntityId: PAT, toEntityId: ACME })]),
      ),
    );
    const objects = [
      object(NEWCO, "create", "company", { name: ["Newco"] }),
      object(R2, "create", "works_for", {}, [PAT, NEWCO]),
      rename(KIM, "Kim X", "Kim"),
      object(R3, "create", "works_for", {}, [GHOST, PAT]),
      rename(GONE, "x", "x"),
      object(NOTE1, "update", "note", { body: ["new", recordedDocument("older")] }),
      object(R1, "update", "works_for", { role: ["lead", "boss"] }, [PAT, ACME]),
      object(ACME, "delete", "company"),
      // A relation onto an entity this changeset deletes, off its page.
      object(R4, "create", "works_for", {}, [KIM, ACME]),
    ];
    seed(objects);

    const whole = await getChangeset("full_lens", null, CS, 0, 100, on());
    const pass = await lockFreePass(await loadSchema("full_lens", on()), CS, on());
    for (const view of whole.objects) {
      const faults = pass.faults.filter((fault) => fault.object === view.id).map(({ kind, message }) => ({ kind, message }));
      expect(allMarkers(view)).toEqual(faults);
    }
    expect(Object.fromEntries(whole.objects.map((o) => [o.id, allMarkers(o).map((m) => m.kind)]))).toEqual({
      [NEWCO]: [], [R2]: [], [KIM]: ["drift"], [R3]: ["dangling"], [GONE]: ["missing"], [NOTE1]: ["drift"], [R1]: ["dangling", "drift"], [ACME]: [], [R4]: ["dangling"],
    });
    expect(whole.objects[8]!.markers).toEqual([{ kind: "dangling", message: "The target end is deleted in this changeset" }]);
    expect(whole.objects[1]).toMatchObject({ from: { id: PAT, name: "Pat" }, to: { id: NEWCO, name: "Newco" } });
    expect(whole.objects[5]!.values[0]).toMatchObject({ current: { document: true, length: 3 } });

    for (const limit of [1, 3]) {
      for (let offset = 0; offset < objects.length; offset += 1) {
        const page = await getChangeset("full_lens", null, CS, offset, limit, on());
        expect(page.objects).toEqual(whole.objects.slice(offset, offset + limit));
      }
    }
  });

  it("through a scoped lens nothing hidden appears: no hidden type, property, name or value", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    // A last change at noon yesterday: unexpired, and its timestamp cannot
    // contain the hidden values searched for below (":41", ":50").
    const today = new Date();
    const noonYesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1, 12));
    stored[DEPT] = makeEntity({ name: "Secret Dept" }, "department", DEPT);
    seed(
      [
        // Staged before the lens hid `age`.
        object(PAT, "update", "person", { name: ["P2", "Pat"], age: [50, 41] }),
        object(NEWCO, "create", "department", { name: ["Hidden New"] }),
        object(DEPT, "delete", "department"),
        object(KIM, "delete", "person"),
      ],
      { lastChangeAt: noonYesterday },
    );

    const read = await getChangeset("hr_view", null, CS, 0, 100, on());
    const [update, create, remove, del] = read.objects;

    expect(update).toMatchObject({ type: "person", values: [{ property: "name", before: "Pat", current: "Pat", after: "P2" }] });
    expect(update!.markers).toEqual([{ kind: "not_visible", message: "A property this entity sets is no longer visible through lens 'hr_view'" }]);
    for (const [hidden, id, action] of [[create, NEWCO, "create"], [remove, DEPT, "delete"]] as const) {
      expect(hidden).toEqual({
        id,
        kind: "entity",
        type: null,
        action,
        firstTouchedAt: expect.any(Date),
        markers: [{ kind: "not_visible", message: "The type of this entity is no longer visible through lens 'hr_view'" }],
        values: [],
      });
    }
    expect(del).toMatchObject({ type: "person", name: "Kim Y", markers: [] });
    const text = JSON.stringify(read);
    for (const secret of ['"age"', ":41", ":50", "department", "Secret Dept", "Hidden New"]) {
      expect(text).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// The staged document read
// ---------------------------------------------------------------------------

describe("staged document read", () => {
  const NOTE2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const text = "# Plan\n\nStep one 😀, step two.";
  const read = (id: string, offset = 0, limit: number | null = null, lensKey = "full_lens", rulesetKey: string | null = null) =>
    getStagedDocument(lensKey, rulesetKey, CS, "note", id, "body", offset, limit, on());

  beforeEach(() => {
    seed([
      object(NOTE1, "update", "note", { body: [text, recordedDocument("old")], name: ["N2", "N"] }),
      object(NOTE2, "create", "note", { name: ["New"], body: [text] }),
    ]);
  });

  it("the staged value, whole, as the document read answers; one read of that object", async () => {
    expect(await read(NOTE1)).toEqual({ propertyKey: "body", content: text, offset: 0, length: 29, totalLength: 29 });
    expect(store.changesetStore.objects).toHaveBeenCalledWith(CS, [NOTE1]);
    expect(store.changesetStore.page).not.toHaveBeenCalled();
  });

  it("slices by characters (code points) as the document read does", async () => {
    expect(await read(NOTE1, 17, 3)).toEqual({ propertyKey: "body", content: "😀, ", offset: 17, length: 3, totalLength: 29 });
    expect(await read(NOTE1, 25)).toEqual({ propertyKey: "body", content: "two.", offset: 25, length: 4, totalLength: 29 });
    expect(await read(NOTE1, 100, 5)).toEqual({ propertyKey: "body", content: "", offset: 100, length: 0, totalLength: 29 });
  });

  it("an entity created in this changeset reads its create's value", async () => {
    expect((await read(NOTE2)).content).toBe(text);
  });

  it("a staged null reads as the empty text", async () => {
    seed([object(NOTE1, "update", "note", { body: [null, recordedDocument(text)] })]);
    expect(await read(NOTE1)).toEqual({ propertyKey: "body", content: "", offset: 0, length: 0, totalLength: 0 });
  });

  it("not found when the changeset stages no value of it: another property only, another entity", async () => {
    seed([object(NOTE1, "update", "note", { name: ["N2", "N"] })]);
    await expect(read(NOTE1)).rejects.toThrow(new NotFoundError(`Changeset '${CS}' stages no 'body' of entity '${NOTE1}'`));
    await expect(read(NOTE2)).rejects.toThrow(NotFoundError);
  });

  it("not found when the changeset deletes the entity: a commit leaves no text", async () => {
    seed([object(NOTE1, "delete", "note")]);
    await expect(read(NOTE1)).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' deletes entity '${NOTE1}': a commit leaves no 'body'`),
    );
  });

  it("not found for an unknown changeset, type, or a property that is not a document", async () => {
    store.changesetStore.get.mockResolvedValueOnce(null);
    await expect(read(NOTE1)).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    await expect(getStagedDocument("full_lens", null, CS, "nope", NOTE1, "body", 0, null, on())).rejects.toThrow(
      new NotFoundError("Entity type 'nope' not found"),
    );
    await expect(getStagedDocument("full_lens", null, CS, "note", NOTE1, "name", 0, null, on())).rejects.toThrow(
      new NotFoundError("Document property 'name' not found on entity type 'note'"),
    );
  });

  it("through a lens that hides the type it is not found, as every review read", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    await expect(read(NOTE1, 0, null, "hr_view")).rejects.toThrow(new NotFoundError("Entity type 'note' not found"));
  });

  it("through the ruleset URL: bound to its ruleset, and readable while submitted", async () => {
    seed([object(NOTE1, "update", "note", { body: [text, recordedDocument("old")] })], { rulesetKey: "agent-a", submittedAt: NOW });
    expect((await read(NOTE1, 0, null, "full_lens", "agent-a")).content).toBe(text);
    expect(store.changesetStore.get).toHaveBeenCalledWith(CS, "lens-1", "agent-a");
  });
});

// ---------------------------------------------------------------------------
// The staged entity read
// ---------------------------------------------------------------------------

describe("staged entity read", () => {
  const read = (type: string, id: string, lensKey = "full_lens", rulesetKey: string | null = null) =>
    getStagedEntity(lensKey, rulesetKey, CS, type, id, on());

  beforeEach(() => {
    store.getEntity.mockImplementation(async (type: string, id: string) =>
      stored[id]?._entityTypeKey === type ? stored[id] : null,
    );
  });

  it("a stored entity with its staged values applied, a null removing a key; its object as the review shows it", async () => {
    seed([
      object(PAT, "update", "person", { name: ["Pat C", "Pat"], age: [null, 41], email: ["p@x", undefined] }),
      rename(KIM, "Kim X", "Kim Y"),
    ]);
    const view = await read("person", PAT);
    expect(view.entity).toEqual({ _id: PAT, _entityTypeKey: "person", _createdAt: NOW, _updatedAt: NOW, name: "Pat C", email: "p@x" });
    expect(view.deleted).toBe(false);
    expect(view.object).toMatchObject({ id: PAT, type: "person", action: "update", name: "Pat", markers: [] });
    expect(view.object!.values).toEqual([
      { property: "age", before: 41, current: 41, after: null, markers: [] },
      { property: "email", before: null, current: null, after: "p@x", markers: [] },
      { property: "name", before: "Pat", current: "Pat", after: "Pat C", markers: [] },
    ]);
    // One read of its object and one of the entity: no pass over the changeset.
    expect(store.changesetStore.objects).toHaveBeenCalledWith(CS, [PAT]);
    expect(store.changesetStore.page).not.toHaveBeenCalled();
    expect(store.getEntity).toHaveBeenCalledTimes(1);
  });

  it("markers judged on its own object: drift against the stored row, a value the lens no longer accepts", async () => {
    stored[PAT] = makeEntity({ name: "Pat Changed", age: 41 }, "person", PAT);
    seed([object(PAT, "update", "person", { name: ["Pat B", "Pat"], age: ["old", 41] })]);
    const view = await read("person", PAT);
    const byProperty = Object.fromEntries(view.object!.values.map((v) => [v.property, v]));
    expect(byProperty.name).toMatchObject({ current: "Pat Changed", markers: [{ kind: "drift", message: "Changed since it was staged" }] });
    expect(byProperty.age!.markers.map((m) => m.kind)).toEqual(["replay"]);
  });

  it("an entity this changeset creates: its values, no defaults applied", async () => {
    seed([object(GHOST, "create", "person", { name: ["Newer"], email: ["n@x"] })]);
    const view = await read("person", GHOST);
    // `active` has a default; the commit applies it, not this read.
    expect(view.entity).toEqual({ _id: GHOST, _entityTypeKey: "person", name: "Newer", email: "n@x" });
    expect(view.object).toMatchObject({ action: "create", id: GHOST, name: "Newer", markers: [] });
  });

  it("documents as stubs: a staged value measured afresh, not by the stored length", async () => {
    stored[NOTE1] = makeEntity({ name: "N", body: "old", _doc_body_length: 3 }, "note", NOTE1);
    seed([object(NOTE1, "update", "note", { body: ["new text", recordedDocument("old")] })]);
    const view = await read("note", NOTE1);
    expect(view.entity).toMatchObject({ name: "N", body: { document: true, length: 8 } });
    expect(view.entity).not.toHaveProperty("_doc_body_length");
    expect(view.object!.values[0]).toMatchObject({ before: { document: true, length: 3 }, after: { document: true, length: 8 } });
    expect(JSON.stringify(view)).not.toContain("new text");
  });

  it("deleted when the changeset deletes it: the stored entity, its object a delete without values", async () => {
    seed([object(PAT, "delete", "person")]);
    expect(await read("person", PAT)).toMatchObject({
      deleted: true,
      entity: { name: "Pat", age: 41 },
      object: { action: "delete", id: PAT, name: "Pat", values: [], markers: [] },
    });
  });

  it("a stored entity the changeset does not touch: as stored, no object", async () => {
    expect(await read("person", KIM)).toEqual({
      entity: { _id: KIM, _entityTypeKey: "person", _createdAt: NOW, _updatedAt: NOW, name: "Kim Y" },
      deleted: false,
      object: null,
    });
  });

  it("not found: an unknown changeset, a type the lens hides, an entity neither stored nor created by this changeset", async () => {
    store.changesetStore.get.mockResolvedValueOnce(null);
    await expect(read("person", PAT)).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    await expect(read("nope", PAT)).rejects.toThrow(new NotFoundError("Entity type 'nope' not found"));
    // Stored as another type.
    await expect(read("company", PAT)).rejects.toThrow(new NotFoundError(`Entity '${PAT}' not found`));
    // An update whose target is gone: nothing a commit could leave.
    seed([object(GHOST, "update", "person", { name: ["x", "y"] })]);
    await expect(read("person", GHOST)).rejects.toThrow(new NotFoundError(`Entity '${GHOST}' not found`));
    invalidateLoadedSchemaCache();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    await expect(read("department", DEPT, "hr_view")).rejects.toThrow(new NotFoundError("Entity type 'department' not found"));
  });

  it("through a scoped lens: no hidden property in the entity or the object, which is marked not visible", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    seed([object(PAT, "update", "person", { name: ["P2", "Pat"], age: [50, 41] })]);
    const view = await read("person", PAT, "hr_view");
    expect(view.entity).toEqual({ _id: PAT, _entityTypeKey: "person", _createdAt: NOW, _updatedAt: NOW, name: "P2" });
    expect(view.object!.values).toEqual([{ property: "name", before: "Pat", current: "Pat", after: "P2", markers: [] }]);
    expect(view.object!.markers.map((m) => m.kind)).toEqual(["not_visible"]);
    expect(JSON.stringify(view)).not.toContain('"age"');
  });

  it("through the ruleset URL: bound to its ruleset, and readable while submitted", async () => {
    seed([rename(PAT, "Pat B", "Pat")], { rulesetKey: "agent-a", submittedAt: NOW });
    expect((await read("person", PAT, "full_lens", "agent-a")).entity).toMatchObject({ name: "Pat B" });
    expect(store.changesetStore.get).toHaveBeenCalledWith(CS, "lens-1", "agent-a");
  });
});
