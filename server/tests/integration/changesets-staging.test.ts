/**
 * Staging into a changeset over REST, on the in-test hierarchy
 * (`buildHierarchy`, with `has_task` requiring `phase` and a document
 * property on project): start, the seven staging operations and their
 * body, how each merges into the set of staged objects and values, a
 * create with a parent relation as two objects, minted ids, the before at
 * first touch, document edits on the staged text, the delete cascade, the
 * immediate write's 404 and 422, binding to the lens and the ruleset, the
 * deleted anchor, unstage, cut, rebase, discard, expiry, the note, the
 * object and byte caps, and a staged call while a commit holds the row.
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

/** The staged objects of a changeset, by first touch, each with its
 * values by key: `{value, before}`. */
async function objects(cs: string): Promise<Row[]> {
  const rows = await sql(
    `SELECT object_id, kind, type_key, action, from_id, to_id FROM changeset_object
      WHERE changeset_id = $1 ORDER BY first_touched_at, object_id`,
    [cs],
  );
  const values = await sql(
    `SELECT object_id, property_key, value, before, bytes FROM changeset_value WHERE changeset_id = $1`,
    [cs],
  );
  return rows.map((row) => ({
    ...row,
    values: Object.fromEntries(
      values
        .filter((v) => v.object_id === row.object_id)
        .map((v) => [v.property_key, { value: v.value, before: v.before }]),
    ),
  }));
}

/** The one staged object on `id`. */
async function objectOn(cs: string, id: string): Promise<Row | undefined> {
  return (await objects(cs)).find((o) => o.object_id === id);
}

