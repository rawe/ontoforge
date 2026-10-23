/**
 * The lifecycle of a changeset over REST, on the in-test project hierarchy
 * (`buildProjectHierarchy`, rebuilt fresh per group): submit and unsubmit
 * with their notes, the refusals while submitted, the version check of a
 * commit, a rejected commit that stays submitted, submit refused by the
 * lock-free pass and by a deleted anchor, no expiry while submitted, the
 * list per lens and per ruleset, and the review read: names, before →
 * after, markers, and nothing a scoped lens hides.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runQuery } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { closeStores, getRuntimeStore, initStores, type RuntimeStore } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import { modelPrefix, runtimePrefix } from "./fixture.js";
import {
  buildProjectHierarchy,
  PROJECT_HIERARCHY_ONTOLOGY_KEY as O,
  type ProjectHierarchyIds,
} from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const NS = `ont_${O}`;
const ALL = runtimePrefix(O, "all");
const RULESETS = `/api/ontologies/${O}/runtime/rulesets`;

let app: FastifyInstance;
let h: ProjectHierarchyIds;
let e: ProjectHierarchyIds["entities"];
let store: RuntimeStore;

async function call(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function sql(text: string, params?: unknown[]): Promise<Row[]> {
  return (await runQuery(text, params, NS)).rows;
}

async function fresh(): Promise<void> {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  h = await buildProjectHierarchy(app);
  e = h.entities;
  store = await getRuntimeStore(O);
}

async function start(base = ALL, note?: string): Promise<string> {
  const res = await call("POST", `${base}/changesets`, note === undefined ? undefined : { note });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Stage one call: its body, answered 201. */
async function staged(base: string, cs: string, write: Row): Promise<Row> {
  const res = await call("POST", `${base}/changesets/${cs}/writes`, write);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

function view(cs: string, base = ALL): Promise<{ status: number; body: Row }> {
  return call("GET", `${base}/changesets/${cs}`);
}

function submit(cs: string, note?: string, base = ALL): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/changesets/${cs}/submit`, note === undefined ? {} : { note });
}

function unsubmit(cs: string, payload: Row, base = ALL): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/changesets/${cs}/unsubmit`, payload);
}

