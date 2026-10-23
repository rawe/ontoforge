/**
 * The commit over mocked stores: the order of its steps, the version
 * check, the staged objects applied in fixed phases through the store's
 * write methods, idempotent deletes, the delete capture, a fault rolled
 * back as a 422, the errors that stay 409s, and the process limit. The
 * stored entities the objects name answer the lock-free pass
 * (`changesets-validation.test.ts` covers it).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { ChangesetRecord, StagedObjectRecord } from "../../src/core/ports.js";
import { applyObjects, commitChangeset, type Applied } from "../../src/runtime/changesets.js";
import {
  invalidateLoadedSchemaCache,
  invalidateSearchContext,
  loadSchema,
  loadSearchContext,
} from "../../src/runtime/schemaCache.js";
import {
  NOW,
  asRuntimeStore,
  createMockRuntimeStore,
  hashedById,
  inTouchOrder,
  makeEntity,
  makeRelation,
  makeUnscopedSchema,
  stagedObject,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, any>;

const CS = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222";
const ACME = "33333333-3333-4333-8333-333333333333";
const D1 = "44444444-4444-4444-8444-444444444444";
const R1 = "55555555-5555-4555-8555-555555555555";
const NEW = "66666666-6666-4666-8666-666666666666";
const NEW_REL = "77777777-7777-4777-8777-777777777777";
const R2 = "88888888-8888-4888-8888-888888888888";
const R3 = "99999999-9999-4999-8999-999999999999";

/** The helper schema (lens `full_lens`), with `belongs_to` (department →
 * company) as a parent relation whose parent is the target. */
function schema(): Row {
  const full = makeUnscopedSchema() as Row;
  full.relationTypes.find((rt: Row) => rt.key === "belongs_to").parent = "target";
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
    objectCount: 0,
    ...overrides,
  };
}

/** One staged object of each phase, staged in the reverse of the commit's
 * phases. */
function sixObjects(): StagedObjectRecord[] {
  return [
    stagedObject(D1, "delete", "department"),
    stagedObject(R2, "update", "works_for", { role: ["lead", "dev"] }, [P1, ACME]),
    stagedObject(R1, "create", "works_for", { role: ["dev"] }, [P1, ACME]),
    stagedObject(R3, "delete", "works_for", {}, [P1, ACME]),
    stagedObject(P1, "update", "person", { age: [41, undefined] }),
    stagedObject(NEW, "create", "department", { name: ["Ops"] }),
  ];
}

let store: MockRuntimeStore;
let staged: StagedObjectRecord[];

/** The entities the staged objects below name, as stored. */
const STORED: Record<string, Row> = {
  [P1]: makeEntity({ name: "Pat" }, "person", P1),
  [ACME]: makeEntity({ name: "ACME" }, "company", ACME),
  [D1]: makeEntity({ name: "Ops" }, "department", D1),
  [NEW]: makeEntity({ name: "Ops" }, "department", NEW),
};

beforeEach(() => {
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema());
  staged = [];
  store.getRelationsByIds.mockResolvedValue({ [R2]: makeRelation({ role: "dev" }, { relationId: R2, fromEntityId: P1, toEntityId: ACME }) });
  store.createEntity.mockImplementation(async (type: string, id: string) => makeEntity({}, type, id));
  store.createEntityWithParent.mockResolvedValue({ entity: makeEntity(), relation: makeRelation() });
  store.updateEntity.mockResolvedValue(makeEntity());
  store.deleteEntity.mockResolvedValue(true);
  store.createRelation.mockResolvedValue(makeRelation());
  store.updateRelation.mockResolvedValue(makeRelation());
  store.deleteRelation.mockResolvedValue(true);
  store.getEntitiesByIdsHashed.mockImplementation(async (ids: string[], documentKeys: Record<string, string[]>) =>
    hashedById(STORED, ids, documentKeys),
  );
  store.getEntityTypes.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in STORED).map((id) => [id, STORED[id]!._entityTypeKey])),
  );
});

