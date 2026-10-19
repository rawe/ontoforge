/**
 * The commit over mocked stores: the order of its steps, the version
 * check, the replay by seq through the store's write methods, idempotent
 * deletes, the delete capture, a replay fault rolled back as a 422, the
 * errors that stay 409s, and the process limit. The stored entities the
 * journal names answer the lock-free pass (`changesets-validation.test.ts`
 * covers it).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { ChangesetRecord, ChangesetWriteRecord } from "../../src/core/ports.js";
import { commitChangeset, replayJournal, type Replay } from "../../src/runtime/changesets.js";
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
  makeEntity,
  makeRelation,
  makeUnscopedSchema,
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
    anchorKey: null,
    version: 7,
    note: null,
    submittedAt: null,
    createdAt: NOW,
    lastChangeAt: new Date(),
    writeCount: 2,
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

/** One staged write of each operation, by seq. */
function sixWrites(): ChangesetWriteRecord[] {
  return [
    row(1, {
      operation: "create_entity",
      typeKey: "department",
      mintedId: NEW,
      arguments: {
        properties: { name: "Ops" },
        parentRelation: { type: "belongs_to", parentId: ACME, properties: {} },
        relationId: NEW_REL,
      },
    }),
    row(2, { operation: "update_entity", typeKey: "person", targetId: P1, arguments: { properties: { age: 41 } } }),
    row(3, {
      operation: "create_relation",
      typeKey: "works_for",
      mintedId: R1,
      arguments: { fromEntityId: P1, toEntityId: ACME, properties: { role: "dev" } },
    }),
    row(4, { operation: "update_relation", typeKey: "works_for", targetId: R1, arguments: { properties: { role: "lead" } } }),
    row(5, { operation: "delete_relation", typeKey: "works_for", targetId: R1, arguments: {} }),
    row(6, { operation: "delete_entity", typeKey: "department", targetId: D1, arguments: {} }),
  ];
}

let store: MockRuntimeStore;

/** The entities the journals below name, as stored. */
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
  store.changesetStore.get.mockResolvedValue(changeset());
  store.changesetStore.lockForCommit.mockResolvedValue(changeset());
  store.createEntity.mockImplementation(async (type: string, id: string) => makeEntity({}, type, id));
  store.createEntityWithParent.mockResolvedValue({ entity: makeEntity(), relation: makeRelation() });
  store.updateEntity.mockResolvedValue(makeEntity());
  store.deleteEntity.mockResolvedValue(true);
  store.createRelation.mockResolvedValue(makeRelation());
  store.updateRelation.mockResolvedValue(makeRelation());
  store.deleteRelation.mockResolvedValue(true);
  store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in STORED).map((id) => [id, STORED[id]])),
  );
});

function journal(writes: ChangesetWriteRecord[]): void {
  store.changesetStore.page.mockImplementation(async (_id: string, offset: number, limit: number) =>
    writes.slice(offset, offset + limit),
  );
}

