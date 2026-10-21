/**
 * The lifecycle of a changeset over mocked stores: submit (the lock-free
 * pass, the compare-and-set on the version, the anchor refusal), unsubmit
 * with its required note, the refusals while submitted, the list as the
 * lens shows it, and the review reads: names, before, current and after, and
 * markers, with no staged arguments, documents as stubs, the staged document
 * text, one entity as the changeset leaves it, and nothing the lens hides.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { AnchorRecord, ChangesetRecord, ChangesetSummary, ChangesetWriteRecord } from "../../src/core/ports.js";
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
  makeEntity,
  makeFullSchema,
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
    before: null,
    createdAt: NOW,
    ...overrides,
  };
}

const rename = (seq: number, id: string, name: string, before: Row | null): ChangesetWriteRecord =>
  row(seq, { operation: "update_entity", typeKey: "person", targetId: id, arguments: { properties: { name } }, before });

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
  store.getEntitiesByIdsHashed.mockImplementation(async (ids: string[], documentKeys: Record<string, string[]>) =>
    hashedById(stored, ids, documentKeys),
  );
  store.changesetStore.findMintedAmong.mockImplementation(async (_id: string, ids: string[]) =>
    journal.filter((write) => write.mintedId !== null && ids.includes(write.mintedId)),
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

  it("a lock-free fault is a 422 with the violations, and the changeset stays a draft", async () => {
    journal = [rename(1, KIM, "Kim X", { name: "Kim" }), rename(2, GONE, "x", { name: "x" })];
    const error = await submitChangeset("full_lens", null, CS, "n", on()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("The changeset was not submitted; it stays a draft");
    expect((error as ValidationError).details).toEqual({
      violations: [
        { seq: 1, kind: "drift", message: "Changed since this write was staged" },
        { seq: 2, kind: "missing", message: "Deleted since this write was staged" },
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

  it("an anchored changeset whose anchor is dangling, or at an entity the lens hides, is a 409 with no fix hint", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ anchorKey: "agent-a" }));
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    // Through the plain lens URL too: the stored anchor counts.
    await expect(submitChangeset("full_lens", null, CS, "n", on())).rejects.toThrow(
      new ConflictError("Anchor 'agent-a' is dangling"),
    );

    invalidateLoadedSchemaCache();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "department", id: DEPT }));
    await expect(submitChangeset("hr_view", "agent-a", CS, "n", on())).rejects.toThrow(
      new ConflictError("Anchor 'agent-a' points at an entity that lens 'hr_view' does not show"),
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

  it("back to draft, the note replaced, on any URL, a dangling anchor's included", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ submittedAt: NOW, anchorKey: "agent-a" }));
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    store.changesetStore.unsubmit.mockResolvedValue(changeset({ version: 7, note: "fix T2", anchorKey: "agent-a" }));

    const view = await unsubmitChangeset("full_lens", "agent-a", CS, "fix T2", on());

    expect(store.changesetStore.unsubmit).toHaveBeenCalledWith(CS, "fix T2");
    expect(view).toMatchObject({ state: "draft", version: 7, note: "fix T2", submittedAt: null });
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
      expect.objectContaining({ id: "a", state: "draft", writeCount: 0, operations: {}, types: [], notVisible: 0 }),
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
  it("names resolved, before, current and after for updates, and the markers of the pass, on the page", async () => {
    store.getRelationsByIds.mockResolvedValue({
      [R1]: makeRelation({ role: "dev" }, { relationId: R1, fromEntityId: PAT, toEntityId: ACME }),
    });
    journal = [
      row(1, { typeKey: "company", mintedId: NEWCO, arguments: { properties: { name: "Newco" } } }),
      rename(2, PAT, "Pat B", { name: "Pat" }),
      row(3, {
        operation: "create_relation",
        typeKey: "works_for",
        mintedId: R2,
        arguments: { fromEntityId: PAT, toEntityId: NEWCO, properties: { role: "dev" } },
      }),
      rename(4, KIM, "Kim X", { name: "Kim" }),
      row(5, { operation: "update_relation", typeKey: "works_for", targetId: R1, arguments: { properties: { role: "lead" } }, before: { role: "dev" } }),
      row(6, { operation: "create_relation", typeKey: "works_for", mintedId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", arguments: { fromEntityId: PAT, toEntityId: GHOST, properties: {} } }),
      rename(7, GONE, "x", { name: "x" }),
      row(8, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: "new text" } }, before: { body: recordedDocument("old") } }),
    ];

    const read = await getChangeset("full_lens", null, CS, 1, 7, on());
    const bySeq = Object.fromEntries(read.writes.map((w) => [w.seq, w]));

    expect(read.writes.map((w) => w.seq)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    // The page alone: one journal read, one lookup of the creates its ids
    // name, one batched read each of its stored relations and entities.
    expect(store.changesetStore.page).toHaveBeenCalledTimes(1);
    expect(store.changesetStore.findMintedAmong).toHaveBeenCalledTimes(1);
    expect(store.getRelationsByIds).toHaveBeenCalledTimes(1);
    expect(store.getEntitiesByIdsHashed).toHaveBeenCalledTimes(1);
    expect(store.getEntitiesByIdsHashed.mock.calls[0]![1]).toEqual({ note: ["body"] });
    expect(bySeq[2]).toMatchObject({ type: "person", id: PAT, name: "Pat", before: { name: "Pat" }, current: { name: "Pat" }, after: { name: "Pat B" }, markers: [] });
    // A minted end is named by its staged create, even off the page.
    expect(bySeq[3]).toMatchObject({ from: { id: PAT, name: "Pat" }, to: { id: NEWCO, name: "Newco" }, before: null, current: null, after: { role: "dev" } });
    // Drift: current differs from before, the value staged against.
    expect(bySeq[4]).toMatchObject({ name: "Kim Y", before: { name: "Kim" }, current: { name: "Kim Y" }, after: { name: "Kim X" } });
    expect(bySeq[4]!.markers).toEqual([{ kind: "drift", message: "Changed since this write was staged" }]);
    expect(bySeq[5]).toMatchObject({ from: { id: PAT, name: "Pat" }, to: { id: ACME, name: "Acme" }, before: { role: "dev" }, current: { role: "dev" }, after: { role: "lead" }, markers: [] });
    expect(bySeq[6]).toMatchObject({ to: { id: GHOST, name: null } });
    expect(bySeq[6]!.markers.map((m) => m.kind)).toEqual(["dangling"]);
    // A target gone since staging keeps its before; it has no current.
    expect(bySeq[7]).toMatchObject({ name: null, before: { name: "x" }, current: null });
    expect(bySeq[7]!.markers.map((m) => m.kind)).toEqual(["missing"]);
    // Documents: before, current and after as the reads stub them; no text.
    expect(bySeq[8]).toMatchObject({
      name: "N",
      before: { body: { document: true, length: 3 } },
      current: { body: { document: true, length: 3 } },
      after: { body: { document: true, length: 8 } },
    });
    // No write shows its staged arguments, nor the staged text or its hash.
    for (const write of read.writes) expect(write).not.toHaveProperty("arguments");
    const text = JSON.stringify(read);
    expect(text).not.toContain("new text");
    expect(text).not.toContain(recordedDocument("old").sha256 as string);
  });

  it("a document before recorded without a length shows a stub with length null", async () => {
    journal = [
      row(1, {
        operation: "update_entity",
        typeKey: "note",
        targetId: NOTE1,
        arguments: { properties: { body: "new text" } },
        before: { body: { sha256: recordedDocument("old").sha256 } },
      }),
    ];
    const read = await getChangeset("full_lens", null, CS, 0, 100, on());
    expect(read.writes[0]).toMatchObject({
      before: { body: { document: true, length: null } },
      current: { body: { document: true, length: 3 } },
      markers: [],
    });
  });

  it("a create staged with its parent relation is two rows, the relation's ends named; an update of a staged create has no before and no current", async () => {
    invalidateLoadedSchemaCache();
    const full = schema();
    const belongsTo = full.relationTypes.find((rt: Row) => rt.key === "belongs_to");
    belongsTo.parent = "target";
    belongsTo.properties.push({ key: "since", displayName: "Since", dataType: "string", required: false, defaultValue: null });
    store.getFullSchemaWithLensInclusions.mockResolvedValue(full);
    journal = [
      row(1, { typeKey: "department", mintedId: DEPT, arguments: { properties: { name: "Ops" } } }),
      row(2, {
        operation: "create_relation",
        typeKey: "belongs_to",
        mintedId: R2,
        arguments: { fromEntityId: DEPT, toEntityId: ACME, properties: { since: "2020" } },
      }),
      row(3, { operation: "update_entity", typeKey: "department", targetId: DEPT, arguments: { properties: { name: "Ops 2" } } }),
    ];
    const read = await getChangeset("full_lens", null, CS, 0, 100, on());
    expect(read.writes[0]).toMatchObject({ operation: "create_entity", id: DEPT, name: "Ops", after: { name: "Ops" } });
    expect(read.writes[0]).not.toHaveProperty("parent");
    expect(read.writes[1]).toMatchObject({
      operation: "create_relation",
      type: "belongs_to",
      id: R2,
      from: { id: DEPT, name: "Ops" },
      to: { id: ACME, name: "Acme" },
      after: { since: "2020" },
      markers: [],
    });
    expect(read.writes[2]).toMatchObject({ name: "Ops", before: null, current: null, after: { name: "Ops 2" }, markers: [] });
  });

  it("a page judges its own writes: at any offset its markers and names are the whole journal's, and the pass's", async () => {
    const R3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const UNSTAGED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    store.getRelationsByIds.mockImplementation(async (ids: string[]) =>
      Object.fromEntries(
        ids
          .filter((id) => id === R1)
          .map((id) => [id, makeRelation({ role: "dev" }, { relationId: R1, fromEntityId: PAT, toEntityId: ACME })]),
      ),
    );
    journal = [
      row(1, { typeKey: "company", mintedId: NEWCO, arguments: { properties: { name: "Newco" } } }),
      row(2, { operation: "create_relation", typeKey: "works_for", mintedId: R2, arguments: { fromEntityId: PAT, toEntityId: NEWCO, properties: {} } }),
      rename(3, KIM, "Kim X", { name: "Kim" }),
      // An update of a relation a create off the page minted: its ends from that create.
      row(4, { operation: "update_relation", typeKey: "works_for", targetId: R2, arguments: { properties: { role: "lead" } } }),
      row(5, { operation: "create_relation", typeKey: "works_for", mintedId: R3, arguments: { fromEntityId: GHOST, toEntityId: PAT, properties: {} } }),
      rename(6, GONE, "x", { name: "x" }),
      row(7, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: "new" } }, before: { body: recordedDocument("older") } }),
      row(8, { operation: "update_relation", typeKey: "works_for", targetId: R1, arguments: { properties: { role: "lead" } }, before: { role: "boss" } }),
      row(9, { operation: "update_entity", typeKey: "company", targetId: NEWCO, arguments: { properties: { name: "Newco 2" } } }),
      // What a create since unstaged minted.
      rename(10, UNSTAGED, "y", null),
      row(11, { operation: "delete_relation", typeKey: "works_for", targetId: R2, arguments: {} }),
    ];

    const whole = await getChangeset("full_lens", null, CS, 0, 100, on());
    const pass = await lockFreePass(await loadSchema("full_lens", on()), CS, on());
    for (const write of whole.writes) {
      const faults = pass.faults.filter((fault) => fault.seq === write.seq).map(({ kind, message }) => ({ kind, message }));
      expect(write.markers).toEqual(faults);
    }
    expect(Object.fromEntries(whole.writes.map((w) => [w.seq, w.markers.map((m) => m.kind)]))).toEqual({
      1: [], 2: [], 3: ["drift"], 4: [], 5: ["dangling"], 6: ["missing"], 7: ["drift"], 8: ["drift"], 9: [], 10: ["dangling"], 11: [],
    });
    expect(whole.writes[3]).toMatchObject({ from: { id: PAT, name: "Pat" }, to: { id: NEWCO, name: "Newco" } });
    expect(whole.writes[6]).toMatchObject({ current: { body: { document: true, length: 3 } } });
    expect(whole.writes[8]).toMatchObject({ name: "Newco", before: null, current: null });

    for (const limit of [1, 3]) {
      for (let offset = 0; offset < journal.length; offset += 1) {
        const page = await getChangeset("full_lens", null, CS, offset, limit, on());
        expect(page.writes).toEqual(whole.writes.slice(offset, offset + limit));
      }
    }
  });

  it("through a scoped lens nothing hidden appears: no hidden type, property, name or value", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    // A last change at noon yesterday: unexpired, and its timestamp cannot
    // contain the hidden values searched for below (":41", ":50").
    const today = new Date();
    const noonYesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1, 12));
    store.changesetStore.get.mockResolvedValue(changeset({ lastChangeAt: noonYesterday }));
    stored[DEPT] = makeEntity({ name: "Secret Dept" }, "department", DEPT);
    journal = [
      // Staged before the lens hid `age`.
      row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { name: "P2", age: 50 } }, before: { name: "Pat", age: 41 } }),
      row(2, { typeKey: "department", mintedId: DEPT, arguments: { properties: { name: "Hidden New" } } }),
      row(3, { operation: "delete_entity", typeKey: "department", targetId: DEPT, arguments: {} }),
      row(4, { operation: "delete_entity", typeKey: "person", targetId: PAT, arguments: {} }),
    ];

    const read = await getChangeset("hr_view", null, CS, 0, 100, on());
    const [update, create, remove, del] = read.writes;

    expect(update).toMatchObject({ type: "person", before: { name: "Pat" }, current: { name: "Pat" }, after: { name: "P2" } });
    expect(update!.markers.map((m) => m.kind)).toEqual(["not_visible"]);
    for (const hidden of [create, remove]) {
      expect(hidden).toEqual({
        seq: hidden!.seq,
        operation: hidden!.operation,
        type: null,
        id: null,
        createdAt: NOW,
        before: null,
        current: null,
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

// ---------------------------------------------------------------------------
// The staged document read
// ---------------------------------------------------------------------------

describe("staged document read", () => {
  const NOTE2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const text = "# Plan\n\nStep one 😀, step two.";
  const read = (id: string, offset = 0, limit: number | null = null, lensKey = "full_lens", anchorKey: string | null = null) =>
    getStagedDocument(lensKey, anchorKey, CS, "note", id, "body", offset, limit, on());

  beforeEach(() => {
    journal = [
      row(1, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: "first" } }, before: { body: recordedDocument("old") } }),
      row(3, { typeKey: "note", mintedId: NOTE2, arguments: { properties: { name: "New", body: text } } }),
      row(4, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { name: "N2" } }, before: { name: "N" } }),
      row(6, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: text } }, before: { body: recordedDocument("old") } }),
    ];
  });

  it("the last staged write that sets the property wins, whole, as the document read answers", async () => {
    expect(await read(NOTE1)).toEqual({ propertyKey: "body", content: text, offset: 0, length: 29, totalLength: 29 });
  });

  it("slices by characters (code points) as the document read does", async () => {
    expect(await read(NOTE1, 17, 3)).toEqual({ propertyKey: "body", content: "😀, ", offset: 17, length: 3, totalLength: 29 });
    expect(await read(NOTE1, 25)).toEqual({ propertyKey: "body", content: "two.", offset: 25, length: 4, totalLength: 29 });
    expect(await read(NOTE1, 100, 5)).toEqual({ propertyKey: "body", content: "", offset: 100, length: 0, totalLength: 29 });
  });

  it("an entity created in this changeset reads the value its create sets; a later update would win", async () => {
    expect((await read(NOTE2)).content).toBe(text);
    journal.push(row(7, { operation: "update_entity", typeKey: "note", targetId: NOTE2, arguments: { properties: { body: "rewritten" } } }));
    expect((await read(NOTE2)).content).toBe("rewritten");
  });

  it("a staged null reads as the empty text", async () => {
    journal.push(row(8, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: null } }, before: { body: recordedDocument(text) } }));
    expect(await read(NOTE1)).toEqual({ propertyKey: "body", content: "", offset: 0, length: 0, totalLength: 0 });
  });

  it("reads the whole journal, page by page", async () => {
    journal = [
      ...Array.from({ length: 600 }, (_, i) => rename(i + 1, PAT, `P${i}`, { name: "Pat" })),
      row(601, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: "late" } } }),
    ];
    expect((await read(NOTE1)).content).toBe("late");
    expect(store.changesetStore.page).toHaveBeenCalledWith(CS, 500, 500);
  });

  it("not found when no staged write sets it: another entity, another property, a delete", async () => {
    journal = [
      row(1, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { name: "N2" } }, before: { name: "N" } }),
      row(2, { operation: "delete_entity", typeKey: "note", targetId: NOTE2 }),
    ];
    await expect(read(NOTE1)).rejects.toThrow(
      new NotFoundError(`No staged write of changeset '${CS}' sets 'body' of entity '${NOTE1}'`),
    );
    await expect(read(NOTE2)).rejects.toThrow(NotFoundError);
  });

  it("not found when a later staged write deletes the entity: a commit leaves no text", async () => {
    const gone = (id: string) => new NotFoundError(`Changeset '${CS}' deletes entity '${id}': a commit leaves no 'body'`);
    journal.push(row(7, { operation: "delete_entity", typeKey: "note", targetId: NOTE1 }));
    await expect(read(NOTE1)).rejects.toThrow(gone(NOTE1));
    // An entity created in this changeset and deleted again.
    journal.push(row(8, { operation: "delete_entity", typeKey: "note", targetId: NOTE2 }));
    await expect(read(NOTE2)).rejects.toThrow(gone(NOTE2));
    // A delete of another entity, or one before the write that sets it, does not count.
    journal = [
      row(1, { operation: "delete_entity", typeKey: "note", targetId: NOTE1 }),
      row(2, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: "after" } } }),
      row(3, { operation: "delete_entity", typeKey: "note", targetId: NOTE2 }),
    ];
    expect((await read(NOTE1)).content).toBe("after");
  });

  it("not found for an unknown changeset, type, or a property that is not a document", async () => {
    store.changesetStore.get.mockResolvedValue(null);
    await expect(read(NOTE1)).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    store.changesetStore.get.mockResolvedValue(changeset());
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

  it("through the anchored URL: bound to its anchor, and readable while submitted", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ anchorKey: "agent-a", submittedAt: NOW }));
    expect((await read(NOTE1, 0, null, "full_lens", "agent-a")).content).toBe(text);
    expect(store.changesetStore.get).toHaveBeenCalledWith(CS, "lens-1", "agent-a");
  });
});

// ---------------------------------------------------------------------------
// The staged entity read
// ---------------------------------------------------------------------------

describe("staged entity read", () => {
  const read = (type: string, id: string, lensKey = "full_lens", anchorKey: string | null = null) =>
    getStagedEntity(lensKey, anchorKey, CS, type, id, on());

  beforeEach(() => {
    store.getEntity.mockImplementation(async (type: string, id: string) =>
      stored[id]?._entityTypeKey === type ? stored[id] : null,
    );
    store.changesetStore.writesOn.mockImplementation(async (_id: string, objectId: string) =>
      journal.filter((write) => write.mintedId === objectId || write.targetId === objectId),
    );
  });

  it("a stored entity with its updates folded by seq, a null removing a key; its writes as the review shows them", async () => {
    journal = [
      rename(2, PAT, "Pat B", { name: "Pat" }),
      rename(4, KIM, "Kim X", { name: "Kim Y" }),
      row(5, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { age: null, email: "p@x" } }, before: { age: 41 } }),
      rename(7, PAT, "Pat C", { name: "Pat" }),
    ];

    const view = await read("person", PAT);

    expect(view.entity).toEqual({ _id: PAT, _entityTypeKey: "person", _createdAt: NOW, _updatedAt: NOW, name: "Pat C", email: "p@x" });
    expect(view.deleted).toBe(false);
    expect(view.writes.map((w) => w.seq)).toEqual([2, 5, 7]);
    expect(view.writes[0]).toMatchObject({ operation: "update_entity", type: "person", id: PAT, name: "Pat", before: { name: "Pat" }, current: { name: "Pat" }, after: { name: "Pat B" }, markers: [] });
    expect(view.writes[1]).toMatchObject({ before: { age: 41, email: null }, current: { age: 41, email: null }, after: { age: null, email: "p@x" } });
    // One journal query and one entity read: no lock-free pass over the journal.
    expect(store.changesetStore.writesOn).toHaveBeenCalledWith(CS, PAT);
    expect(store.changesetStore.page).not.toHaveBeenCalled();
    expect(store.getEntity).toHaveBeenCalledTimes(1);
    expect(store.getEntitiesByIdsHashed).not.toHaveBeenCalled();
  });

  it("markers judged on its own writes: drift against the stored row, a value the lens no longer accepts", async () => {
    stored[PAT] = makeEntity({ name: "Pat Changed", age: 41 }, "person", PAT);
    journal = [
      rename(2, PAT, "Pat B", { name: "Pat" }),
      row(3, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { age: "old" } }, before: { age: 41 } }),
    ];
    const view = await read("person", PAT);
    expect(view.writes[0]).toMatchObject({ current: { name: "Pat Changed" }, markers: [{ kind: "drift", message: "Changed since this write was staged" }] });
    expect(view.writes[1]!.markers.map((m) => m.kind)).toEqual(["replay"]);
  });

  it("an entity this changeset creates: the create's values, no defaults applied, then its updates", async () => {
    journal = [
      row(3, { typeKey: "person", mintedId: GHOST, arguments: { properties: { name: "New", email: "n@x" } } }),
      row(4, { operation: "update_entity", typeKey: "person", targetId: GHOST, arguments: { properties: { name: "Newer" } } }),
    ];
    const view = await read("person", GHOST);
    // `active` has a default; the commit applies it, not this read.
    expect(view.entity).toEqual({ _id: GHOST, _entityTypeKey: "person", name: "Newer", email: "n@x" });
    expect(view.writes[0]).toMatchObject({ operation: "create_entity", id: GHOST, name: "New", after: { name: "New", email: "n@x" }, markers: [] });
    expect(view.writes[1]).toMatchObject({ name: "New", before: null, current: null, after: { name: "Newer" }, markers: [] });
  });

  it("documents as stubs: a staged value measured afresh, not by the stored length", async () => {
    stored[NOTE1] = makeEntity({ name: "N", body: "old", _doc_body_length: 3 }, "note", NOTE1);
    journal = [row(2, { operation: "update_entity", typeKey: "note", targetId: NOTE1, arguments: { properties: { body: "new text" } }, before: { body: recordedDocument("old") } })];
    const view = await read("note", NOTE1);
    expect(view.entity).toMatchObject({ name: "N", body: { document: true, length: 8 } });
    expect(view.entity).not.toHaveProperty("_doc_body_length");
    expect(view.writes[0]).toMatchObject({ before: { body: { document: true, length: 3 } }, after: { body: { document: true, length: 8 } } });
    expect(JSON.stringify(view)).not.toContain("new text");
  });

  it("deleted when its last staged write deletes it, the values folded still shown; a later write clears it", async () => {
    journal = [
      rename(2, PAT, "Pat B", { name: "Pat" }),
      row(3, { operation: "delete_entity", typeKey: "person", targetId: PAT }),
    ];
    let view = await read("person", PAT);
    expect(view).toMatchObject({ deleted: true, entity: { name: "Pat B" } });
    expect(view.writes[1]).toMatchObject({ operation: "delete_entity", id: PAT, name: "Pat", before: null, after: null, markers: [] });
    // As the staged document read: a write after the delete counts.
    journal.push(rename(4, PAT, "Pat C", { name: "Pat" }));
    view = await read("person", PAT);
    expect(view).toMatchObject({ deleted: false, entity: { name: "Pat C" } });
    // An entity created and deleted again in this changeset.
    journal = [
      row(5, { typeKey: "person", mintedId: GHOST, arguments: { properties: { name: "New" } } }),
      row(6, { operation: "delete_entity", typeKey: "person", targetId: GHOST }),
    ];
    expect(await read("person", GHOST)).toMatchObject({ deleted: true, entity: { name: "New" } });
  });

  it("only the entity's own writes: a relation write the store hands back is left out", async () => {
    journal = [
      rename(2, PAT, "Pat B", { name: "Pat" }),
      row(3, { operation: "delete_relation", typeKey: "works_for", targetId: PAT }),
    ];
    expect((await read("person", PAT)).writes.map((w) => w.seq)).toEqual([2]);
  });

  it("not found: an unknown changeset, a type the lens hides, an entity neither stored nor created by this changeset", async () => {
    store.changesetStore.get.mockResolvedValue(null);
    await expect(read("person", PAT)).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    store.changesetStore.get.mockResolvedValue(changeset());
    await expect(read("nope", PAT)).rejects.toThrow(new NotFoundError("Entity type 'nope' not found"));
    // Stored as another type.
    await expect(read("company", PAT)).rejects.toThrow(new NotFoundError(`Entity '${PAT}' not found`));
    // Only an update whose create was unstaged: nothing a commit could leave.
    journal = [row(2, { operation: "update_entity", typeKey: "person", targetId: GHOST, arguments: { properties: { name: "x" } } })];
    await expect(read("person", GHOST)).rejects.toThrow(new NotFoundError(`Entity '${GHOST}' not found`));
    invalidateLoadedSchemaCache();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    await expect(read("department", DEPT, "hr_view")).rejects.toThrow(new NotFoundError("Entity type 'department' not found"));
  });

  it("through a scoped lens: no hidden property in the entity or the writes, a write setting one marked not visible", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    journal = [
      row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { name: "P2", age: 50 } }, before: { name: "Pat", age: 41 } }),
    ];
    const view = await read("person", PAT, "hr_view");
    expect(view.entity).toEqual({ _id: PAT, _entityTypeKey: "person", _createdAt: NOW, _updatedAt: NOW, name: "P2" });
    expect(view.writes[0]).toMatchObject({ before: { name: "Pat" }, current: { name: "Pat" }, after: { name: "P2" } });
    expect(view.writes[0]!.markers.map((m) => m.kind)).toEqual(["not_visible"]);
    expect(JSON.stringify(view)).not.toContain('"age"');
  });

  it("through the anchored URL: bound to its anchor, and readable while submitted", async () => {
    store.changesetStore.get.mockResolvedValue(changeset({ anchorKey: "agent-a", submittedAt: NOW }));
    journal = [rename(2, PAT, "Pat B", { name: "Pat" })];
    expect((await read("person", PAT, "full_lens", "agent-a")).entity).toMatchObject({ name: "Pat B" });
    expect(store.changesetStore.get).toHaveBeenCalledWith(CS, "lens-1", "agent-a");
  });
});
