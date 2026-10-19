/**
 * Commit validation over REST, on the in-test project hierarchy
 * (`buildProjectHierarchy`, rebuilt fresh per group): every violation
 * kind rejects in its own group, with nothing persisted and the changeset
 * as it was, beside a control that commits. The lock-free pass (not
 * visible, missing, dangling, drift), drift re-checked under the lock
 * against a second connection, the end-state rules (has children, two
 * parents, cycle, endpoint type), anchor coverage before and after, the
 * re-point, a dangling or hidden anchor, the anchor gone, the cap of 100
 * listed violations, and messages that name nothing a scoped lens hides.
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
const ANCHORS = `/api/ontologies/${O}/runtime/anchors`;

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

async function staged(method: string, base: string, cs: string, path: string, payload?: Row): Promise<Row> {
  const res = await call(method, `${base}/changesets/${cs}/${path}`, payload);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body;
}

function underParent(name: string, type: string, parentId: string, properties: Row = {}): Row {
  return { name, parentRelation: { type, parentId, properties } };
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
 * still there with its version and writes. The violations. */
async function rejected(cs: string, base = ALL): Promise<Row[]> {
  const before = await graph();
  const view = await call("GET", `${base}/changesets/${cs}`);
  const res = await commit(cs, base);
  expect(res.status, JSON.stringify(res.body)).toBe(422);
  expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: "The commit was rejected; nothing was persisted" });
  expect(await graph()).toEqual(before);
  const after = await call("GET", `${base}/changesets/${cs}`);
  expect(after.status).toBe(200);
  expect(after.body).toMatchObject({ version: view.body.version, writeCount: view.body.writeCount });
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
  const res = await call("PUT", `${ANCHORS}/${key}`, { entity: { type, id } });
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

describe("not_visible: the lens no longer shows what a write names (V19, V41)", () => {
  beforeAll(fresh, 60_000);

  it("a type removed from the start lens rejects, naming no type; a write the lens still shows commits", async () => {
    const model = modelPrefix(O);
    const ops = (await call("POST", `${model}/lenses`, { key: "ops", name: "Ops" })).body.lensId as string;
    for (const key of ["customer", "project"]) {
      expect((await call("POST", `${model}/lenses/${ops}/includes/entity-types`, { key })).status).toBe(201);
    }
    const OPS = runtimePrefix(O, "ops");
    const cs = await start(OPS);
    await staged("PATCH", OPS, cs, `entities/project/${e.P2}`, { name: "P2 Ops" });
    const control = await start(OPS);
    await staged("PATCH", OPS, control, `entities/customer/${e.BETA}`, { name: "BETA Ops" });

    const types = (await call("GET", `${model}/entity-types`)).body as unknown as Row[];
    const project = types.find((t) => t.key === "project")!.entityTypeId as string;
    expect((await call("DELETE", `${model}/lenses/${ops}/includes/entity-types/${project}`)).status).toBe(204);

    const violations = await rejected(cs, OPS);
    expect(violations).toEqual([
      { seq: 1, kind: "not_visible", message: "The type of this write is no longer visible through lens 'ops'" },
    ]);
    expect(JSON.stringify(violations)).not.toContain("project");
    expect(await name("project", e.P2)).toBe("P2");
    expect(await committed(control, OPS)).toEqual({ committed: 1, alreadyGone: [] });
  });
});

describe("missing and dangling: ids the journal names (V6)", () => {
  beforeAll(fresh, 60_000);

  it("missing: an update target deleted since staging; control: a stored target commits", async () => {
    const cs = await start();
    await staged("PATCH", ALL, cs, `entities/person/${e.Kim}`, { name: "Kim B" });
    expect((await call("DELETE", `${ALL}/entities/person/${e.Kim}`)).status).toBe(204);
    expect(await rejected(cs)).toEqual([{ seq: 1, kind: "missing", message: `Entity '${e.Kim}' no longer exists` }]);

    const control = await start();
    await staged("PATCH", ALL, control, `entities/person/${e.Ana}`, { name: "Ana B" });
    await committed(control);
    expect(await name("person", e.Ana)).toBe("Ana B");
  });

  it("dangling: a task under a create since unstaged; control: kept, it commits", async () => {
    const cs = await start();
    const p5 = (await staged("POST", ALL, cs, "entities/project", underParent("P5", "has_project", e.ACME))).id as string;
    await staged("POST", ALL, cs, "entities/task", underParent("T9", "has_task", p5, { phase: "plan" }));
    expect((await call("DELETE", `${ALL}/changesets/${cs}/writes/1`)).status).toBe(204);
    expect(await rejected(cs)).toEqual([
      { seq: 2, kind: "dangling", message: `Entity '${p5}' is neither stored nor created by a write in this changeset` },
    ]);

    const control = await start();
    const p6 = (await staged("POST", ALL, control, "entities/project", underParent("P6", "has_project", e.ACME))).id as string;
    const t10 = (await staged("POST", ALL, control, "entities/task", underParent("T10", "has_task", p6, { phase: "plan" }))).id as string;
    await committed(control);
    expect(await name("task", t10)).toBe("T10");
  });
});