function commit(cs: string, payload: Row = {}, base = ALL): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/changesets/${cs}/commit`, payload);
}

async function list(base = ALL): Promise<Row[]> {
  const res = await call("GET", `${base}/changesets`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as Row[];
}

async function name(type: string, id: string): Promise<string | null> {
  const res = await call("GET", `${ALL}/entities/${type}/${id}`);
  return res.status === 200 ? (res.body.name as string) : null;
}

async function pointAnchor(key: string, type: string, id: string): Promise<void> {
  const res = await call("PUT", `${RULESETS}/${key}`, { anchor: { type, id } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  await initStores();
  app = await createApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("submit, unsubmit, and the refusals while submitted (V7, V38, V40, R14)", () => {
  beforeAll(fresh, 60_000);

  it("the whole round: submit, refused writes, a stale commit, unsubmit, restage, resubmit, commit", async () => {
    const cs = await start(ALL, "g9");
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "project",
      id: e.P2,
      properties: { name: "P2 Website" },
    });
    const draft = (await view(cs)).body;

    const submitted = await submit(cs, "please review");
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body).toMatchObject({ state: "submitted", version: draft.version + 1, note: "please review" });
    expect(Date.parse(submitted.body.submittedAt)).not.toBeNaN();

    // Frozen: stage, unstage, cut, rebase, discard and a second submit are 409s.
    const refused = [
      await call("POST", `${ALL}/changesets/${cs}/writes`, {
        operation: "update_entity",
        type: "project",
        id: e.P1,
        properties: { name: "P1 x" },
      }),
      await call("DELETE", `${ALL}/changesets/${cs}/objects/${e.P2}`),
      await call("DELETE", `${ALL}/changesets/${cs}/objects/${e.P2}/properties/name`),
      await call("POST", `${ALL}/changesets/${cs}/objects/${e.P2}/rebase`, {}),
      await call("DELETE", `${ALL}/changesets/${cs}`),
    ];
    for (const res of refused) {
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error.message).toBe(`Changeset '${cs}' is submitted; unsubmit it first`);
    }
    expect((await submit(cs, "again")).status).toBe(409);
    expect((await view(cs)).body).toMatchObject({ version: submitted.body.version, objectCount: 1 });

    // A stale version: 409, nothing persisted.
    const stale = await commit(cs, { expectedVersion: submitted.body.version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toBe(
      `Changeset '${cs}' changed since you looked: version ${submitted.body.version}, not ${submitted.body.version - 1}`,
    );
    expect(await name("project", e.P2)).toBe("P2");

    // Unsubmit needs a note.
    for (const payload of [{}, { note: "" }, { note: "  " }, { note: "x".repeat(1001) }]) {
      const res = await unsubmit(cs, payload);
      expect(res.status, JSON.stringify(payload)).toBe(422);
      expect(res.body.error.details.fields).toHaveProperty("note");
    }
    const back = await unsubmit(cs, { note: "fix T2" });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toMatchObject({ state: "draft", note: "fix T2", submittedAt: null, version: submitted.body.version + 1 });
    expect((await unsubmit(cs, { note: "twice" })).status).toBe(409);

    await staged(ALL, cs, { operation: "update_entity", type: "project", id: e.P1, properties: { name: "P1 Core" } });
    const restaged = (await view(cs)).body;
    expect(restaged.version).toBe(back.body.version + 1);

    // Submit without a note keeps it.
    const again = await submit(cs);
    expect(again.body).toMatchObject({ state: "submitted", note: "fix T2", version: restaged.version + 1 });
    const done = await commit(cs, { expectedVersion: again.body.version });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toEqual({ committed: 2, alreadyGone: [] });
    expect(await name("project", e.P2)).toBe("P2 Website");
    expect(await name("project", e.P1)).toBe("P1 Core");
    expect((await view(cs)).status).toBe(404);
    expect((await list()).map((c) => c.id)).not.toContain(cs);
  });

  it("a lock-free fault refuses the submit with 422, and the changeset stays a draft with its version", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "update_entity", type: "person", id: e.Kim, properties: { name: "Kim B" } });
    expect((await call("DELETE", `${ALL}/entities/person/${e.Kim}`)).status).toBe(204);
    const before = (await view(cs)).body;

    const res = await submit(cs, "n");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The changeset was not submitted; it stays a draft",
      details: { violations: [{ object: e.Kim, kind: "missing", message: "Deleted since it was staged" }], total: 1 },
    });
    expect((await view(cs)).body).toMatchObject({ state: "draft", version: before.version, note: null });
  });

  it("a rejected commit of a submitted changeset leaves it submitted with the same version", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "delete_entity", type: "project", id: e.P3 });
    const submitted = (await submit(cs, "drop P3")).body;
    const res = await commit(cs, { expectedVersion: submitted.version });
    expect(res.status).toBe(422);
    expect(res.body.error.details.violations[0]).toMatchObject({ object: e.P3, kind: "has_children" });
    expect((await view(cs)).body).toMatchObject({ state: "submitted", version: submitted.version, note: "drop P3" });
    expect(await name("project", e.P3)).toBe("P3");
  });

  it("a draft changeset commits without expectedVersion", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "update_entity", type: "person", id: e.Ana, properties: { name: "Ana B" } });
    expect((await commit(cs)).status).toBe(200);
    expect(await name("person", e.Ana)).toBe("Ana B");
  });

  it("while a commit holds the row, submit and unsubmit answer 409 at once", async () => {
    const cs = await start();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let ready!: () => void;
    const held = new Promise<void>((resolve) => (ready = resolve));
    const done = store.transaction(await store.designRevision(), async (bound) => {
      await bound.changesets().lockForCommit(cs);
      ready();
      await released;
    });
    await held;
    try {
      const res = await submit(cs, "n");
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(`Changeset '${cs}' is busy; try again`);
    } finally {
      release();
      await done;
    }
    expect((await submit(cs, "n")).status).toBe(200);
  });

  it("a submitted changeset idle for 8 days neither expires nor is swept; a draft one does", async () => {
    const kept = await start();
    await submit(kept, "old but submitted");
    const gone = await start();
    await sql(`UPDATE changeset SET last_change_at = now() - interval '8 days' WHERE changeset_id = ANY($1::uuid[])`, [
      [kept, gone],
    ]);
    await start(); // sweeps
    expect((await view(kept)).status).toBe(200);
    expect((await list()).map((c) => c.id)).toContain(kept);
    expect((await view(gone)).status).toBe(404);
  });
});

describe("the list (V17, V41)", () => {
  beforeAll(fresh, 60_000);

  it("per lens and per ruleset, by number, with counts and types", async () => {
    await pointAnchor("agent-a", "project", e.P1);
    await pointAnchor("agent-b", "project", e.P3);
    const AA = `${ALL}/rulesets/agent-a`;
    const plain = await start(ALL, "plain");
    await staged(ALL, plain, { operation: "update_entity", type: "project", id: e.P2, properties: { name: "P2 x" } });
    const viaRuleset = await start(AA, "via ruleset");
    await staged(AA, viaRuleset, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9" },
      parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "build" } },
    });
    await staged(AA, viaRuleset, { operation: "delete_entity", type: "task", id: e.T3 });
    await staged(AA, viaRuleset, {
      operation: "create_relation",
      type: "assigned_to",
      fromEntityId: e.T1,
      toEntityId: e.Kim,
    });
    const late = await start(ALL, "late");
    expect((await submit(viaRuleset, "review")).status).toBe(200);

    const all = await list();
    expect(all.map((c) => [c.id, c.number])).toEqual([[plain, 1], [viaRuleset, 2], [late, 3]]);
    expect(all[1]).toEqual({
      id: viaRuleset,
      number: 2,
      state: "submitted",
      version: 5,
      note: "review",
      ruleset: "agent-a",
      objectCount: 4,
      operations: { create_entity: 1, delete_entity: 1, create_relation: 2 },
      types: ["assigned_to", "has_task", "task"],
      notVisible: 0,
      createdAt: expect.any(String),
      lastChangeAt: expect.any(String),
      submittedAt: expect.any(String),
    });
    expect(all[2]).toMatchObject({ state: "draft", objectCount: 0, operations: {}, types: [], ruleset: null });

    expect((await list(AA)).map((c) => c.id)).toEqual([viaRuleset]);
    expect(await list(`${ALL}/rulesets/agent-b`)).toEqual([]);
    expect(await list(runtimePrefix(O, "portfolio"))).toEqual([]);
    expect((await call("GET", `${ALL}/rulesets/nope/changesets`)).status).toBe(404);
  });

  it("types apply the lens as it is now: a type the lens dropped is counted, not named", async () => {
    const model = modelPrefix(O);
    const ops = (await call("POST", `${model}/lenses`, { key: "ops", name: "Ops" })).body.lensId as string;
    for (const key of ["customer", "project"]) {
      await call("POST", `${model}/lenses/${ops}/includes/entity-types`, { key });
    }
    const OPS = runtimePrefix(O, "ops");
    const cs = await start(OPS);
    await staged(OPS, cs, { operation: "update_entity", type: "project", id: e.P2, properties: { name: "P2 Ops" } });
    await staged(OPS, cs, {
      operation: "update_entity",
      type: "customer",
      id: e.BETA,
      properties: { name: "BETA Ops" },
    });
    const types = (await call("GET", `${model}/entity-types`)).body as unknown as Row[];
    const project = types.find((t) => t.key === "project")!.entityTypeId as string;
    expect((await call("DELETE", `${model}/lenses/${ops}/includes/entity-types/${project}`)).status).toBe(204);

    const [item] = await list(OPS);
    expect(item).toMatchObject({ id: cs, types: ["customer"], notVisible: 1, objectCount: 2 });
    expect(JSON.stringify(item)).not.toContain("project");

    // The review read of the same changeset names no hidden type either: the
    // object keeps only its id, the address to unstage it by.
    const read = (await view(cs, OPS)).body;
    expect(read.objects[0]).toEqual({
      id: e.P2,
      kind: "entity",
      type: null,
      action: "update",
      firstTouchedAt: expect.any(String),
      markers: [{ kind: "not_visible", message: "The type of this entity is no longer visible through lens 'ops'" }],
      values: [],
    });
    expect(read.objects[1]).toMatchObject({
      type: "customer",
      name: "BETA",
      values: [{ property: "name", before: "BETA", current: "BETA", after: "BETA Ops" }],
    });
    const text = JSON.stringify(read);
    for (const hidden of ["project", "P2 Ops"]) expect(text).not.toContain(hidden);
    expect((await call("DELETE", `${OPS}/changesets/${cs}/objects/${e.P2}`)).status).toBe(204);
  });
});

describe("the review read (V41)", () => {
  beforeAll(fresh, 60_000);

  it("names, values with before, current and after, and the drift, dangling and missing markers", async () => {
    const cs = await start();
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "project",
      id: e.P2,
      properties: { name: "P2 Website" },
    }); // drift
    const p5 = await staged(ALL, cs, {
      operation: "create_entity",
      type: "project",
      properties: { name: "P5" },
      parentRelation: { type: "has_project", parentId: e.ACME, properties: {} },
    }); // its entity unstaged below
    const t9 = await staged(ALL, cs, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9" },
      parentRelation: { type: "has_task", parentId: p5.id, properties: { phase: "plan" } },
    }); // its parent relation dangling
    const assigned = await staged(ALL, cs, {
      operation: "create_relation",
      type: "assigned_to",
      fromEntityId: e.T1,
      toEntityId: e.Kim,
    });
    const link = h.relations["P1 has_task T3"]!;
    await staged(ALL, cs, { operation: "update_relation", type: "has_task", id: link, properties: { phase: "test" } });
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "person",
      id: e.Ben,
      properties: { name: "Ben B" },
    }); // missing
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T2,
      properties: { notes: "New notes" },
    }); // a document
    expect((await call("DELETE", `${ALL}/changesets/${cs}/objects/${p5.id}`)).status).toBe(204);
    expect((await call("PATCH", `${ALL}/entities/project/${e.P2}`, { name: "P2 Mobile" })).status).toBe(200);
    expect((await call("DELETE", `${ALL}/entities/person/${e.Ben}`)).status).toBe(204);

    const read = (await view(cs)).body;
    expect(read).toMatchObject({ state: "draft", note: null, submittedAt: null, objectCount: 8 });
    const byId = Object.fromEntries((read.objects as Row[]).map((o) => [o.id, o]));
    expect((read.objects as Row[]).map((o) => o.id)).toEqual([
      e.P2,
      p5.relation.id,
      t9.id,
      t9.relation.id,
      assigned.id,
      link,
      e.Ben,
      e.T2,
    ]);

    // Drift, on the value: current is no longer before, the value staged against.
    expect(byId[e.P2]).toMatchObject({ kind: "entity", type: "project", action: "update", name: "P2 Mobile", markers: [] });
    expect(byId[e.P2].values).toEqual([
      {
        property: "name",
        before: "P2",
        current: "P2 Mobile",
        after: "P2 Website",
        markers: [{ kind: "drift", message: "Changed since it was staged" }],
      },
    ]);
    expect(byId[p5.relation.id]).toMatchObject({
      kind: "relation",
      action: "create",
      type: "has_project",
      from: { id: e.ACME, name: "ACME" },
      to: { id: p5.id, name: null },
      markers: [{ kind: "dangling", message: "The target end is neither stored nor created in this changeset" }],
    });
    expect(byId[t9.id]).toMatchObject({ name: "T9", values: [{ property: "name", after: "T9" }], markers: [] });
    expect(byId[t9.relation.id]).toMatchObject({
      type: "has_task",
      from: { id: p5.id, name: null },
      to: { id: t9.id, name: "T9" },
      values: [{ property: "phase", after: "plan" }],
      markers: [{ kind: "dangling", message: "The source end is neither stored nor created in this changeset" }],
    });
    expect(byId[assigned.id]).toMatchObject({ from: { id: e.T1, name: "T1" }, to: { id: e.Kim, name: "Kim" }, markers: [], values: [] });
    expect(byId[link]).toMatchObject({
      action: "update",
      from: { id: e.P1, name: "P1" },
      to: { id: e.T3, name: "T3" },
      values: [{ property: "phase", before: "build", current: "build", after: "test", markers: [] }],
      markers: [],
    });
    // Gone since staging: before stays, there is no current.
    expect(byId[e.Ben]).toMatchObject({ name: null, values: [{ property: "name", before: "Ben", current: null, after: "Ben B" }] });
    expect(byId[e.Ben].markers.map((m: Row) => m.kind)).toEqual(["missing"]);
    expect(byId[e.T2]).toMatchObject({
      name: "T2",
      values: [
        {
          property: "notes",
          before: { document: true, length: "Notes of T2".length },
          current: { document: true, length: "Notes of T2".length },
          after: { document: true, length: "New notes".length },
        },
      ],
    });

    // A page shows the markers of its own objects.
    const page = (await call("GET", `${ALL}/changesets/${cs}?offset=1&limit=1`)).body;
    expect(page.objects.map((o: Row) => [o.id, o.markers.map((m: Row) => m.kind)])).toEqual([[p5.relation.id, ["dangling"]]]);
  });

  it("through a scoped lens: hidden names are not returned", async () => {
    // no_projects hides project: no project, its name or a has_task value is shown.
    const NO = runtimePrefix(O, "no_projects");
    const cs = await start(NO);
    await staged(NO, cs, { operation: "update_entity", type: "task", id: e.T4, properties: { name: "T4 b" } });
    await staged(NO, cs, { operation: "create_relation", type: "has_subtask", fromEntityId: e.T4, toEntityId: e.T5 });
    const read = (await view(cs, NO)).body;
    expect(read.objects[0]).toMatchObject({ name: "T4", values: [{ property: "name", before: "T4", current: "T4", after: "T4 b" }] });
    expect(read.objects[1]).toMatchObject({ from: { id: e.T4, name: "T4" }, to: { id: e.T5, name: "T5" } });
    const text = JSON.stringify(read);
    for (const hidden of ["P2", "project", "phase"]) expect(text).not.toContain(hidden);
  });
});

describe("a deleted anchor at submit (V42; the deleted row of the anchor states)", () => {
  beforeAll(fresh, 60_000);

  it("a deleted anchor refuses submit with 409; unsubmit stays allowed", async () => {
    await pointAnchor("agent-a", "task", e.T2a);
    const AA = `${ALL}/rulesets/agent-a`;
    const cs = await start(AA);
    await staged(AA, cs, { operation: "update_entity", type: "person", id: e.Kim, properties: { name: "Kim C" } });
    const other = await start(AA);
    expect((await submit(other, "before")).status).toBe(200);
    expect((await call("DELETE", `${ALL}/entities/task/${e.T2a}`)).status).toBe(204);

    const deleted = "The anchor of ruleset 'agent-a' no longer exists";
    for (const base of [AA, ALL]) {
      const res = await submit(cs, "n", base);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(deleted);
    }
    const back = await unsubmit(other, { note: "anchor is deleted" }, AA);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toMatchObject({ state: "draft", note: "anchor is deleted" });
  });
});
