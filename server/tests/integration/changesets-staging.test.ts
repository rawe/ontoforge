/**
 * Staging into a changeset over REST, on the in-test hierarchy
 * (`buildHierarchy`, with `has_task` requiring `phase` and a document
 * property on project): start, the six staged writes and their body, a
 * create with a parent relation as two writes, minted ids, bases, the
 * immediate write's 404 and 422, binding to the lens and the anchor,
 * the dangling anchor, unstage, discard, expiry, the note, write and byte caps,
 * and a staged write while a commit holds the row.
 */

import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
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
const RULESETS = `/api/ontologies/${O}/runtime/rulesets`;

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

/** Stage one write: its journal body, posted to the changeset's writes. */
function stage(cs: string, write: Row, base = ALL): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/changesets/${cs}/writes`, write);
}

/** The journal body of an update of project P1 or another project. */
function rename(id: string, name: string): Row {
  return { operation: "update_entity", type: "project", id, properties: { name } };
}

async function putAnchor(key: string, entity: { type: string; id: string } | null): Promise<void> {
  const res = await call("PUT", `${RULESETS}/${key}`, { anchor: entity });
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
  await call("DELETE", `${RULESETS}/agent-a`);
  await call("DELETE", `${RULESETS}/agent-b`);
});

describe("start", () => {
  it("answers 201: draft, version, note, and no anchor on the plain lens", async () => {
    const cs = await start(ALL, "g1");
    expect(cs).toMatchObject({ state: "draft", version: 1, note: "g1", ruleset: null, writeCount: 0 });
    expect(cs.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await call("POST", `${ALL}/changesets`)).toMatchObject({ status: 201, body: { note: null } });
  });

  it("through an anchored URL, the anchor is its key", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    const cs = await start(`${ALL}/rulesets/agent-a`);
    expect(cs.ruleset).toBe("agent-a");
  });

  it("not found in the order lens, anchor; a note of 1001 characters is 422", async () => {
    expect((await call("POST", `${runtimePrefix(O, "nope")}/changesets`)).status).toBe(404);
    const anchor = await call("POST", `${ALL}/rulesets/ghost/changesets`);
    expect(anchor).toMatchObject({ status: 404, body: { error: { message: "Anchor 'ghost' not found" } } });
    const long = await call("POST", `${ALL}/changesets`, { note: "x".repeat(1001) });
    expect(long.status).toBe(422);
    expect(long.body.error.details.fields.note).toContain("1000");
    expect(await call("POST", `${ALL}/changesets`, { note: "x".repeat(1000) })).toMatchObject({ status: 201 });
    expect(await sql(`SELECT count(*)::int AS n FROM changeset`)).toEqual([{ n: 1 }]);
  });
});

describe("the six staged writes", () => {
  it("each answers 201 {seq, id} and appends one row; nothing reaches the graph or the search queue", async () => {
    const cs = (await start()).id as string;
    const before = await graphCounts();
    const url = `${ALL}/changesets/${cs}`;
    const assigned = await relationId("assigned_to", ids.T1, ids.Ben);

    const create = await stage(cs, { operation: "create_entity", type: "task", properties: { name: "T9" } });
    expect(create).toMatchObject({ status: 201, body: { seq: 1, id: expect.any(String) } });
    expect(create.body).not.toHaveProperty("relation");
    const t9 = create.body.id as string;

    // Reads never see staged data.
    expect((await call("GET", `${ALL}/entities/task/${t9}`)).status).toBe(404);

    expect(await stage(cs, { operation: "update_entity", type: "task", id: t9, properties: { name: "T9b" } })).toEqual({
      status: 201,
      body: { seq: 2, id: t9 },
    });
    expect(await stage(cs, rename(ids.P2, "P2 Website"))).toEqual({ status: 201, body: { seq: 3, id: ids.P2 } });
    expect(await stage(cs, { operation: "delete_entity", type: "task", id: ids.T2 })).toEqual({
      status: 201,
      body: { seq: 4, id: ids.T2 },
    });
    const relation = await stage(cs, {
      operation: "create_relation",
      type: "assigned_to",
      fromEntityId: ids.T2,
      toEntityId: ids.Ben,
    });
    expect(relation).toMatchObject({ status: 201, body: { seq: 5 } });
    // properties defaults to {}.
    expect(await stage(cs, { operation: "update_relation", type: "assigned_to", id: assigned })).toEqual({
      status: 201,
      body: { seq: 6, id: assigned },
    });
    const removal = await app.inject({
      method: "POST",
      url: `${url}/writes`,
      payload: { operation: "delete_relation", type: "assigned_to", id: assigned },
    });
    expect([removal.statusCode, removal.json()]).toEqual([201, { seq: 7, id: assigned }]);
    // The seq is in the body; no Location.
    expect(removal.headers).not.toHaveProperty("location");

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
    // The create's id is final and kept in the row; the update by the
    // minted id has no before.
    expect(rows[0]).toMatchObject({ minted_id: t9, target_id: null, before: null, arguments: { properties: { name: "T9" } } });
    expect(rows[1]).toMatchObject({ target_id: t9, before: null, arguments: { properties: { name: "T9b" } } });
    expect(rows[2]).toMatchObject({ target_id: ids.P2, before: { name: "P2" } });
    expect(rows[3]).toMatchObject({ target_id: ids.T2, before: null, arguments: {} });
    expect(rows[4]).toMatchObject({ minted_id: relation.body.id, arguments: { fromEntityId: ids.T2, toEntityId: ids.Ben } });
    expect(rows[5]).toMatchObject({ target_id: assigned, arguments: { properties: {} } });

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

  it("a create with a parent relation is two writes, the entity's and then the relation's, by consecutive seqs", async () => {
    const cs = (await start()).id as string;
    await stage(cs, rename(ids.P2, "x"));
    expect((await call("DELETE", `${ALL}/changesets/${cs}/writes/1`)).status).toBe(204);

    const create = await stage(cs, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9" },
      parentRelation: { type: "has_task", parentId: ids.P1, properties: { phase: "build" } },
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const { seq, id: t9, relation } = create.body;
    expect(create.body).toEqual({ seq, id: t9, relation: { seq: seq + 1, id: expect.any(String) } });
    expect(seq).toBeGreaterThan(1);

    const rows = await journal(cs);
    expect(rows).toEqual([
      {
        seq,
        operation: "create_entity",
        arguments: { properties: { name: "T9" } },
        minted_id: t9,
        type_key: "task",
        target_id: null,
        before: null,
      },
      {
        seq: seq + 1,
        operation: "create_relation",
        arguments: { fromEntityId: ids.P1, toEntityId: t9, properties: { phase: "build" } },
        minted_id: relation.id,
        type_key: "has_task",
        target_id: null,
        before: null,
      },
    ]);
    // Each row keeps its own bytes.
    const bytes = await sql(`SELECT bytes FROM changeset_write WHERE changeset_id = $1 ORDER BY seq`, [cs]);
    expect(bytes.map((r) => r.bytes)).toEqual(
      rows.map((r) => Buffer.byteLength(JSON.stringify(r.arguments))),
    );

    // The relation is a staged relation like any other: later writes name it.
    expect(
      await stage(cs, { operation: "update_relation", type: "has_task", id: relation.id, properties: { phase: "test" } }),
    ).toMatchObject({ status: 201, body: { id: relation.id } });
    expect(await stage(cs, { operation: "delete_relation", type: "has_task", id: relation.id })).toMatchObject({
      status: 201,
    });
    // Unstaging one of the two leaves the other.
    expect((await call("DELETE", `${ALL}/changesets/${cs}/writes/${seq}`)).status).toBe(204);
    expect((await journal(cs)).map((r) => r.operation)).toEqual(["create_relation", "update_relation", "delete_relation"]);
  });

  it("the body: one of six operations, each a strict object; anything else is 422 VALIDATION_ERROR", async () => {
    const cs = (await start()).id as string;
    for (const body of [
      {},
      { operation: "move_entity", type: "task", id: ids.T2 },
      { operation: "create_entity" },
      { operation: "update_entity", type: "project", properties: { name: "x" } },
      { operation: "delete_entity", type: "task", id: ids.T2, properties: {} },
      { operation: "create_entity", type: "task", name: "flat" },
      { operation: "create_relation", type: "assigned_to", fromEntityId: ids.T2 },
      { operation: "update_entity", type: "project", id: ids.P2, properties: "x" },
      { operation: "create_entity", type: "task", parentRelation: { type: "has_task" } },
      { operation: "delete_relation", type: "has_task", relationId: ids.T2 },
    ]) {
      const res = await stage(cs, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error.code, JSON.stringify(body)).toBe("VALIDATION_ERROR");
    }
    expect(await journal(cs)).toEqual([]);
  });

  it("the six staging routes of the immediate paths are not mounted, on either mount", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    const plain = (await start()).id as string;
    const anchored = (await start(`${ALL}/rulesets/agent-a`)).id as string;
    const relation = await relationId("assigned_to", ids.T1, ids.Ben);
    for (const url of [`${ALL}/changesets/${plain}`, `${ALL}/rulesets/agent-a/changesets/${anchored}`]) {
      for (const [method, path, payload] of [
        ["POST", "/entities/task", { name: "T9" }],
        ["PATCH", `/entities/project/${ids.P2}`, { name: "x" }],
        ["DELETE", `/entities/task/${ids.T2}`, undefined],
        ["POST", "/relations/assigned_to", { fromEntityId: ids.T2, toEntityId: ids.Ben }],
        ["PATCH", `/relations/assigned_to/${relation}`, {}],
        ["DELETE", `/relations/assigned_to/${relation}`, undefined],
      ] as const) {
        expect((await call(method, `${url}${path}`, payload)).status, `${method} ${path}`).toBe(404);
      }
    }
    expect(await sql(`SELECT 1 FROM changeset_write`)).toEqual([]);
  });

  it("before holds exactly the patched keys: absent stays absent, a document is its hash and length", async () => {
    const cs = (await start()).id as string;
    await stage(cs, { operation: "update_entity", type: "project", id: ids.P1, properties: { name: "P1 New", body: "new plan" } });
    await stage(cs, { operation: "update_entity", type: "project", id: ids.P2, properties: { body: "first plan" } });
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

    expect(await stage(cs, rename(ghost, "X"))).toMatchObject({
      status: 404,
      body: { error: { message: `Entity '${ghost}' not found` } },
    });
    expect((await stage(cs, { operation: "delete_relation", type: "has_task", id: ghost })).status).toBe(404);

    const immediate = await call("POST", `${ALL}/entities/task`, {
      bogus: 1,
      parentRelation: { type: "has_task", parentId: ids.P1 },
    });
    const staged = await stage(cs, {
      operation: "create_entity",
      type: "task",
      properties: { bogus: 1 },
      parentRelation: { type: "has_task", parentId: ids.P1 },
    });
    expect(immediate.status).toBe(422);
    expect(staged.status).toBe(422);
    expect(staged.body).toEqual(immediate.body);

    const patch = await stage(cs, { operation: "update_entity", type: "project", id: ids.P1, properties: { bogus: 1 } });
    expect(patch.status).toBe(422);
    expect(patch.body).toEqual((await call("PATCH", `${ALL}/entities/project/${ids.P1}`, { bogus: 1 })).body);
    expect(
      await stage(cs, { operation: "update_entity", type: "project", id: ids.P1, properties: { name: { a: 1 } } }),
    ).toMatchObject({
      status: 422,
      body: { error: { details: { fields: { name: "Expected string for 'name', got object" } } } },
    });
    expect((await stage(cs, { operation: "delete_entity", type: "nope", id: ids.P1 })).status).toBe(404);
    expect(await journal(cs)).toEqual([]);
    expect((await call("GET", url)).body.version).toBe(1);
  });
});

describe("binding", () => {
  it("another lens is 404; another anchor's URL is 404; the plain lens URL reaches an anchored one", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    await putAnchor("agent-b", { type: "project", id: ids.P2 });
    const plain = (await start()).id as string;
    const anchored = (await start(`${ALL}/rulesets/agent-a`)).id as string;
    const notFound = (cs: string) => ({ status: 404, body: { error: { message: `Changeset '${cs}' not found` } } });

    expect(await call("GET", `${PORTFOLIO}/changesets/${plain}`)).toMatchObject(notFound(plain));
    expect(await stage(plain, rename(ids.P2, "x"), PORTFOLIO)).toMatchObject(notFound(plain));
    expect(await call("GET", `${ALL}/rulesets/agent-b/changesets/${anchored}`)).toMatchObject(notFound(anchored));
    expect(await call("GET", `${ALL}/rulesets/agent-a/changesets/${plain}`)).toMatchObject(notFound(plain));
    expect((await call("GET", `${ALL}/rulesets/agent-a/changesets/${anchored}`)).status).toBe(200);
    expect((await call("GET", `${ALL}/changesets/${anchored}`)).status).toBe(200);
    expect(await call("GET", `${ALL}/changesets/not-a-uuid`)).toMatchObject(notFound("not-a-uuid"));
  });

  it("an anchored URL stages outside its anchor: coverage is a commit rule", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    const cs = (await start(`${ALL}/rulesets/agent-a`)).id as string;
    const res = await stage(
      cs,
      {
        operation: "create_entity",
        type: "task",
        properties: { name: "Outside" },
        parentRelation: { type: "has_task", parentId: ids.P2, properties: { phase: "build" } },
      },
      `${ALL}/rulesets/agent-a`,
    );
    expect(res.status).toBe(201);
  });

  it("a dangling anchor refuses staging with 409; unstage still works", async () => {
    const leaf = (await call("POST", `${ALL}/entities/task`, {
      name: "Leaf",
      parentRelation: { type: "has_task", parentId: ids.P2, properties: { phase: "x" } },
    })).body._id as string;
    await putAnchor("agent-a", { type: "task", id: leaf });
    const anchored = `${ALL}/rulesets/agent-a`;
    const base = `${anchored}/changesets`;
    const cs = (await start(anchored)).id as string;
    const l2 = { operation: "update_entity", type: "task", id: leaf, properties: { name: "L2" } };
    expect((await stage(cs, l2, anchored)).status).toBe(201);

    expect((await call("DELETE", `${ALL}/entities/task/${leaf}`)).status).toBe(204);
    const refused = await stage(cs, rename(ids.P2, "x"), anchored);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("dangling");
    expect(await journal(cs)).toHaveLength(1);

    expect((await call("DELETE", `${base}/${cs}/writes/1`)).status).toBe(204);
    expect(await journal(cs)).toEqual([]);
  });

  it("after its anchor is deleted, the plain lens URL still reaches the changeset", async () => {
    await putAnchor("agent-b", { type: "project", id: ids.P2 });
    const cs = (await start(`${ALL}/rulesets/agent-b`)).id as string;
    expect((await call("DELETE", `${RULESETS}/agent-b`)).status).toBe(204);
    expect((await call("GET", `${ALL}/rulesets/agent-b/changesets/${cs}`)).status).toBe(404);
    expect(await call("GET", `${ALL}/changesets/${cs}`)).toMatchObject({ status: 200, body: { ruleset: "agent-b" } });
    expect((await stage(cs, rename(ids.P2, "x"))).status).toBe(201);
  });
});

describe("unstage, discard, expiry, caps, the row lock", () => {
  it("unstage removes one write by seq; an unknown seq is 404; a seq is never reused", async () => {
    const cs = (await start()).id as string;
    const url = `${ALL}/changesets/${cs}`;
    await stage(cs, rename(ids.P1, "a"));
    await stage(cs, rename(ids.P2, "b"));
    expect((await call("DELETE", `${url}/writes/2`)).status).toBe(204);
    expect(await call("DELETE", `${url}/writes/2`)).toMatchObject({
      status: 404,
      body: { error: { message: `Staged write 2 not found in changeset '${cs}'` } },
    });
    const next = await stage(cs, rename(ids.P2, "c"));
    expect(next.body.seq).toBeGreaterThan(2);
    expect((await journal(cs)).map((r) => r.seq)).toEqual([1, next.body.seq]);
  });

  it("discard deletes the changeset and its journal; then it is 404", async () => {
    const cs = (await start()).id as string;
    await stage(cs, rename(ids.P1, "a"));
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
    await stage(cs, rename(ids.P1, "a"));
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
      `INSERT INTO changeset_write (changeset_id, seq, operation, arguments, type_key, bytes)
       SELECT $1, g, 'delete_entity', '{}'::jsonb, 'task', 2 FROM generate_series(1, 10000) g`,
      [cs],
    );
    const res = await stage(cs, rename(ids.P1, "a"));
    expect(res).toMatchObject({ status: 409, body: { error: { message: `Changeset '${cs}' is full: at most 10000 staged writes` } } });
    expect(await sql(`SELECT count(*)::int AS n FROM changeset_write WHERE changeset_id = $1`, [cs])).toEqual([
      { n: 10000 },
    ]);
  });

  it("the cap counts both writes of a create with a parent relation: one short of it, the pair is 409 and appends nothing", async () => {
    const cs = (await start()).id as string;
    await sql(
      `INSERT INTO changeset_write (changeset_id, seq, operation, arguments, type_key, bytes)
       SELECT $1, g, 'delete_entity', '{}'::jsonb, 'task', 2 FROM generate_series(1, 9999) g`,
      [cs],
    );
    const pair = {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9" },
      parentRelation: { type: "has_task", parentId: ids.P1, properties: { phase: "build" } },
    };
    expect(await stage(cs, pair)).toMatchObject({
      status: 409,
      body: { error: { message: `Changeset '${cs}' is full: at most 10000 staged writes` } },
    });
    const count = async () =>
      (await sql(`SELECT count(*)::int AS n FROM changeset_write WHERE changeset_id = $1`, [cs]))[0]!.n;
    expect(await count()).toBe(9999);
    // One write still fits.
    expect((await stage(cs, rename(ids.P1, "a"))).status).toBe(201);
    expect(await count()).toBe(10000);
  });

  it("the byte cap: document text counts; a write past it is 409 'full' and appends nothing", async () => {
    const cap = settings.CHANGESET_MAX_BYTES;
    settings.CHANGESET_MAX_BYTES = 1_000_000;
    try {
      const cs = (await start()).id as string;
      // 200,000 characters, 400,000 bytes as UTF-8.
      const body = "ä".repeat(200_000);
      const write = { operation: "update_entity", type: "project", id: ids.P1, properties: { body } };
      expect((await stage(cs, write)).status).toBe(201);
      const second = await stage(cs, write);
      expect(second.status).toBe(201);
      const res = await stage(cs, write);
      expect(res).toMatchObject({
        status: 409,
        body: { error: { message: `Changeset '${cs}' is full: at most 1000000 bytes of staged writes` } },
      });
      const [row] = await sql(
        `SELECT count(*)::int AS n, sum(bytes)::int AS bytes FROM changeset_write WHERE changeset_id = $1`,
        [cs],
      );
      expect(row!.n).toBe(2);
      expect(row!.bytes).toBeGreaterThan(800_000);
      expect(row!.bytes).toBeLessThan(1_000_000);

      // Unstaging frees its bytes.
      expect((await call("DELETE", `${ALL}/changesets/${cs}/writes/${second.body.seq}`)).status).toBe(204);
      expect((await stage(cs, write)).status).toBe(201);
    } finally {
      settings.CHANGESET_MAX_BYTES = cap;
    }
  });

  it("the byte cap sums both writes of a create with a parent relation: if the pair passes it, neither is appended", async () => {
    const cap = settings.CHANGESET_MAX_BYTES;
    settings.CHANGESET_MAX_BYTES = 1_000_000;
    try {
      const cs = (await start()).id as string;
      const body = "ä".repeat(200_000);
      const filler = { operation: "update_entity", type: "project", id: ids.P1, properties: { body } };
      expect((await stage(cs, filler)).status).toBe(201);
      expect((await stage(cs, filler)).status).toBe(201);
      // Two rows of 150,000 bytes each: either alone would fit beside the
      // 800,000 staged, the two together do not.
      const half = "ö".repeat(75_000);
      const pair = {
        operation: "create_entity",
        type: "task",
        properties: { name: half },
        parentRelation: { type: "has_task", parentId: ids.P1, properties: { phase: half } },
      };
      expect(await stage(cs, pair)).toMatchObject({
        status: 409,
        body: { error: { message: `Changeset '${cs}' is full: at most 1000000 bytes of staged writes` } },
      });
      expect(await journal(cs)).toHaveLength(2);
      expect((await call("DELETE", `${ALL}/changesets/${cs}/writes/2`)).status).toBe(204);
      expect((await stage(cs, pair)).status).toBe(201);
      expect(await journal(cs)).toHaveLength(3);
    } finally {
      settings.CHANGESET_MAX_BYTES = cap;
    }
  });

  it("a staged write while a commit holds the row is 409 at once; after release it is staged", async () => {
    const cs = (await start()).id as string;
    const release = await hold((bound) => bound.changesets().lockForCommit(cs));
    try {
      const started = Date.now();
      const res = await stage(cs, rename(ids.P1, "a"));
      expect(res).toMatchObject({ status: 409, body: { error: { message: `Changeset '${cs}' is busy; try again` } } });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(409);
    } finally {
      await release();
    }
    expect(await journal(cs)).toEqual([]);
    expect((await stage(cs, rename(ids.P1, "a"))).status).toBe(201);
  });
});
