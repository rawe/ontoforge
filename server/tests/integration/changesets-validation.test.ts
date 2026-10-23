/**
 * Commit validation over REST, on the in-test project hierarchy
 * (`buildProjectHierarchy`, rebuilt fresh per group): every violation
 * kind rejects in its own group, with nothing persisted and the changeset
 * as it was, beside a control that commits. The lock-free pass (not
 * visible, missing, dangling, drift and its rebase), drift re-checked under the lock
 * against a second connection, the end-state rules (has children, two
 * parents, cycle, endpoint type), anchor coverage before and after, the
 * re-point, a deleted or hidden anchor, the ruleset gone, each of the five
 * ruleset kinds once more through a ruleset's URL, the cap of 100 listed
 * violations, and messages that name nothing a scoped lens hides.
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

/** A fresh hierarchy: every ontology dropped, then built again. */
async function fresh(): Promise<void> {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  h = await buildProjectHierarchy(app);
  e = h.entities;
  store = await getRuntimeStore(O);
}

async function start(base = ALL): Promise<string> {
  const res = await call("POST", `${base}/changesets`);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Stage one call: its body, answered 201. */
async function staged(base: string, cs: string, write: Row): Promise<Row> {
  const res = await call("POST", `${base}/changesets/${cs}/writes`, write);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** The body of a create of `entityType` under `parentId`. */
function underParent(entityType: string, name: string, type: string, parentId: string, properties: Row = {}): Row {
  return { operation: "create_entity", type: entityType, properties: { name }, parentRelation: { type, parentId, properties } };
}

function commit(cs: string, base = ALL): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/changesets/${cs}/commit`, {});
}

async function graph(): Promise<Row> {
  return (
    await sql(`SELECT (SELECT count(*) FROM entity)::int AS entities,
                      (SELECT count(*) FROM relation)::int AS relations,
                      (SELECT md5(string_agg(id::text || props::text, ',' ORDER BY id)) FROM entity) AS props`)
  )[0]!;
}

/** Commit and expect a rejection: 422, nothing persisted, the changeset
 * still there with its version and objects. The violations. */
async function rejected(cs: string, base = ALL): Promise<Row[]> {
  const before = await graph();
  const view = await call("GET", `${base}/changesets/${cs}`);
  const res = await commit(cs, base);
  expect(res.status, JSON.stringify(res.body)).toBe(422);
  expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: "The commit was rejected; nothing was persisted" });
  expect(await graph()).toEqual(before);
  const after = await call("GET", `${base}/changesets/${cs}`);
  expect(after.status).toBe(200);
  expect(after.body).toMatchObject({ version: view.body.version, objectCount: view.body.objectCount, objects: view.body.objects });
  return res.body.error.details.violations as Row[];
}

async function committed(cs: string, base = ALL): Promise<Row> {
  const res = await commit(cs, base);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function name(type: string, id: string): Promise<string | null> {
  const res = await call("GET", `${ALL}/entities/${type}/${id}`);
  return res.status === 200 ? (res.body.name as string) : null;
}

async function pointAnchor(key: string, type: string, id: string): Promise<void> {
  const res = await call("PUT", `${RULESETS}/${key}`, { anchor: { type, id } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** A transaction on its own connection that runs `during`, then holds
 * its locks until the returned function is called. */
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
  app = await createApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("not_visible: the lens no longer shows what an object names", () => {
  beforeAll(fresh, 60_000);

  it("a type removed from the start lens rejects, naming no type; a write the lens still shows commits", async () => {
    const model = modelPrefix(O);
    const ops = (await call("POST", `${model}/lenses`, { key: "ops", name: "Ops" })).body.lensId as string;
    for (const key of ["customer", "project"]) {
      expect((await call("POST", `${model}/lenses/${ops}/includes/entity-types`, { key })).status).toBe(201);
    }
    const OPS = runtimePrefix(O, "ops");
    const cs = await start(OPS);
    await staged(OPS, cs, { operation: "update_entity", type: "project", id: e.P2, properties: { name: "P2 Ops" } });
    const control = await start(OPS);
    await staged(OPS, control, {
      operation: "update_entity",
      type: "customer",
      id: e.BETA,
      properties: { name: "BETA Ops" },
    });

    const types = (await call("GET", `${model}/entity-types`)).body as unknown as Row[];
    const project = types.find((t) => t.key === "project")!.entityTypeId as string;
    expect((await call("DELETE", `${model}/lenses/${ops}/includes/entity-types/${project}`)).status).toBe(204);

    const violations = await rejected(cs, OPS);
    expect(violations).toEqual([
      { object: e.P2, kind: "not_visible", message: "The type of this entity is no longer visible through lens 'ops'" },
    ]);
    expect(JSON.stringify(violations)).not.toContain("project");
    expect(await name("project", e.P2)).toBe("P2");
    expect(await committed(control, OPS)).toEqual({ committed: 1, alreadyGone: [] });
  });
});

describe("missing and dangling: ids the staged objects name", () => {
  beforeAll(fresh, 60_000);

  it("missing: an update target deleted since staging; control: a stored target commits", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "update_entity", type: "person", id: e.Kim, properties: { name: "Kim B" } });
    expect((await call("DELETE", `${ALL}/entities/person/${e.Kim}`)).status).toBe(204);
    expect(await rejected(cs)).toEqual([{ object: e.Kim, kind: "missing", message: "Deleted since it was staged" }]);

    const control = await start();
    await staged(ALL, control, {
      operation: "update_entity",
      type: "person",
      id: e.Ana,
      properties: { name: "Ana B" },
    });
    await committed(control);
    expect(await name("person", e.Ana)).toBe("Ana B");
  });

  it("dangling: a task under a create since unstaged; a relation onto an entity deleted here; control: kept, it commits", async () => {
    const cs = await start();
    const p5 = await staged(ALL, cs, underParent("project", "P5", "has_project", e.ACME));
    const t9 = await staged(ALL, cs, underParent("task", "T9", "has_task", p5.id, { phase: "plan" }));
    expect((await call("DELETE", `${ALL}/changesets/${cs}/objects/${p5.id}`)).status).toBe(204);
    // The parent relations into and out of P5 dangle.
    expect(await rejected(cs)).toEqual([
      { object: p5.relation.id, kind: "dangling", message: "The target end is neither stored nor created in this changeset" },
      { object: t9.relation.id, kind: "dangling", message: "The source end is neither stored nor created in this changeset" },
    ]);

    const onto = await start();
    await staged(ALL, onto, { operation: "delete_entity", type: "person", id: e.Lea });
    const assigned = await staged(ALL, onto, { operation: "create_relation", type: "assigned_to", fromEntityId: e.T2, toEntityId: e.Lea });
    expect(await rejected(onto)).toEqual([
      { object: assigned.id, kind: "dangling", message: "The target end is deleted in this changeset" },
    ]);

    const control = await start();
    const p6 = (await staged(ALL, control, underParent("project", "P6", "has_project", e.ACME))).id as string;
    const t10 = (await staged(ALL, control, underParent("task", "T10", "has_task", p6, { phase: "plan" }))).id as string;
    await committed(control);
    expect(await name("task", t10)).toBe("T10");
  });
});

describe("drift", () => {
  beforeAll(fresh, 60_000);

  it("a live change of a key in before rejects; rebase accepts it and the staged value commits", async () => {
    const cs = await start();
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "project",
      id: e.P2,
      properties: { name: "P2 Website" },
    });
    expect((await call("PATCH", `${ALL}/entities/project/${e.P2}`, { name: "P2 Mobile" })).status).toBe(200);
    expect(await rejected(cs)).toEqual([
      { object: e.P2, property: "name", kind: "drift", message: "Changed since it was staged" },
    ]);
    expect(await name("project", e.P2)).toBe("P2 Mobile");

    // Staging the value again keeps the before of its first touch: still drift.
    await staged(ALL, cs, { operation: "update_entity", type: "project", id: e.P2, properties: { name: "P2 Website" } });
    expect((await rejected(cs)).map((v) => v.kind)).toEqual(["drift"]);
    const rebased = await call("POST", `${ALL}/changesets/${cs}/objects/${e.P2}/rebase`, {});
    expect(rebased.status, JSON.stringify(rebased.body)).toBe(200);
    expect(rebased.body.values).toEqual([
      { property: "name", before: "P2 Mobile", current: "P2 Mobile", after: "P2 Website", markers: [] },
    ]);
    await committed(cs);
    expect(await name("project", e.P2)).toBe("P2 Website");
  });

  it("control: a value changed and changed back is no drift; another key's change is none either", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "update_entity", type: "project", id: e.P1, properties: { name: "P1 X" } });
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: e.T1, properties: { name: "T1 X" } });
    expect((await call("PATCH", `${ALL}/entities/project/${e.P1}`, { name: "P1 Y" })).status).toBe(200);
    expect((await call("PATCH", `${ALL}/entities/project/${e.P1}`, { name: "P1" })).status).toBe(200);
    expect((await call("PATCH", `${ALL}/entities/task/${e.T1}`, { notes: "Changed notes" })).status).toBe(200);
    await committed(cs);
    expect(await name("project", e.P1)).toBe("P1 X");
  });

  it("a staged delete has no before: a live change of its target does not reject it", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T2a });
    expect((await call("PATCH", `${ALL}/entities/task/${e.T2a}`, { name: "T2a renamed" })).status).toBe(200);
    await committed(cs);
    expect(await name("task", e.T2a)).toBeNull();
  });

  it("a change landing after the commit took its lock is waited for, then compared under the lock", async () => {
    const cs = await start();
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "project",
      id: e.P3,
      properties: { name: "P3 Website" },
    });
    // A second connection changes P3 and holds the row; the commit's pass
    // still reads the old value, then waits for the row under its lock.
    const release = await hold((bound) => bound.updateEntity("project", e.P3, { name: "P3 Mobile" }, [], {}));
    let running: Promise<{ status: number; body: Row }> | undefined;
    try {
      running = commit(cs);
      await waitingForLocks(1);
    } finally {
      await release();
    }
    const res = await running!;
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details.violations).toEqual([
      { object: e.P3, property: "name", kind: "drift", message: "Changed since it was staged" },
    ]);
    expect(await name("project", e.P3)).toBe("P3 Mobile");
    expect((await call("GET", `${ALL}/changesets/${cs}`)).status).toBe(200);
  });

  it("under the lock a document is compared by its hash: a same-length edit landing meanwhile rejects", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: e.T5, properties: { notes: "Planned T5" } });
    // "Notes of T5" → "Texts of T5", held by a second connection: the
    // pass reads the old text, the lock the new one.
    const release = await hold((bound) => bound.updateEntity("task", e.T5, { notes: "Texts of T5" }, [], {}));
    let running: Promise<{ status: number; body: Row }> | undefined;
    try {
      running = commit(cs);
      await waitingForLocks(1);
    } finally {
      await release();
    }
    const res = await running!;
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details.violations).toEqual([
      { object: e.T5, property: "notes", kind: "drift", message: "Changed since it was staged" },
    ]);

    // Control: the text as staged against, under the lock too, commits.
    const again = await start();
    await staged(ALL, again, { operation: "update_entity", type: "task", id: e.T5, properties: { notes: "Planned T5" } });
    const touch = await hold((bound) => bound.updateEntity("task", e.T5, { name: "T5" }, [], {}));
    try {
      running = commit(again);
      await waitingForLocks(1);
    } finally {
      await touch();
    }
    expect(await running).toMatchObject({ status: 200, body: { committed: 1 } });
    expect((await call("GET", `${ALL}/entities/task/${e.T5}/documents/notes`)).body.content).toBe("Planned T5");
  });
});

describe("has_children and the order-free subtree delete", () => {
  beforeAll(fresh, 60_000);

  it("deleting a parent while a child stays rejects, naming no child; deleting the children too commits", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "delete_entity", type: "project", id: e.P2 });
    const violations = await rejected(cs);
    expect(violations).toEqual([{ object: e.P2, kind: "has_children", message: "Still has children" }]);
    expect(JSON.stringify(violations)).not.toMatch(new RegExp(`${e.T4}|${e.T5}|task`));

    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T4 });
    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T5 });
    expect(await committed(cs)).toEqual({ committed: 3, alreadyGone: [] });
    for (const [type, id] of [["project", e.P2], ["task", e.T4], ["task", e.T5]] as const) {
      expect(await name(type, id)).toBeNull();
    }
  });

  it("children first, and a child re-parented instead of deleted, both commit", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T2a });
    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T2 });
    await staged(ALL, cs, {
      operation: "create_relation",
      type: "has_task",
      fromEntityId: e.P3,
      toEntityId: e.T3,
      properties: { phase: "test" },
    });
    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T1a1 });
    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T1a });
    await staged(ALL, cs, { operation: "delete_entity", type: "milestone", id: e.M1 });
    await staged(ALL, cs, { operation: "delete_relation", type: "has_task", id: h.relations["P1 has_task T1"] });
    await staged(ALL, cs, {
      operation: "create_relation",
      type: "has_task",
      fromEntityId: e.P3,
      toEntityId: e.T1,
      properties: { phase: "test" },
    });
    await staged(ALL, cs, { operation: "delete_entity", type: "project", id: e.P1 });
    // T3 is re-parented before P1 goes; T1 after the move of its link.
    await committed(cs);
    expect(await name("project", e.P1)).toBeNull();
    const path = await call("GET", `${ALL}/entities/task/${e.T3}/path`);
    expect((path.body as unknown as Row[]).map((step) => step.name)).toEqual(["BETA", "P3", "T3"]);
  });
});

describe("the parent rules on the end state: two_parents, cycle", () => {
  beforeAll(fresh, 60_000);

  it("two_parents: a second parent for T1", async () => {
    const cs = await start();
    const second = await staged(ALL, cs, {
      operation: "create_relation",
      type: "has_task",
      fromEntityId: e.P2,
      toEntityId: e.T1,
      properties: { phase: "x" },
    });
    expect(await rejected(cs)).toEqual([
      { object: second.id, kind: "two_parents", message: "The target end already has a parent" },
    ]);
  });

  it("cycle: with the delete of P1 has_task T1 first, T1a has_subtask T1 is a cycle alone", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "delete_relation", type: "has_task", id: h.relations["P1 has_task T1"] });
    const link = await staged(ALL, cs, { operation: "create_relation", type: "has_subtask", fromEntityId: e.T1a, toEntityId: e.T1 });
    expect(await rejected(cs)).toEqual([{ object: link.id, kind: "cycle", message: "This parent link would close a cycle" }]);
  });

  it("control: a parent move, the new link staged before the old one's delete, closes no cycle and commits", async () => {
    const cs = await start();
    await staged(ALL, cs, { operation: "create_relation", type: "has_subtask", fromEntityId: e.T1, toEntityId: e.T3 });
    await staged(ALL, cs, { operation: "delete_relation", type: "has_task", id: h.relations["P1 has_task T3"] });
    await committed(cs);
    const path = await call("GET", `${ALL}/entities/task/${e.T3}/path`);
    expect((path.body as unknown as Row[]).map((step) => step.name)).toEqual(["ACME", "P1", "T1", "T3"]);
  });
});

describe("endpoint_type", () => {
  beforeAll(fresh, 60_000);

  it("has_task with a person as the child rejects, naming no type; control: the right types commit", async () => {
    const cs = await start();
    const wrong = await staged(ALL, cs, {
      operation: "create_relation",
      type: "has_task",
      fromEntityId: e.P1,
      toEntityId: e.Lea,
      properties: { phase: "x" },
    });
    const violations = await rejected(cs);
    expect(violations).toEqual([
      { object: wrong.id, kind: "endpoint_type", message: "The target end does not have the type relation type 'has_task' requires" },
    ]);
    expect(JSON.stringify(violations)).not.toContain("person");
    expect(JSON.stringify(violations)).not.toContain("'task'");

    const control = await start();
    await staged(ALL, control, {
      operation: "create_relation",
      type: "assigned_to",
      fromEntityId: e.T2,
      toEntityId: e.Kim,
    });
    await committed(control);
  });
});

describe("anchor coverage", () => {
  const A = `${ALL}/rulesets/agent-a`;
  const B = `${ALL}/rulesets/agent-b`;

  beforeAll(async () => {
    await fresh();
    await pointAnchor("agent-a", "project", e.P1);
    await pointAnchor("agent-b", "project", e.P3);
  }, 60_000);

  it("coverage: a task under P2 through agent-a rejects; control: under P1 commits", async () => {
    const cs = await start(A);
    const t = await staged(A, cs, underParent("task", "T20", "has_task", e.P2, { phase: "plan" }));
    // The parent relation, whose parent end P2 is outside, and the task.
    expect(await rejected(cs, A)).toEqual([
      { object: t.relation.id, kind: "outside_subtree", message: "Outside the anchor subtree of ruleset 'agent-a'" },
      { object: t.id, kind: "outside_subtree", message: "Would be outside the anchor subtree of ruleset 'agent-a' after the commit" },
    ]);

    const control = await start(A);
    await staged(A, control, underParent("task", "T21", "has_task", e.P1, { phase: "plan" }));
    await staged(A, control, { operation: "update_entity", type: "person", id: e.Ben, properties: { name: "Ben A" } });
    await committed(control, A);
  });

  it("before and after: moving a task out of the subtree, or into it, rejects; a move inside commits", async () => {
    const out = await start(A);
    const oldLink = h.relations["P1 has_task T3"]!;
    await staged(A, out, { operation: "delete_relation", type: "has_task", id: oldLink });
    const outLink = await staged(A, out, {
      operation: "create_relation",
      type: "has_task",
      fromEntityId: e.P2,
      toEntityId: e.T3,
      properties: { phase: "x" },
    });
    // The new link's parent end is outside before; T3 is outside after.
    expect((await rejected(out, A)).map((v) => [v.object, v.kind])).toEqual([
      [outLink.id, "outside_subtree"],
      [oldLink, "outside_subtree"],
    ]);

    const into = await start(A);
    const fromP2 = h.relations["P2 has_task T4"]!;
    await staged(A, into, { operation: "delete_relation", type: "has_task", id: fromP2 });
    const intoLink = await staged(A, into, {
      operation: "create_relation",
      type: "has_task",
      fromEntityId: e.P1,
      toEntityId: e.T4,
      properties: { phase: "x" },
    });
    expect(await rejected(into, A)).toEqual([
      { object: fromP2, kind: "outside_subtree", message: "Outside the anchor subtree of ruleset 'agent-a'" },
      { object: intoLink.id, kind: "outside_subtree", message: "Outside the anchor subtree of ruleset 'agent-a'" },
    ]);

    const inside = await start(A);
    await staged(A, inside, { operation: "delete_relation", type: "has_task", id: h.relations["P1 has_task T3"] });
    await staged(A, inside, {
      operation: "create_relation",
      type: "has_subtask",
      fromEntityId: e.T2,
      toEntityId: e.T3,
    });
    await committed(inside, A);
  });

  it("a re-point between staging and commit rejects; pointed back, it commits", async () => {
    const cs = await start(A);
    const t22 = await staged(A, cs, underParent("task", "T22", "has_task", e.P1, { phase: "plan" }));
    await pointAnchor("agent-a", "project", e.P2);
    expect((await rejected(cs, A)).map((v) => [v.object, v.kind])).toEqual([
      [t22.relation.id, "outside_subtree"],
      [t22.id, "outside_subtree"],
    ]);
    await pointAnchor("agent-a", "project", e.P1);
    await committed(cs, A);
  });

  it("anchor_deleted: the anchor entity deleted after staging", async () => {
    await pointAnchor("agent-c", "task", e.T2a);
    const C = `${ALL}/rulesets/agent-c`;
    const cs = await start(C);
    await staged(C, cs, { operation: "update_entity", type: "person", id: e.Kim, properties: { name: "Kim C" } });
    expect((await call("DELETE", `${ALL}/entities/task/${e.T2a}`)).status).toBe(204);
    const [violation] = await rejected(cs, C);
    expect(violation).toEqual({
      object: null,
      kind: "anchor_deleted",
      message: "The anchor of ruleset 'agent-c' no longer exists",
    });
  });

  it("anchor_hidden: re-pointed at an entity the lens hides, named by neither type nor id", async () => {
    const PORTFOLIO = runtimePrefix(O, "portfolio");
    await pointAnchor("agent-d", "project", e.P3);
    const D = `${PORTFOLIO}/rulesets/agent-d`;
    const cs = await start(D);
    await staged(D, cs, { operation: "update_entity", type: "project", id: e.P3, properties: { name: "P3 D" } });
    await pointAnchor("agent-d", "task", e.T6);
    const violations = await rejected(cs, D);
    expect(violations).toEqual([
      {
        object: null,
        kind: "anchor_hidden",
        message: "The anchor of ruleset 'agent-d' is an entity that lens 'portfolio' does not show",
      },
    ]);
    expect(JSON.stringify(violations)).not.toMatch(new RegExp(`task|${e.T6}`));
  });

  it("ruleset_gone: the ruleset deleted; its changeset, reached through the plain lens URL, rejects", async () => {
    const cs = await start(B);
    await staged(B, cs, { operation: "update_entity", type: "task", id: e.T6, properties: { name: "T6 B" } });
    expect((await call("DELETE", `${RULESETS}/agent-b`)).status).toBe(204);
    expect((await call("GET", `${B}/changesets/${cs}`)).status).toBe(404);
    expect(await rejected(cs)).toEqual([
      { object: null, kind: "ruleset_gone", message: "Ruleset 'agent-b' no longer exists, so this changeset cannot be committed" },
    ]);
  });
});

describe("the five ruleset violation kinds through the REST mirror", () => {
  const url = (key: string, lens = ALL): string => `${lens}/rulesets/${key}`;

  beforeAll(fresh, 60_000);

  it("ruleset_gone: the ruleset deleted after staging; the plain lens commit rejects", async () => {
    await pointAnchor("k-gone", "project", e.P1);
    const cs = await start(url("k-gone"));
    await staged(url("k-gone"), cs, { operation: "update_entity", type: "task", id: e.T1, properties: { name: "T1 gone" } });
    expect((await call("DELETE", `${RULESETS}/k-gone`)).status).toBe(204);
    const read = await call("GET", `${url("k-gone")}/changesets/${cs}`);
    expect(read).toMatchObject({ status: 404, body: { error: { message: "Ruleset 'k-gone' not found" } } });
    expect(await rejected(cs)).toEqual([
      { object: null, kind: "ruleset_gone", message: "Ruleset 'k-gone' no longer exists, so this changeset cannot be committed" },
    ]);
  });

  it("outside_subtree: an update of a task under another project, named by neither id nor type", async () => {
    await pointAnchor("k-sub", "project", e.P1);
    const cs = await start(url("k-sub"));
    await staged(url("k-sub"), cs, { operation: "update_entity", type: "task", id: e.T4, properties: { name: "T4 sub" } });
    const violations = await rejected(cs, url("k-sub"));
    // The object is the staged object's id, the caller's own; the message names nothing.
    expect(violations).toEqual([{ object: e.T4, kind: "outside_subtree", message: "Outside the anchor subtree of ruleset 'k-sub'" }]);
    expect(violations[0]!.message).not.toMatch(new RegExp(`${e.T4}|${e.P1}|task|project`));
  });

  it("anchor_deleted: staging, submit and the commit refuse with one text", async () => {
    await pointAnchor("k-del", "task", e.T1a1);
    const cs = await start(url("k-del"));
    await staged(url("k-del"), cs, { operation: "update_entity", type: "person", id: e.Kim, properties: { name: "Kim del" } });
    expect((await call("DELETE", `${ALL}/entities/task/${e.T1a1}`)).status).toBe(204);
    const text = "The anchor of ruleset 'k-del' no longer exists";
    const stage = await call("POST", `${url("k-del")}/changesets/${cs}/writes`, {
      operation: "update_entity",
      type: "person",
      id: e.Ana,
      properties: { name: "Ana del" },
    });
    expect(stage).toMatchObject({ status: 409, body: { error: { message: text } } });
    const submit = await call("POST", `${url("k-del")}/changesets/${cs}/submit`, {});
    expect(submit).toMatchObject({ status: 409, body: { error: { message: text } } });
    expect(await rejected(cs, url("k-del"))).toEqual([{ object: null, kind: "anchor_deleted", message: text }]);
  });

  it("anchor_hidden: re-pointed at an entity the lens hides; staging, submit and the commit refuse with one text", async () => {
    const lens = runtimePrefix(O, "portfolio");
    await pointAnchor("k-hid", "project", e.P3);
    const cs = await start(url("k-hid", lens));
    await staged(url("k-hid", lens), cs, { operation: "update_entity", type: "project", id: e.P3, properties: { name: "P3 hid" } });
    await pointAnchor("k-hid", "task", e.T6);
    const text = "The anchor of ruleset 'k-hid' is an entity that lens 'portfolio' does not show";
    const stage = await call("POST", `${url("k-hid", lens)}/changesets/${cs}/writes`, {
      operation: "update_entity",
      type: "project",
      id: e.P3,
      properties: { name: "P3 hid again" },
    });
    expect(stage).toMatchObject({ status: 409, body: { error: { message: text } } });
    const submit = await call("POST", `${url("k-hid", lens)}/changesets/${cs}/submit`, {});
    expect(submit).toMatchObject({ status: 409, body: { error: { message: text } } });
    const violations = await rejected(cs, url("k-hid", lens));
    expect(violations).toEqual([{ object: null, kind: "anchor_hidden", message: text }]);
    expect(JSON.stringify([stage.body, submit.body, violations])).not.toMatch(new RegExp(`task|${e.T6}`));
  });

  it("deletes_anchor: a staged delete of another ruleset's anchor inside the subtree, naming neither that ruleset nor the entity", async () => {
    await pointAnchor("k-own", "project", e.P1);
    await pointAnchor("k-leaf", "task", e.T3);
    const cs = await start(url("k-own"));
    await staged(url("k-own"), cs, { operation: "delete_entity", type: "task", id: e.T3 });
    const violations = await rejected(cs, url("k-own"));
    expect(violations).toEqual([
      { object: e.T3, kind: "deletes_anchor", message: "It is the anchor of a ruleset, so it cannot be deleted on this connection" },
    ]);
    expect(violations[0]!.message).not.toMatch(new RegExp(`k-leaf|${e.T3}`));
    expect(await name("task", e.T3)).toBe("T3");
  });
});

describe("the violations listed, and what they name", () => {
  beforeAll(fresh, 60_000);

  it("more than 100 faults list the first 100 by first touch, and the total", async () => {
    const x = (await call("POST", `${ALL}/entities/person`, { name: "X" })).body._id as string;
    const cs = await start();
    const links: string[] = [];
    for (let i = 0; i < 120; i++) {
      links.push((await staged(ALL, cs, { operation: "create_relation", type: "assigned_to", fromEntityId: e.T2, toEntityId: x })).id as string);
    }
    expect((await call("DELETE", `${ALL}/entities/person/${x}`)).status).toBe(204);
    const res = await commit(cs);
    expect(res.status).toBe(422);
    const { violations, total } = res.body.error.details as Row;
    expect(total).toBe(120);
    expect(violations).toHaveLength(100);
    expect(violations.map((v: Row) => v.object)).toEqual(links.slice(0, 100));
  });

  it("on a scoped lens, no message names a type, id or name the lens hides", async () => {
    // `no_projects` hides project: P1, T1's parent, is never named.
    const NP = runtimePrefix(O, "no_projects");
    const cs = await start(NP);
    const second = await staged(NP, cs, { operation: "create_relation", type: "has_subtask", fromEntityId: e.T2a, toEntityId: e.T1 });
    await staged(NP, cs, { operation: "delete_entity", type: "task", id: e.T1a });
    const wrong = await staged(NP, cs, { operation: "create_relation", type: "has_subtask", fromEntityId: e.T3, toEntityId: e.M1 });
    const violations = await rejected(cs, NP);
    expect(violations.map((v) => [v.object, v.kind])).toEqual([
      [e.T1a, "has_children"],
      [wrong.id, "endpoint_type"],
      [second.id, "two_parents"],
    ]);
    expect(violations[2]!.message).toBe("The target end already has a parent");
    const text = JSON.stringify(violations);
    for (const hidden of ["project", "P1", e.P1, e.P2, e.T1a1, "milestone"]) {
      expect(text).not.toContain(hidden);
    }
  });
});