function commit(expectedVersion?: number) {
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
  it("loads before BEGIN, then locks, replays, deletes the journal, and answers the count", async () => {
    journal(sixWrites());
    expect(await commit()).toEqual({ committed: 6, alreadyGone: [] });

    const cs = store.changesetStore;
    expect(cs.get).toHaveBeenCalledWith(CS, "lens-1", null);
    expect(store.indices.listIndices).toHaveBeenCalled();
    const transaction = store.transaction.mock.invocationCallOrder[0]!;
    expect(store.indices.listIndices.mock.invocationCallOrder[0]!).toBeLessThan(transaction);
    expect(cs.lockForCommit).toHaveBeenCalledWith(CS);
    // The lock-free pass reads the journal before BEGIN; the replay after the lock.
    expect(cs.page.mock.invocationCallOrder[0]!).toBeLessThan(transaction);
    expect(cs.lockForCommit.mock.invocationCallOrder[0]!).toBeLessThan(cs.page.mock.invocationCallOrder.at(-1)!);
    expect(cs.deleteWithJournal).toHaveBeenCalledWith(CS);
    expect(cs.deleteWithJournal.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.deleteEntity.mock.invocationCallOrder[0]!,
    );
    expect(cs.touch).not.toHaveBeenCalled();
  });

  it("an unknown changeset is 404 before any transaction", async () => {
    store.changesetStore.get.mockResolvedValue(null);
    await expect(commit()).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("a changeset gone by the time it is locked is 404", async () => {
    store.changesetStore.lockForCommit.mockResolvedValue(null);
    await expect(commit()).rejects.toThrow(new NotFoundError(`Changeset '${CS}' not found`));
    expect(writeOrder()).toEqual([]);
  });

  it("another commit running stays a 409, with nothing replayed and no touch", async () => {
    store.changesetStore.lockForCommit.mockRejectedValue(new ConflictError("Another commit is running; try again"));
    await expect(commit()).rejects.toThrow(ConflictError);
    expect(writeOrder()).toEqual([]);
    expect(store.changesetStore.touch).not.toHaveBeenCalled();
  });
});

describe("the version check (V40)", () => {
  it("a stale expectedVersion is 409, before the replay", async () => {
    journal(sixWrites());
    const error = await commit(6).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain("changed since you looked");
    expect(writeOrder()).toEqual([]);
    expect(store.changesetStore.deleteWithJournal).not.toHaveBeenCalled();
  });

  it("the current version commits, and so does none", async () => {
    journal([]);
    expect(await commit(7)).toEqual({ committed: 0, alreadyGone: [] });
    expect(await commit()).toEqual({ committed: 0, alreadyGone: [] });
  });
});

describe("the replay (V20)", () => {
  it("runs every write by seq through the store's write method, with the prepare's args", async () => {
    journal(sixWrites());
    await commit();
    expect(writeOrder()).toEqual([
      "createEntityWithParent",
      "updateEntity",
      "createRelation",
      "updateRelation",
      "deleteRelation",
      "deleteEntity",
    ]);

    const [entity, relation] = store.createEntityWithParent.mock.calls[0]!;
    expect(entity).toMatchObject({ entityTypeKey: "department", entityId: NEW, properties: { name: "Ops" } });
    expect(relation).toMatchObject({ relationTypeKey: "belongs_to", relationId: NEW_REL, fromEntityId: NEW, toEntityId: ACME });
    expect(store.updateEntity.mock.calls[0]!.slice(0, 4)).toEqual(["person", P1, { age: 41 }, []]);
    expect(store.createRelation.mock.calls[0]!.slice(0, 5)).toEqual(["works_for", R1, P1, ACME, { role: "dev" }]);
    expect(store.updateRelation.mock.calls[0]!.slice(0, 4)).toEqual(["works_for", R1, { role: "lead" }, []]);
    expect(store.deleteRelation.mock.calls[0]!.slice(0, 2)).toEqual(["works_for", R1]);
    expect(store.deleteEntity.mock.calls[0]!.slice(0, 2)).toEqual(["department", D1]);
  });

  it("applies the full schema's defaults again, and removes a key staged as null", async () => {
    journal([
      row(1, { operation: "create_entity", typeKey: "person", mintedId: NEW, arguments: { properties: { name: "Ann" }, parentRelation: null, relationId: null } }),
      row(2, { operation: "update_entity", typeKey: "person", targetId: P1, arguments: { properties: { email: null } } }),
    ]);
    await commit();
    expect(store.createEntity.mock.calls[0]!.slice(0, 3)).toEqual(["person", NEW, { name: "Ann", active: true }]);
    expect(store.updateEntity.mock.calls[0]!.slice(0, 4)).toEqual(["person", P1, {}, ["email"]]);
  });

  it("an empty update is done without a store call", async () => {
    journal([row(1, { operation: "update_entity", typeKey: "person", targetId: P1, arguments: { properties: {} } })]);
    expect(await commit()).toEqual({ committed: 1, alreadyGone: [] });
    expect(store.updateEntity).not.toHaveBeenCalled();
  });

  it("reads the journal page by page", async () => {
    const writes = Array.from({ length: 501 }, (_, i) =>
      row(i + 1, { operation: "delete_relation", typeKey: "works_for", targetId: R1, arguments: {} }),
    );
    journal(writes);
    expect(await commit()).toMatchObject({ committed: 501 });
    // Twice: the lock-free pass, then the replay.
    expect(store.changesetStore.page.mock.calls.map((call) => call.slice(1))).toEqual([
      [0, 500],
      [500, 500],
      [0, 500],
      [500, 500],
    ]);
  });

  it("a delete that finds nothing is done, and noted as already gone", async () => {
    store.deleteEntity.mockResolvedValue(false);
    store.deleteRelation.mockResolvedValue(false);
    journal(sixWrites());
    expect(await commit()).toEqual({ committed: 6, alreadyGone: [5, 6] });
    expect(store.changesetStore.deleteWithJournal).toHaveBeenCalled();
  });

  it("a staged entity delete locks the entity and records its children before the delete", async () => {
    const children = [{ relationType: "belongs_to", relationId: R1, parentId: D1, childId: NEW }];
    store.childrenOf.mockResolvedValue(children);
    journal([row(4, { operation: "delete_entity", typeKey: "department", targetId: D1, arguments: {} })]);
    const loaded = await loadSchema("full_lens", asRuntimeStore(store));
    const search = await loadSearchContext(store.ontologyKey, store.indices);

    const replay: Replay = await replayJournal(loaded, search, CS, asRuntimeStore(store));
    expect(store.childrenOf).toHaveBeenCalledWith([D1], { belongs_to: "target" }, true);
    expect(store.childrenOf.mock.invocationCallOrder[0]!).toBeLessThan(store.deleteEntity.mock.invocationCallOrder[0]!);
    expect(replay).toEqual({
      replayed: 1,
      alreadyGone: [],
      deletedChildren: [{ seq: 4, entityId: D1, children }],
      fault: null,
    });
  });
});

describe("a replay fault: 422, nothing persisted", () => {
  it("a target gone since staging rejects with its seq; later writes do not run", async () => {
    store.updateEntity.mockResolvedValue(null);
    journal(sixWrites());
    const error = await rejected(commit());
    expect(error.message).toBe("The commit was rejected; nothing was persisted");
    expect(error.details).toEqual({
      violations: [{ seq: 2, kind: "replay", message: `Entity '${P1}' not found` }],
      total: 1,
    });
    expect(store.createRelation).not.toHaveBeenCalled();
    expect(store.changesetStore.deleteWithJournal).not.toHaveBeenCalled();
    // After the rollback, the last change is refreshed; the version stays.
    expect(store.changesetStore.touch).toHaveBeenCalledWith(CS);
    expect(store.changesetStore.touch.mock.invocationCallOrder[0]!).toBeGreaterThan(
      store.transaction.mock.invocationCallOrder[0]!,
    );
  });

  it("a reference the store refuses (FK) names what was sent", async () => {
    store.createRelation.mockRejectedValue(new NotFoundError(`Entity '${ACME}' not found`));
    journal(sixWrites());
    const error = await rejected(commit());
    expect(error.details!.violations).toEqual([{ seq: 3, kind: "replay", message: `Entity '${ACME}' not found` }]);
  });

  it("a value the lens no longer accepts names its field", async () => {
    journal([row(1, { operation: "update_entity", typeKey: "person", targetId: P1, arguments: { properties: { age: "old" } } })]);
    const error = await rejected(commit());
    const [violation] = error.details!.violations as Row[];
    expect(violation).toMatchObject({ seq: 1, kind: "replay" });
    expect(violation!.message).toMatch(/^Instance validation failed: age: /);
    expect(store.updateEntity).not.toHaveBeenCalled();
  });

  it("a type the lens no longer shows is found by the lock-free pass, before BEGIN", async () => {
    journal([row(2, { operation: "delete_entity", typeKey: "gone", targetId: D1, arguments: {} })]);
    const error = await rejected(commit());
    expect(error.details!.violations).toEqual([
      { seq: 2, kind: "not_visible", message: "The type of this write is no longer visible through lens 'full_lens'" },
    ]);
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("a lock wait past the timeout stays a 409, and is no rejection", async () => {
    store.updateEntity.mockRejectedValue(new ConflictError("Another operation holds this data; try again"));
    journal(sixWrites());
    await expect(commit()).rejects.toThrow(ConflictError);
    expect(store.changesetStore.touch).not.toHaveBeenCalled();
  });
});

describe("the process limit (V26, R5)", () => {
  it("a third concurrent commit is 409 at once; a later one runs", async () => {
    journal([]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    store.changesetStore.lockForCommit.mockImplementation(async () => {
      await held;
      return changeset();
    });
    const first = commit();
    const second = commit();
    await expect(commit()).rejects.toThrow(new ConflictError("Too many commits are running; try again"));
    release();
    expect(await first).toEqual({ committed: 0, alreadyGone: [] });
    expect(await second).toEqual({ committed: 0, alreadyGone: [] });
    expect(await commit()).toEqual({ committed: 0, alreadyGone: [] });
  });

  it("a failed commit frees its place", async () => {
    store.changesetStore.get.mockResolvedValue(null);
    for (let i = 0; i < 3; i++) {
      await expect(commit()).rejects.toThrow(NotFoundError);
    }
    store.changesetStore.get.mockResolvedValue(changeset());
    journal([]);
    expect(await commit()).toMatchObject({ committed: 0 });
  });
});
