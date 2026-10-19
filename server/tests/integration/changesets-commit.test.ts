/**
 * The commit over REST, on the in-test project hierarchy
 * (`buildProjectHierarchy`): every staged operation persisted with its
 * search work, the move, the nested create, the order-free subtree delete,
 * the rollback of a replay error, the version check, and the locks: the
 * commit lock, the changeset row, a graph row held past the lock timeout,
 * and the process limit. Two small ontologies of their own give commits
 * that run beside it.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runQuery } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { closeStores, getRuntimeStore, initStores, type RuntimeStore } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createOntology, modelPrefix, runtimePrefix } from "./fixture.js";
import {
  buildProjectHierarchy,
  PROJECT_HIERARCHY_ONTOLOGY_KEY as O,
  type ProjectHierarchyIds,
} from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const NS = `ont_${O}`;
const ALL = runtimePrefix(O, "all");
const SIDE = ["side_a", "side_b"] as const;

let app: FastifyInstance;
let h: ProjectHierarchyIds;
let e: ProjectHierarchyIds["entities"];
let store: RuntimeStore;
/** The one entity of each side ontology. */
const sideThing: Record<string, string> = {};

async function call(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function sql(text: string, params?: unknown[], namespace = NS): Promise<Row[]> {
  return (await runQuery(text, params, namespace)).rows;
}

async function graphCounts(): Promise<Row> {
  return (
    await sql(`SELECT (SELECT count(*) FROM entity)::int AS entities,
                      (SELECT count(*) FROM relation)::int AS relations,
                      (SELECT count(*) FROM search_queue)::int AS queued`)
  )[0]!;
}

async function start(base = ALL): Promise<string> {
  const res = await call("POST", `${base}/changesets`);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function staged(method: string, base: string, cs: string, path: string, payload?: Row): Promise<Row> {
  const res = await call(method, `${base}/changesets/${cs}/${path}`, payload);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body;
}

async function version(cs: string, base = ALL): Promise<number> {
  const res = await call("GET", `${base}/changesets/${cs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.version as number;
}

function commit(cs: string, payload?: Row, base = ALL): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/changesets/${cs}/commit`, payload);
}

async function pathNames(type: string, id: string): Promise<string[]> {
  const res = await call("GET", `${ALL}/entities/${type}/${id}/path`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as unknown as Row[]).map((step) => step.name as string);
}

/** A transaction on its own connection that runs `during`, then holds
 * its locks until the returned function is called. */
async function hold(on: RuntimeStore, during: (bound: RuntimeStore) => Promise<unknown>): Promise<() => Promise<void>> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const held = new Promise<void>((resolve) => (ready = resolve));
  const done = on.transaction(async (bound) => {
    await during(bound);
    ready();
    await released;
  });
  await held;
  return async () => {
    release();
    await done;
  };
}

/** Wait until `n` statements of this database wait for a lock. */
async function waitingForLocks(n: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [row] = (
      await runQuery(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      )
    ).rows;
    if ((row!.n as number) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`fewer than ${n} statements wait for a lock`);
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  app = await createApp();
  await app.ready();
  h = await buildProjectHierarchy(app);
  e = h.entities;
  store = await getRuntimeStore(O);
  for (const key of SIDE) {
    await createOntology(app, key);
    await call("POST", `${modelPrefix(key)}/entity-types`, { key: "thing", displayName: "Thing" });
    await call("POST", `${modelPrefix(key)}/lenses`, { key: "all", name: "All" });
    const thing = await call("POST", `${runtimePrefix(key, "all")}/entities/thing`, { name: "one" });
    expect(thing.status, JSON.stringify(thing.body)).toBe(201);
    sideThing[key] = thing.body._id as string;
  }
}, 60_000);

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("a commit persists every staged write", () => {
  it("all six operations and a whole document value, with their search work; then the changeset is gone", async () => {
    await sql(`DELETE FROM search_queue`);
    const cs = await start();
    const t9 = (
      await staged("POST", ALL, cs, "entities/task", {
        name: "T9",
        parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "build" } },
      })
    ).id as string;
    await staged("PATCH", ALL, cs, `entities/task/${t9}`, { name: "T9b" });
    await staged("PATCH", ALL, cs, `entities/project/${e.P2}`, { name: "P2 Website" });
    await staged("PATCH", ALL, cs, `entities/task/${e.T5}`, { notes: "A whole new text" });
    await staged("DELETE", ALL, cs, `entities/task/${e.T4}`);
    const assigned = (
      await staged("POST", ALL, cs, "relations/assigned_to", { fromEntityId: e.T2, toEntityId: e.Kim })
    ).id as string;
    await staged("PATCH", ALL, cs, `relations/has_task/${h.relations["P1 has_task T2"]}`, { phase: "test" });
    await staged("DELETE", ALL, cs, `relations/mentors/${h.relations["Ben mentors Kim"]}`);
    expect(await sql(`SELECT 1 FROM search_queue`)).toEqual([]);

    const res = await commit(cs, { expectedVersion: await version(cs) });
    expect(res).toEqual({ status: 200, body: { committed: 8, alreadyGone: [] } });

    expect((await call("GET", `${ALL}/entities/task/${t9}`)).body).toMatchObject({ name: "T9b" });
    expect(await pathNames("task", t9)).toEqual(["ACME", "P1", "T9b"]);
    const parent = await call("GET", `${ALL}/relations/has_task?toEntityId=${t9}`);
    expect(parent.body.items).toEqual([expect.objectContaining({ fromEntityId: e.P1, phase: "build" })]);
    expect((await call("GET", `${ALL}/entities/project/${e.P2}`)).body).toMatchObject({ name: "P2 Website" });
    const notes = await call("GET", `${ALL}/entities/task/${e.T5}/documents/notes`);
    expect(notes.body).toMatchObject({ content: "A whole new text" });
    expect((await call("GET", `${ALL}/entities/task/${e.T4}`)).status).toBe(404);
    expect((await call("GET", `${ALL}/relations/assigned_to/${assigned}`)).body).toMatchObject({
      fromEntityId: e.T2,
      toEntityId: e.Kim,
    });
    expect((await call("GET", `${ALL}/relations/has_task/${h.relations["P1 has_task T2"]}`)).body).toMatchObject({
      phase: "test",
    });
    expect((await call("GET", `${ALL}/relations/mentors/${h.relations["Ben mentors Kim"]}`)).status).toBe(404);

    // The search work of each write, queued in the commit, is what the
    // same immediate write queues (twins: P3 for P2, T6 for T5).
    const kinds = async (id: string): Promise<string[]> =>
      (await sql(`SELECT DISTINCT part_kind FROM search_queue WHERE entity_id = $1 ORDER BY 1`, [id])).map(
        (row) => row.part_kind as string,
      );
    expect(await kinds(t9)).toEqual(expect.arrayContaining(["entity"]));
    expect(await kinds(e.T4)).toEqual([]);
    expect((await call("PATCH", `${ALL}/entities/project/${e.P3}`, { name: "P3 B" })).status).toBe(200);
    expect((await call("PATCH", `${ALL}/entities/task/${e.T6}`, { notes: "Other text" })).status).toBe(200);
    expect(await kinds(e.P2)).not.toEqual([]);
    expect(await kinds(e.P2)).toEqual(await kinds(e.P3));
    expect(await kinds(e.T5)).not.toEqual([]);
    expect(await kinds(e.T5)).toEqual(await kinds(e.T6));

    // The changeset and its journal are gone.
    expect((await call("GET", `${ALL}/changesets/${cs}`)).status).toBe(404);
    expect((await commit(cs)).status).toBe(404);
    expect(await sql(`SELECT 1 FROM changeset_write WHERE changeset_id = $1`, [cs])).toEqual([]);
  });

  it("the move: delete the parent relation, then create the new one", async () => {
    const cs = await start();
    await staged("DELETE", ALL, cs, `relations/has_task/${h.relations["P1 has_task T3"]}`);
    await staged("POST", ALL, cs, "relations/has_task", { fromEntityId: e.P2, toEntityId: e.T3, phase: "test" });
    expect(await commit(cs)).toMatchObject({ status: 200, body: { committed: 2 } });
    expect(await pathNames("task", e.T3)).toEqual(["ACME", "P2 Website", "T3"]);
    const assigned = await call("GET", `${ALL}/relations/assigned_to?fromEntityId=${e.T3}`);
    expect(assigned.body.items).toEqual([expect.objectContaining({ toEntityId: e.Ana })]);
  });

  it("the nested create: a project, tasks under its minted id, an update of one", async () => {
    const cs = await start();
    const p4 = (
      await staged("POST", ALL, cs, "entities/project", {
        name: "P4",
        parentRelation: { type: "has_project", parentId: e.ACME },
      })
    ).id as string;
    const under = (name: string) => ({
      name,
      parentRelation: { type: "has_task", parentId: p4, properties: { phase: "plan" } },
    });
    const t7 = (await staged("POST", ALL, cs, "entities/task", under("T7"))).id as string;
    const t8 = (await staged("POST", ALL, cs, "entities/task", under("T8"))).id as string;
    await staged("PATCH", ALL, cs, `entities/task/${t7}`, { name: "T7b" });
    expect(await commit(cs)).toMatchObject({ status: 200, body: { committed: 4 } });
    expect(await pathNames("task", t7)).toEqual(["ACME", "P4", "T7b"]);
    expect(await pathNames("task", t8)).toEqual(["ACME", "P4", "T8"]);
  });

  it("the subtree delete in any order, parent first", async () => {
    const cs = await start();
    for (const name of ["T1", "T1a", "T1a1"] as const) {
      await staged("DELETE", ALL, cs, `entities/task/${e[name]}`);
    }
    expect(await commit(cs)).toEqual({ status: 200, body: { committed: 3, alreadyGone: [] } });
    for (const name of ["T1", "T1a", "T1a1"] as const) {
      expect((await call("GET", `${ALL}/entities/task/${e[name]}`)).status).toBe(404);
    }
  });

  it("a delete of what is already gone counts as done, and is listed", async () => {
    const x = (await call("POST", `${ALL}/entities/person`, { name: "X" })).body._id as string;
    const cs = await start();
    await staged("DELETE", ALL, cs, `entities/person/${x}`);
    expect((await call("DELETE", `${ALL}/entities/person/${x}`)).status).toBe(204);
    expect(await commit(cs)).toEqual({ status: 200, body: { committed: 1, alreadyGone: [1] } });
  });
});