/** Stage these objects, first touched in this order. */
function changesetOf(objects: StagedObjectRecord[]): void {
  staged = objects;
}

/** Commit the changeset as staged, seeded afresh: a commit deletes it. */
function commit(expectedVersion?: number) {
  store.changesetStore.seed(changeset({ objectCount: staged.length }), inTouchOrder(staged));
  return commitChangeset("full_lens", null, CS, expectedVersion, asRuntimeStore(store));
}

/** The store write methods in the order they were called. */
function writeOrder(): string[] {
  const methods = [
    "createEntity",
    "createEntityWithParent",
    "updateEntity",
    "deleteEntity",
    "createRelation",
    "updateRelation",
    "deleteRelation",
  ] as const;
  return methods
    .flatMap((method) => store[method].mock.invocationCallOrder.map((order) => [order, method] as const))
    .sort((a, b) => a[0] - b[0])
    .map(([, method]) => method);
}

async function rejected(promise: Promise<unknown>): Promise<ValidationError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ValidationError);
  return error as ValidationError;
}

describe("the steps", () => {
  it("loads before BEGIN, then locks, applies, deletes the changeset, and answers the count", async () => {
    changesetOf(sixObjects());
    expect(await commit()).toEqual({ committed: 6, alreadyGone: [] });

    const cs = store.changesetStore;
    expect(cs.get).toHaveBeenCalledWith(CS, "lens-1", null);
    expect(store.indices.listIndices).toHaveBeenCalled();
    const transaction = store.transaction.mock.invocationCallOrder[0]!;
    expect(store.indices.listIndices.mock.invocationCallOrder[0]!).toBeLessThan(transaction);
    expect(cs.lockForCommit).toHaveBeenCalledWith(CS);
    // The lock-free pass reads the objects before BEGIN, once; the commit applies what it read.
    expect(cs.page).toHaveBeenCalledTimes(1);
    expect(cs.page.mock.invocationCallOrder[0]!).toBeLessThan(transaction);
    expect(cs.deleteCommitted).toHaveBeenCalledWith(CS);
    expect(cs.deleteCommitted.mock.invocationCallOrder[0]!).toBeGreaterThan(store.deleteEntity.mock.invocationCallOrder[0]!);
    expect(cs.touch).not.toHaveBeenCalled();
  });

  it("an unknown changeset is 404 before any transaction", async () => {
    await expect(commitChangeset("full_lens", null, CS, undefined, asRuntimeStore(store))).rejects.toThrow(
      new NotFoundError(`Changeset '${CS}' not found`),
    );
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("a changeset gone by the time it is locked is 404", async () => {
    store.changesetStore.lockForCommit.mockResolvedValue(null);
    await expect(commit()).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    expect(writeOrder()).toEqual([]);
  });

  it("another commit running stays a 409, with nothing applied and no touch", async () => {
    store.changesetStore.lockForCommit.mockRejectedValue(new ConflictError("Another commit is running; try again"));
    await expect(commit()).rejects.toThrow(ConflictError);
    expect(writeOrder()).toEqual([]);
    expect(store.changesetStore.touch).not.toHaveBeenCalled();
  });
});

describe("the version check", () => {
  it("a stale expectedVersion is 409, before anything is applied", async () => {
    changesetOf(sixObjects());
    const error = await commit(6).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain("changed since you looked");
    expect(writeOrder()).toEqual([]);
    expect(store.changesetStore.deleteCommitted).not.toHaveBeenCalled();
  });

  it("the current version commits, and so does none", async () => {
    expect(await commit(7)).toEqual({ committed: 0, alreadyGone: [] });
    expect(await commit()).toEqual({ committed: 0, alreadyGone: [] });
  });
});

describe("the phases", () => {
  it("entity creates, entity updates, relation deletes, relation creates, relation updates, entity deletes, whatever the staging order", async () => {
    changesetOf(sixObjects());
    await commit();
    expect(writeOrder()).toEqual([
      "createEntity",
      "updateEntity",
      "deleteRelation",
      "createRelation",
      "updateRelation",
      "deleteEntity",
    ]);
    expect(store.createEntity.mock.calls[0]!.slice(0, 3)).toEqual(["department", NEW, { name: "Ops" }]);
    expect(store.updateEntity.mock.calls[0]!.slice(0, 4)).toEqual(["person", P1, { age: 41 }, []]);
    expect(store.deleteRelation.mock.calls[0]!.slice(0, 2)).toEqual(["works_for", R3]);
    expect(store.createRelation.mock.calls[0]!.slice(0, 5)).toEqual(["works_for", R1, P1, ACME, { role: "dev" }]);
    expect(store.updateRelation.mock.calls[0]!.slice(0, 4)).toEqual(["works_for", R2, { role: "lead" }, []]);
    expect(store.deleteEntity.mock.calls[0]!.slice(0, 2)).toEqual(["department", D1]);
  });

  it("an entity created with a relation onto it, and another entity deleted: create, relation, then the delete", async () => {
    changesetOf([
      stagedObject(D1, "delete", "department"),
      stagedObject(NEW_REL, "create", "belongs_to", {}, [NEW, ACME]),
      stagedObject(NEW, "create", "department", { name: ["Ops"] }),
    ]);
    expect(await commit()).toEqual({ committed: 3, alreadyGone: [] });
    expect(writeOrder()).toEqual(["createEntity", "createRelation", "deleteEntity"]);
    expect(store.createEntity.mock.calls[0]!.slice(0, 2)).toEqual(["department", NEW]);
    expect(store.createRelation.mock.calls[0]!.slice(0, 4)).toEqual(["belongs_to", NEW_REL, NEW, ACME]);
    expect(store.createEntityWithParent).not.toHaveBeenCalled();
  });

  it("applies the full schema's defaults to a create, and removes a key staged as null", async () => {
    changesetOf([
      stagedObject(NEW, "create", "person", { name: ["Ann"] }),
      stagedObject(P1, "update", "person", { email: [null, undefined] }),
    ]);
    await commit();
    expect(store.createEntity.mock.calls[0]!.slice(0, 3)).toEqual(["person", NEW, { name: "Ann", active: true }]);
    expect(store.updateEntity.mock.calls[0]!.slice(0, 4)).toEqual(["person", P1, {}, ["email"]]);
  });

  it("each object is one store write: a create carries every value of the set", async () => {
    changesetOf([stagedObject(NEW, "create", "person", { name: ["Ann"], age: [3], email: ["a@x"] })]);
    await commit();
    expect(store.createEntity).toHaveBeenCalledTimes(1);
    expect(store.createEntity.mock.calls[0]![2]).toEqual({ name: "Ann", age: 3, email: "a@x", active: true });
  });

  it("reads the staged objects page by page, once", async () => {
    changesetOf(
      Array.from({ length: 501 }, (_, i) =>
        stagedObject(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "delete", "works_for", {}, [P1, ACME]),
      ),
    );
    expect(await commit()).toMatchObject({ committed: 501 });
    expect(store.changesetStore.page.mock.calls.map((call) => call.slice(1))).toEqual([
      [0, 500],
      [500, 500],
    ]);
  });

  it("a delete that finds nothing is done, and noted as already gone", async () => {
    store.deleteEntity.mockResolvedValue(false);
    store.deleteRelation.mockResolvedValue(false);
    changesetOf(sixObjects());
    expect(await commit()).toEqual({ committed: 6, alreadyGone: [R3, D1] });
    expect(store.changesetStore.deleteCommitted).toHaveBeenCalled();
  });

  it("a staged entity delete locks the entity and records its children before the delete", async () => {
    const children = [{ relationType: "belongs_to", relationId: R1, parentId: D1, childId: NEW }];
    store.childrenOf.mockResolvedValue(children);
    const loaded = await loadSchema("full_lens", asRuntimeStore(store));
    const search = await loadSearchContext(store.ontologyKey, store.indices);

    const applied: Applied = await applyObjects(loaded, search, [stagedObject(D1, "delete", "department")], asRuntimeStore(store));
    expect(store.childrenOf).toHaveBeenCalledWith([D1], { belongs_to: "target" }, true);
    expect(store.childrenOf.mock.invocationCallOrder[0]!).toBeLessThan(store.deleteEntity.mock.invocationCallOrder[0]!);
    expect(applied).toEqual({ applied: 1, alreadyGone: [], deletedChildren: [{ objectId: D1, children }], fault: null });
  });
});

describe("a fault while applying: 422, nothing persisted", () => {
  it("a target gone since staging rejects on its object; later phases do not run", async () => {
    store.updateEntity.mockResolvedValue(null);
    changesetOf(sixObjects());
    const error = await rejected(commit());
    expect(error.message).toBe("The commit was rejected; nothing was persisted");
    expect(error.details).toEqual({
      violations: [{ object: P1, kind: "replay", message: "Deleted since it was staged" }],
      total: 1,
    });
    expect(store.createRelation).not.toHaveBeenCalled();
    expect(store.changesetStore.deleteCommitted).not.toHaveBeenCalled();
    // After the rollback, the last change is refreshed; the version stays.
    expect(store.changesetStore.touch).toHaveBeenCalledWith(CS);
    expect(store.changesetStore.touch.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.transaction.mock.invocationCallOrder[0]!,
    );
  });

  it("a reference the store refuses (FK) names the ends by their role, not the id", async () => {
    store.createRelation.mockRejectedValue(new NotFoundError(`Entity '${ACME}' not found`));
    changesetOf(sixObjects());
    expect((await rejected(commit())).details!.violations).toEqual([
      { object: R1, kind: "replay", message: "The source or target end no longer exists" },
    ]);

    // A parent gone is the parent relation's end gone.
    changesetOf([stagedObject(NEW, "create", "department", { name: ["Ops"] }), stagedObject(NEW_REL, "create", "belongs_to", {}, [NEW, ACME])]);
    expect((await rejected(commit())).details!.violations).toEqual([
      { object: NEW_REL, kind: "replay", message: "The source or target end no longer exists" },
    ]);
  });

  it("a value the lens no longer accepts names its field, found by the lock-free pass", async () => {
    changesetOf([stagedObject(P1, "update", "person", { age: ["old", undefined] })]);
    const [violation] = (await rejected(commit())).details!.violations as Row[];
    expect(violation).toMatchObject({ object: P1, property: "age", kind: "replay" });
    expect(violation!.message).toMatch(/^Instance validation failed: age: /);
    expect(store.updateEntity).not.toHaveBeenCalled();
  });

  it("a type the lens no longer shows is found by the lock-free pass, before BEGIN", async () => {
    changesetOf([stagedObject(D1, "delete", "gone")]);
    expect((await rejected(commit())).details!.violations).toEqual([
      { object: D1, kind: "not_visible", message: "The type of this entity is no longer visible through lens 'full_lens'" },
    ]);
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("a lock wait past the timeout stays a 409, and is no rejection", async () => {
    store.updateEntity.mockRejectedValue(new ConflictError("Another operation holds this data; try again"));
    changesetOf(sixObjects());
    await expect(commit()).rejects.toThrow(ConflictError);
    expect(store.changesetStore.touch).not.toHaveBeenCalled();
  });
});

describe("the process limit", () => {
  it("a second concurrent commit is 409 at once; a later one runs", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    store.changesetStore.lockForCommit.mockImplementationOnce(async () => {
      await held;
      return changeset();
    });
    const first = commit();
    await expect(commitChangeset("full_lens", null, CS, undefined, asRuntimeStore(store))).rejects.toThrow(
      new ConflictError("Too many commits are running; try again"),
    );
    release();
    expect(await first).toEqual({ committed: 0, alreadyGone: [] });
    expect(await commit()).toEqual({ committed: 0, alreadyGone: [] });
  });

  it("a failed commit frees its place", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(commitChangeset("full_lens", null, CS, undefined, asRuntimeStore(store))).rejects.toThrow(NotFoundError);
    }
    expect(await commit()).toMatchObject({ committed: 0 });
  });
});
