/**
 * Commit validation over mocked stores: the lock-free pass (step 0b) and
 * what it finds per staged object and value; drift re-checked under the
 * lock (step 1); the end-state rules after the phases (step 3): children
 * of a staged delete, the parent rules, endpoint types and anchor
 * coverage; the cap on listed violations; and messages that name nothing
 * the lens hides.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ValidationError } from "../../src/core/exceptions.js";
import type { ChangesetRecord, ParentLink, RulesetRecord, StagedObjectRecord } from "../../src/core/ports.js";
import { commitChangeset, recordedDocument, lockFreePass } from "../../src/runtime/changesets.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext, loadSchema } from "../../src/runtime/schemaCache.js";
import {
  NOW,
  asRuntimeStore,
  createMockRuntimeStore,
  fingerprinted,
  hashedById,
  inTouchOrder,
  makeEntity,
  makeRelation,
  makeScopedSchema,
  makeUnscopedSchema,
  stagedObject,
  type MockRuntimeStore,
  type StagedValues,
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
    number: 1,
    rulesetKey: null,
    version: 7,
    note: null,
    submittedAt: null,
    createdAt: NOW,
    lastChangeAt: new Date(),
    objectCount: 1,
    ...overrides,
  };
}

const update = (id: string, type: string, values: StagedValues): StagedObjectRecord =>
  stagedObject(id, "update", type, values);
const rename = (id: string, name: string, before: string): StagedObjectRecord => update(id, "person", { name: [name, before] });
const deleteOf = (type: string, id: string): StagedObjectRecord => stagedObject(id, "delete", type);
const relate = (type: string, id: string, from: string, to: string): StagedObjectRecord =>
  stagedObject(id, "create", type, {}, [from, to]);
/** A department created under `parentId`, as staging stages it: the
 * entity's create, then its `belongs_to` relation's. */
const department = (id: string, parentId: string, relationId: string): StagedObjectRecord[] => [
  stagedObject(id, "create", "department", { name: ["New"] }),
  relate("belongs_to", relationId, id, parentId),
];

let store: MockRuntimeStore;
/** The changeset as seeded before each pass or commit, and its objects. */
let record: Partial<ChangesetRecord>;
let staged: StagedObjectRecord[];
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
  record = {};
  staged = [];
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
  store.getEntityTypes.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in stored).map((id) => [id, stored[id]!._entityTypeKey])),
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

/** Stage these objects, first touched in this order. */
function changesetOf(objects: StagedObjectRecord[]): void {
  staged = objects;
}

/** The changeset as staged, seeded afresh: a commit deletes it. */
function seed(): void {
  store.changesetStore.seed(changeset({ objectCount: staged.length, ...record }), inTouchOrder(staged));
}

function commit(lensKey = "full_lens") {
  seed();
  return commitChangeset(lensKey, null, CS, undefined, asRuntimeStore(store));
}

async function violations(promise: Promise<unknown>): Promise<Row[]> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ValidationError);
  const details = (error as ValidationError).details as Row;
  expect(details.total).toBe(details.violations.length);
  return details.violations;
}

async function pass(objects: StagedObjectRecord[], lensKey = "full_lens") {
  changesetOf(objects);
  seed();
  return lockFreePass(await loadSchema(lensKey, asRuntimeStore(store)), CS, asRuntimeStore(store));
}


const DRIFTED = "Changed since it was staged";
const GONE_SINCE = "Deleted since it was staged";

/** The helper schema with a document `bio` on person. */
function withBio(): Row {
  const full = schema();
  full.entityTypes.find((et: Row) => et.key === "person").properties.push({
    key: "bio",
    displayName: "Bio",
    dataType: "document",
    required: false,
    defaultValue: null,
  });
  return full;
}

