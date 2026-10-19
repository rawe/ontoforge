/**
 * The lifecycle of a changeset over mocked stores: submit (the lock-free
 * pass, the compare-and-set on the version, the anchor refusal), unsubmit
 * with its required note, the refusals while submitted, the list as the
 * lens shows it, and the review read: names, before → after and markers,
 * with nothing the lens hides.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { AnchorRecord, ChangesetRecord, ChangesetSummary, ChangesetWriteRecord } from "../../src/core/ports.js";
import {
  commitChangeset,
  documentHash,
  getChangeset,
  listChangesets,
  stage,
  submitChangeset,
  unstage,
  unsubmitChangeset,
} from "../../src/runtime/changesets.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import {
  NOW,
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeRelation,
  makeScopedSchema,
  makeUnscopedSchema,
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
    anchorKey: null,
    version: 5,
    note: "start note",
    submittedAt: null,
    createdAt: NOW,
    lastChangeAt: new Date(),
    writeCount: 1,
    ...overrides,
  };
}

function row(seq: number, overrides: Partial<ChangesetWriteRecord>): ChangesetWriteRecord {
  return {
    seq,
    operation: "create_entity",
    arguments: {},
    mintedId: null,
    typeKey: "person",
    targetId: null,
    base: null,
    createdAt: NOW,
    ...overrides,
  };
}

const rename = (seq: number, id: string, name: string, base: Row | null): ChangesetWriteRecord =>
  row(seq, { operation: "update_entity", typeKey: "person", targetId: id, arguments: { properties: { name } }, base });

let store: MockRuntimeStore;
let stored: Record<string, Row>;
let journal: ChangesetWriteRecord[];

beforeEach(() => {
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema());
  store.changesetStore.get.mockResolvedValue(changeset());
  stored = {
    [PAT]: makeEntity({ name: "Pat", age: 41 }, "person", PAT),
    [KIM]: makeEntity({ name: "Kim Y" }, "person", KIM),
    [ACME]: makeEntity({ name: "Acme" }, "company", ACME),
    [NOTE1]: makeEntity({ name: "N", body: "old" }, "note", NOTE1),
  };
  journal = [];
  store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in stored).map((id) => [id, stored[id]])),
  );
  store.changesetStore.page.mockImplementation(async (_id: string, offset: number, limit: number) =>
    journal.slice(offset, offset + limit),
  );
});

const on = () => asRuntimeStore(store);

function anchorAt(entity: { type: string; id: string } | null, entityFound = true): AnchorRecord {
  return { key: "agent-a", entity, entityFound } as AnchorRecord;
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

describe("submit", () => {
  it("a clean plan: compare-and-set on the version the pass saw, with the note given", async () => {
    journal = [rename(1, PAT, "Pat B", { name: "Pat" })];
    store.changesetStore.submit.mockResolvedValue(changeset({ version: 6, submittedAt: NOW, note: "please review" }));

    const view = await submitChangeset("full_lens", null, CS, "please review", on());

    expect(store.changesetStore.submit).toHaveBeenCalledWith(CS, 5, "please review");
    expect(view).toMatchObject({ state: "submitted", version: 6, note: "please review", submittedAt: NOW });
    // No lock and no transaction around the pass (V5 d).
    expect(store.transaction).not.toHaveBeenCalled();
    expect(store.changesetStore.lockForCommit).not.toHaveBeenCalled();
  });

  it("without a note, the stored note stays", async () => {
    store.changesetStore.submit.mockResolvedValue(changeset({ version: 6, submittedAt: NOW }));
    await submitChangeset("full_lens", null, CS, undefined, on());
    expect(store.changesetStore.submit).toHaveBeenCalledWith(CS, 5, "start note");
  });

  it("a note over 1,000 characters is a 422", async () => {
    await expect(submitChangeset("full_lens", null, CS, "x".repeat(1001), on())).rejects.toBeInstanceOf(ValidationError);
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("already submitted is a 409", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW }));
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' is already submitted`),
    );
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("a lock-free fault is a 422 with the violations, and the changeset stays live", async () => {
    journal = [rename(1, KIM, "Kim X", { name: "Kim" }), rename(2, GONE, "x", { name: "x" })];
    const error = await submitChangeset("full_lens", null, CS, "n", on()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("The changeset was not submitted; it stays live");
    expect((error as ValidationError).details).toEqual({
      violations: [
        { seq: 1, kind: "drift", message: `Entity '${KIM}' changed since this write was staged; unstage and restage it` },
        { seq: 2, kind: "missing", message: `Entity '${GONE}' no longer exists` },
      ],
      total: 2,
    });
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("a version changed since the pass is a 409; a changeset gone meanwhile is not found", async () => {
    store.changesetStore.submit.mockResolvedValue(null);
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' changed during the submit; try again`),
    );
    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(null);
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' not found`),
    );
  });

  it("an anchored changeset whose anchor is dangling, or at an entity the lens hides, is a 409 with v1's texts", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ anchorKey: "agent-a" }));
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    // Through the plain lens URL too: the stored anchor counts.
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError(
        "Anchor 'agent-a' is dangling: its entity no longer exists, so every write is refused until a person re-anchors it",
      ),
    );

    invalidateLoadedSchemaCache();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "department", id: DEPT }));
    await expect(submitChangeset("hr_view", "agent-a", CS, "n", on())).rejects.toThrow(
      new ConflictError("Anchor 'agent-a' points at an entity that lens 'hr_view' does not show, so every write is refused"),
    );
    expect(store.changesetStore.submit).not.toHaveBeenCalled();
  });

  it("an anchor deleted since is left to the commit; an anchored one submits", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ anchorKey: "agent-a" }));
    store.changesetStore.submit.mockResolvedValue(changeset({ anchorKey: "agent-a", submittedAt: NOW, version: 6 }));
    store.anchorStore.getAnchor.mockResolvedValue(null);
    await submitChangeset("full_lens", null, CS, "n", on());
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: ACME }));
    await submitChangeset("full_lens", null, CS, "n", on());
    expect(store.changesetStore.submit).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Unsubmit
// ---------------------------------------------------------------------------

describe("unsubmit", () => {
  beforeEach(() => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW }));
  });

  it("back to live, the note replaced, on any URL, a dangling anchor's included", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW, anchorKey: "agent-a" }));
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    store.changesetStore.unsubmit.mockResolvedValue(changeset({ version: 7, note: "fix T2", anchorKey: "agent-a" }));

    const view = await unsubmitChangeset("full_lens", "agent-a", CS, "fix T2", on());

    expect(store.changesetStore.unsubmit).toHaveBeenCalledWith(CS, "fix T2");
    expect(view).toMatchObject({ state: "live", version: 7, note: "fix T2", submittedAt: null });
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

  it("a live changeset is a 409, also one unsubmitted after the read; gone is not found", async () => {
    store.changesetStore.get.mockResolvedValue(changeset());
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

  it("stage is a 409 with nothing appended", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW }));
    await expect(
      stage("full_lens", null, CS, { operation: "delete_entity", typeKey: "person", id: PAT }, on()),
    ).rejects.toThrow(new ConflictError(submittedText));
    expect(store.changesetStore.append).not.toHaveBeenCalled();
  });

  it("a submit landing after the stage's read: the store refuses the append, and it is a 409", async () => {
    store.getEntity.mockResolvedValue(stored[PAT]);
    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(changeset({ submittedAt: NOW }));
    store.changesetStore.append.mockResolvedValue(null);
    await expect(
      stage("full_lens", null, CS, { operation: "delete_entity", typeKey: "person", id: PAT }, on()),
    ).rejects.toThrow(new ConflictError(submittedText));

    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(null);
    await expect(
      stage("full_lens", null, CS, { operation: "delete_entity", typeKey: "person", id: PAT }, on()),
    ).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
  });

  it("unstage is a 409, also when the submit lands after the read", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW }));
    await expect(unstage("full_lens", null, CS, 1, on())).rejects.toThrow(new ConflictError(submittedText));
    expect(store.changesetStore.unstage).not.toHaveBeenCalled();

    store.changesetStore.get.mockResolvedValueOnce(changeset()).mockResolvedValueOnce(changeset({ submittedAt: NOW }));
    store.changesetStore.unstage.mockResolvedValue(false);
    await expect(unstage("full_lens", null, CS, 1, on())).rejects.toThrow(new ConflictError(submittedText));
  });

  it("a submitted changeset older than 7 days is read, not swept", async () => {
    store.changesetStore.get.mockResolvedValue(
      changeset({ submittedAt: NOW, lastChangeAt: new Date(Date.now() - 30 * 24 * 3_600_000) }),
    );
    await expect(getChangeset("full_lens", null, CS, 0, 100, on())).resolves.toMatchObject({ state: "submitted" });
    expect(store.changesetStore.sweep).not.toHaveBeenCalled();
  });

  it("a commit with a stale version is a 409 before anything is read or locked", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW }));
    await expect(commitChangeset("full_lens", null, CS, 4, on())).rejects.toThrow(
      new ConflictError(`Changeset '${CS}' changed since you looked: version 5, not 4`),
    );
    expect(store.changesetStore.page).not.toHaveBeenCalled();
    expect(store.transaction).not.toHaveBeenCalled();
    expect(store.changesetStore.touch).not.toHaveBeenCalled();
  });

  it("a rejected commit keeps it as it was: no state or version change, only the last change refreshed", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW }));
    journal = [rename(1, KIM, "Kim X", { name: "Kim" })];
    await expect(commitChangeset("full_lens", null, CS, 5, on())).rejects.toBeInstanceOf(ValidationError);
    expect(store.changesetStore.touch).toHaveBeenCalledWith(CS);
    expect(store.changesetStore.unsubmit).not.toHaveBeenCalled();
    expect(store.changesetStore.discard).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function summary(overrides: Partial<ChangesetSummary>): ChangesetSummary {
  return {
    ...changeset(),
    operations: {},
    typeKeys: [],
    ...overrides,
  };
}

describe("list", () => {
  it("sweeps first, passes the binding, and answers the fields in the store's order", async () => {
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt(null));
    store.changesetStore.list.mockResolvedValue([
      summary({ id: "b", submittedAt: NOW, anchorKey: "agent-a", writeCount: 3, operations: { create_entity: 2, delete_entity: 1 }, typeKeys: ["company", "person"] }),
      summary({ id: "a", writeCount: 0 }),
    ]);

    const list = await listChangesets("full_lens", "agent-a", on());

    expect(store.changesetStore.sweep).toHaveBeenCalledTimes(1);
    expect(store.changesetStore.list).toHaveBeenCalledWith("lens-1", "agent-a");
    expect(list).toEqual([
      {
        id: "b",
        state: "submitted",
        version: 5,
        note: "start note",
        anchor: "agent-a",
        writeCount: 3,
        operations: { create_entity: 2, delete_entity: 1 },
        types: ["company", "person"],
        notVisible: 0,
        createdAt: NOW,
        lastChangeAt: expect.any(Date),
        submittedAt: NOW,
      },
      expect.objectContaining({ id: "a", state: "live", writeCount: 0, operations: {}, types: [], notVisible: 0 }),
    ]);
  });

  it("an unknown anchor is not found", async () => {
    await expect(listChangesets("full_lens", "nope", on())).rejects.toThrow(new NotFoundError("Anchor 'nope' not found"));
    expect(store.changesetStore.list).not.toHaveBeenCalled();
  });

  it("types apply the lens as it is now: a hidden type key is left out and counted", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    store.changesetStore.list.mockResolvedValue([
      summary({ typeKeys: ["belongs_to", "department", "person", "works_for"], writeCount: 4 }),
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

describe("review read", () => {
  it("names resolved, before → after for updates, and the markers of the pass, on the page", async () => {
    store.getRelation.mockImplementation(async (_type: string, id: string) =>
      id === R1 ? makeRelation({ role: "dev" }, { relationId: R1, fromEntityId: PAT, toEntityId: ACME }) : null,
    );
    journal = [
      row(1, { typeKey: "company", mintedId: NEWCO, arguments: { properties: { name: "Newco" }, parentRelation: null, relationId: null } }),
      rename(2, PAT, "Pat B", { name: "Pat" }),
      row(3, {
        operation: "create_relation",
        typeKey: "works_for",
        mintedId: R2,
        arguments: { fromEntityId: PAT, toEntityId: NEWCO, properties: { role: "dev" } },
      }),
      rename(4, KIM, "Kim X", { name: "Kim" }),
      row(5, { operation: "update_relation", typeKey: "works_for", targetId: R1, arguments: { properties: { role: "lead" } }, base: { role: "dev" } }),
      row(6, { operation: "create_relation", typeKey: "works_for", mintedId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", arguments: { fromEntityId: PAT, toEntityId: GHOST, properties: {} } }),
      rename(7, GONE, "x", { name: "x" }),
      row(8, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: "new text" } }, base: { body: documentHash("old") } }),
    ];

    const read = await getChangeset("full_lens", null, CS, 1, 7, on());
    const bySeq = Object.fromEntries(read.writes.map((w) => [w.seq, w]));

    expect(read.writes.map((w) => w.seq)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    // One batched entity read for the page.
    expect(store.getEntitiesByIds.mock.calls.filter(([, defs]) => defs !== undefined).length).toBeGreaterThanOrEqual(1);
    expect(bySeq[2]).toMatchObject({ type: "person", id: PAT, name: "Pat", before: { name: "Pat" }, after: { name: "Pat B" }, markers: [] });
    // A minted end is named by its staged create, even off the page.
    expect(bySeq[3]).toMatchObject({ from: { id: PAT, name: "Pat" }, to: { id: NEWCO, name: "Newco" }, before: null, after: { role: "dev" } });
    expect(bySeq[4]).toMatchObject({ name: "Kim Y", before: { name: "Kim Y" }, after: { name: "Kim X" } });
    expect(bySeq[4]!.markers).toEqual([{ kind: "drift", message: `Entity '${KIM}' changed since this write was staged; unstage and restage it` }]);
    expect(bySeq[5]).toMatchObject({ from: { id: PAT, name: "Pat" }, to: { id: ACME, name: "Acme" }, before: { role: "dev" }, after: { role: "lead" }, markers: [] });
    expect(bySeq[6]).toMatchObject({ to: { id: GHOST, name: null } });
    expect(bySeq[6]!.markers.map((m) => m.kind)).toEqual(["dangling"]);
    expect(bySeq[7]).toMatchObject({ name: null, before: null });
    expect(bySeq[7]!.markers.map((m) => m.kind)).toEqual(["missing"]);
    // Documents as the reads stub them.
    expect(bySeq[8]).toMatchObject({ name: "N", before: { body: { document: true, length: 3 } }, after: { body: { document: true, length: 8 } } });
  });

  it("a create's parent is named; an update of a staged create has no before", async () => {
    invalidateLoadedSchemaCache();
    const full = schema();
    full.relationTypes.find((rt: Row) => rt.key === "belongs_to").parent = "target";
    store.getFullSchemaWithLensInclusions.mockResolvedValue(full);
    journal = [
      row(1, {
        typeKey: "department",
        mintedId: DEPT,
        arguments: { properties: { name: "Ops" }, parentRelation: { type: "belongs_to", parentId: ACME, properties: {} }, relationId: R2 },
      }),
      row(2, { operation: "update_entity", typeKey: "department", targetId: DEPT, arguments: { properties: { name: "Ops 2" } } }),
    ];
    const read = await getChangeset("full_lens", null, CS, 0, 100, on());
    expect(read.writes[0]).toMatchObject({ name: "Ops", parent: { id: ACME, name: "Acme" }, after: { name: "Ops" } });
    expect(read.writes[1]).toMatchObject({ name: "Ops", before: null, after: { name: "Ops 2" }, markers: [] });
  });

  it("through a scoped lens nothing hidden appears: no hidden type, property, name or value", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    stored[DEPT] = makeEntity({ name: "Secret Dept" }, "department", DEPT);
    journal = [
      // Staged before the lens hid `age`.
      row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { name: "P2", age: 50 } }, base: { name: "Pat", age: 41 } }),
      row(2, { typeKey: "department", mintedId: DEPT, arguments: { properties: { name: "Hidden New" }, parentRelation: null, relationId: null } }),
      row(3, { operation: "delete_entity", typeKey: "department", targetId: DEPT, arguments: {} }),
      row(4, { operation: "delete_entity", typeKey: "person", targetId: PAT, arguments: {} }),
    ];

    const read = await getChangeset("hr_view", null, CS, 0, 100, on());
    const [update, create, remove, del] = read.writes;

    expect(update).toMatchObject({ type: "person", arguments: { properties: { name: "P2" } }, before: { name: "Pat" }, after: { name: "P2" } });
    expect(update!.markers.map((m) => m.kind)).toEqual(["not_visible"]);
    for (const hidden of [create, remove]) {
      expect(hidden).toEqual({
        seq: hidden!.seq,
        operation: hidden!.operation,
        type: null,
        id: null,
        arguments: {},
        createdAt: NOW,
        before: null,
        after: null,
        markers: [{ kind: "not_visible", message: "The type of this write is no longer visible through lens 'hr_view'" }],
      });
    }
    expect(del).toMatchObject({ type: "person", name: "Pat", markers: [] });
    const text = JSON.stringify(read);
    for (const secret of ['"age"', ":41", ":50", "department", "Secret Dept", "Hidden New", DEPT]) {
      expect(text).not.toContain(secret);
    }
  });
});
