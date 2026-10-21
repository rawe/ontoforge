/**
 * Commit validation over mocked stores: the lock-free pass (step 0b) and
 * what it finds per staged write; drift re-checked under the lock (step
 * 1); the end-state rules after the replay (step 3): children of a staged
 * delete, the parent rules, endpoint types and anchor coverage; the cap on
 * listed violations; and messages that name nothing the lens hides.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ValidationError } from "../../src/core/exceptions.js";
import type { AnchorRecord, ChangesetRecord, ChangesetWriteRecord, ParentLink } from "../../src/core/ports.js";
import { commitChangeset, recordedDocument, lockFreePass } from "../../src/runtime/changesets.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext, loadSchema } from "../../src/runtime/schemaCache.js";
import {
  NOW,
  asRuntimeStore,
  createMockRuntimeStore,
  fingerprinted,
  hashedById,
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
const D1 = "44444444-4444-4444-8444-444444444444";
const R1 = "55555555-5555-4555-8555-555555555555";
const NEW = "66666666-6666-4666-8666-666666666666";
const NEW_REL = "77777777-7777-4777-8777-777777777777";
const BETA = "88888888-8888-4888-8888-888888888888";
const GHOST = "99999999-9999-4999-8999-999999999999";
const KIM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The helper schema with `belongs_to` (department → company) and
 * `reports_to` (person → person) as parent relations whose parent is the
 * target; `scoped` is the lens `hr_view` (department, age and
 * belongs_to hidden). */
function schema(scoped = false): Row {
  const full = (scoped ? makeScopedSchema() : makeUnscopedSchema()) as Row;
  full.relationTypes.find((rt: Row) => rt.key === "belongs_to").parent = "target";
  full.relationTypes.push({
    relationTypeId: "rt-3",
    key: "reports_to",
    displayName: "Reports To",
    description: null,
    sourceKey: "person",
    targetKey: "person",
    properties: [],
    parent: "target",
  });
  if (scoped) full.relationInclusions.push({ key: "reports_to", properties: null });
  return full;
}

