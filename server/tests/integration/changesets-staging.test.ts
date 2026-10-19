/**
 * Staging into a changeset over REST, on the in-test hierarchy
 * (`buildHierarchy`, with `has_task` requiring `phase` and a document
 * property on project): start, the six staged writes, minted ids, bases,
 * the immediate write's 404 and 422, binding to the lens and the anchor,
 * the dangling anchor, unstage, discard, expiry, the note and write caps,
 * and a staged write while a commit holds the row.
 */

import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { closeStores, getRuntimeStore, initStores, type RuntimeStore } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { defineEntityProperty, modelPrefix, runtimePrefix } from "./fixture.js";
import {
  buildHierarchy,
  HIERARCHY_ONTOLOGY_KEY as O,
  requirePhaseOnHasTask,
  type HierarchyIds,
} from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const NS = `ont_${O}`;
const ALL = runtimePrefix(O, "all");
const PORTFOLIO = runtimePrefix(O, "portfolio");
const ANCHORS = `/api/ontologies/${O}/runtime/anchors`;

let app: FastifyInstance;
let ids: HierarchyIds;
let store: RuntimeStore;

async function call(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function sql(text: string, params?: unknown[]): Promise<Row[]> {
  return (await runQuery(text, params, NS)).rows;
}

/** Rows of the graph and the search queue: staging must leave them alone. */
async function graphCounts(): Promise<Row> {
  return (
    await sql(`SELECT (SELECT count(*) FROM entity)::int AS entities,
                      (SELECT count(*) FROM relation)::int AS relations,
                      (SELECT count(*) FROM search_queue)::int AS queued`)
  )[0]!;
}

async function journal(cs: string): Promise<Row[]> {
  return sql(
    `SELECT seq, operation, arguments, minted_id, type_key, target_id, before
       FROM changeset_write WHERE changeset_id = $1 ORDER BY seq`,
    [cs],
  );
}

async function start(base = ALL, note?: string): Promise<Row> {
  const res = await call("POST", `${base}/changesets`, note === undefined ? undefined : { note });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function putAnchor(key: string, entity: { type: string; id: string } | null): Promise<void> {
  const res = await call("PUT", `${ANCHORS}/${key}`, { entity });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function relationId(type: string, from: string, to: string): Promise<string> {
  const res = await call("GET", `${ALL}/relations/${type}?fromEntityId=${from}&toEntityId=${to}`);
  return res.body.items[0]._id as string;
}

/** A transaction on its own connection that runs `during`, then holds
 * its locks until `release` is called. */
async function hold(during: (bound: RuntimeStore) => Promise<unknown>): Promise<() => Promise<void>> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const held = new Promise<void>((resolve) => (ready = resolve));
  const done = store.transaction(async (bound) => {
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

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  app = await createApp();
  await app.ready();
  ids = await buildHierarchy(app);
  await requirePhaseOnHasTask(app);
  const types = (await call("GET", `${modelPrefix(O)}/entity-types`)).body as unknown as Row[];
  const project = types.find((t) => t.key === "project")!;
  await defineEntityProperty(app, O, project.entityTypeId as string, {
    key: "body",
    displayName: "Body",
    dataType: "document",
  });
  await call("PATCH", `${ALL}/entities/project/${ids.P1}`, { body: "the plan" });
  store = await getRuntimeStore(O);
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await sql(`DELETE FROM changeset`);
  await call("DELETE", `${ANCHORS}/agent-a`);
  await call("DELETE", `${ANCHORS}/agent-b`);
});

describe("start", () => {
  it("answers 201: draft, version, note, and no anchor on the plain lens", async () => {
    const cs = await start(ALL, "g1");
    expect(cs).toMatchObject({ state: "draft", version: 1, note: "g1", anchor: null, writeCount: 0 });
    expect(cs.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await call("POST", `${ALL}/changesets`)).toMatchObject({ status: 201, body: { note: null } });
  });

  it("through an anchored URL, the anchor is its key", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    const cs = await start(`${ALL}/anchors/agent-a`);
    expect(cs.anchor).toBe("agent-a");
  });

  it("not found in the order lens, anchor; a note of 1001 characters is 422", async () => {
    expect((await call("POST", `${runtimePrefix(O, "nope")}/changesets`)).status).toBe(404);
    const anchor = await call("POST", `${ALL}/anchors/ghost/changesets`);
    expect(anchor).toMatchObject({ status: 404, body: { error: { message: "Anchor 'ghost' not found" } } });
    const long = await call("POST", `${ALL}/changesets`, { note: "x".repeat(1001) });
    expect(long.status).toBe(422);
    expect(long.body.error.details.fields.note).toContain("1000");
    expect(await call("POST", `${ALL}/changesets`, { note: "x".repeat(1000) })).toMatchObject({ status: 201 });
    expect(await sql(`SELECT count(*)::int AS n FROM changeset`)).toEqual([{ n: 1 }]);
  });
});

describe("the six staged writes", () => {
  it("each answers 202 {seq, id} and appends one row; nothing reaches the graph or the search queue", async () => {
    const cs = (await start()).id as string;
    const before = await graphCounts();
    const url = `${ALL}/changesets/${cs}`;
    const assigned = await relationId("assigned_to", ids.T1, ids.Ben);

    const create = await call("POST", `${url}/entities/task`, {
      name: "T9",
      parentRelation: { type: "has_task", parentId: ids.P1, properties: { phase: "build" } },
    });
    expect(create).toMatchObject({ status: 202, body: { seq: 1, id: expect.any(String) } });
    const t9 = create.body.id as string;

    // Reads never see staged data.
    expect((await call("GET", `${ALL}/entities/task/${t9}`)).status).toBe(404);

    expect(await call("PATCH", `${url}/entities/task/${t9}`, { name: "T9b" })).toMatchObject({
      status: 202,
      body: { seq: 2, id: t9 },
    });
    expect(await call("PATCH", `${url}/entities/project/${ids.P2}`, { name: "P2 Website" })).toMatchObject({
      status: 202,
      body: { seq: 3, id: ids.P2 },
    });
    expect(await call("DELETE", `${url}/entities/task/${ids.T2}`)).toMatchObject({
      status: 202,
      body: { seq: 4, id: ids.T2 },
    });
    const relation = await call("POST", `${url}/relations/assigned_to`, {
      fromEntityId: ids.T2,
      toEntityId: ids.Ben,
    });
    expect(relation).toMatchObject({ status: 202, body: { seq: 5 } });
    expect(await call("PATCH", `${url}/relations/assigned_to/${assigned}`, {})).toMatchObject({
      status: 202,
      body: { seq: 6, id: assigned },
    });
    expect(await call("DELETE", `${url}/relations/assigned_to/${assigned}`)).toMatchObject({
      status: 202,
      body: { seq: 7, id: assigned },
    });

    expect(await graphCounts()).toEqual(before);
    const rows = await journal(cs);
    expect(rows.map((r) => [r.seq, r.operation, r.type_key])).toEqual([
      [1, "create_entity", "task"],
      [2, "update_entity", "task"],
      [3, "update_entity", "project"],
      [4, "delete_entity", "task"],
      [5, "create_relation", "assigned_to"],
      [6, "update_relation", "assigned_to"],
      [7, "delete_relation", "assigned_to"],
    ]);
    // The create's ids are final and kept in the row; the update by the
    // minted id has no before.
    expect(rows[0]).toMatchObject({
      minted_id: t9,
      target_id: null,
      before: null,
      arguments: {
        properties: { name: "T9" },
        parentRelation: { type: "has_task", parentId: ids.P1, properties: { phase: "build" } },
        relationId: expect.any(String),
      },
    });
    expect(rows[1]).toMatchObject({ target_id: t9, before: null, arguments: { properties: { name: "T9b" } } });
    expect(rows[2]).toMatchObject({ target_id: ids.P2, before: { name: "P2" } });
    expect(rows[3]).toMatchObject({ target_id: ids.T2, before: null, arguments: {} });
    expect(rows[4]).toMatchObject({ minted_id: relation.body.id, arguments: { fromEntityId: ids.T2, toEntityId: ids.Ben } });

    // The immediate data is unchanged.
    expect((await call("GET", `${ALL}/entities/project/${ids.P2}`)).body.name).toBe("P2");
    expect((await call("GET", `${ALL}/entities/task/${ids.T2}`)).status).toBe(200);

    const read = await call("GET", `${url}?limit=3&offset=1`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: cs, state: "draft", version: 8, writeCount: 7, offset: 1, limit: 3 });
    expect(read.body.writes.map((w: Row) => [w.seq, w.operation, w.type, w.id])).toEqual([
      [2, "update_entity", "task", t9],
      [3, "update_entity", "project", ids.P2],
      [4, "delete_entity", "task", ids.T2],
    ]);
    expect((await call("GET", url)).body.writes).toHaveLength(7);
    expect((await call("GET", `${url}?limit=501`)).status).toBe(422);
  });

  it("before holds exactly the patched keys: absent stays absent, a document is its hash and length", async () => {
    const cs = (await start()).id as string;
    const url = `${ALL}/changesets/${cs}`;
    await call("PATCH", `${url}/entities/project/${ids.P1}`, { name: "P1 New", body: "new plan" });
    await call("PATCH", `${url}/entities/project/${ids.P2}`, { body: "first plan" });
    const rows = await journal(cs);
    const hash = createHash("sha256").update("the plan").digest("hex");
    expect(rows[0]!.before).toEqual({ name: "P1", body: { sha256: hash, length: "the plan".length } });
    expect(rows[0]!.arguments).toEqual({ properties: { name: "P1 New", body: "new plan" } });
    // P2 holds no body: the key is absent from before, not null.
    expect(rows[1]!.before).toEqual({});
  });

  it("a missing target is 404 and a bad value 422 with the immediate write's fields; neither appends", async () => {
    const cs = (await start()).id as string;
    const url = `${ALL}/changesets/${cs}`;
    const ghost = randomUUID();

    expect(await call("PATCH", `${url}/entities/project/${ghost}`, { name: "X" })).toMatchObject({
      status: 404,
      body: { error: { message: `Entity '${ghost}' not found` } },
    });
    expect((await call("DELETE", `${url}/relations/has_task/${ghost}`)).status).toBe(404);

    const immediate = await call("POST", `${ALL}/entities/task`, {
      bogus: 1,
      parentRelation: { type: "has_task", parentId: ids.P1 },
    });
    const staged = await call("POST", `${url}/entities/task`, {
      bogus: 1,
      parentRelation: { type: "has_task", parentId: ids.P1 },
    });
    expect(immediate.status).toBe(422);
    expect(staged.status).toBe(422);
    expect(staged.body).toEqual(immediate.body);

    const patch = await call("PATCH", `${url}/entities/project/${ids.P1}`, { bogus: 1 });
    expect(patch.status).toBe(422);
    expect(patch.body).toEqual((await call("PATCH", `${ALL}/entities/project/${ids.P1}`, { bogus: 1 })).body);
    expect((await call("DELETE", `${url}/entities/nope/${ids.P1}`)).status).toBe(404);
    expect(await journal(cs)).toEqual([]);
    expect((await call("GET", url)).body.version).toBe(1);
  });
});

describe("binding", () => {
  it("another lens is 404; another anchor's URL is 404; the plain lens URL reaches an anchored one", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    await putAnchor("agent-b", { type: "project", id: ids.P2 });
    const plain = (await start()).id as string;
    const anchored = (await start(`${ALL}/anchors/agent-a`)).id as string;
    const notFound = (cs: string) => ({ status: 404, body: { error: { message: `Changeset '${cs}' not found` } } });

    expect(await call("GET", `${PORTFOLIO}/changesets/${plain}`)).toMatchObject(notFound(plain));
    expect(await call("PATCH", `${PORTFOLIO}/changesets/${plain}/entities/project/${ids.P2}`, { name: "x" })).toMatchObject(
      notFound(plain),
    );
    expect(await call("GET", `${ALL}/anchors/agent-b/changesets/${anchored}`)).toMatchObject(notFound(anchored));
    expect(await call("GET", `${ALL}/anchors/agent-a/changesets/${plain}`)).toMatchObject(notFound(plain));
    expect((await call("GET", `${ALL}/anchors/agent-a/changesets/${anchored}`)).status).toBe(200);
    expect((await call("GET", `${ALL}/changesets/${anchored}`)).status).toBe(200);
    expect(await call("GET", `${ALL}/changesets/not-a-uuid`)).toMatchObject(notFound("not-a-uuid"));
  });

  it("an anchored URL stages outside its anchor: coverage is a commit rule", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    const cs = (await start(`${ALL}/anchors/agent-a`)).id as string;
    const res = await call("POST", `${ALL}/anchors/agent-a/changesets/${cs}/entities/task`, {
      name: "Outside",
      parentRelation: { type: "has_task", parentId: ids.P2, properties: { phase: "build" } },
    });
    expect(res.status).toBe(202);
  });

  it("a dangling anchor refuses staging with 409; unstage still works", async () => {
    const leaf = (await call("POST", `${ALL}/entities/task`, {
      name: "Leaf",
      parentRelation: { type: "has_task", parentId: ids.P2, properties: { phase: "x" } },
    })).body._id as string;
    await putAnchor("agent-a", { type: "task", id: leaf });
    const base = `${ALL}/anchors/agent-a/changesets`;
    const cs = (await start(`${ALL}/anchors/agent-a`)).id as string;
    expect((await call("PATCH", `${base}/${cs}/entities/task/${leaf}`, { name: "L2" })).status).toBe(202);

    expect((await call("DELETE", `${ALL}/entities/task/${leaf}`)).status).toBe(204);
    const refused = await call("PATCH", `${base}/${cs}/entities/project/${ids.P2}`, { name: "x" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("dangling");
    expect(await journal(cs)).toHaveLength(1);

    expect((await call("DELETE", `${base}/${cs}/writes/1`)).status).toBe(204);
    expect(await journal(cs)).toEqual([]);
  });

  it("after its anchor is deleted, the plain lens URL still reaches the changeset", async () => {
    await putAnchor("agent-b", { type: "project", id: ids.P2 });
    const cs = (await start(`${ALL}/anchors/agent-b`)).id as string;
    expect((await call("DELETE", `${ANCHORS}/agent-b`)).status).toBe(204);
    expect((await call("GET", `${ALL}/anchors/agent-b/changesets/${cs}`)).status).toBe(404);
    expect(await call("GET", `${ALL}/changesets/${cs}`)).toMatchObject({ status: 200, body: { anchor: "agent-b" } });
    expect((await call("PATCH", `${ALL}/changesets/${cs}/entities/project/${ids.P2}`, { name: "x" })).status).toBe(202);
  });
});

describe("unstage, discard, expiry, caps, the row lock", () => {
  it("unstage removes one write by seq; an unknown seq is 404; a seq is never reused", async () => {
    const cs = (await start()).id as string;
    const url = `${ALL}/changesets/${cs}`;
    await call("PATCH", `${url}/entities/project/${ids.P1}`, { name: "a" });
    await call("PATCH", `${url}/entities/project/${ids.P2}`, { name: "b" });
    expect((await call("DELETE", `${url}/writes/2`)).status).toBe(204);
    expect(await call("DELETE", `${url}/writes/2`)).toMatchObject({
      status: 404,
      body: { error: { message: `Staged write 2 not found in changeset '${cs}'` } },
    });
    const next = await call("PATCH", `${url}/entities/project/${ids.P2}`, { name: "c" });
    expect(next.body.seq).toBeGreaterThan(2);
    expect((await journal(cs)).map((r) => r.seq)).toEqual([1, next.body.seq]);
  });

  it("discard deletes the changeset and its journal; then it is 404", async () => {
    const cs = (await start()).id as string;
    await call("PATCH", `${ALL}/changesets/${cs}/entities/project/${ids.P1}`, { name: "a" });
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(204);
    expect(await sql(`SELECT 1 FROM changeset_write WHERE changeset_id = $1`, [cs])).toEqual([]);
    expect((await call("GET", `${ALL}/changesets/${cs}`)).status).toBe(404);
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(404);
  });

  it("discard refuses a submitted changeset with 409, and keeps it", async () => {
    const cs = await start();
    await store.changesets().submit(cs.id as string, cs.version as number, "review");
    expect((await call("DELETE", `${ALL}/changesets/${cs.id}`)).status).toBe(409);
    expect((await call("GET", `${ALL}/changesets/${cs.id}`)).body.state).toBe("submitted");
  });

  it("a draft changeset idle for 8 days is 404 and its rows are gone", async () => {
    const cs = (await start()).id as string;
    await call("PATCH", `${ALL}/changesets/${cs}/entities/project/${ids.P1}`, { name: "a" });
    await sql(`UPDATE changeset SET last_change_at = now() - interval '8 days' WHERE changeset_id = $1`, [cs]);
    expect(await call("GET", `${ALL}/changesets/${cs}`)).toMatchObject({
      status: 404,
      body: { error: { message: `Changeset '${cs}' not found` } },
    });
    expect(await sql(`SELECT 1 FROM changeset WHERE changeset_id = $1`, [cs])).toEqual([]);
    expect(await sql(`SELECT 1 FROM changeset_write WHERE changeset_id = $1`, [cs])).toEqual([]);
  });

  it("start sweeps expired draft changesets of the ontology", async () => {
    const old = (await start()).id as string;
    await sql(`UPDATE changeset SET last_change_at = now() - interval '8 days' WHERE changeset_id = $1`, [old]);
    await start();
    expect(await sql(`SELECT 1 FROM changeset WHERE changeset_id = $1`, [old])).toEqual([]);
  });

  it("the cap: at 10,000 writes the next stage is 409 'full' and appends nothing", async () => {
    const cs = (await start()).id as string;
    await sql(
      `INSERT INTO changeset_write (changeset_id, seq, operation, arguments, type_key)
       SELECT $1, g, 'delete_entity', '{}'::jsonb, 'task' FROM generate_series(1, 10000) g`,
      [cs],
    );
    const res = await call("PATCH", `${ALL}/changesets/${cs}/entities/project/${ids.P1}`, { name: "a" });
    expect(res).toMatchObject({ status: 409, body: { error: { message: `Changeset '${cs}' is full: at most 10000 staged writes` } } });
    expect(await sql(`SELECT count(*)::int AS n FROM changeset_write WHERE changeset_id = $1`, [cs])).toEqual([
      { n: 10000 },
    ]);
  });

  it("a staged write while a commit holds the row is 409 at once; after release it is staged", async () => {
    const cs = (await start()).id as string;
    const release = await hold((bound) => bound.changesets().lockForCommit(cs));
    try {
      const started = Date.now();
      const res = await call("PATCH", `${ALL}/changesets/${cs}/entities/project/${ids.P1}`, { name: "a" });
      expect(res).toMatchObject({ status: 409, body: { error: { message: `Changeset '${cs}' is busy; try again` } } });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(409);
    } finally {
      await release();
    }
    expect(await journal(cs)).toEqual([]);
    expect((await call("PATCH", `${ALL}/changesets/${cs}/entities/project/${ids.P1}`, { name: "a" })).status).toBe(202);
  });
});
