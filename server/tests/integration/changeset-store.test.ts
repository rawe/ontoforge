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
  type ChangesetChange,
  type ChangesetRecord,
  type NewStagedObject,
  type NewStagedValue,
  type RuntimeStore,
} from "../../src/core/ports.js";
import { planSearchWrite } from "../../src/core/searchDependencies.js";
import { recordedDocument } from "../../src/runtime/changesets.js";
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
  const done = on.transaction(await on.designRevision(), async (bound) => {
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

function entity(objectId: string, typeKey: string, action: NewStagedObject["action"] = "create"): NewStagedObject {
  return { objectId, kind: "entity", typeKey, action, fromId: null, toId: null };
}

function relation(
  objectId: string,
  typeKey: string,
  ends: [string, string],
  action: NewStagedObject["action"] = "create",
): NewStagedObject {
  return { objectId, kind: "relation", typeKey, action, fromId: ends[0], toId: ends[1] };
}

function value(objectId: string, propertyKey: string, v: unknown, before: Row | null = null, bytes = 0): NewStagedValue {
  return { objectId, propertyKey, value: v, before, bytes };
}

/** A change that stages one new task. */
function newTask(): ChangesetChange {
  const id = randomUUID();
  return { objects: [entity(id, "task")], values: [value(id, "name", "T")] };
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

  it("a return commits every write: entity, search queue rows, ruleset and changeset", async () => {
    const { id, plan } = await plannedTask();
    const changesetId = randomUUID();
    const seen = await store.transaction(await store.designRevision(), async (bound) => {
      await bound.createEntity("task", id, { name: "Bound" }, {}, plan);
      await bound.rulesets().save("bound-a", { anchor: { type: "task", id } });
      await bound.changesets().start({ id: changesetId, lensId: lenses.all!, rulesetKey: null, note: null });
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
    expect(await store.rulesets().get("bound-a")).toMatchObject({ anchorFound: true });
    expect(await store.changesets().get(changesetId, lenses.all!, null)).not.toBeNull();
    await store.rulesets().delete("bound-a");
  });

  it("a throw rolls back everything the bound store wrote, search queue rows included", async () => {
    const { id, plan } = await plannedTask();
    const changesetId = randomUUID();
    const promise = store.transaction(await store.designRevision(), async (bound) => {
      await bound.createEntity("task", id, { name: "Gone" }, {}, plan);
      await bound.createRelation("has_task", randomUUID(), ids.P2, id, {}, {});
      await bound.rulesets().save("bound-b", { anchor: { type: "task", id } });
      await bound.changesets().start({ id: changesetId, lensId: lenses.all!, rulesetKey: null, note: null });
      await bound.changesets().apply(changesetId, 1, newTask());
      throw new Error("boom");
    });
    await expect(promise).rejects.toThrow("boom");

    expect(await store.getEntity("task", id)).toBeNull();
    expect(await store.childrenOf([ids.P2], READINGS)).toHaveLength(1);
    expect(await sql(`SELECT 1 FROM search_queue WHERE entity_id = $1`, [id])).toEqual([]);
    expect(await store.rulesets().get("bound-b")).toBeNull();
    expect(await sql(`SELECT 1 FROM changeset_object`)).toEqual([]);
    expect(await store.changesets().get(changesetId, lenses.all!, null)).toBeNull();
  });

  it("a driver error inside rolls back too", async () => {
    const id = randomUUID();
    const promise = store.transaction(await store.designRevision(), async (bound) => {
      await bound.createEntity("task", id, { name: "Gone" }, {});
      // The FK fails: no such parent.
      await bound.createRelation("has_task", randomUUID(), randomUUID(), id, {}, {});
    });
    await expect(promise).rejects.toThrow("not found");
    expect(await store.getEntity("task", id)).toBeNull();
  });

  it("a pool checkout inside fails loudly, never as a second connection", async () => {
    const id = randomUUID();
    await store.transaction(await store.designRevision(), async (bound) => {
      await bound.createEntity("task", id, { name: "Inside" }, {});
      // A nested transaction.
      await expect(bound.transaction(await bound.designRevision(), async () => undefined)).rejects.toThrow(
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
  async function started(rulesetKey: string | null = null, lensId = lenses.all!): Promise<ChangesetRecord> {
    return store.changesets().start({ id: randomUUID(), lensId, rulesetKey, note: "n" });
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

  /** Apply at the current version. */
  async function apply(id: string, change: ChangesetChange) {
    return store.changesets().apply(id, (await read(id)).version, change);
  }

  it("start: version 1, draft, no objects, bound to its lens and ruleset", async () => {
    const cs = await started("agent-a");
    expect(cs).toMatchObject({
      lensId: lenses.all,
      number: 1,
      rulesetKey: "agent-a",
      version: 1,
      note: "n",
      submittedAt: null,
      objectCount: 0,
    });
    expect(cs.createdAt).toBeInstanceOf(Date);
    expect(cs.lastChangeAt).toBeInstanceOf(Date);
  });

  it("start numbers per lens: the highest plus one, rulesets sharing it, a freed highest given again", async () => {
    const changesets = store.changesets();
    const first = await started(null);
    const second = await started("agent-a");
    const third = await started(null);
    expect([first.number, second.number, third.number]).toEqual([1, 2, 3]);
    expect((await started(null, lenses.portfolio!)).number).toBe(1);

    expect(await changesets.discard(second.id)).toBe(true);
    expect((await started("agent-a")).number).toBe(4);
    const fifth = await started(null);
    expect(fifth.number).toBe(5);
    expect(await changesets.discard(fifth.id)).toBe(true);
    expect((await started(null)).number).toBe(5);

    // Concurrent starts never share a number.
    const many = await Promise.all(Array.from({ length: 8 }, () => started(null)));
    expect(many.map((cs) => cs.number).sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("get honours the binding: another lens or another ruleset answers null", async () => {
    const plain = await started(null);
    const viaRuleset = await started("agent-a");
    const changesets = store.changesets();

    expect(await changesets.get(plain.id, lenses.all!, null)).toMatchObject({ id: plain.id });
    expect(await changesets.get(plain.id, lenses.portfolio!, null)).toBeNull();
    expect(await changesets.get(plain.id, lenses.all!, "agent-a")).toBeNull();

    // The plain lens URL reaches the ruleset's one; only its own ruleset does.
    expect(await changesets.get(viaRuleset.id, lenses.all!, null)).toMatchObject({ id: viaRuleset.id });
    expect(await changesets.get(viaRuleset.id, lenses.all!, "agent-a")).toMatchObject({ id: viaRuleset.id });
    expect(await changesets.get(viaRuleset.id, lenses.all!, "agent-b")).toBeNull();
    expect(await changesets.get(viaRuleset.id, lenses.portfolio!, "agent-a")).toBeNull();

    expect(await changesets.get("not-a-uuid", lenses.all!, null)).toBeNull();
    expect(await changesets.get(randomUUID(), lenses.all!, null)).toBeNull();
  });

  it("apply: a compare-and-set on the version that bumps it and the last change; objects by first touch, with their values", async () => {
    const cs = await started();
    const changesets = store.changesets();
    const [task, link] = [randomUUID(), randomUUID()];
    await age(cs.id);
    const before = await read(cs.id);

    expect(await changesets.apply(cs.id, before.version + 1, newTask())).toBeNull();
    expect(await read(cs.id)).toMatchObject({ version: before.version, objectCount: 0 });

    const recorded = { value: { sha256: "ab", length: 3 } };
    const after = await changesets.apply(cs.id, before.version, {
      objects: [entity(task, "task"), relation(link, "has_task", [ids.P1, task]), entity(ids.T1, "task", "update")],
      values: [
        value(task, "name", "T9", null, 10),
        value(ids.T1, "notes", "new text", recorded, 20),
        // Absent and null stay distinct, and so do a stored null and a removal.
        value(ids.T1, "name", null, {}, 5),
        value(ids.T1, "due", "2026", { value: null }, 5),
      ],
    });
    expect(after).toMatchObject({ id: cs.id, version: before.version + 1, objectCount: 3 });
    expect(after!.lastChangeAt.getTime()).toBeGreaterThan(before.lastChangeAt.getTime());

    const page = await changesets.page(cs.id, 0, 10);
    expect(page.map((o) => o.objectId)).toEqual([task, link, ids.T1]);
    expect(page[0]).toMatchObject({ kind: "entity", typeKey: "task", action: "create", fromId: null, toId: null });
    expect(page[0]!.firstTouchedAt).toBeInstanceOf(Date);
    expect(page[0]!.values).toEqual([{ propertyKey: "name", value: "T9", before: null, bytes: 10 }]);
    expect(page[1]).toMatchObject({ kind: "relation", typeKey: "has_task", fromId: ids.P1, toId: task, values: [] });
    expect(page[2]!.values).toEqual([
      { propertyKey: "due", value: "2026", before: { value: null }, bytes: 5 },
      { propertyKey: "name", value: null, before: {}, bytes: 5 },
      { propertyKey: "notes", value: "new text", before: recorded, bytes: 20 },
    ]);
    expect((await changesets.page(cs.id, 1, 1)).map((o) => o.objectId)).toEqual([link]);

    expect(await changesets.apply(randomUUID(), 1, newTask())).toBeNull();
    expect(await changesets.apply("not-a-uuid", 1, newTask())).toBeNull();
  });

  it("apply on staged objects: an action set keeps the first touch; values replaced whole; removals first, all or none", async () => {
    const cs = await started();
    const changesets = store.changesets();
    const [task, link] = [randomUUID(), randomUUID()];
    await apply(cs.id, {
      objects: [entity(ids.T1, "task", "update"), entity(task, "task"), relation(link, "has_task", [ids.P1, task])],
      values: [value(ids.T1, "name", "A", { value: "T1" }), value(ids.T1, "notes", "x", {}), value(task, "name", "N")],
    });
    const touched = (await changesets.objects(cs.id, [ids.T1]))[0]!.firstTouchedAt;

    await apply(cs.id, {
      removeValues: [{ objectId: ids.T1, propertyKey: "notes" }],
      objects: [entity(ids.T1, "task", "delete")],
      values: [value(task, "name", "N2", null, 7)],
    });
    const [t1] = await changesets.objects(cs.id, [ids.T1]);
    expect(t1).toMatchObject({ action: "delete", firstTouchedAt: touched });
    expect(t1!.values.map((v) => v.propertyKey)).toEqual(["name"]);
    expect((await changesets.objects(cs.id, [task]))[0]!.values).toEqual([{ propertyKey: "name", value: "N2", before: null, bytes: 7 }]);

    // An object removed takes its values; the same change may stage it anew.
    await apply(cs.id, { removeObjects: [task, link], objects: [entity(task, "task")], values: [value(task, "code", "C")] });
    expect((await changesets.objects(cs.id, [task, link, ids.T1, randomUUID(), "not-a-uuid"])).map((o) => [o.objectId, o.values.length])).toEqual([
      [ids.T1, 1],
      [task, 1],
    ]);
    expect(await sql(`SELECT property_key FROM changeset_value WHERE object_id = $1`, [task])).toEqual([{ property_key: "code" }]);

    // A value for an object not staged fails the whole change.
    const version = (await read(cs.id)).version;
    await expect(changesets.apply(cs.id, version, { removeObjects: [ids.T1], values: [value(randomUUID(), "name", "x")] })).rejects.toThrow();
    expect(await read(cs.id)).toMatchObject({ version, objectCount: 2 });
    expect(await changesets.objects(randomUUID(), [task])).toEqual([]);
  });

  it("relationsAt: the staged relations at either end of an entity, of this changeset only", async () => {
    const cs = await started();
    const other = await started();
    const [task, a, b, c] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await apply(cs.id, {
      objects: [
        entity(task, "task"),
        relation(a, "has_task", [ids.P1, task]),
        relation(b, "assigned_to", [task, ids.Ben], "update"),
        relation(c, "has_task", [ids.P1, ids.T1], "delete"),
      ],
    });
    await apply(other.id, { objects: [relation(randomUUID(), "has_task", [ids.P1, task])] });
    expect(await store.changesets().relationsAt(cs.id, task)).toEqual([a, b]);
    expect(await store.changesets().relationsAt(cs.id, ids.P1)).toEqual([a, c]);
    expect(await store.changesets().relationsAt(cs.id, randomUUID())).toEqual([]);
    expect(await store.changesets().relationsAt(cs.id, "not-a-uuid")).toEqual([]);
  });

  it("stagedBytes sums the bytes of the staged values now; a removed value's go with it", async () => {
    const cs = await started();
    const changesets = store.changesets();
    const task = randomUUID();
    expect(await changesets.stagedBytes(cs.id)).toBe(0);
    await apply(cs.id, {
      objects: [entity(task, "task")],
      values: [value(task, "name", "a", null, 1_500_000_000), value(task, "notes", "b", null, 1_500_000_001)],
    });
    // A sum past the integer range still comes back as a number.
    expect(await changesets.stagedBytes(cs.id)).toBe(3_000_000_001);
    // A value replaced counts once, by its new size.
    await apply(cs.id, { values: [value(task, "notes", "c", null, 1)] });
    expect(await changesets.stagedBytes(cs.id)).toBe(1_500_000_001);
    await apply(cs.id, { removeValues: [{ objectId: task, propertyKey: "name" }] });
    expect(await changesets.stagedBytes(cs.id)).toBe(1);
    expect(await changesets.stagedBytes(randomUUID())).toBe(0);
    expect(await changesets.stagedBytes("not-a-uuid")).toBe(0);
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

  it("list: counts per operation from action and kind, type keys, bound as get, by number", async () => {
    const changesets = store.changesets();
    const a = await started(null);
    const b = await started("agent-a");
    const empty = await started(null);
    await started(null, lenses.portfolio!);
    await apply(a.id, {
      objects: [
        entity(randomUUID(), "task"),
        entity(randomUUID(), "task"),
        relation(randomUUID(), "has_task", [ids.P1, ids.T1], "delete"),
      ],
    });
    await apply(b.id, { objects: [entity(ids.P1, "project", "update")], values: [value(ids.P1, "name", "P", { value: "P1" })] });
    expect(await changesets.submit(b.id, (await read(b.id)).version, "go")).not.toBeNull();

    const listed = await changesets.list(lenses.all!, null);
    expect(listed.map((cs) => [cs.id, cs.number])).toEqual([[a.id, 1], [b.id, 2], [empty.id, 3]]);
    const byId = Object.fromEntries(listed.map((cs) => [cs.id, cs]));
    expect(byId[a.id]).toMatchObject({
      objectCount: 3,
      operations: { create_entity: 2, delete_relation: 1 },
      typeKeys: ["has_task", "task"],
      version: 2,
    });
    expect(byId[empty.id]).toMatchObject({ objectCount: 0, operations: {}, typeKeys: [] });
    expect(byId[b.id]).toMatchObject({ rulesetKey: "agent-a", objectCount: 1, operations: { update_entity: 1 }, note: "go" });

    expect((await changesets.list(lenses.all!, "agent-a")).map((cs) => cs.id)).toEqual([b.id]);
    expect(await changesets.list(lenses.all!, "agent-b")).toEqual([]);
    expect(await changesets.list(lenses.portfolio!, null)).toHaveLength(1);
    expect(await changesets.list("not-a-uuid", null)).toEqual([]);
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

  it("sweep deletes draft changesets idle past the cutoff, with their objects and values; submitted ones stay", async () => {
    const changesets = store.changesets();
    const idle = await started();
    const fresh = await started();
    const submitted = await started();
    await apply(idle.id, newTask());
    await changesets.submit(submitted.id, submitted.version, null);
    await age(idle.id, "8 days");
    await age(submitted.id, "8 days");

    expect(await changesets.sweep(7 * 24 * 3_600_000)).toBe(1);
    expect(await changesets.get(idle.id, lenses.all!, null)).toBeNull();
    expect(await sql(`SELECT 1 FROM changeset_object WHERE changeset_id = $1`, [idle.id])).toEqual([]);
    expect(await sql(`SELECT 1 FROM changeset_value WHERE changeset_id = $1`, [idle.id])).toEqual([]);
    expect(await changesets.get(fresh.id, lenses.all!, null)).not.toBeNull();
    expect(await changesets.get(submitted.id, lenses.all!, null)).not.toBeNull();
  });

  it("discard and deleteCommitted delete the changeset with its objects and values", async () => {
    const changesets = store.changesets();
    const a = await started();
    const b = await started();
    await apply(a.id, newTask());
    await apply(b.id, newTask());

    expect(await changesets.discard(a.id)).toBe(true);
    expect(await changesets.discard(a.id)).toBe(false);
    expect(await changesets.get(a.id, lenses.all!, null)).toBeNull();

    await changesets.deleteCommitted(b.id);
    expect(await changesets.get(b.id, lenses.all!, null)).toBeNull();
    expect(await sql(`SELECT 1 FROM changeset_object`)).toEqual([]);
    expect(await sql(`SELECT 1 FROM changeset_value`)).toEqual([]);
  });

  it("discard deletes a draft changeset only: a submitted one stays, with its objects", async () => {
    const changesets = store.changesets();
    const cs = await started();
    await apply(cs.id, newTask());
    const submitted = await changesets.submit(cs.id, (await read(cs.id)).version, "go");

    expect(await changesets.discard(cs.id)).toBe(false);
    expect(await read(cs.id)).toMatchObject({ version: submitted!.version, objectCount: 1 });

    await changesets.unsubmit(cs.id, "back");
    expect(await changesets.discard(cs.id)).toBe(true);
    expect(await changesets.get(cs.id, lenses.all!, null)).toBeNull();
  });

  it("the state is judged in the writing statement: apply and submit change a draft changeset only, unsubmit a submitted one", async () => {
    const changesets = store.changesets();
    const cs = await started();
    await apply(cs.id, newTask());
    const submitted = (await changesets.submit(cs.id, (await read(cs.id)).version, "go"))!;

    expect(await changesets.apply(cs.id, submitted.version, newTask())).toBeNull();
    expect(await changesets.submit(cs.id, submitted.version, "again")).toBeNull();
    expect(await read(cs.id)).toMatchObject({ version: submitted.version, objectCount: 1, note: "go" });

    const draft = (await changesets.unsubmit(cs.id, "back"))!;
    expect(await changesets.unsubmit(cs.id, "twice")).toBeNull();
    expect(await read(cs.id)).toMatchObject({ version: draft.version, note: "back", submittedAt: null });
    expect(await changesets.apply(cs.id, draft.version, newTask())).toMatchObject({ objectCount: 2 });
  });

  it("while another connection holds the row, every mutation is a ConflictError at once", async () => {
    const changesets = store.changesets();
    const cs = await started();
    await apply(cs.id, newTask());
    await age(cs.id, "8 days");
    const before = await read(cs.id);

    const holder = await hold(store, (bound) => bound.changesets().lockForCommit(cs.id));
    try {
      for (const mutation of [
        () => changesets.apply(cs.id, before.version, newTask()),
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
      expect(await changesets.sweep(0)).toBe(0);
      // Reads never wait.
      expect(await read(cs.id)).toMatchObject({ version: before.version });
      expect(await changesets.page(cs.id, 0, 10)).toHaveLength(1);
    } finally {
      holder.release();
      await holder.done;
    }
    const after = await read(cs.id);
    expect(after.version).toBe(before.version);
    expect(after.lastChangeAt).toEqual(before.lastChangeAt);
    expect(await changesets.apply(cs.id, before.version, newTask())).toMatchObject({ objectCount: 2 });
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
      await apply(cs.id, newTask());
      const locked = await store.transaction(await store.designRevision(), (bound) => bound.changesets().lockForCommit(cs.id));
      expect(locked).toMatchObject({ id: cs.id, version: 2, objectCount: 1 });
      expect(await store.transaction(await store.designRevision(), (bound) => bound.changesets().lockForCommit(randomUUID()))).toBeNull();
    });

    it("a second commit on the same ontology is a ConflictError at once; another ontology is not blocked", async () => {
      const first = await started();
      const second = await started();
      const other = await getRuntimeStore(OTHER);
      const elsewhere = await other.changesets().start({
        id: randomUUID(),
        lensId: lenses.other!,
        rulesetKey: null,
        note: null,
      });

      const holder = await hold(store, (bound) => bound.changesets().lockForCommit(first.id));
      try {
        const promise = store.transaction(await store.designRevision(), (bound) => bound.changesets().lockForCommit(second.id));
        expect(await settlesWithin(promise, 2_000)).toBe(true);
        await expect(promise).rejects.toBeInstanceOf(ConflictError);
        await expect(promise).rejects.toThrow("Another commit is running; try again");

        const parallel = other.transaction(await other.designRevision(), (bound) => bound.changesets().lockForCommit(elsewhere.id));
        expect(await settlesWithin(parallel, 2_000)).toBe(true);
        expect(await parallel).toMatchObject({ id: elsewhere.id });
      } finally {
        holder.release();
        await holder.done;
      }
      // Released with the transaction.
      expect(await store.transaction(await store.designRevision(), (bound) => bound.changesets().lockForCommit(second.id))).toMatchObject({
        id: second.id,
      });
    });

    it("a row held by a mutation is a ConflictError too", async () => {
      const cs = await started();
      const holder = await hold(store, (bound) => bound.changesets().apply(cs.id, cs.version, newTask()));
      try {
        const promise = store.transaction(await store.designRevision(), (bound) => bound.changesets().lockForCommit(cs.id));
        expect(await settlesWithin(promise, 2_000)).toBe(true);
        await expect(promise).rejects.toThrow("Another commit is running; try again");
      } finally {
        holder.release();
        await holder.done;
      }
    });
  });
});

describe("RulesetStore", () => {
  const P1 = () => ({ type: "project", id: ids.P1 });

  beforeEach(async () => {
    await sql(`DELETE FROM ruleset`);
  });

  it("save with an empty patch creates an empty ruleset: no anchor, write access full", async () => {
    expect(await store.rulesets().save("agent-a", {})).toEqual({
      key: "agent-a",
      anchor: null,
      anchorFound: false,
      writeAccess: "full",
    });
    expect(await store.rulesets().get("agent-a")).toEqual({ key: "agent-a", anchor: null, anchorFound: false, writeAccess: "full" });
  });

  it("a patch naming write access keeps the anchor", async () => {
    await store.rulesets().save("agent-a", { anchor: P1() });
    expect(await store.rulesets().save("agent-a", { writeAccess: "propose" })).toEqual({
      key: "agent-a",
      anchor: P1(),
      anchorFound: true,
      writeAccess: "propose",
    });
  });

  it("a null anchor removes it and keeps write access", async () => {
    await store.rulesets().save("agent-a", { anchor: P1(), writeAccess: "none" });
    expect(await store.rulesets().save("agent-a", { anchor: null })).toEqual({
      key: "agent-a",
      anchor: null,
      anchorFound: false,
      writeAccess: "none",
    });
  });

  it("a patch naming the anchor keeps write access; an empty patch keeps both", async () => {
    await store.rulesets().save("agent-a", { writeAccess: "propose" });
    expect(await store.rulesets().save("agent-a", { anchor: P1() })).toMatchObject({ anchor: P1(), writeAccess: "propose" });
    expect(await store.rulesets().save("agent-a", {})).toMatchObject({ anchor: P1(), writeAccess: "propose" });
  });

  it("a new ruleset takes the rules the patch names", async () => {
    expect(await store.rulesets().save("agent-b", { anchor: P1(), writeAccess: "none" })).toEqual({
      key: "agent-b",
      anchor: P1(),
      anchorFound: true,
      writeAccess: "none",
    });
    expect((await store.rulesets().list()).map((r) => r.key)).toEqual(["agent-b"]);
    expect(await store.rulesets().delete("agent-b")).toBe(true);
    expect(await store.rulesets().delete("agent-b")).toBe(false);
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
      const targets = await bound.lockTargets([ids.T1, link, randomUUID(), "not-a-uuid"], {});
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
    expect(await store.lockTargets([], {})).toEqual([]);
  });

  describe("document values as their fingerprint", () => {
    /** Multi-byte text: an emoji (two UTF-16 units, four UTF-8 bytes), an umlaut. */
    const TEXT = `Plan 😀 für T1\n${"x".repeat(5000)}`;
    const DOCS = { task: ["notes"] };

    beforeAll(async () => {
      await store.updateEntity("task", ids.T1, { notes: TEXT, _doc_notes_length: recordedDocument(TEXT).length }, [], {});
    });

    afterAll(async () => {
      await store.updateEntity("task", ids.T1, {}, ["notes", "_doc_notes_length"], {});
    });

    it("getEntitiesByIdsHashed: the rows as getEntitiesByIds reads them raw, a document as recordedDocument keeps it", async () => {
      const read = [ids.T1, ids.T2, ids.P1, randomUUID(), "not-a-uuid"];
      const raw = await store.getEntitiesByIds(read, {});
      const hashed = await store.getEntitiesByIdsHashed(read, DOCS);
      expect(Object.keys(hashed).sort()).toEqual([ids.T1, ids.T2, ids.P1].sort());
      // SQL's sha256 over the UTF-8 bytes and char_length equal Node's hash and code points.
      expect(hashed[ids.T1]).toEqual({ ...raw[ids.T1], notes: recordedDocument(TEXT) });
      expect(recordedDocument(TEXT).length).toBe([...TEXT].length);
      expect(hashed[ids.T2]).toEqual(raw[ids.T2]);
      expect(hashed[ids.P1]).toEqual(raw[ids.P1]);
      // A key that is no document of the type is read as stored.
      expect((await store.getEntitiesByIdsHashed([ids.T1], { project: ["notes"] }))[ids.T1]).toEqual(raw[ids.T1]);
      expect(await store.getEntitiesByIdsHashed([], DOCS)).toEqual({});
    });

    it("lockTargets: a locked entity's document as its fingerprint", async () => {
      await store.transaction(await store.designRevision(), async (bound) => {
        const [target] = await bound.lockTargets([ids.T1], DOCS);
        expect(target).toEqual({
          id: ids.T1,
          kind: "entity",
          typeKey: "task",
          props: { name: "T1", notes: recordedDocument(TEXT), _doc_notes_length: [...TEXT].length },
        });
      });
    });
  });

  it("getEntityTypes: the type key of each entity of the ids; relations and unknown ids left out", async () => {
    const link = await relationId("assigned_to", ids.T1, ids.Ben);
    expect(await store.getEntityTypes([ids.T1, ids.P1, ids.Ben, link, randomUUID(), "not-a-uuid"])).toEqual({
      [ids.T1]: "task",
      [ids.P1]: "project",
      [ids.Ben]: "person",
    });
    expect(await store.getEntityTypes([])).toEqual({});
  });

  it("getRelationsByIds: relations of any type by id, as getRelation reads them; an unknown id left out", async () => {
    const assigned = await relationId("assigned_to", ids.T1, ids.Ben);
    const subtask = await relationId("has_subtask", ids.T1, ids.T1a);
    const read = await store.getRelationsByIds([assigned, subtask, ids.T1, randomUUID(), "not-a-uuid"]);
    expect(read).toEqual({
      [assigned]: await store.getRelation("assigned_to", assigned),
      [subtask]: await store.getRelation("has_subtask", subtask),
    });
    expect(await store.getRelationsByIds([])).toEqual({});
  });
});