function changeset(overrides: Partial<ChangesetRecord> = {}): ChangesetRecord {
  return {
    id: CS,
    lensId: "lens-1",
    anchorKey: null,
    version: 7,
    note: null,
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
const deleteOf = (seq: number, type: string, id: string): ChangesetWriteRecord =>
  row(seq, { operation: "delete_entity", typeKey: type, targetId: id, arguments: {} });
const relate = (seq: number, type: string, id: string, from: string, to: string): ChangesetWriteRecord =>
  row(seq, { operation: "create_relation", typeKey: type, mintedId: id, arguments: { fromEntityId: from, toEntityId: to, properties: {} } });
/** A department created under `parentId`, as staging expands it: the
 * entity's create at `seq`, its `belongs_to` relation at `seq + 1`. */
const department = (seq: number, id: string, parentId: string, relationId: string): ChangesetWriteRecord[] => [
  row(seq, { operation: "create_entity", typeKey: "department", mintedId: id, arguments: { properties: { name: "New" } } }),
  relate(seq + 1, "belongs_to", relationId, id, parentId),
];

let store: MockRuntimeStore;
/** The entities as stored, by id. */
let stored: Record<string, Row>;
/** The parent links as stored, by child id. */
let parents: Record<string, ParentLink[]>;

function link(relationType: string, relationId: string, parentId: string, childId: string): ParentLink {
  return { relationType, relationId, parentId, childId };
}

beforeEach(() => {
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema());
  store.changesetStore.get.mockResolvedValue(changeset());
  store.changesetStore.lockForCommit.mockResolvedValue(changeset());
  stored = {
    [PAT]: makeEntity({ name: "Pat", email: null }, "person", PAT),
    [KIM]: makeEntity({ name: "Kim" }, "person", KIM),
    [ACME]: makeEntity({ name: "ACME" }, "company", ACME),
    [BETA]: makeEntity({ name: "BETA" }, "company", BETA),
    [D1]: makeEntity({ name: "Ops" }, "department", D1),
  };
  parents = { [D1]: [link("belongs_to", R1, ACME, D1)] };
  store.getEntitiesByIdsHashed.mockImplementation(async (ids: string[], documentKeys: Record<string, string[]>) =>
    hashedById(stored, ids, documentKeys),
  );
  store.parentsOf.mockImplementation(async (ids: string[]) => ids.flatMap((id) => parents[id] ?? []));
  store.lockTargets.mockImplementation(async (ids: string[], documentKeys: Record<string, string[]>) =>
    ids
      .filter((id) => id in stored)
      .map((id) => {
        const { _id, _entityTypeKey, _createdAt, _updatedAt, ...props } = stored[id]!;
        return { id, kind: "entity", typeKey: _entityTypeKey, props: fingerprinted(props, _entityTypeKey as string, documentKeys) };
      }),
  );
  store.createEntity.mockResolvedValue(makeEntity());
  store.createEntityWithParent.mockResolvedValue({ entity: makeEntity(), relation: makeRelation() });
  store.updateEntity.mockResolvedValue(makeEntity());
  store.deleteEntity.mockResolvedValue(true);
  store.createRelation.mockResolvedValue(makeRelation());
  store.updateRelation.mockResolvedValue(makeRelation());
  store.deleteRelation.mockResolvedValue(true);
});

function journal(writes: ChangesetWriteRecord[]): void {
  store.changesetStore.page.mockImplementation(async (_id: string, offset: number, limit: number) =>
    writes.slice(offset, offset + limit),
  );
}

function commit(lensKey = "full_lens") {
  return commitChangeset(lensKey, null, CS, undefined, asRuntimeStore(store));
}

async function violations(promise: Promise<unknown>): Promise<Row[]> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ValidationError);
  const details = (error as ValidationError).details as Row;
  expect(details.total).toBe(details.violations.length);
  return details.violations;
}

async function pass(writes: ChangesetWriteRecord[], lensKey = "full_lens") {
  journal(writes);
  return lockFreePass(await loadSchema(lensKey, asRuntimeStore(store)), CS, asRuntimeStore(store));
}