describe("drift (V10, V19)", () => {
  beforeAll(fresh, 60_000);

  it("a live change of a base key rejects; unstage and restage commits", async () => {
    const cs = await start();
    await staged("PATCH", ALL, cs, `entities/project/${e.P2}`, { name: "P2 Website" });
    expect((await call("PATCH", `${ALL}/entities/project/${e.P2}`, { name: "P2 Mobile" })).status).toBe(200);
    expect(await rejected(cs)).toEqual([
      { seq: 1, kind: "drift", message: `Entity '${e.P2}' changed since this write was staged; unstage and restage it` },
    ]);
    expect(await name("project", e.P2)).toBe("P2 Mobile");

    expect((await call("DELETE", `${ALL}/changesets/${cs}/writes/1`)).status).toBe(204);
    await staged("PATCH", ALL, cs, `entities/project/${e.P2}`, { name: "P2 Website" });
    await committed(cs);
    expect(await name("project", e.P2)).toBe("P2 Website");
  });

  it("control: a value changed and changed back is no drift; another key's change is none either", async () => {
    const cs = await start();
    await staged("PATCH", ALL, cs, `entities/project/${e.P1}`, { name: "P1 X" });
    await staged("PATCH", ALL, cs, `entities/task/${e.T1}`, { name: "T1 X" });
    expect((await call("PATCH", `${ALL}/entities/project/${e.P1}`, { name: "P1 Y" })).status).toBe(200);
    expect((await call("PATCH", `${ALL}/entities/project/${e.P1}`, { name: "P1" })).status).toBe(200);
    expect((await call("PATCH", `${ALL}/entities/task/${e.T1}`, { notes: "Changed notes" })).status).toBe(200);
    await committed(cs);
    expect(await name("project", e.P1)).toBe("P1 X");
  });

  it("a staged delete has no base: a live change of its target does not reject it", async () => {
    const cs = await start();
    await staged("DELETE", ALL, cs, `entities/task/${e.T2a}`);
    expect((await call("PATCH", `${ALL}/entities/task/${e.T2a}`, { name: "T2a renamed" })).status).toBe(200);
    await committed(cs);
    expect(await name("task", e.T2a)).toBeNull();
  });

  it("a change landing after the commit took its lock is waited for, then compared under the lock", async () => {
    const cs = await start();
    await staged("PATCH", ALL, cs, `entities/project/${e.P3}`, { name: "P3 Website" });
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
      { seq: 1, kind: "drift", message: `Entity '${e.P3}' changed since this write was staged; unstage and restage it` },
    ]);
    expect(await name("project", e.P3)).toBe("P3 Mobile");
    expect((await call("GET", `${ALL}/changesets/${cs}`)).status).toBe(200);
  });
});

describe("has_children and the order-free subtree delete (V20, V21)", () => {
  beforeAll(fresh, 60_000);

  it("deleting a parent while a child stays rejects, naming no child; deleting the children too commits", async () => {
    const cs = await start();
    await staged("DELETE", ALL, cs, `entities/project/${e.P2}`);
    const violations = await rejected(cs);
    expect(violations).toEqual([
      { seq: 1, kind: "has_children", message: `Entity '${e.P2}' still has children; delete or re-parent them in this changeset` },
    ]);
    expect(JSON.stringify(violations)).not.toMatch(new RegExp(`${e.T4}|${e.T5}|task`));

    await staged("DELETE", ALL, cs, `entities/task/${e.T4}`);
    await staged("DELETE", ALL, cs, `entities/task/${e.T5}`);
    expect(await committed(cs)).toEqual({ committed: 3, alreadyGone: [] });
    for (const [type, id] of [["project", e.P2], ["task", e.T4], ["task", e.T5]] as const) {
      expect(await name(type, id)).toBeNull();
    }
  });

  it("children first, and a child re-parented instead of deleted, both commit", async () => {
    const cs = await start();
    await staged("DELETE", ALL, cs, `entities/task/${e.T2a}`);
    await staged("DELETE", ALL, cs, `entities/task/${e.T2}`);
    await staged("POST", ALL, cs, "relations/has_task", { fromEntityId: e.P3, toEntityId: e.T3, phase: "test" });
    await staged("DELETE", ALL, cs, `entities/task/${e.T1a1}`);
    await staged("DELETE", ALL, cs, `entities/task/${e.T1a}`);
    await staged("DELETE", ALL, cs, `entities/milestone/${e.M1}`);
    await staged("DELETE", ALL, cs, `relations/has_task/${h.relations["P1 has_task T1"]}`);
    await staged("POST", ALL, cs, "relations/has_task", { fromEntityId: e.P3, toEntityId: e.T1, phase: "test" });
    await staged("DELETE", ALL, cs, `entities/project/${e.P1}`);
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
    await staged("POST", ALL, cs, "relations/has_task", { fromEntityId: e.P2, toEntityId: e.T1, phase: "x" });
    expect(await rejected(cs)).toEqual([
      { seq: 1, kind: "two_parents", message: `Entity '${e.T1}' already has a parent` },
    ]);
  });

  it("cycle: with the delete of P1 has_task T1 first, T1a has_subtask T1 is a cycle alone", async () => {
    const cs = await start();
    await staged("DELETE", ALL, cs, `relations/has_task/${h.relations["P1 has_task T1"]}`);
    await staged("POST", ALL, cs, "relations/has_subtask", { fromEntityId: e.T1a, toEntityId: e.T1 });
    expect(await rejected(cs)).toEqual([
      { seq: 2, kind: "cycle", message: `Entity '${e.T1a}' cannot be the parent: this would close a cycle` },
    ]);
  });

  it("control: a move that closes no cycle and leaves one parent commits", async () => {
    const cs = await start();
    await staged("DELETE", ALL, cs, `relations/has_task/${h.relations["P1 has_task T3"]}`);
    await staged("POST", ALL, cs, "relations/has_subtask", { fromEntityId: e.T1, toEntityId: e.T3 });
    await committed(cs);
    const path = await call("GET", `${ALL}/entities/task/${e.T3}/path`);
    expect((path.body as unknown as Row[]).map((step) => step.name)).toEqual(["ACME", "P1", "T1", "T3"]);
  });
});