describe("a rejected commit persists nothing", () => {
  it("a replay error rolls everything back: 422 naming the seq; the version kept, the last change refreshed", async () => {
    await sql(`DELETE FROM search_queue`);
    const cs = await start();
    await staged("POST", ALL, cs, "entities/task", {
      name: "T10",
      parentRelation: { type: "has_task", parentId: e.P2, properties: { phase: "build" } },
    });
    const ghost = randomUUID();
    await staged("POST", ALL, cs, "relations/has_task", { fromEntityId: e.P2, toEntityId: ghost, phase: "x" });
    const before = await graphCounts();
    const v = await version(cs);
    const [{ last_change_at: changedBefore }] = await sql(
      `SELECT last_change_at FROM changeset WHERE changeset_id = $1`,
      [cs],
    );

    const res = await commit(cs, { expectedVersion: v });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The commit was rejected; nothing was persisted",
      details: { violations: [{ seq: 2, kind: "replay", message: `Entity '${ghost}' not found` }], total: 1 },
    });

    expect(await graphCounts()).toEqual(before);
    expect(before.queued).toBe(0);
    expect(await version(cs)).toBe(v);
    const [{ last_change_at: changedAfter }] = await sql(
      `SELECT last_change_at FROM changeset WHERE changeset_id = $1`,
      [cs],
    );
    expect((changedAfter as Date).getTime()).toBeGreaterThan((changedBefore as Date).getTime());
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(204);
  });

  it("a stale expectedVersion is 409; none commits", async () => {
    const cs = await start();
    await staged("PATCH", ALL, cs, `entities/person/${e.Lea}`, { name: "Lea M" });
    const v = await version(cs);
    const stale = await commit(cs, { expectedVersion: v - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toContain("changed since you looked");
    expect((await call("GET", `${ALL}/entities/person/${e.Lea}`)).body).toMatchObject({ name: "Lea" });
    expect(await version(cs)).toBe(v);
    expect(await commit(cs)).toMatchObject({ status: 200, body: { committed: 1 } });
    expect((await call("GET", `${ALL}/entities/person/${e.Lea}`)).body).toMatchObject({ name: "Lea M" });
  });

  it("an off-format expectedVersion is 422", async () => {
    const cs = await start();
    expect((await commit(cs, { expectedVersion: "1" })).status).toBe(422);
    expect((await commit(cs, { expectedVersion: 0 })).status).toBe(422);
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(204);
  });

  it("through an anchored URL, another anchor's changeset is 404", async () => {
    const anchors = `/api/ontologies/${O}/runtime/anchors`;
    for (const [key, id] of [
      ["agent-a", e.P2],
      ["agent-b", e.P3],
    ] as const) {
      expect((await call("PUT", `${anchors}/${key}`, { entity: { type: "project", id } })).status).toBe(200);
    }
    const cs = await start(`${ALL}/anchors/agent-a`);
    await staged("PATCH", `${ALL}/anchors/agent-a`, cs, `entities/task/${e.T5}`, { name: "T5b" });
    expect((await commit(cs, undefined, `${ALL}/anchors/agent-b`)).status).toBe(404);
    expect(await commit(cs, undefined, `${ALL}/anchors/agent-a`)).toMatchObject({ status: 200, body: { committed: 1 } });
    await call("DELETE", `${anchors}/agent-a`);
    await call("DELETE", `${anchors}/agent-b`);
  });
});