describe("the lock-free pass (step 0b)", () => {
  it("a clean journal has no faults, and names the stored targets to lock", async () => {
    const result = await pass([
      rename(1, PAT, "Pat M", { name: "Pat" }),
      ...department(2, NEW, ACME, NEW_REL),
      rename(4, NEW, "x", null),
      deleteOf(5, "department", D1),
      relate(6, "works_for", R1, PAT, ACME),
      row(7, { operation: "update_relation", typeKey: "works_for", targetId: R1, arguments: { properties: { role: "x" } } }),
    ]);
    expect(result.faults).toEqual([]);
    expect(result.targets.sort()).toEqual([D1, PAT].sort());
    expect(result.stored.get(PAT)).toBe("person");
    expect([...result.minted.keys()]).toEqual([NEW, NEW_REL, R1]);
  });

  it("not_visible: a hidden type or property, named by neither; nothing else checked", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    const result = await pass(
      [
        deleteOf(1, "department", D1),
        row(2, { operation: "update_entity", typeKey: "person", targetId: GHOST, arguments: { properties: { age: 3 } }, before: {} }),
        // A parent relation's write: its end GHOST is not judged.
        relate(3, "belongs_to", NEW_REL, D1, GHOST),
        rename(4, PAT, "Pat M", { name: "Pat" }),
      ],
      "hr_view",
    );
    const through = "is no longer visible through lens 'hr_view'";
    expect(result.faults).toEqual([
      { seq: 1, kind: "not_visible", message: `The type of this write ${through}` },
      { seq: 2, kind: "not_visible", message: `A property this write sets ${through}` },
      { seq: 3, kind: "not_visible", message: `The type of this write ${through}` },
    ]);
    for (const fault of result.faults) {
      expect(fault.message).not.toMatch(/department|age|belongs_to/);
    }
  });

  it("replay: a value the lens no longer accepts, as the replay would meet it", async () => {
    const result = await pass([
      row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { age: "old" } }, before: {} }),
    ]);
    expect(result.faults).toHaveLength(1);
    expect(result.faults[0]).toMatchObject({ seq: 1, kind: "replay" });
    expect(result.faults[0]!.message).toMatch(/^Instance validation failed: age: /);
  });

  it("missing: an update target stored at staging is gone", async () => {
    delete stored[PAT];
    const result = await pass([rename(1, PAT, "Pat M", { name: "Pat" })]);
    expect(result.faults).toEqual([{ seq: 1, kind: "missing", message: "Deleted since this write was staged" }]);
  });

  it("missing: a relation update target stored at staging is gone; stored, it passes", async () => {
    const update = row(1, { operation: "update_relation", typeKey: "works_for", targetId: R1, arguments: { properties: { role: "lead" } }, before: { role: "dev" } });
    expect((await pass([update])).faults).toEqual([{ seq: 1, kind: "missing", message: "Deleted since this write was staged" }]);
    store.getRelationsByIds.mockResolvedValue({ [R1]: makeRelation({ role: "dev" }, { relationId: R1 }) });
    expect((await pass([update])).faults).toEqual([]);
    expect(store.getRelationsByIds).toHaveBeenCalledWith([R1]);
    // Of another type, it is not the target.
    store.getRelationsByIds.mockResolvedValue({ [R1]: makeRelation({ role: "dev" }, { relationId: R1, relationTypeKey: "reports_to" }) });
    expect((await pass([update])).faults.map((f) => f.kind)).toEqual(["missing"]);
  });

  it("dangling: what a create since unstaged minted (V6), or an end neither stored nor minted, named by its role", async () => {
    const result = await pass([
      rename(2, NEW, "x", null),
      relate(3, "works_for", NEW_REL, GHOST, ACME),
      ...department(4, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", GHOST, R1),
    ]);
    expect(result.faults).toEqual([
      { seq: 2, kind: "dangling", message: "Neither stored nor created in this changeset" },
      { seq: 3, kind: "dangling", message: "The source end is neither stored nor created in this changeset" },
      { seq: 5, kind: "dangling", message: "The target end is neither stored nor created in this changeset" },
    ]);
  });

  it("control: ends and parents minted by a create still in the journal resolve", async () => {
    const result = await pass([
      row(1, { operation: "create_entity", typeKey: "person", mintedId: NEW, arguments: { properties: { name: "N" } } }),
      relate(2, "reports_to", NEW_REL, NEW, PAT),
    ]);
    expect(result.faults).toEqual([]);
  });

  it("a delete whose target is gone is no fault: the replay counts it as done", async () => {
    expect((await pass([deleteOf(1, "department", GHOST)])).faults).toEqual([]);
  });

  describe("drift (V10)", () => {
    it("a changed value of a patched key drifts; another key's change does not", async () => {
      stored[PAT]!.name = "Pat Mobile";
      const result = await pass([rename(1, PAT, "Pat W", { name: "Pat" })]);
      expect(result.faults).toEqual([
        { seq: 1, kind: "drift", message: "Changed since this write was staged" },
      ]);
      stored[PAT]!.name = "Pat";
      stored[PAT]!.age = 50;
      expect((await pass([rename(1, PAT, "Pat W", { name: "Pat" })])).faults).toEqual([]);
    });

    it("a value changed and changed back is no drift", async () => {
      stored[PAT]!.name = "Pat";
      expect((await pass([rename(1, PAT, "Pat W", { name: "Pat" })])).faults).toEqual([]);
    });

    it("absent and null differ", async () => {
      // Pat stores `email: null`; a before staged while the key was absent drifts.
      const write = row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { email: "p@x" } }, before: {} });
      expect((await pass([write])).faults.map((f) => f.kind)).toEqual(["drift"]);
      expect((await pass([{ ...write, before: { email: null } }])).faults).toEqual([]);
    });

    it("a document value is compared by its hash", async () => {
      const full = schema();
      full.entityTypes.find((et: Row) => et.key === "person").properties.push({
        key: "bio",
        displayName: "Bio",
        dataType: "document",
        required: false,
        defaultValue: null,
      });
      store.getFullSchemaWithLensInclusions.mockResolvedValue(full);
      stored[PAT]!.bio = "old text";
      const write = row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { bio: "new" } }, before: { bio: recordedDocument("old text") } });
      expect((await pass([write])).faults).toEqual([]);
      invalidateLoadedSchemaCache();
      stored[PAT]!.bio = "other text";
      expect((await pass([write])).faults.map((f) => f.kind)).toEqual(["drift"]);
    });

    it("a document is compared by its hash alone: a before recorded without a length still matches", async () => {
      const full = schema();
      full.entityTypes.find((et: Row) => et.key === "person").properties.push({
        key: "bio",
        displayName: "Bio",
        dataType: "document",
        required: false,
        defaultValue: null,
      });
      store.getFullSchemaWithLensInclusions.mockResolvedValue(full);
      stored[PAT]!.bio = "old text";
      const { sha256 } = recordedDocument("old text");
      const write = row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { bio: "new" } }, before: { bio: { sha256 } } });
      expect((await pass([write])).faults).toEqual([]);
      invalidateLoadedSchemaCache();
      // The same length, another text: drift.
      stored[PAT]!.bio = "new text";
      expect((await pass([write])).faults.map((f) => f.kind)).toEqual(["drift"]);
    });
  });

  it("a fault rejects before BEGIN: no transaction, no commit lock; the last change is refreshed", async () => {
    delete stored[PAT];
    journal([rename(1, PAT, "Pat M", { name: "Pat" })]);
    expect(await violations(commit())).toEqual([{ seq: 1, kind: "missing", message: "Deleted since this write was staged" }]);
    expect(store.transaction).not.toHaveBeenCalled();
    expect(store.changesetStore.lockForCommit).not.toHaveBeenCalled();
    expect(store.changesetStore.touch).toHaveBeenCalledWith(CS);
  });

  it("lists the first 100 faults by seq, and the total", async () => {
    delete stored[PAT];
    journal(Array.from({ length: 150 }, (_, i) => rename(150 - i, PAT, "x", { name: "Pat" })).reverse());
    const error = (await commit().catch((e: unknown) => e)) as ValidationError;
    const details = error.details as Row;
    expect(details.total).toBe(150);
    expect(details.violations).toHaveLength(100);
    expect(details.violations.map((v: Row) => v.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});

describe("step 1: under the lock", () => {
  it("locks every stored target and re-checks drift on the locked rows", async () => {
    journal([rename(1, PAT, "Pat W", { name: "Pat" }), deleteOf(2, "department", D1)]);
    store.lockTargets.mockResolvedValue([{ id: PAT, kind: "entity", typeKey: "person", props: { name: "Pat Mobile" } }]);
    expect(await violations(commit())).toEqual([{ seq: 1, kind: "drift", message: "Changed since this write was staged" }]);
    expect(store.lockTargets.mock.calls[0]![0].sort()).toEqual([PAT, D1].sort());
    expect(store.lockTargets.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.changesetStore.lockForCommit.mock.invocationCallOrder[0]!,
    );
    expect(store.updateEntity).not.toHaveBeenCalled();
  });

  it("a document is re-read under the lock as its hash and length, and compared by its hash", async () => {
    const full = schema();
    full.entityTypes.find((et: Row) => et.key === "person").properties.push({
      key: "bio",
      displayName: "Bio",
      dataType: "document",
      required: false,
      defaultValue: null,
    });
    store.getFullSchemaWithLensInclusions.mockResolvedValue(full);
    stored[PAT]!.bio = "old text";
    journal([row(1, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { bio: "new" } }, before: { bio: recordedDocument("old text") } })]);
    // Changed after the pass, as the lock reads it.
    store.lockTargets.mockResolvedValueOnce([
      { id: PAT, kind: "entity", typeKey: "person", props: { name: "Pat", bio: recordedDocument("other text") } },
    ]);
    expect(await violations(commit())).toEqual([{ seq: 1, kind: "drift", message: "Changed since this write was staged" }]);
    expect(store.lockTargets.mock.calls[0]![1]).toEqual({ person: ["bio"] });
    // Unchanged, it commits.
    expect(await commit()).toEqual({ committed: 1, alreadyGone: [] });
  });

  it("a journal changed between the pass and the lock is a 409", async () => {
    journal([rename(1, PAT, "Pat W", { name: "Pat" })]);
    store.changesetStore.lockForCommit.mockResolvedValue(changeset({ version: 8 }));
    const error = await commit().catch((e: unknown) => e);
    expect(error).toEqual(new ConflictError(`Changeset '${CS}' changed during the commit; try again`));
    expect(store.updateEntity).not.toHaveBeenCalled();
  });
});