describe("endpoint_type", () => {
  beforeAll(fresh, 60_000);

  it("has_task with a person as the child rejects, naming no type; control: the right types commit", async () => {
    const cs = await start();
    await staged("POST", ALL, cs, "relations/has_task", { fromEntityId: e.P1, toEntityId: e.Lea, phase: "x" });
    const violations = await rejected(cs);
    expect(violations).toEqual([
      { seq: 1, kind: "endpoint_type", message: `Target entity '${e.Lea}' does not have the type relation type 'has_task' requires` },
    ]);
    expect(JSON.stringify(violations)).not.toContain("person");
    expect(JSON.stringify(violations)).not.toContain("'task'");

    const control = await start();
    await staged("POST", ALL, control, "relations/assigned_to", { fromEntityId: e.T2, toEntityId: e.Kim });
    await committed(control);
  });
});

describe("anchor coverage (V8, V17, V21, V42)", () => {
  const A = `${ALL}/anchors/agent-a`;
  const B = `${ALL}/anchors/agent-b`;

  beforeAll(async () => {
    await fresh();
    await pointAnchor("agent-a", "project", e.P1);
    await pointAnchor("agent-b", "project", e.P3);
  }, 60_000);

  it("coverage: a task under P2 through agent-a rejects; control: under P1 commits", async () => {
    const cs = await start(A);
    const t = (await staged("POST", A, cs, "entities/task", underParent("T20", "has_task", e.P2, { phase: "plan" }))).id as string;
    expect(await rejected(cs, A)).toEqual([
      { seq: 1, kind: "not_covered", message: `Entity '${t}' would not be under anchor 'agent-a' after the commit` },
    ]);

    const control = await start(A);
    await staged("POST", A, control, "entities/task", underParent("T21", "has_task", e.P1, { phase: "plan" }));
    await staged("PATCH", A, control, `entities/person/${e.Ben}`, { name: "Ben A" });
    await committed(control, A);
  });

  it("before and after: moving a task out of the subtree, or into it, rejects; a move inside commits", async () => {
    const out = await start(A);
    await staged("DELETE", A, out, `relations/has_task/${h.relations["P1 has_task T3"]}`);
    await staged("POST", A, out, "relations/has_task", { fromEntityId: e.P2, toEntityId: e.T3, phase: "x" });
    expect((await rejected(out, A)).map((v) => [v.seq, v.kind])).toEqual([
      [1, "not_covered"],
      [2, "not_covered"],
    ]);

    const into = await start(A);
    await staged("DELETE", A, into, `relations/has_task/${h.relations["P2 has_task T4"]}`);
    await staged("POST", A, into, "relations/has_task", { fromEntityId: e.P1, toEntityId: e.T4, phase: "x" });
    expect(await rejected(into, A)).toEqual([
      { seq: 1, kind: "not_covered", message: `Relation '${h.relations["P2 has_task T4"]}' is not under anchor 'agent-a'` },
      { seq: 2, kind: "not_covered", message: expect.stringMatching(/^Relation '.+' is not under anchor 'agent-a'$/) },
    ]);

    const inside = await start(A);
    await staged("DELETE", A, inside, `relations/has_task/${h.relations["P1 has_task T3"]}`);
    await staged("POST", A, inside, "relations/has_subtask", { fromEntityId: e.T2, toEntityId: e.T3 });
    await committed(inside, A);
  });

  it("a re-point between staging and commit rejects; pointed back, it commits", async () => {
    const cs = await start(A);
    await staged("POST", A, cs, "entities/task", underParent("T22", "has_task", e.P1, { phase: "plan" }));
    await pointAnchor("agent-a", "project", e.P2);
    expect((await rejected(cs, A)).map((v) => v.kind)).toEqual(["not_covered"]);
    await pointAnchor("agent-a", "project", e.P1);
    await committed(cs, A);
  });

  it("anchor_dangling: the anchored entity deleted after staging", async () => {
    await pointAnchor("agent-c", "task", e.T2a);
    const C = `${ALL}/anchors/agent-c`;
    const cs = await start(C);
    await staged("PATCH", C, cs, `entities/person/${e.Kim}`, { name: "Kim C" });
    expect((await call("DELETE", `${ALL}/entities/task/${e.T2a}`)).status).toBe(204);
    const [violation] = await rejected(cs, C);
    expect(violation).toEqual({
      seq: 0,
      kind: "anchor_dangling",
      message: "Anchor 'agent-c' is dangling: its entity no longer exists, so every write is refused until a person re-anchors it",
    });
  });

  it("anchor_dangling: re-pointed at an entity the lens hides, named by neither type nor id", async () => {
    const PORTFOLIO = runtimePrefix(O, "portfolio");
    await pointAnchor("agent-d", "project", e.P3);
    const D = `${PORTFOLIO}/anchors/agent-d`;
    const cs = await start(D);
    await staged("PATCH", D, cs, `entities/project/${e.P3}`, { name: "P3 D" });
    await pointAnchor("agent-d", "task", e.T6);
    const violations = await rejected(cs, D);
    expect(violations).toEqual([
      {
        seq: 0,
        kind: "anchor_dangling",
        message: "Anchor 'agent-d' points at an entity that lens 'portfolio' does not show, so every write is refused",
      },
    ]);
    expect(JSON.stringify(violations)).not.toMatch(new RegExp(`task|${e.T6}`));
  });

  it("anchor_gone: the anchor deleted; its changeset, reached through the plain lens URL, rejects", async () => {
    const cs = await start(B);
    await staged("PATCH", B, cs, `entities/task/${e.T6}`, { name: "T6 B" });
    expect((await call("DELETE", `${ANCHORS}/agent-b`)).status).toBe(204);
    expect((await call("GET", `${B}/changesets/${cs}`)).status).toBe(404);
    expect(await rejected(cs)).toEqual([
      { seq: 0, kind: "anchor_gone", message: "Anchor 'agent-b' no longer exists, so this changeset cannot be committed" },
    ]);
  });
});

