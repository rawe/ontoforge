/**
 * The port extension for changesets on PostgreSQL: the transaction-bound
 * runtime store, the changeset store, and the neutral reads, on the
 * in-test hierarchy (`buildHierarchy`). A second connection holding a row
 * or the commit lock is a bound transaction of its own, kept open until
 * the test releases it.
 */

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { ConflictError } from "../../src/core/exceptions.js";
import {
  closeStores,
  getRuntimeStore,
  initStores,
  type ChangesetRecord,
  type RuntimeStore,
} from "../../src/core/ports.js";
import { planSearchWrite } from "../../src/core/searchDependencies.js";
import { invalidateLoadedSchemaCache, loadSearchContext } from "../../src/runtime/schemaCache.js";
import { createOntology, modelPrefix, runtimePrefix } from "./fixture.js";
import { buildHierarchy, HIERARCHY_ONTOLOGY_KEY as O, type HierarchyIds } from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const NS = `ont_${O}`;
const OTHER = "other_ont";

const READINGS = {
  has_project: "source",
  has_task: "source",
  has_subtask: "source",
  belongs_to: "target",
} as const;

let app: FastifyInstance;
let ids: HierarchyIds;
let store: RuntimeStore;
/** Lens ids by key. */
const lenses: Record<string, string> = {};

async function lensIds(ontologyKey: string): Promise<Record<string, string>> {
  const res = await app.inject({ method: "GET", url: `${modelPrefix(ontologyKey)}/lenses` });
  expect(res.statusCode, res.body).toBe(200);
  return Object.fromEntries((res.json() as Row[]).map((lens) => [lens.key, lens.lensId]));
}

/** A transaction on its own connection that runs `during`, then holds
 * its locks until `release` is called. */
async function hold(
  on: RuntimeStore,
  during: (bound: RuntimeStore) => Promise<unknown>,
): Promise<{ release: () => void; done: Promise<unknown> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  let failed!: (exc: unknown) => void;
  const held = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const done = on.transaction(async (bound) => {
    try {
      await during(bound);
    } catch (exc) {
      failed(exc);
      throw exc;
    }
    ready();
    await released;
  });
  done.catch(() => undefined);
  await held;
  return { release, done };
}

/** Whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

async function sql(text: string, params?: unknown[]): Promise<Row[]> {
  return (await runQuery(text, params, NS)).rows;
}

async function relationId(type: string, from: string, to: string): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: `${runtimePrefix(O, "all")}/relations/${type}?fromEntityId=${from}&toEntityId=${to}`,
  });
  return (res.json().items as Row[])[0]!._id as string;
}

function write(operation: string, typeKey: string, extra: Partial<Row> = {}) {
  return {
    operation,
    arguments: { name: `${operation} ${typeKey}` },
    mintedId: null,
    typeKey,
    targetId: null,
    base: null,
    ...extra,
  };
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  app = await createApp();
  await app.ready();
  ids = await buildHierarchy(app);
  Object.assign(lenses, await lensIds(O));
  await createOntology(app, OTHER);
  await app.inject({ method: "POST", url: `${modelPrefix(OTHER)}/lenses`, payload: { key: "main", name: "Main" } });
  lenses.other = (await lensIds(OTHER)).main!;
  store = await getRuntimeStore(O);
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await sql(`DELETE FROM changeset`);
});

describe("transaction: a store bound to one connection", () => {
  async function plannedTask(): Promise<{ id: string; plan: ReturnType<typeof planSearchWrite> }> {
    const id = randomUUID();
    const context = await loadSearchContext(O, store.searchIndices());
    const plan = planSearchWrite(context.dependencies, { kind: "entityCreated", entityType: "task", entityId: id });
    expect(plan).not.toBeNull();
    return { id, plan };
  }

  it("a return commits every write: entity, search queue rows, anchor and changeset", async () => {
    const { id, plan } = await plannedTask();
    const changesetId = randomUUID();
    const seen = await store.transaction(async (bound) => {
      await bound.createEntity("task", id, { name: "Bound" }, {}, plan);
      await bound.anchors().saveAnchor("bound-a", { type: "task", id });
      await bound.changesets().start({ id: changesetId, lensId: lenses.all!, anchorKey: null, note: null });
      // The bound store reads its own writes.
      return {
        entity: await bound.getEntity("task", id),
        changeset: await bound.changesets().get(changesetId, lenses.all!, null),
      };
    });
    expect(seen.entity).toMatchObject({ _id: id, name: "Bound" });
    expect(seen.changeset).toMatchObject({ id: changesetId });

    expect(await store.getEntity("task", id)).toMatchObject({ name: "Bound" });
    expect(await sql(`SELECT part_kind FROM search_queue WHERE entity_id = $1`, [id])).toEqual([
      { part_kind: "entity" },
    ]);
    expect(await store.anchors().getAnchor("bound-a")).toMatchObject({ entityFound: true });
    expect(await store.changesets().get(changesetId, lenses.all!, null)).not.toBeNull();
    await store.anchors().deleteAnchor("bound-a");
  });

  it("a throw rolls back everything the bound store wrote, search queue rows included", async () => {
    const { id, plan } = await plannedTask();
    const changesetId = randomUUID();
    const promise = store.transaction(async (bound) => {
      await bound.createEntity("task", id, { name: "Gone" }, {}, plan);
      await bound.createRelation("has_task", randomUUID(), ids.P2, id, {}, {});
      await bound.anchors().saveAnchor("bound-b", { type: "task", id });
      await bound.changesets().start({ id: changesetId, lensId: lenses.all!, anchorKey: null, note: null });
      await bound.changesets().append(changesetId, write("create_entity", "task"));
      throw new Error("boom");
    });
    await expect(promise).rejects.toThrow("boom");

    expect(await store.getEntity("task", id)).toBeNull();
    expect(await store.childrenOf([ids.P2], READINGS)).toHaveLength(1);
    expect(await sql(`SELECT 1 FROM search_queue WHERE entity_id = $1`, [id])).toEqual([]);
    expect(await store.anchors().getAnchor("bound-b")).toBeNull();
    expect(await sql(`SELECT 1 FROM changeset_write`)).toEqual([]);
    expect(await store.changesets().get(changesetId, lenses.all!, null)).toBeNull();
  });

  it("a driver error inside rolls back too", async () => {
    const id = randomUUID();
    const promise = store.transaction(async (bound) => {
      await bound.createEntity("task", id, { name: "Gone" }, {});
      // The FK fails: no such parent.
      await bound.createRelation("has_task", randomUUID(), randomUUID(), id, {}, {});
    });
    await expect(promise).rejects.toThrow("not found");
    expect(await store.getEntity("task", id)).toBeNull();
  });

  it("a pool checkout inside fails loudly, never as a second connection", async () => {
    const id = randomUUID();
    await store.transaction(async (bound) => {
      await bound.createEntity("task", id, { name: "Inside" }, {});
      // A nested transaction.
      await expect(bound.transaction(async () => undefined)).rejects.toThrow(
        "Pool checkout inside a bound transaction",
      );
      // The schema read wants its own REPEATABLE READ.
      await expect(bound.getFullSchemaWithLensInclusions("all")).rejects.toThrow(
        "A bound store cannot open a REPEATABLE READ transaction",
      );
      // The unbound store, used by mistake inside the work.
      await expect(store.getEntity("task", id)).rejects.toThrow("Pool checkout inside a bound transaction");
      // A store the bound store hands out that has no bound door.
      await expect(bound.searchIndices().listIndices()).rejects.toThrow(
        "Pool checkout inside a bound transaction",
      );
    });
    // The transaction itself went on and committed.
    expect(await store.getEntity("task", id)).toMatchObject({ name: "Inside" });
  });
});

describe("ChangesetStore", () => {
  async function started(anchorKey: string | null = null, lensId = lenses.all!): Promise<ChangesetRecord> {
    return store.changesets().start({ id: randomUUID(), lensId, anchorKey, note: "n" });
  }

  /** Move a changeset's last change back, so a refresh is visible. */
  async function age(id: string, interval = "1 hour"): Promise<void> {
    await sql(`UPDATE changeset SET last_change_at = now() - $2::interval WHERE changeset_id = $1`, [
      id,
      interval,
    ]);
  }

  async function read(id: string): Promise<ChangesetRecord> {
    return (await store.changesets().get(id, lenses.all!, null))!;
  }

  it("start: version 1, draft, no writes, bound to its lens and anchor", async () => {
    const cs = await started("agent-a");
    expect(cs).toMatchObject({
      lensId: lenses.all,
      anchorKey: "agent-a",
      version: 1,
      note: "n",
      submittedAt: null,
      writeCount: 0,
    });
    expect(cs.createdAt).toBeInstanceOf(Date);
    expect(cs.lastChangeAt).toBeInstanceOf(Date);
  });

  it("get honours the binding: another lens or another anchor answers null", async () => {
    const plain = await started(null);
    const anchored = await started("agent-a");
    const changesets = store.changesets();

    expect(await changesets.get(plain.id, lenses.all!, null)).toMatchObject({ id: plain.id });
    expect(await changesets.get(plain.id, lenses.portfolio!, null)).toBeNull();
    expect(await changesets.get(plain.id, lenses.all!, "agent-a")).toBeNull();

    // The plain lens URL reaches the anchored one; only its own anchor does.
    expect(await changesets.get(anchored.id, lenses.all!, null)).toMatchObject({ id: anchored.id });
    expect(await changesets.get(anchored.id, lenses.all!, "agent-a")).toMatchObject({ id: anchored.id });
    expect(await changesets.get(anchored.id, lenses.all!, "agent-b")).toBeNull();
    expect(await changesets.get(anchored.id, lenses.portfolio!, "agent-a")).toBeNull();

    expect(await changesets.get("not-a-uuid", lenses.all!, null)).toBeNull();
    expect(await changesets.get(randomUUID(), lenses.all!, null)).toBeNull();
  });

  it("append assigns the last seq plus one, bumps the version and refreshes last change", async () => {
    const cs = await started();
    const changesets = store.changesets();
    const minted = randomUUID();
    const target = randomUUID();
    await age(cs.id);
    const before = await read(cs.id);

    expect(await changesets.append(cs.id, write("create_entity", "task", { mintedId: minted }))).toBe(1);
    const after = await read(cs.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.lastChangeAt.getTime()).toBeGreaterThan(before.lastChangeAt.getTime());
    expect(after.writeCount).toBe(1);

    const base = { name: "T1", gone: null };
    expect(
      await changesets.append(
        cs.id,
        write("update_entity", "task", { targetId: target, arguments: { name: "T1b" }, base }),
      ),
    ).toBe(2);
    expect(await changesets.append(cs.id, write("delete_entity", "project", { targetId: ids.P2 }))).toBe(3);
    expect((await read(cs.id)).version).toBe(4);

    const page = await changesets.page(cs.id, 0, 10);
    expect(page.map((w) => w.seq)).toEqual([1, 2, 3]);
    expect(page[0]).toMatchObject({
      operation: "create_entity",
      mintedId: minted,
      typeKey: "task",
      targetId: null,
      base: null,
    });
    // Plain JSON in and out: absent and null stay distinct in the base.
    expect(page[1]).toMatchObject({ arguments: { name: "T1b" }, targetId: target, base });
    expect(page[1]!.base).not.toHaveProperty("other");
    expect(page[1]!.createdAt).toBeInstanceOf(Date);
    expect((await changesets.page(cs.id, 1, 1)).map((w) => w.seq)).toEqual([2]);

    expect(await changesets.findMinted(cs.id, minted)).toMatchObject({ seq: 1, operation: "create_entity" });
    expect(await changesets.findMinted(cs.id, target)).toBeNull();
    expect(await changesets.findMinted(randomUUID(), minted)).toBeNull();

    expect(await changesets.append(randomUUID(), write("create_entity", "task"))).toBeNull();
  });

  it("unstage removes one write by seq and bumps the version; an unknown seq changes nothing; no seq is reused", async () => {
    const cs = await started();
    const changesets = store.changesets();
    for (let i = 0; i < 3; i++) await changesets.append(cs.id, write("create_entity", "task"));
    await age(cs.id);
    const before = await read(cs.id);

    expect(await changesets.unstage(cs.id, 2)).toBe(true);
    const after = await read(cs.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.lastChangeAt.getTime()).toBeGreaterThan(before.lastChangeAt.getTime());
    expect((await changesets.page(cs.id, 0, 10)).map((w) => w.seq)).toEqual([1, 3]);

    expect(await changesets.unstage(cs.id, 2)).toBe(false);
    expect((await read(cs.id)).version).toBe(after.version);
    expect(await changesets.unstage(randomUUID(), 1)).toBe(false);

    // The seq is the version at the append: unstaging the last write
    // frees no seq for the next one.
    expect(await changesets.unstage(cs.id, 3)).toBe(true);
    expect(await changesets.append(cs.id, write("create_entity", "task"))).toBe(after.version + 1);
    expect((await changesets.page(cs.id, 0, 10)).map((w) => w.seq)).toEqual([1, after.version + 1]);
  });

  it("submit is a compare-and-set on the version; unsubmit returns to draft with the note", async () => {
    const cs = await started();
    const changesets = store.changesets();
    await age(cs.id);
    const aged = await read(cs.id);

    expect(await changesets.submit(cs.id, cs.version + 1, "please review")).toBeNull();
    expect(await read(cs.id)).toMatchObject({ version: cs.version, submittedAt: null });

    const submitted = await changesets.submit(cs.id, cs.version, "please review");
    expect(submitted).toMatchObject({ version: cs.version + 1, note: "please review" });
    expect(submitted!.submittedAt).toBeInstanceOf(Date);
    expect(submitted!.lastChangeAt.getTime()).toBeGreaterThan(aged.lastChangeAt.getTime());

    const draft = await changesets.unsubmit(cs.id, "fix T2");
    expect(draft).toMatchObject({ version: cs.version + 2, note: "fix T2", submittedAt: null });

    expect(await changesets.submit(randomUUID(), 1, null)).toBeNull();
    expect(await changesets.unsubmit(randomUUID(), "x")).toBeNull();
  });

  it("list: counts per operation and type keys, bound as get, submitted first", async () => {
    const changesets = store.changesets();
    const a = await started(null);
    const b = await started("agent-a");
    const empty = await started(null);
    await started(null, lenses.portfolio!);
    await changesets.append(a.id, write("create_entity", "task"));
    await changesets.append(a.id, write("create_entity", "task"));
    await changesets.append(a.id, write("delete_relation", "has_task"));
    await changesets.append(b.id, write("update_entity", "project"));
    const bSubmitted = await changesets.submit(b.id, (await read(b.id)).version, "go");
    expect(bSubmitted).not.toBeNull();

    const listed = await changesets.list(lenses.all!, null);
    expect(listed.map((cs) => cs.id)).toEqual([b.id, expect.any(String), expect.any(String)]);
    expect(listed.map((cs) => cs.id).sort()).toEqual([a.id, b.id, empty.id].sort());
    const byId = Object.fromEntries(listed.map((cs) => [cs.id, cs]));
    expect(byId[a.id]).toMatchObject({
      writeCount: 3,
      operations: { create_entity: 2, delete_relation: 1 },
      typeKeys: ["has_task", "task"],
      version: 4,
    });
    expect(byId[empty.id]).toMatchObject({ writeCount: 0, operations: {}, typeKeys: [] });
    expect(byId[b.id]).toMatchObject({ anchorKey: "agent-a", writeCount: 1, note: "go" });

    expect((await changesets.list(lenses.all!, "agent-a")).map((cs) => cs.id)).toEqual([b.id]);
    expect(await changesets.list(lenses.all!, "agent-b")).toEqual([]);
    expect(await changesets.list(lenses.portfolio!, null)).toHaveLength(1);
  });

  it("touch refreshes the last change only, keeping the version", async () => {
    const cs = await started();
    await age(cs.id);
    const before = await read(cs.id);
    await store.changesets().touch(cs.id);
    const after = await read(cs.id);
    expect(after.version).toBe(before.version);
    expect(after.lastChangeAt.getTime()).toBeGreaterThan(before.lastChangeAt.getTime());
  });

  it("sweep deletes draft changesets idle past the cutoff, with their journal; submitted ones stay", async () => {
    const changesets = store.changesets();
    const idle = await started();
    const fresh = await started();
    const submitted = await started();
    await changesets.append(idle.id, write("create_entity", "task"));
    await changesets.submit(submitted.id, submitted.version, null);
    await age(idle.id, "8 days");
    await age(submitted.id, "8 days");

    const cutoff = new Date(Date.now() - 7 * 24 * 3_600_000);
    expect(await changesets.sweep(cutoff)).toBe(1);
    expect(await changesets.get(idle.id, lenses.all!, null)).toBeNull();
    expect(await sql(`SELECT 1 FROM changeset_write WHERE changeset_id = $1`, [idle.id])).toEqual([]);
    expect(await changesets.get(fresh.id, lenses.all!, null)).not.toBeNull();
    expect(await changesets.get(submitted.id, lenses.all!, null)).not.toBeNull();
  });

  it("discard and deleteWithJournal delete the changeset and its journal", async () => {
    const changesets = store.changesets();
    const a = await started();
    const b = await started();
    await changesets.append(a.id, write("create_entity", "task"));
    await changesets.append(b.id, write("create_entity", "task"));

    expect(await changesets.discard(a.id)).toBe(true);
    expect(await changesets.discard(a.id)).toBe(false);
    expect(await changesets.get(a.id, lenses.all!, null)).toBeNull();

    await changesets.deleteWithJournal(b.id);
    expect(await changesets.get(b.id, lenses.all!, null)).toBeNull();
    expect(await sql(`SELECT 1 FROM changeset_write`)).toEqual([]);
  });

  it("discard deletes a draft changeset only: a submitted one stays, with its journal", async () => {
    const changesets = store.changesets();
    const cs = await started();
    await changesets.append(cs.id, write("create_entity", "task"));
    const submitted = await changesets.submit(cs.id, (await read(cs.id)).version, "go");

    expect(await changesets.discard(cs.id)).toBe(false);
    expect(await read(cs.id)).toMatchObject({ version: submitted!.version, writeCount: 1 });

    await changesets.unsubmit(cs.id, "back");
    expect(await changesets.discard(cs.id)).toBe(true);
    expect(await changesets.get(cs.id, lenses.all!, null)).toBeNull();
  });

  it("the state is judged in the writing statement: append, unstage and submit change a draft changeset only, unsubmit a submitted one", async () => {
    const changesets = store.changesets();
    const cs = await started();
    const seq = (await changesets.append(cs.id, write("create_entity", "task")))!;
    const submitted = (await changesets.submit(cs.id, (await read(cs.id)).version, "go"))!;

    expect(await changesets.append(cs.id, write("create_entity", "task"))).toBeNull();
    expect(await changesets.unstage(cs.id, seq)).toBe(false);
    expect(await changesets.submit(cs.id, submitted.version, "again")).toBeNull();
    expect(await read(cs.id)).toMatchObject({ version: submitted.version, writeCount: 1, note: "go" });

    const draft = (await changesets.unsubmit(cs.id, "back"))!;
    expect(await changesets.unsubmit(cs.id, "twice")).toBeNull();
    expect(await read(cs.id)).toMatchObject({ version: draft.version, note: "back", submittedAt: null });
    expect(await changesets.unstage(cs.id, seq)).toBe(true);
  });

  it("while another connection holds the row, every mutation is a ConflictError at once", async () => {
    const changesets = store.changesets();
    const cs = await started();
    await changesets.append(cs.id, write("create_entity", "task"));
    await age(cs.id, "8 days");
    const before = await read(cs.id);

    const holder = await hold(store, (bound) => bound.changesets().lockForCommit(cs.id));
    try {
      for (const mutation of [
        () => changesets.append(cs.id, write("create_entity", "task")),
        () => changesets.unstage(cs.id, 1),
        () => changesets.submit(cs.id, before.version, null),
        () => changesets.unsubmit(cs.id, "x"),
        () => changesets.discard(cs.id),
      ]) {
        const promise = mutation();
        expect(await settlesWithin(promise, 2_000)).toBe(true);
        await expect(promise).rejects.toBeInstanceOf(ConflictError);
        await expect(promise).rejects.toThrow(`Changeset '${cs.id}' is busy; try again`);
      }
      // touch and sweep skip the held row without waiting.
      expect(await settlesWithin(changesets.touch(cs.id), 2_000)).toBe(true);
      expect(await changesets.sweep(new Date())).toBe(0);
      // Reads never wait.
      expect(await read(cs.id)).toMatchObject({ version: before.version });
    } finally {
      holder.release();
      await holder.done;
    }
    const after = await read(cs.id);
    expect(after.version).toBe(before.version);
    expect(after.lastChangeAt).toEqual(before.lastChangeAt);
    expect(await changesets.append(cs.id, write("create_entity", "task"))).toBe(2);
  });

  describe("lockForCommit", () => {
    it("runs inside a bound store only", async () => {
      const cs = await started();
      await expect(store.changesets().lockForCommit(cs.id)).rejects.toThrow(
        "lockForCommit runs inside a bound store only",
      );
    });

    it("answers the changeset, or null when it is gone", async () => {
      const cs = await started();
      await store.changesets().append(cs.id, write("create_entity", "task"));
      const locked = await store.transaction((bound) => bound.changesets().lockForCommit(cs.id));
      expect(locked).toMatchObject({ id: cs.id, version: 2, writeCount: 1 });
      expect(await store.transaction((bound) => bound.changesets().lockForCommit(randomUUID()))).toBeNull();
    });

    it("a second commit on the same ontology is a ConflictError at once; another ontology is not blocked", async () => {
      const first = await started();
      const second = await started();
      const other = await getRuntimeStore(OTHER);
      const elsewhere = await other.changesets().start({
        id: randomUUID(),
        lensId: lenses.other!,
        anchorKey: null,
        note: null,
      });

      const holder = await hold(store, (bound) => bound.changesets().lockForCommit(first.id));
      try {
        const promise = store.transaction((bound) => bound.changesets().lockForCommit(second.id));
        expect(await settlesWithin(promise, 2_000)).toBe(true);
        await expect(promise).rejects.toBeInstanceOf(ConflictError);
        await expect(promise).rejects.toThrow("Another commit is running; try again");

        const parallel = other.transaction((bound) => bound.changesets().lockForCommit(elsewhere.id));
        expect(await settlesWithin(parallel, 2_000)).toBe(true);
        expect(await parallel).toMatchObject({ id: elsewhere.id });
      } finally {
        holder.release();
        await holder.done;
      }
      // Released with the transaction.
      expect(await store.transaction((bound) => bound.changesets().lockForCommit(second.id))).toMatchObject({
        id: second.id,
      });
    });

    it("a row held by a mutation is a ConflictError too", async () => {
      const cs = await started();
      const holder = await hold(store, (bound) => bound.changesets().append(cs.id, write("create_entity", "task")));
      try {
        const promise = store.transaction((bound) => bound.changesets().lockForCommit(cs.id));
        expect(await settlesWithin(promise, 2_000)).toBe(true);
        await expect(promise).rejects.toThrow("Another commit is running; try again");
      } finally {
        holder.release();
        await holder.done;
      }
    });
  });
});