describe("step 3: the end state", () => {
  it("has_children: a recorded child neither deleted nor re-parented; the message names no entity", async () => {
    store.childrenOf.mockResolvedValue([link("belongs_to", R1, ACME, D1)]);
    journal([deleteOf(1, "company", ACME)]);
    parents[D1] = [];
    expect(await violations(commit())).toEqual([
      { seq: 1, kind: "has_children", message: "Still has children" },
    ]);
    expect(store.changesetStore.deleteWithJournal).not.toHaveBeenCalled();
  });

  it("has_children control: the child re-parented, or deleted too", async () => {
    store.childrenOf.mockResolvedValueOnce([link("belongs_to", R1, ACME, D1)]).mockResolvedValue([]);
    journal([deleteOf(1, "company", ACME), relate(2, "belongs_to", NEW_REL, D1, BETA)]);
    parents[D1] = [link("belongs_to", NEW_REL, BETA, D1)];
    expect(await commit()).toEqual({ committed: 2, alreadyGone: [] });

    store.childrenOf.mockResolvedValueOnce([link("belongs_to", R1, ACME, D1)]).mockResolvedValue([]);
    journal([deleteOf(1, "company", ACME), deleteOf(2, "department", D1)]);
    stored = { [ACME]: stored[ACME]!, [D1]: stored[D1]! };
    store.getEntitiesByIdsHashed
      .mockImplementationOnce(async () => ({ [ACME]: stored[ACME], [D1]: stored[D1] }))
      .mockResolvedValue({});
    expect(await commit()).toMatchObject({ committed: 2 });
  });

  it("two_parents: a child given a second parent; control: the old link deleted first", async () => {
    journal([relate(1, "belongs_to", NEW_REL, D1, BETA)]);
    parents[D1] = [link("belongs_to", R1, ACME, D1), link("belongs_to", NEW_REL, BETA, D1)];
    expect(await violations(commit())).toEqual([
      { seq: 1, kind: "two_parents", message: "The source end already has a parent" },
    ]);

    journal([row(1, { operation: "delete_relation", typeKey: "belongs_to", targetId: R1, arguments: {} }), relate(2, "belongs_to", NEW_REL, D1, BETA)]);
    parents[D1] = [link("belongs_to", NEW_REL, BETA, D1)];
    expect(await commit()).toMatchObject({ committed: 2 });
  });

  it("two_parents on a create staged with its parent relation: each relation names its child end", async () => {
    stored[NEW] = makeEntity({ name: "New" }, "department", NEW);
    journal([...department(1, NEW, ACME, R1), relate(3, "belongs_to", NEW_REL, NEW, BETA)]);
    parents[NEW] = [link("belongs_to", R1, ACME, NEW), link("belongs_to", NEW_REL, BETA, NEW)];
    expect(await violations(commit())).toEqual([
      { seq: 2, kind: "two_parents", message: "The source end already has a parent" },
      { seq: 3, kind: "two_parents", message: "The source end already has a parent" },
    ]);
  });

  it("cycle: a parent link that closes a cycle, and a self-loop", async () => {
    // Kim reports to Pat, staged; Pat already reports to Kim.
    journal([relate(1, "reports_to", NEW_REL, KIM, PAT), relate(2, "reports_to", R1, PAT, PAT)]);
    parents[KIM] = [link("reports_to", NEW_REL, PAT, KIM)];
    parents[PAT] = [link("reports_to", "r-old", KIM, PAT), link("reports_to", R1, PAT, PAT)];
    const found = await violations(commit());
    expect(found).toContainEqual({ seq: 1, kind: "cycle", message: "This parent link would close a cycle" });
    expect(found).toContainEqual({ seq: 2, kind: "cycle", message: "This parent link would close a cycle" });
    expect(found.filter((v) => v.seq === 1).map((v) => v.kind)).toEqual(["cycle"]);
  });

  it("a link the changeset creates and then deletes is not judged", async () => {
    journal([relate(1, "belongs_to", NEW_REL, D1, BETA), row(2, { operation: "delete_relation", typeKey: "belongs_to", targetId: NEW_REL, arguments: {} })]);
    expect(await commit()).toMatchObject({ committed: 2 });
  });

  it("endpoint_type: a relation end of another type, a create's parent relation's too, the type not named", async () => {
    journal([relate(1, "works_for", NEW_REL, PAT, D1), ...department(2, NEW, KIM, R1)]);
    const found = await violations(commit());
    expect(found).toEqual([
      { seq: 1, kind: "endpoint_type", message: "The target end does not have the type relation type 'works_for' requires" },
      { seq: 3, kind: "endpoint_type", message: "The target end does not have the type relation type 'belongs_to' requires" },
    ]);
    for (const v of found) expect(v.message).not.toMatch(/department|person|company/);
  });

  it("an end of the wrong type is not judged by the parent rules, as in v1", async () => {
    // Pat (a person) as the department end of belongs_to: one violation.
    journal([relate(1, "belongs_to", NEW_REL, PAT, BETA)]);
    parents[PAT] = [link("reports_to", "r-old", KIM, PAT), link("belongs_to", NEW_REL, BETA, PAT)];
    expect((await violations(commit())).map((v) => v.kind)).toEqual(["endpoint_type"]);
  });

  it("every kind found is listed in one rejection, by seq", async () => {
    store.childrenOf.mockResolvedValueOnce([link("belongs_to", R1, ACME, D1)]).mockResolvedValue([]);
    journal([relate(1, "works_for", NEW_REL, PAT, D1), deleteOf(2, "company", ACME)]);
    parents[D1] = [];
    expect((await violations(commit())).map((v) => [v.seq, v.kind])).toEqual([
      [1, "endpoint_type"],
      [2, "has_children"],
    ]);
  });
});