async function start(base = ALL, note?: string): Promise<Row> {
  const res = await call("POST", `${base}/changesets`, note === undefined ? undefined : { note });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Stage one call: its body, posted to the changeset's writes. */
function stage(cs: string, write: Row, base = ALL): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/changesets/${cs}/writes`, write);
}

/** The body of an update of project P1 or another project. */
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
  it("answers 201: draft, version, note, and no ruleset on the plain lens", async () => {
    const cs = await start(ALL, "g1");
    expect(cs).toMatchObject({ state: "draft", version: 1, note: "g1", ruleset: null, objectCount: 0 });
    expect(cs.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await call("POST", `${ALL}/changesets`)).toMatchObject({ status: 201, body: { note: null } });
  });

  it("through a ruleset URL, the ruleset is its key", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    const cs = await start(`${ALL}/rulesets/agent-a`);
    expect(cs.ruleset).toBe("agent-a");
  });

  it("not found in the order lens, ruleset; a note of 1001 characters is 422", async () => {
    expect((await call("POST", `${runtimePrefix(O, "nope")}/changesets`)).status).toBe(404);
    const ruleset = await call("POST", `${ALL}/rulesets/ghost/changesets`);
    expect(ruleset).toMatchObject({ status: 404, body: { error: { message: "Ruleset 'ghost' not found" } } });
    const long = await call("POST", `${ALL}/changesets`, { note: "x".repeat(1001) });
    expect(long.status).toBe(422);
    expect(long.body.error.details.fields.note).toContain("1000");
    expect(await call("POST", `${ALL}/changesets`, { note: "x".repeat(1000) })).toMatchObject({ status: 201 });
    expect(await sql(`SELECT count(*)::int AS n FROM changeset`)).toEqual([{ n: 1 }]);
  });
});

describe("staging merges into the set", () => {
  it("each call answers 201 {id}; one object per entity or relation; nothing reaches the graph or the search queue", async () => {
    const cs = (await start()).id as string;
    const before = await graphCounts();
    const url = `${ALL}/changesets/${cs}`;
    const assigned = await relationId("assigned_to", ids.T1, ids.Ben);

    const create = await stage(cs, { operation: "create_entity", type: "task", properties: { name: "T9" } });
    expect(create).toEqual({ status: 201, body: { id: expect.any(String) } });
    const t9 = create.body.id as string;
    // Reads never see staged data.
    expect((await call("GET", `${ALL}/entities/task/${t9}`)).status).toBe(404);

    expect(await stage(cs, { operation: "update_entity", type: "task", id: t9, properties: { name: "T9b" } })).toEqual({
      status: 201,
      body: { id: t9 },
    });
    expect(await stage(cs, rename(ids.P2, "P2 Website"))).toEqual({ status: 201, body: { id: ids.P2 } });
    expect(await stage(cs, rename(ids.P2, "P2 Web"))).toEqual({ status: 201, body: { id: ids.P2 } });
    expect(await stage(cs, { operation: "delete_entity", type: "task", id: ids.T2 })).toEqual({
      status: 201,
      body: { id: ids.T2 },
    });
    const relation = await stage(cs, { operation: "create_relation", type: "assigned_to", fromEntityId: ids.T1a, toEntityId: ids.Ben });
    expect(relation).toEqual({ status: 201, body: { id: expect.any(String) } });
    // properties defaults to {}: an update that changes nothing stages nothing.
    expect(await stage(cs, { operation: "update_relation", type: "assigned_to", id: assigned })).toEqual({
      status: 201,
      body: { id: assigned },
    });
    const removal = await app.inject({
      method: "POST",
      url: `${url}/writes`,
      payload: { operation: "delete_relation", type: "assigned_to", id: assigned },
    });
    expect([removal.statusCode, removal.json()]).toEqual([201, { id: assigned }]);
    expect(removal.headers).not.toHaveProperty("location");

    expect(await graphCounts()).toEqual(before);
    const staged = await objects(cs);
    expect(staged.map((o) => [o.object_id, o.kind, o.type_key, o.action])).toEqual([
      [t9, "entity", "task", "create"],
      [ids.P2, "entity", "project", "update"],
      [ids.T2, "entity", "task", "delete"],
      [relation.body.id, "relation", "assigned_to", "create"],
      [assigned, "relation", "assigned_to", "delete"],
    ]);
    // The create's id is final; its update merged into its values with no before.
    expect(staged[0]!.values).toEqual({ name: { value: "T9b", before: null } });
    // A value staged again replaces the staged one and keeps the first before.
    expect(staged[1]!.values).toEqual({ name: { value: "P2 Web", before: { value: "P2" } } });
    expect(staged[2]!.values).toEqual({});
    // A relation records its ends, a stored one too.
    expect(staged[3]).toMatchObject({ from_id: ids.T1a, to_id: ids.Ben });
    expect(staged[4]).toMatchObject({ from_id: ids.T1, to_id: ids.Ben });

    // The immediate data is unchanged.
    expect((await call("GET", `${ALL}/entities/project/${ids.P2}`)).body.name).toBe("P2");
    expect((await call("GET", `${ALL}/entities/task/${ids.T2}`)).status).toBe(200);

    const read = await call("GET", `${url}?limit=3&offset=1`);
    expect(read.status).toBe(200);
    // Seven changes of the set, the update that changed nothing aside.
    expect(read.body).toMatchObject({ id: cs, state: "draft", version: 8, objectCount: 5, offset: 1, limit: 3 });
    expect(read.body.objects.map((o: Row) => [o.id, o.kind, o.type, o.action])).toEqual([
      [ids.P2, "entity", "project", "update"],
      [ids.T2, "entity", "task", "delete"],
      [relation.body.id, "relation", "assigned_to", "create"],
    ]);
    expect(read.body.objects[0]).toMatchObject({
      name: "P2",
      firstTouchedAt: expect.any(String),
      markers: [],
      values: [{ property: "name", before: "P2", current: "P2", after: "P2 Web", markers: [] }],
    });
    expect(read.body.objects[2]).toMatchObject({ from: { id: ids.T1a, name: "T1a" }, to: { id: ids.Ben, name: "Ben" } });
    expect(JSON.stringify(read.body)).not.toMatch(/"seq"/);
    expect((await call("GET", url)).body.objects).toHaveLength(5);
    expect((await call("GET", `${url}?limit=501`)).status).toBe(422);
  });

  it("a create with a parent relation is two objects, the entity first; the relation is a staged relation like any other", async () => {
    const cs = (await start()).id as string;
    const create = await stage(cs, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9" },
      parentRelation: { type: "has_task", parentId: ids.P1, properties: { phase: "build" } },
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const { id: t9, relation } = create.body;
    expect(create.body).toEqual({ id: t9, relation: { id: expect.any(String) } });

    expect(await objects(cs)).toEqual([
      { object_id: t9, kind: "entity", type_key: "task", action: "create", from_id: null, to_id: null, values: { name: { value: "T9", before: null } } },
      {
        object_id: relation.id,
        kind: "relation",
        type_key: "has_task",
        action: "create",
        from_id: ids.P1,
        to_id: t9,
        values: { phase: { value: "build", before: null } },
      },
    ]);
    // Each value keeps its own bytes.
    const bytes = await sql(`SELECT property_key, bytes FROM changeset_value WHERE changeset_id = $1 ORDER BY property_key`, [cs]);
    expect(bytes).toEqual([
      { property_key: "name", bytes: Buffer.byteLength('"T9"') },
      { property_key: "phase", bytes: Buffer.byteLength('"build"') },
    ]);

    // Later calls name the relation: an update merges into its create.
    expect(
      await stage(cs, { operation: "update_relation", type: "has_task", id: relation.id, properties: { phase: "test" } }),
    ).toEqual({ status: 201, body: { id: relation.id } });
    expect((await objectOn(cs, relation.id))!.values).toEqual({ phase: { value: "test", before: null } });
    // Unstaging the entity leaves the relation: it shows as dangling.
    expect((await call("DELETE", `${ALL}/changesets/${cs}/objects/${t9}`)).status).toBe(204);
    const [left] = (await call("GET", `${ALL}/changesets/${cs}`)).body.objects;
    expect(left).toMatchObject({ id: relation.id, markers: [{ kind: "dangling", message: "The target end is neither stored nor created in this changeset" }] });
  });

  it("deletes: a stored object's values go, an object created here goes, an entity's staged relations go with it", async () => {
    const cs = (await start()).id as string;
    await stage(cs, rename(ids.P2, "P2 Website"));
    await stage(cs, { operation: "update_entity", type: "task", id: ids.T2, properties: { name: "T2b" } });
    const t9 = (await stage(cs, { operation: "create_entity", type: "task", properties: { name: "T9" } })).body.id as string;
    const toT9 = (await stage(cs, { operation: "create_relation", type: "assigned_to", fromEntityId: t9, toEntityId: ids.Ben })).body.id as string;
    const toT2 = (await stage(cs, { operation: "create_relation", type: "has_subtask", fromEntityId: ids.T2, toEntityId: ids.T1a })).body.id as string;
    const onT2 = await relationId("has_task", ids.P2, ids.T2);
    await stage(cs, { operation: "update_relation", type: "has_task", id: onT2, properties: { phase: "x" } });

    expect(await stage(cs, { operation: "delete_entity", type: "project", id: ids.P2 })).toEqual({
      status: 201,
      body: { id: ids.P2, cascaded: [onT2] },
    });
    expect(await objectOn(cs, ids.P2)).toMatchObject({ action: "delete", values: {} });
    expect(await stage(cs, { operation: "delete_entity", type: "task", id: t9 })).toEqual({
      status: 201,
      body: { id: t9, cascaded: [toT9] },
    });
    expect(await stage(cs, { operation: "delete_entity", type: "task", id: ids.T2 })).toEqual({
      status: 201,
      body: { id: ids.T2, cascaded: [toT2] },
    });
    expect((await objects(cs)).map((o) => [o.object_id, o.action])).toEqual([
      [ids.P2, "delete"],
      [ids.T2, "delete"],
    ]);

    // An object deleted here takes no more calls: the immediate write's 404.
    for (const body of [
      rename(ids.P2, "again"),
      { operation: "delete_entity", type: "project", id: ids.P2 },
      { operation: "edit_document", type: "project", id: ids.P2, property: "body", op: "replace_range", offset: 0, length: 0, content: "x" },
    ]) {
      expect(await stage(cs, body)).toMatchObject({ status: 404, body: { error: { message: `Entity '${ids.P2}' not found` } } });
    }
    // An id created here and deleted again is gone: as an id never stored.
    expect((await stage(cs, { operation: "update_entity", type: "task", id: t9, properties: { name: "x" } })).status).toBe(404);
  });

  it("the body: one of seven operations, each a strict object; anything else is 422 VALIDATION_ERROR", async () => {
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
      { operation: "edit_document", type: "project", id: ids.P1, op: "str_replace", oldString: "a", newString: "b" },
      { operation: "edit_document", type: "project", id: ids.P1, property: "body", op: "append", content: "x" },
      { operation: "edit_document", type: "project", id: ids.P1, property: "body", op: "str_replace", bogus: 1 },
    ]) {
      const res = await stage(cs, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error.code, JSON.stringify(body)).toBe("VALIDATION_ERROR");
    }
    expect(await objects(cs)).toEqual([]);
  });

  it("the six staging routes of the immediate paths are not mounted, on either mount", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    const plain = (await start()).id as string;
    const viaRuleset = (await start(`${ALL}/rulesets/agent-a`)).id as string;
    const relation = await relationId("assigned_to", ids.T1, ids.Ben);
    for (const url of [`${ALL}/changesets/${plain}`, `${ALL}/rulesets/agent-a/changesets/${viaRuleset}`]) {
      for (const [method, path, payload] of [
        ["POST", "/entities/task", { name: "T9" }],
        ["PATCH", `/entities/project/${ids.P2}`, { name: "x" }],
        ["DELETE", `/entities/task/${ids.T2}`, undefined],
        ["POST", "/relations/assigned_to", { fromEntityId: ids.T2, toEntityId: ids.Ben }],
        ["PATCH", `/relations/assigned_to/${relation}`, {}],
        ["DELETE", `/relations/assigned_to/${relation}`, undefined],
        ["PATCH", `/entities/project/${ids.P1}/documents/body`, { op: "str_replace", oldString: "a", newString: "b" }],
      ] as const) {
        expect((await call(method, `${url}${path}`, payload)).status, `${method} ${path}`).toBe(404);
      }
    }
    expect(await sql(`SELECT 1 FROM changeset_object`)).toEqual([]);
  });

  it("the before is the stored value at a key's first touch: absent is the empty before, a document its hash and length", async () => {
    const cs = (await start()).id as string;
    await stage(cs, { operation: "update_entity", type: "project", id: ids.P1, properties: { name: "P1 New", body: "new plan" } });
    await stage(cs, { operation: "update_entity", type: "project", id: ids.P2, properties: { body: "first plan" } });
    const hash = createHash("sha256").update("the plan").digest("hex");
    expect((await objectOn(cs, ids.P1))!.values).toEqual({
      name: { value: "P1 New", before: { value: "P1" } },
      body: { value: "new plan", before: { value: { sha256: hash, length: "the plan".length } } },
    });
    // P2 holds no body: the before is empty, not null.
    expect((await objectOn(cs, ids.P2))!.values).toEqual({ body: { value: "first plan", before: {} } });

    // A change made meanwhile does not refresh a before; a key touched first now records the stored value now.
    expect((await call("PATCH", `${ALL}/entities/project/${ids.P1}`, { name: "P1 Changed" })).status).toBe(200);
    await stage(cs, { operation: "update_entity", type: "project", id: ids.P1, properties: { name: "P1 Newer" } });
    expect((await objectOn(cs, ids.P1))!.values.name).toEqual({ value: "P1 Newer", before: { value: "P1" } });
    await call("PATCH", `${ALL}/entities/project/${ids.P1}`, { name: "P1" });
  });

  it("a missing target is 404 and a bad value 422 with the immediate write's fields; neither stages", async () => {
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
    expect(await objects(cs)).toEqual([]);
    expect((await call("GET", url)).body.version).toBe(1);
  });
});

describe("edit_document: a document edit on the staged text", () => {
  const edit = (id: string, body: Row): Row => ({ operation: "edit_document", type: "project", id, property: "body", ...body });

  it("str_replace on the stored text: the whole result staged, the answer the immediate edit's with the id", async () => {
    const cs = (await start()).id as string;
    const res = await stage(cs, edit(ids.P1, { op: "str_replace", oldString: "plan", newString: "roadmap" }));
    expect(res).toEqual({
      status: 201,
      body: {
        id: ids.P1,
        propertyKey: "body",
        totalLength: 11,
        editedRange: { offset: 4, length: 7 },
        replacements: 1,
        context: "the roadmap",
        contextOffset: 0,
      },
    });
    const hash = createHash("sha256").update("the plan").digest("hex");
    expect((await objectOn(cs, ids.P1))!.values).toEqual({
      body: { value: "the roadmap", before: { value: { sha256: hash, length: 8 } } },
    });
    // The stored document is untouched.
    expect((await call("GET", `${ALL}/entities/project/${ids.P1}/documents/body`)).body.content).toBe("the plan");

    // A second edit applies to the staged text; the before stays.
    await stage(cs, edit(ids.P1, { op: "replace_range", offset: 11, length: 0, content: " for 2027" }));
    expect((await objectOn(cs, ids.P1))!.values.body).toEqual({
      value: "the roadmap for 2027",
      before: { value: { sha256: hash, length: 8 } },
    });
    expect((await call("GET", `${ALL}/changesets/${cs}/documents/project/${ids.P1}/body`)).body).toMatchObject({
      content: "the roadmap for 2027",
      totalLength: 20,
    });
  });

  it("on a project created here: the empty text without a staged value, no before", async () => {
    const cs = (await start()).id as string;
    const p9 = (await stage(cs, { operation: "create_entity", type: "project", properties: { name: "P9" } })).body.id as string;
    await stage(cs, edit(p9, { op: "replace_range", offset: 0, length: 0, content: "Draft" }));
    await stage(cs, edit(p9, { op: "str_replace", oldString: "Draft", newString: "Final" }));
    expect((await objectOn(cs, p9))!).toMatchObject({
      action: "create",
      values: { name: { value: "P9", before: null }, body: { value: "Final", before: null } },
    });
  });

  it("the immediate edit's faults with its status and text; the document read's 404s; nothing staged", async () => {
    const cs = (await start()).id as string;
    const document = `${ALL}/entities/project/${ids.P1}/documents/body`;
    for (const body of [
      { op: "str_replace", oldString: "nope", newString: "x" },
      { op: "str_replace", oldString: "plan", newString: "plan" },
      { op: "replace_range", offset: 99, length: 0, content: "x" },
      { op: "replace_range", offset: 0, length: 3, content: "x", expect: "thx" },
    ]) {
      const staged = await stage(cs, edit(ids.P1, body));
      const immediate = await call("PATCH", document, body);
      expect([staged.status, staged.body], JSON.stringify(body)).toEqual([immediate.status, immediate.body]);
    }
    expect((await stage(cs, { ...edit(ids.P1, { op: "str_replace", oldString: "a", newString: "b" }), property: "name" })).body.error.message).toBe(
      "Document property 'name' not found on entity type 'project'",
    );
    expect((await stage(cs, edit(randomUUID(), { op: "str_replace", oldString: "a", newString: "b" }))).status).toBe(404);
    expect(await objects(cs)).toEqual([]);
    expect((await call("GET", document)).body.content).toBe("the plan");
  });
});

describe("binding", () => {
  it("another lens is 404; another ruleset's URL is 404; the plain lens URL reaches a ruleset's one", async () => {
    await putAnchor("agent-a", { type: "project", id: ids.P1 });
    await putAnchor("agent-b", { type: "project", id: ids.P2 });
    const plain = (await start()).id as string;
    const viaRuleset = (await start(`${ALL}/rulesets/agent-a`)).id as string;
    const notFound = (cs: string) => ({ status: 404, body: { error: { message: `Changeset '${cs}' not found` } } });

    expect(await call("GET", `${PORTFOLIO}/changesets/${plain}`)).toMatchObject(notFound(plain));
    expect(await stage(plain, rename(ids.P2, "x"), PORTFOLIO)).toMatchObject(notFound(plain));
    expect(await call("GET", `${ALL}/rulesets/agent-b/changesets/${viaRuleset}`)).toMatchObject(notFound(viaRuleset));
    expect(await call("GET", `${ALL}/rulesets/agent-a/changesets/${plain}`)).toMatchObject(notFound(plain));
    expect((await call("GET", `${ALL}/rulesets/agent-a/changesets/${viaRuleset}`)).status).toBe(200);
    expect((await call("GET", `${ALL}/changesets/${viaRuleset}`)).status).toBe(200);
    expect(await call("GET", `${ALL}/changesets/not-a-uuid`)).toMatchObject(notFound("not-a-uuid"));
  });

  it("a ruleset URL stages outside its anchor: coverage is a commit rule", async () => {
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

  it("a deleted anchor refuses staging with 409; unstage still works", async () => {
    const leaf = (await call("POST", `${ALL}/entities/task`, {
      name: "Leaf",
      parentRelation: { type: "has_task", parentId: ids.P2, properties: { phase: "x" } },
    })).body._id as string;
    await putAnchor("agent-a", { type: "task", id: leaf });
    const mount = `${ALL}/rulesets/agent-a`;
    const base = `${mount}/changesets`;
    const cs = (await start(mount)).id as string;
    const l2 = { operation: "update_entity", type: "task", id: leaf, properties: { name: "L2" } };
    expect((await stage(cs, l2, mount)).status).toBe(201);

    expect((await call("DELETE", `${ALL}/entities/task/${leaf}`)).status).toBe(204);
    const refused = await stage(cs, rename(ids.P2, "x"), mount);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("no longer exists");
    expect(await objects(cs)).toHaveLength(1);

    expect((await call("DELETE", `${base}/${cs}/objects/${leaf}`)).status).toBe(204);
    expect(await objects(cs)).toEqual([]);
  });

  it("after its ruleset is deleted, the plain lens URL still reaches the changeset", async () => {
    await putAnchor("agent-b", { type: "project", id: ids.P2 });
    const cs = (await start(`${ALL}/rulesets/agent-b`)).id as string;
    expect((await call("DELETE", `${RULESETS}/agent-b`)).status).toBe(204);
    expect((await call("GET", `${ALL}/rulesets/agent-b/changesets/${cs}`)).status).toBe(404);
    expect(await call("GET", `${ALL}/changesets/${cs}`)).toMatchObject({ status: 200, body: { ruleset: "agent-b" } });
    expect((await stage(cs, rename(ids.P2, "x"))).status).toBe(201);
  });
});

describe("unstage, cut, rebase", () => {
  it("unstage takes an object out with its values; cut takes one value, an update left empty goes; 404s; the version rises", async () => {
    const cs = (await start()).id as string;
    const url = `${ALL}/changesets/${cs}`;
    await stage(cs, { operation: "update_entity", type: "project", id: ids.P1, properties: { name: "a", body: "b" } });
    await stage(cs, rename(ids.P2, "b"));
    const version = (await call("GET", url)).body.version as number;

    expect((await call("DELETE", `${url}/objects/${ids.P2}`)).status).toBe(204);
    expect(await call("DELETE", `${url}/objects/${ids.P2}`)).toMatchObject({
      status: 404,
      body: { error: { message: `Object '${ids.P2}' is not staged in changeset '${cs}'` } },
    });
    expect((await call("DELETE", `${url}/objects/${ids.P1}/properties/body`)).status).toBe(204);
    expect((await objectOn(cs, ids.P1))!.values).toEqual({ name: { value: "a", before: { value: "P1" } } });
    expect(await call("DELETE", `${url}/objects/${ids.P1}/properties/body`)).toMatchObject({
      status: 404,
      body: { error: { message: `No value of 'body' is staged for object '${ids.P1}' in changeset '${cs}'` } },
    });
    expect((await call("DELETE", `${url}/objects/${ids.P1}/properties/name`)).status).toBe(204);
    expect(await objects(cs)).toEqual([]);
    expect((await call("GET", url)).body.version).toBe(version + 3);
  });

  it("rebase sets the befores to the stored values now and keeps the staged values; its answer is the object as reviewed", async () => {
    const cs = (await start()).id as string;
    const url = `${ALL}/changesets/${cs}`;
    await stage(cs, { operation: "update_entity", type: "project", id: ids.P2, properties: { name: "P2 Web", body: "x" } });
    expect((await call("PATCH", `${ALL}/entities/project/${ids.P2}`, { name: "P2 Mobile" })).status).toBe(200);
    const [drifted] = (await call("GET", url)).body.objects;
    expect(drifted.values.map((v: Row) => [v.property, v.markers.map((m: Row) => m.kind)])).toEqual([
      ["body", []],
      ["name", ["drift"]],
    ]);

    const rebased = await call("POST", `${url}/objects/${ids.P2}/rebase`, { properties: ["name"] });
    expect(rebased.status).toBe(200);
    expect(rebased.body).toMatchObject({
      id: ids.P2,
      action: "update",
      markers: [],
      values: [
        { property: "body", before: null, after: { document: true, length: 1 }, markers: [] },
        { property: "name", before: "P2 Mobile", current: "P2 Mobile", after: "P2 Web", markers: [] },
      ],
    });
    // Without a body: every value of the object.
    expect((await call("POST", `${url}/objects/${ids.P2}/rebase`)).status).toBe(200);

    expect((await call("POST", `${url}/objects/${ids.P2}/rebase`, { properties: ["code"] })).status).toBe(404);
    const p9 = (await stage(cs, { operation: "create_entity", type: "project", properties: { name: "P9" } })).body.id as string;
    expect(await call("POST", `${url}/objects/${p9}/rebase`)).toMatchObject({
      status: 409,
      body: { error: { message: "Only an update of a stored object can be rebased; this object is a create" } },
    });
    expect((await call("POST", `${url}/objects/${ids.P2}/rebase`, { properties: "name" })).status).toBe(422);
    await call("PATCH", `${ALL}/entities/project/${ids.P2}`, { name: "P2" });
  });

  it("unstage, cut and rebase are 409 while submitted", async () => {
    const cs = (await start()).id as string;
    const url = `${ALL}/changesets/${cs}`;
    await stage(cs, rename(ids.P2, "b"));
    expect((await call("POST", `${url}/submit`, {})).status).toBe(200);
    for (const [method, path] of [
      ["DELETE", `/objects/${ids.P2}`],
      ["DELETE", `/objects/${ids.P2}/properties/name`],
      ["POST", `/objects/${ids.P2}/rebase`],
    ] as const) {
      expect(await call(method, `${url}${path}`, method === "POST" ? {} : undefined)).toMatchObject({
        status: 409,
        body: { error: { message: `Changeset '${cs}' is submitted; unsubmit it first` } },
      });
    }
  });
});

describe("discard, expiry, caps, the row lock", () => {
  it("discard deletes the changeset with its objects; then it is 404", async () => {
    const cs = (await start()).id as string;
    await stage(cs, rename(ids.P1, "a"));
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(204);
    expect(await sql(`SELECT 1 FROM changeset_object WHERE changeset_id = $1`, [cs])).toEqual([]);
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
    expect(await sql(`SELECT 1 FROM changeset_object WHERE changeset_id = $1`, [cs])).toEqual([]);
  });

  it("start sweeps expired draft changesets of the ontology", async () => {
    const old = (await start()).id as string;
    await sql(`UPDATE changeset SET last_change_at = now() - interval '8 days' WHERE changeset_id = $1`, [old]);
    await start();
    expect(await sql(`SELECT 1 FROM changeset WHERE changeset_id = $1`, [old])).toEqual([]);
  });

  /** Fill a changeset with `n` staged deletes of tasks that do not exist. */
  async function fill(cs: string, n: number): Promise<void> {
    await sql(
      `INSERT INTO changeset_object (changeset_id, object_id, kind, type_key, action, first_touched_at)
       SELECT $1, gen_random_uuid(), 'entity', 'task', 'delete', now() FROM generate_series(1, $2::int)`,
      [cs, n],
    );
  }

  const count = async (cs: string) =>
    (await sql(`SELECT count(*)::int AS n FROM changeset_object WHERE changeset_id = $1`, [cs]))[0]!.n;

  it("the object cap: at 10,000 objects a new object is 409 'full'; a merge into a staged one is not", async () => {
    const cs = (await start()).id as string;
    await stage(cs, rename(ids.P1, "a"));
    await fill(cs, 9999);
    const res = await stage(cs, rename(ids.P2, "b"));
    expect(res).toMatchObject({ status: 409, body: { error: { message: `Changeset '${cs}' is full: at most 10000 staged objects` } } });
    expect(await count(cs)).toBe(10000);
    expect((await stage(cs, rename(ids.P1, "a2"))).status).toBe(201);
  });

  it("the cap counts both objects of a create with a parent relation: one short of it, the pair is 409", async () => {
    const cs = (await start()).id as string;
    await fill(cs, 9999);
    const pair = {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9" },
      parentRelation: { type: "has_task", parentId: ids.P1, properties: { phase: "build" } },
    };
    expect(await stage(cs, pair)).toMatchObject({
      status: 409,
      body: { error: { message: `Changeset '${cs}' is full: at most 10000 staged objects` } },
    });
    expect(await count(cs)).toBe(9999);
    // One object still fits.
    expect((await stage(cs, rename(ids.P1, "a"))).status).toBe(201);
    expect(await count(cs)).toBe(10000);
  });

  it("the byte cap counts the staged values now, one copy per document: a merge past it is 409 'full'", async () => {
    const cap = settings.CHANGESET_MAX_BYTES;
    settings.CHANGESET_MAX_BYTES = 1_000_000;
    try {
      const cs = (await start()).id as string;
      // 200,000 characters, 400,000 bytes as UTF-8.
      const body = "ä".repeat(200_000);
      const write = (id: string) => ({ operation: "update_entity", type: "project", id, properties: { body } });
      // Staged again, a document replaces its staged copy.
      for (let i = 0; i < 3; i++) expect((await stage(cs, write(ids.P1))).status).toBe(201);
      expect((await stage(cs, write(ids.P2))).status).toBe(201);
      const res = await stage(cs, { operation: "create_entity", type: "project", properties: { name: "P9", body } });
      expect(res).toMatchObject({
        status: 409,
        body: { error: { message: `Changeset '${cs}' is full: at most 1000000 bytes of staged values` } },
      });
      const [row] = await sql(`SELECT count(*)::int AS n, sum(bytes)::int AS bytes FROM changeset_value WHERE changeset_id = $1`, [cs]);
      expect(row!.n).toBe(2);
      expect(row!.bytes).toBeGreaterThan(800_000);
      expect(row!.bytes).toBeLessThan(1_000_000);

      // A cut frees its bytes.
      expect((await call("DELETE", `${ALL}/changesets/${cs}/objects/${ids.P2}/properties/body`)).status).toBe(204);
      expect((await stage(cs, { operation: "create_entity", type: "project", properties: { name: "P9", body } })).status).toBe(201);
    } finally {
      settings.CHANGESET_MAX_BYTES = cap;
    }
  });

  it("a staged call while a commit holds the row is 409 at once; after release it is staged", async () => {
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
    expect(await objects(cs)).toEqual([]);
    expect((await stage(cs, rename(ids.P1, "a"))).status).toBe(201);
  });
});