describe("the lock-free pass (step 0b)", () => {
  it("a clean changeset has no faults, and names the stored targets to lock", async () => {
    const result = await pass([
      rename(PAT, "Pat M", "Pat"),
      ...department(NEW, ACME, NEW_REL),
      deleteOf("department", D1),
      stagedObject(R1, "create", "works_for", { role: ["x"] }, [PAT, ACME]),
    ]);
    expect(result.faults).toEqual([]);
    expect(result.targets.sort()).toEqual([D1, PAT].sort());
    expect(result.stored.get(PAT)).toBe("person");
    expect(result.objects.map((o) => o.objectId)).toEqual([PAT, NEW, NEW_REL, D1, R1]);
  });

  it("not_visible: a hidden type, or a property it sets, named by neither; nothing else checked", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    const result = await pass(
      [
        deleteOf("department", D1),
        update(GHOST, "person", { age: [3, undefined] }),
        // A parent relation's object: its end GHOST is not judged.
        relate("belongs_to", NEW_REL, D1, GHOST),
        rename(PAT, "Pat M", "Pat"),
      ],
      "hr_view",
    );
    const through = "is no longer visible through lens 'hr_view'";
    expect(result.faults).toEqual([
      { object: D1, kind: "not_visible", message: `The type of this entity ${through}` },
      { object: GHOST, kind: "not_visible", message: `A property this entity sets ${through}` },
      { object: NEW_REL, kind: "not_visible", message: `The type of this relation ${through}` },
    ]);
    for (const fault of result.faults) {
      expect(fault.message).not.toMatch(/department|age|belongs_to/);
    }
  });

  it("replay: a value the lens no longer accepts, on its property; a create's required value missing", async () => {
    const result = await pass([update(PAT, "person", { age: ["old", undefined] }), stagedObject(NEW, "create", "person", { email: ["e"] })]);
    expect(result.faults).toEqual([
      { object: PAT, property: "age", kind: "replay", message: expect.stringMatching(/^Instance validation failed: age: /) },
      { object: NEW, property: "name", kind: "replay", message: "Instance validation failed: name: Required property missing" },
    ]);
  });

  it("missing: the stored target of an update is gone", async () => {
    delete stored[PAT];
    expect((await pass([rename(PAT, "Pat M", "Pat")])).faults).toEqual([{ object: PAT, kind: "missing", message: GONE_SINCE }]);
  });

  it("missing: a relation update's target is gone; stored, it passes; of another type, it is not the target", async () => {
    const relation = stagedObject(R1, "update", "works_for", { role: ["lead", "dev"] }, [PAT, ACME]);
    expect((await pass([relation])).faults).toEqual([{ object: R1, kind: "missing", message: GONE_SINCE }]);
    store.getRelationsByIds.mockResolvedValue({ [R1]: makeRelation({ role: "dev" }, { relationId: R1 }) });
    expect((await pass([relation])).faults).toEqual([]);
    expect(store.getRelationsByIds).toHaveBeenCalledWith([R1]);
    store.getRelationsByIds.mockResolvedValue({ [R1]: makeRelation({ role: "dev" }, { relationId: R1, relationTypeKey: "reports_to" }) });
    expect((await pass([relation])).faults.map((f) => f.kind)).toEqual(["missing"]);
  });

  it("dangling: an end neither stored nor created here, or deleted here, named by its role", async () => {
    const D2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const R2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    store.getRelationsByIds.mockResolvedValue({ [R1]: makeRelation({}, { relationId: R1, relationTypeKey: "reports_to", fromEntityId: PAT, toEntityId: KIM }) });
    const result = await pass([
      relate("works_for", NEW_REL, GHOST, ACME),
      ...department(D2, GHOST, R2),
      deleteOf("person", KIM),
      relate("reports_to", NEW, KIM, PAT),
      stagedObject(R1, "update", "reports_to", {}, [PAT, KIM]),
    ]);
    expect(result.faults).toEqual([
      { object: NEW_REL, kind: "dangling", message: "The source end is neither stored nor created in this changeset" },
      { object: R2, kind: "dangling", message: "The target end is neither stored nor created in this changeset" },
      { object: NEW, kind: "dangling", message: "The source end is deleted in this changeset" },
      { object: R1, kind: "dangling", message: "The target end is deleted in this changeset" },
    ]);
  });

  it("control: ends and parents created in this changeset resolve", async () => {
    const result = await pass([stagedObject(NEW, "create", "person", { name: ["N"] }), relate("reports_to", NEW_REL, NEW, PAT)]);
    expect(result.faults).toEqual([]);
  });

  it("a delete whose target is gone is no fault: the commit counts it as done", async () => {
    expect((await pass([deleteOf("department", GHOST)])).faults).toEqual([]);
  });

  describe("drift, per value", () => {
    it("a changed value of a staged key drifts; another key's change does not", async () => {
      stored[PAT]!.name = "Pat Mobile";
      expect((await pass([rename(PAT, "Pat W", "Pat")])).faults).toEqual([{ object: PAT, property: "name", kind: "drift", message: DRIFTED }]);
      stored[PAT]!.name = "Pat";
      stored[PAT]!.age = 50;
      expect((await pass([rename(PAT, "Pat W", "Pat")])).faults).toEqual([]);
    });

    it("each value on its own: only the drifted one is marked", async () => {
      stored[PAT] = { ...stored[PAT]!, name: "Pat Mobile", age: 41 };
      expect((await pass([update(PAT, "person", { name: ["Pat W", "Pat"], age: [42, 41] })])).faults).toEqual([
        { object: PAT, property: "name", kind: "drift", message: DRIFTED },
      ]);
    });

    it("absent and null differ", async () => {
      // Pat stores `email: null`; a before recorded while the key was absent drifts.
      expect((await pass([update(PAT, "person", { email: ["p@x", undefined] })])).faults.map((f) => f.kind)).toEqual(["drift"]);
      expect((await pass([update(PAT, "person", { email: ["p@x", null] })])).faults).toEqual([]);
    });

    it("a document value is compared by its hash", async () => {
      store.getFullSchemaWithLensInclusions.mockResolvedValue(withBio());
      stored[PAT]!.bio = "old text";
      const object = update(PAT, "person", { bio: ["new", recordedDocument("old text")] });
      expect((await pass([object])).faults).toEqual([]);
      stored[PAT]!.bio = "other text";
      expect((await pass([object])).faults.map((f) => f.kind)).toEqual(["drift"]);
    });

    it("a document is compared by its hash alone: a before recorded without a length still matches", async () => {
      store.getFullSchemaWithLensInclusions.mockResolvedValue(withBio());
      stored[PAT]!.bio = "old text";
      const { sha256 } = recordedDocument("old text");
      const object = update(PAT, "person", { bio: ["new", { sha256 }] });
      expect((await pass([object])).faults).toEqual([]);
      // The same length, another text: drift.
      stored[PAT]!.bio = "new text";
      expect((await pass([object])).faults.map((f) => f.kind)).toEqual(["drift"]);
    });
  });

  it("a fault rejects before BEGIN: no transaction, no commit lock; the last change is refreshed", async () => {
    delete stored[PAT];
    changesetOf([rename(PAT, "Pat M", "Pat")]);
    expect(await violations(commit())).toEqual([{ object: PAT, kind: "missing", message: GONE_SINCE }]);
    expect(store.transaction).not.toHaveBeenCalled();
    expect(store.changesetStore.lockForCommit).not.toHaveBeenCalled();
    expect(store.changesetStore.touch).toHaveBeenCalledWith(CS);
  });

  it("lists the first 100 faults by first touch, and the total", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    changesetOf(ids.map((id) => rename(id, "x", "Pat")));
    const error = (await commit().catch((e: unknown) => e)) as ValidationError;
    const details = error.details as Row;
    expect(details.total).toBe(150);
    expect(details.violations).toHaveLength(100);
    expect(details.violations.map((v: Row) => v.object)).toEqual(ids.slice(0, 100));
  });
});