describe("anchor coverage (V8, V42)", () => {
  const anchorAt = (entity: { type: string; id: string } | null, entityFound = true): AnchorRecord => ({
    key: "agent-a",
    entity,
    entityFound,
  });

  beforeEach(() => {
    store.changesetStore.get.mockResolvedValue(changeset({ anchorKey: "agent-a" }));
    store.changesetStore.lockForCommit.mockResolvedValue(changeset({ anchorKey: "agent-a" }));
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: ACME }));
  });

  it("covered before and after: commits; the anchor is read inside the transaction", async () => {
    journal([row(1, { operation: "update_entity", typeKey: "department", targetId: D1, arguments: { properties: { code: "x" } }, before: {} })]);
    expect(await commit()).toMatchObject({ committed: 1 });
    expect(store.anchorStore.getAnchor).toHaveBeenCalledWith("agent-a");
    expect(store.anchorStore.getAnchor.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.changesetStore.lockForCommit.mock.invocationCallOrder[0]!,
    );
  });

  it("not covered before: a touched entity outside the subtree", async () => {
    parents[D1] = [link("belongs_to", R1, BETA, D1)];
    journal([row(1, { operation: "update_entity", typeKey: "department", targetId: D1, arguments: { properties: { code: "x" } }, before: {} })]);
    expect(await violations(commit())).toEqual([
      { seq: 1, kind: "not_covered", message: "Not under anchor 'agent-a'" },
    ]);
  });

  it("not covered after: a create placed outside, or moved out; a free type is free", async () => {
    parents[NEW] = [link("belongs_to", R1, BETA, NEW)];
    stored[NEW] = makeEntity({ name: "New" }, "department", NEW);
    journal([
      ...department(1, NEW, BETA, R1),
      row(3, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { name: "P" } }, before: { name: "Pat" } }),
    ]);
    // The parent relation's write touches its stored parent BETA too.
    expect(await violations(commit())).toEqual([
      { seq: 1, kind: "not_covered", message: "Would not be under anchor 'agent-a' after the commit" },
      { seq: 2, kind: "not_covered", message: "Not under anchor 'agent-a'" },
    ]);
  });

  it("a re-point since staging makes the writes outside the new subtree violations", async () => {
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: BETA }));
    journal([row(1, { operation: "update_entity", typeKey: "department", targetId: D1, arguments: { properties: { code: "x" } }, before: {} })]);
    expect(await violations(commit())).toEqual([
      { seq: 1, kind: "not_covered", message: "Not under anchor 'agent-a'" },
    ]);
  });

  it("a staged delete of an anchored entity", async () => {
    store.anchorStore.listAnchors.mockResolvedValue([anchorAt({ type: "company", id: ACME }), { key: "b", entity: { type: "department", id: D1 }, entityFound: true }]);
    journal([deleteOf(1, "department", D1)]);
    expect(await violations(commit())).toEqual([
      { seq: 1, kind: "not_covered", message: "Anchored, so it cannot be deleted on an anchored connection" },
    ]);
  });

  it("anchor_gone, anchor_dangling, hidden: one violation on seq 0, no coverage checked", async () => {
    journal([row(3, { operation: "update_entity", typeKey: "person", targetId: PAT, arguments: { properties: { name: "P" } }, before: { name: "Pat" } })]);
    store.anchorStore.getAnchor.mockResolvedValue(null);
    expect(await violations(commit())).toEqual([
      { seq: 0, kind: "anchor_gone", message: "Anchor 'agent-a' no longer exists, so this changeset cannot be committed" },
    ]);

    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    const [dangling] = await violations(commit());
    expect(dangling).toMatchObject({ seq: 0, kind: "anchor_dangling" });
    expect(dangling!.message).toContain("is dangling");

    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    invalidateLoadedSchemaCache();
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt({ type: "department", id: D1 }));
    const [hidden] = await violations(commit("hr_view"));
    expect(hidden).toEqual({
      seq: 0,
      kind: "anchor_dangling",
      message: "Anchor 'agent-a' points at an entity that lens 'hr_view' does not show",
    });
    expect(store.parentsOf).not.toHaveBeenCalledWith([PAT], expect.anything());
  });

  it("an unanchored anchor guards nothing", async () => {
    store.anchorStore.getAnchor.mockResolvedValue(anchorAt(null, false));
    parents[D1] = [link("belongs_to", R1, BETA, D1)];
    journal([row(1, { operation: "update_entity", typeKey: "department", targetId: D1, arguments: { properties: { code: "x" } }, before: {} })]);
    expect(await commit()).toMatchObject({ committed: 1 });
  });
});