describe("neutral reads", () => {
  it("parentsOf: the parent relations of the given children, at either end", async () => {
    const links = await store.parentsOf([ids.T1a, ids.M1, ids.Ben, ids.P1, "not-a-uuid"], READINGS);
    expect(links).toHaveLength(3);
    expect(links).toEqual(
      expect.arrayContaining([
        {
          relationType: "has_subtask",
          relationId: await relationId("has_subtask", ids.T1, ids.T1a),
          parentId: ids.T1,
          childId: ids.T1a,
        },
        // belongs_to's parent is its target end.
        {
          relationType: "belongs_to",
          relationId: await relationId("belongs_to", ids.M1, ids.P1),
          parentId: ids.P1,
          childId: ids.M1,
        },
        expect.objectContaining({ relationType: "has_project", parentId: ids.ACME, childId: ids.P1 }),
      ]),
    );
    // Only the readings passed are followed.
    expect(await store.parentsOf([ids.T1a, ids.M1], { has_subtask: "source" })).toHaveLength(1);
    expect(await store.parentsOf([ids.T1a], {})).toEqual([]);
    expect(await store.parentsOf([], READINGS)).toEqual([]);
  });

  it("childrenOf: the parent relations of the given parents; assigned_to is no parent relation", async () => {
    const links = await store.childrenOf([ids.P1, ids.T1], READINGS);
    expect(links.map((l) => [l.relationType, l.parentId, l.childId]).sort()).toEqual(
      [
        ["belongs_to", ids.P1, ids.M1],
        ["has_subtask", ids.T1, ids.T1a],
        ["has_task", ids.P1, ids.T1],
      ].sort(),
    );
    expect(await store.childrenOf([ids.T1a, ids.Ben], READINGS)).toEqual([]);
    expect(await store.childrenOf([ids.P1], {})).toEqual([]);
  });

  it("childrenOf with lock: no child can attach, and the found relations stay put, until the transaction ends", async () => {
    const holder = await hold(store, async (bound) => {
      const links = await bound.childrenOf([ids.P2], READINGS, true);
      expect(links.map((l) => l.childId)).toEqual([ids.T2]);
    });
    const newTask = randomUUID();
    await store.createEntity("task", newTask, { name: "Late" }, {});
    const attach = store.createRelation("has_task", randomUUID(), ids.P2, newTask, {}, {});
    const touchLink = store.updateRelation("has_task", await relationId("has_task", ids.P2, ids.T2), { x: 1 }, [], {});
    try {
      expect(await settlesWithin(attach, 300)).toBe(false);
      expect(await settlesWithin(touchLink, 300)).toBe(false);
    } finally {
      holder.release();
      await holder.done;
    }
    await attach;
    await touchLink;
    expect(await store.childrenOf([ids.P2], READINGS)).toHaveLength(2);
    await store.deleteEntity("task", newTask);
    await store.updateRelation("has_task", await relationId("has_task", ids.P2, ids.T2), {}, ["x"], {});
  });

  it("lockTargets: the stored props of entities and relations, FOR UPDATE", async () => {
    const link = await relationId("assigned_to", ids.T1, ids.Ben);
    const holder = await hold(store, async (bound) => {
      const targets = await bound.lockTargets([ids.T1, link, randomUUID(), "not-a-uuid"]);
      expect(targets).toEqual([
        { id: ids.T1, kind: "entity", typeKey: "task", props: { name: "T1" } },
        { id: link, kind: "relation", typeKey: "assigned_to", props: {} },
      ]);
    });
    const rename = store.updateEntity("task", ids.T1, { name: "T1 renamed" }, [], {});
    const drop = store.deleteRelation("assigned_to", link);
    try {
      expect(await settlesWithin(rename, 300)).toBe(false);
      expect(await settlesWithin(drop, 300)).toBe(false);
      // An unlocked row is not held.
      expect(await settlesWithin(store.updateEntity("task", ids.T2, { name: "T2" }, [], {}), 2_000)).toBe(true);
    } finally {
      holder.release();
      await holder.done;
    }
    expect(await rename).toMatchObject({ name: "T1 renamed" });
    expect(await drop).toBe(true);
    await store.updateEntity("task", ids.T1, { name: "T1" }, [], {});
    await store.createRelation("assigned_to", randomUUID(), ids.T1, ids.Ben, {}, {});
    expect(await store.lockTargets([])).toEqual([]);
  });
});