describe("step 1: under the lock", () => {
  it("locks every stored target and re-checks drift on the locked rows", async () => {
    changesetOf([rename(PAT, "Pat W", "Pat"), deleteOf("department", D1)]);
    store.lockTargets.mockResolvedValue([{ id: PAT, kind: "entity", typeKey: "person", props: { name: "Pat Mobile" } }]);
    expect(await violations(commit())).toEqual([{ object: PAT, property: "name", kind: "drift", message: DRIFTED }]);
    expect(store.lockTargets.mock.calls[0]![0].sort()).toEqual([PAT, D1].sort());
    expect(store.lockTargets.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.changesetStore.lockForCommit.mock.invocationCallOrder[0]!,
    );
    expect(store.updateEntity).not.toHaveBeenCalled();
  });

  it("a document is re-read under the lock as its hash and length, and compared by its hash", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(withBio());
    stored[PAT]!.bio = "old text";
    changesetOf([update(PAT, "person", { bio: ["new", recordedDocument("old text")] })]);
    // Changed after the pass, as the lock reads it.
    store.lockTargets.mockResolvedValueOnce([
      { id: PAT, kind: "entity", typeKey: "person", props: { name: "Pat", bio: recordedDocument("other text") } },
    ]);
    expect(await violations(commit())).toEqual([{ object: PAT, property: "bio", kind: "drift", message: DRIFTED }]);
    expect(store.lockTargets.mock.calls[0]![1]).toEqual({ person: ["bio"] });
    // Unchanged, it commits.
    expect(await commit()).toEqual({ committed: 1, alreadyGone: [] });
  });

  it("a changeset changed between the pass and the lock is a 409", async () => {
    changesetOf([rename(PAT, "Pat W", "Pat")]);
    store.changesetStore.lockForCommit.mockResolvedValue(changeset({ version: 8 }));
    const error = await commit().catch((e: unknown) => e);
    expect(error).toEqual(new ConflictError(`Changeset '${CS}' changed during the commit; try again`));
    expect(store.updateEntity).not.toHaveBeenCalled();
  });
});