describe("locks", () => {
  it("another commit on the ontology is 409 at once; another ontology commits", async () => {
    const other = await start();
    const cs = await start();
    await staged("PATCH", ALL, cs, `entities/person/${e.Kim}`, { name: "Kim B" });
    const release = await hold(store, (bound) => bound.changesets().lockForCommit(other));
    try {
      const began = Date.now();
      const res = await commit(cs);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe("Another commit is running; try again");
      expect(Date.now() - began).toBeLessThan(2000);

      const side = runtimePrefix(SIDE[0], "all");
      const sideCs = await start(side);
      await staged("PATCH", side, sideCs, `entities/thing/${sideThing[SIDE[0]]}`, { name: "two" });
      expect(await commit(sideCs, undefined, side)).toMatchObject({ status: 200, body: { committed: 1 } });
    } finally {
      await release();
    }
    expect((await call("GET", `${ALL}/entities/person/${e.Kim}`)).body).toMatchObject({ name: "Kim" });
    expect(await commit(cs)).toMatchObject({ status: 200 });
  });

  it("while a commit runs, a staged write to it and a second commit are 409; it then commits", async () => {
    const cs = await start();
    await staged("PATCH", ALL, cs, `entities/person/${e.Ana}`, { name: "Ana B" });
    const second = await start();
    await staged("PATCH", ALL, second, `entities/person/${e.Lea}`, { name: "Lea C" });

    const release = await hold(store, (bound) => bound.lockTargets([e.Ana]));
    let running: Promise<{ status: number; body: Row }> | undefined;
    try {
      running = commit(cs);
      await waitingForLocks(1);
      const stage = await call("PATCH", `${ALL}/changesets/${cs}/entities/person/${e.Ben}`, { name: "x" });
      expect(stage.status).toBe(409);
      expect(stage.body.error.message).toBe(`Changeset '${cs}' is busy; try again`);
      expect(await commit(second)).toMatchObject({ status: 409 });
    } finally {
      await release();
    }
    expect(await running).toMatchObject({ status: 200, body: { committed: 1 } });
    expect((await call("GET", `${ALL}/entities/person/${e.Ana}`)).body).toMatchObject({ name: "Ana B" });
    expect(await commit(second)).toMatchObject({ status: 200 });
  });

  it("a wait on a held graph row past 5 s is 409, with nothing persisted", async () => {
    const cs = await start();
    const created = (await staged("POST", ALL, cs, "entities/person", { name: "Zed" })).id as string;
    await staged("PATCH", ALL, cs, `entities/person/${e.Ben}`, { name: "Ben B" });
    const v = await version(cs);
    const release = await hold(store, (bound) => bound.lockTargets([e.Ben]));
    try {
      const began = Date.now();
      const res = await commit(cs);
      const waited = Date.now() - began;
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe("Another operation holds this data; try again");
      expect(waited).toBeGreaterThanOrEqual(4500);
      expect(waited).toBeLessThan(9000);
    } finally {
      await release();
    }
    expect((await call("GET", `${ALL}/entities/person/${created}`)).status).toBe(404);
    expect((await call("GET", `${ALL}/entities/person/${e.Ben}`)).body).toMatchObject({ name: "Ben" });
    expect(await version(cs)).toBe(v);
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(204);
  }, 20_000);

  it("a third concurrent commit in the process is 409 at once", async () => {
    const holds: (() => Promise<void>)[] = [];
    const running: Promise<{ status: number; body: Row }>[] = [];
    try {
      for (const key of SIDE) {
        const side = runtimePrefix(key, "all");
        const cs = await start(side);
        await staged("PATCH", side, cs, `entities/thing/${sideThing[key]}`, { name: "held" });
        holds.push(await hold(await getRuntimeStore(key), (bound) => bound.lockTargets([sideThing[key]!])));
        running.push(commit(cs, undefined, side));
      }
      await waitingForLocks(2);

      const cs = await start();
      const began = Date.now();
      const third = await commit(cs);
      expect(third.status).toBe(409);
      expect(third.body.error.message).toBe("Too many commits are running; try again");
      expect(Date.now() - began).toBeLessThan(2000);
    } finally {
      for (const release of holds) await release();
    }
    for (const res of await Promise.all(running)) {
      expect(res).toMatchObject({ status: 200, body: { committed: 1 } });
    }
    const cs = await start();
    expect(await commit(cs)).toMatchObject({ status: 200, body: { committed: 0 } });
  }, 20_000);
});