describe("the violations listed, and what they name", () => {
  beforeAll(fresh, 60_000);

  it("more than 100 faults list the first 100 by seq, and the total", async () => {
    const x = (await call("POST", `${ALL}/entities/person`, { name: "X" })).body._id as string;
    const cs = await start();
    for (let i = 0; i < 120; i++) {
      await staged("PATCH", ALL, cs, `entities/person/${x}`, { name: `X${i}` });
    }
    expect((await call("DELETE", `${ALL}/entities/person/${x}`)).status).toBe(204);
    const res = await commit(cs);
    expect(res.status).toBe(422);
    const { violations, total } = res.body.error.details as Row;
    expect(total).toBe(120);
    expect(violations).toHaveLength(100);
    expect(violations.map((v: Row) => v.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it("on a scoped lens, no message names a type, id or name the lens hides", async () => {
    // `no_projects` hides project: P1, T1's parent, is never named.
    const NP = runtimePrefix(O, "no_projects");
    const cs = await start(NP);
    await staged("POST", NP, cs, "relations/has_subtask", { fromEntityId: e.T2a, toEntityId: e.T1 });
    await staged("DELETE", NP, cs, `entities/task/${e.T1a}`);
    await staged("POST", NP, cs, "relations/has_subtask", { fromEntityId: e.T3, toEntityId: e.M1 });
    const violations = await rejected(cs, NP);
    expect(violations.map((v) => [v.seq, v.kind])).toEqual([
      [1, "two_parents"],
      [2, "has_children"],
      [3, "endpoint_type"],
    ]);
    expect(violations[0]!.message).toBe(`Entity '${e.T1}' already has a parent`);
    const text = JSON.stringify(violations);
    for (const hidden of ["project", "P1", e.P1, e.P2, e.T1a1, "milestone"]) {
      expect(text).not.toContain(hidden);
    }
  });
});