describe("step 3: the end state", () => {
  it("has_children: a recorded child neither deleted nor re-parented; the message names no entity", async () => {
    store.childrenOf.mockResolvedValue([link("belongs_to", R1, ACME, D1)]);
    changesetOf([deleteOf("company", ACME)]);
    parents[D1] = [];
    expect(await violations(commit())).toEqual([{ object: ACME, kind: "has_children", message: "Still has children" }]);
    expect(store.changesetStore.deleteCommitted).not.toHaveBeenCalled();
  });

  it("has_children control: the child re-parented, or deleted too", async () => {
    store.childrenOf.mockResolvedValueOnce([link("belongs_to", R1, ACME, D1)]).mockResolvedValue([]);
    changesetOf([deleteOf("company", ACME), relate("belongs_to", NEW_REL, D1, BETA)]);
    parents[D1] = [link("belongs_to", NEW_REL, BETA, D1)];
    expect(await commit()).toEqual({ committed: 2, alreadyGone: [] });

    store.childrenOf.mockResolvedValueOnce([link("belongs_to", R1, ACME, D1)]).mockResolvedValue([]);
    changesetOf([deleteOf("company", ACME), deleteOf("department", D1)]);
    // Both deleted by the commit: the end state's type read finds neither.
    store.getEntityTypes.mockResolvedValue({});
    store.getEntitiesByIdsHashed.mockClear();
    expect(await commit()).toMatchObject({ committed: 2 });
    // The end state is read by type alone; only the pass reads properties.
    expect(store.getEntityTypes).toHaveBeenCalled();
    expect(store.getEntitiesByIdsHashed).toHaveBeenCalledTimes(1);
  });

  it("two_parents: a child given a second parent; control: a parent move, the old link deleted in the same changeset", async () => {
    changesetOf([relate("belongs_to", NEW_REL, D1, BETA)]);
    parents[D1] = [link("belongs_to", R1, ACME, D1), link("belongs_to", NEW_REL, BETA, D1)];
    expect(await violations(commit())).toEqual([
      { object: NEW_REL, kind: "two_parents", message: "The source end already has a parent" },
    ]);

    // Staged in any order: the commit deletes relations before it creates them.
    changesetOf([relate("belongs_to", NEW_REL, D1, BETA), stagedObject(R1, "delete", "belongs_to", {}, [D1, ACME])]);
    parents[D1] = [link("belongs_to", NEW_REL, BETA, D1)];
    expect(await commit()).toMatchObject({ committed: 2 });
    expect(store.deleteRelation.mock.invocationCallOrder.at(-1)!).toBeLessThan(store.createRelation.mock.invocationCallOrder.at(-1)!);
  });

  it("two_parents on a create staged with its parent relation: each relation names its child end", async () => {
    stored[NEW] = makeEntity({ name: "New" }, "department", NEW);
    changesetOf([...department(NEW, ACME, R1), relate("belongs_to", NEW_REL, NEW, BETA)]);
    parents[NEW] = [link("belongs_to", R1, ACME, NEW), link("belongs_to", NEW_REL, BETA, NEW)];
    expect(await violations(commit())).toEqual([
      { object: R1, kind: "two_parents", message: "The source end already has a parent" },
      { object: NEW_REL, kind: "two_parents", message: "The source end already has a parent" },
    ]);
  });

  it("cycle: a parent link that closes a cycle, and a self-loop", async () => {
    // Kim reports to Pat, staged; Pat already reports to Kim.
    changesetOf([relate("reports_to", NEW_REL, KIM, PAT), relate("reports_to", R1, PAT, PAT)]);
    parents[KIM] = [link("reports_to", NEW_REL, PAT, KIM)];
    parents[PAT] = [link("reports_to", "r-old", KIM, PAT), link("reports_to", R1, PAT, PAT)];
    const found = await violations(commit());
    expect(found).toContainEqual({ object: NEW_REL, kind: "cycle", message: "This parent link would close a cycle" });
    expect(found).toContainEqual({ object: R1, kind: "cycle", message: "This parent link would close a cycle" });
    expect(found.filter((v) => v.object === NEW_REL).map((v) => v.kind)).toEqual(["cycle"]);
  });

  it("endpoint_type: a relation end of another type, a create's parent relation's too, the type not named", async () => {
    changesetOf([relate("works_for", NEW_REL, PAT, D1), ...department(NEW, KIM, R1)]);
    const found = await violations(commit());
    expect(found).toEqual([
      { object: NEW_REL, kind: "endpoint_type", message: "The target end does not have the type relation type 'works_for' requires" },
      { object: R1, kind: "endpoint_type", message: "The target end does not have the type relation type 'belongs_to' requires" },
    ]);
    for (const v of found) expect(v.message).not.toMatch(/department|person|company/);
  });

  it("an end of the wrong type is not judged by the parent rules", async () => {
    // Pat (a person) as the department end of belongs_to: one violation.
    changesetOf([relate("belongs_to", NEW_REL, PAT, BETA)]);
    parents[PAT] = [link("reports_to", "r-old", KIM, PAT), link("belongs_to", NEW_REL, BETA, PAT)];
    expect((await violations(commit())).map((v) => v.kind)).toEqual(["endpoint_type"]);
  });

  it("every kind found is listed in one rejection", async () => {
    store.childrenOf.mockResolvedValueOnce([link("belongs_to", R1, ACME, D1)]).mockResolvedValue([]);
    changesetOf([relate("works_for", NEW_REL, PAT, D1), deleteOf("company", ACME)]);
    parents[D1] = [];
    expect((await violations(commit())).map((v) => [v.object, v.kind])).toEqual([
      [ACME, "has_children"],
      [NEW_REL, "endpoint_type"],
    ]);
  });
});

describe("anchor coverage", () => {
  const anchorAt = (anchor: { type: string; id: string } | null, anchorFound = true): RulesetRecord => ({
    key: "agent-a",
    anchor,
    anchorFound,
  }) as RulesetRecord;
  const code = (): StagedObjectRecord => update(D1, "department", { code: ["x", undefined] });

  beforeEach(() => {
    record = { rulesetKey: "agent-a" };
    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "company", id: ACME }));
  });

  it("covered before and after: commits; the anchor is read inside the transaction", async () => {
    changesetOf([code()]);
    expect(await commit()).toMatchObject({ committed: 1 });
    expect(store.rulesetStore.get).toHaveBeenCalledWith("agent-a");
    expect(store.rulesetStore.get.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.changesetStore.lockForCommit.mock.invocationCallOrder[0]!,
    );
  });

  it("through the ruleset's URL at write access 'propose': commits, the ruleset read once, inside the transaction", async () => {
    store.rulesetStore.get.mockResolvedValue({ ...anchorAt({ type: "company", id: ACME }), writeAccess: "propose" });
    changesetOf([code()]);
    seed();
    expect(await commitChangeset("full_lens", "agent-a", CS, undefined, asRuntimeStore(store))).toMatchObject({ committed: 1 });
    expect(store.rulesetStore.get).toHaveBeenCalledTimes(1);
    expect(store.rulesetStore.get.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.changesetStore.lockForCommit.mock.invocationCallOrder[0]!,
    );
  });

  it("not covered before: a touched entity outside the subtree", async () => {
    parents[D1] = [link("belongs_to", R1, BETA, D1)];
    changesetOf([code()]);
    expect(await violations(commit())).toEqual([
      { object: D1, kind: "outside_subtree", message: "Outside the anchor subtree of ruleset 'agent-a'" },
    ]);
  });

  it("not covered after: a create placed outside; its parent relation touches its stored parent; a free type is free", async () => {
    parents[NEW] = [link("belongs_to", R1, BETA, NEW)];
    stored[NEW] = makeEntity({ name: "New" }, "department", NEW);
    changesetOf([...department(NEW, BETA, R1), rename(PAT, "P", "Pat")]);
    expect(await violations(commit())).toEqual([
      { object: R1, kind: "outside_subtree", message: "Outside the anchor subtree of ruleset 'agent-a'" },
      { object: NEW, kind: "outside_subtree", message: "Would be outside the anchor subtree of ruleset 'agent-a' after the commit" },
    ]);
  });

  it("a re-point since staging makes the objects outside the new subtree violations", async () => {
    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "company", id: BETA }));
    changesetOf([code()]);
    expect(await violations(commit())).toEqual([
      { object: D1, kind: "outside_subtree", message: "Outside the anchor subtree of ruleset 'agent-a'" },
    ]);
  });

  it("a staged delete of an anchored entity", async () => {
    store.rulesetStore.list.mockResolvedValue([anchorAt({ type: "company", id: ACME }), { key: "b", anchor: { type: "department", id: D1 }, anchorFound: true }]);
    changesetOf([deleteOf("department", D1)]);
    expect(await violations(commit())).toEqual([
      { object: D1, kind: "deletes_anchor", message: "It is the anchor of a ruleset, so it cannot be deleted on this connection" },
    ]);
  });

  it("ruleset_gone, anchor_deleted, anchor_hidden: one violation on the whole changeset, no coverage checked", async () => {
    changesetOf([rename(PAT, "P", "Pat")]);
    store.rulesetStore.get.mockResolvedValue(null);
    expect(await violations(commit())).toEqual([
      { object: null, kind: "ruleset_gone", message: "Ruleset 'agent-a' no longer exists, so this changeset cannot be committed" },
    ]);

    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "company", id: ACME }, false));
    const [deleted] = await violations(commit());
    expect(deleted).toMatchObject({ object: null, kind: "anchor_deleted" });
    expect(deleted!.message).toContain("no longer exists");

    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema(true));
    invalidateLoadedSchemaCache();
    store.rulesetStore.get.mockResolvedValue(anchorAt({ type: "department", id: D1 }));
    const [hidden] = await violations(commit("hr_view"));
    expect(hidden).toEqual({
      object: null,
      kind: "anchor_hidden",
      message: "The anchor of ruleset 'agent-a' is an entity that lens 'hr_view' does not show",
    });
    expect(store.parentsOf).not.toHaveBeenCalledWith([PAT], expect.anything());
  });

  it("a ruleset without an anchor guards nothing", async () => {
    store.rulesetStore.get.mockResolvedValue(anchorAt(null, false));
    parents[D1] = [link("belongs_to", R1, BETA, D1)];
    changesetOf([code()]);
    expect(await commit()).toMatchObject({ committed: 1 });
  });
});
