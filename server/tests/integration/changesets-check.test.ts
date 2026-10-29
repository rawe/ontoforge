/**
 * The check over REST, on the in-test project hierarchy
 * (`buildProjectHierarchy`): it answers what the commit would, passed or
 * rejected, graph faults the lock-free pass cannot see included, in draft
 * and submitted, and persists nothing: the graph, the search queue and the
 * changeset (version, last change, state, staged objects) stay as they
 * were. It counts as a running commit.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runQuery } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { closeStores, getRuntimeStore, initStores, type RuntimeStore } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import { runtimePrefix } from "./fixture.js";
import {
  buildProjectHierarchy,
  PROJECT_HIERARCHY_ONTOLOGY_KEY as O,
  type ProjectHierarchyIds,
} from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const NS = `ont_${O}`;
const ALL = runtimePrefix(O, "all");

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

async function start(): Promise<string> {
  const res = await call("POST", `${ALL}/changesets`);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function staged(cs: string, write: Row): Promise<Row> {
  const res = await call("POST", `${ALL}/changesets/${cs}/writes`, write);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

function check(cs: string): Promise<{ status: number; body: Row }> {
  return call("POST", `${ALL}/changesets/${cs}/check`);
}

function commit(cs: string): Promise<{ status: number; body: Row }> {
  return call("POST", `${ALL}/changesets/${cs}/commit`, {});
}

/** The graph and the search queue, as stored. */
async function graph(): Promise<Row> {
  return (
    await sql(`SELECT (SELECT count(*) FROM entity)::int AS entities,
                      (SELECT count(*) FROM relation)::int AS relations,
                      (SELECT md5(string_agg(id::text || props::text, ',' ORDER BY id)) FROM entity) AS props,
                      (SELECT count(*) FROM search_queue)::int AS queued`)
  )[0]!;
}

/** The changeset row and its staged objects and values, as stored. */
async function changesetRow(cs: string): Promise<Row> {
  const [row] = await sql(
    `SELECT version, note, submitted_at, last_change_at,
            (SELECT md5(string_agg(object_id::text || action || first_touched_at::text, ',' ORDER BY object_id))
               FROM changeset_object WHERE changeset_id = $1) AS objects,
            (SELECT md5(string_agg(object_id::text || property_key || value::text || coalesce(before::text, ''), ','
                                   ORDER BY object_id, property_key))
               FROM changeset_value WHERE changeset_id = $1) AS "values"
       FROM changeset WHERE changeset_id = $1`,
    [cs],
  );
  return row!;
}

/** Check, expecting nothing to change; the answer. */
async function checkedUnchanged(cs: string): Promise<{ status: number; body: Row }> {
  await sql(`DELETE FROM search_queue`);
  const before = { graph: await graph(), changeset: await changesetRow(cs) };
  const res = await check(cs);
  expect({ graph: await graph(), changeset: await changesetRow(cs) }).toEqual(before);
  expect(before.graph.queued).toBe(0);
  return res;
}

/** A transaction on its own connection that runs `during`, then holds
 * its locks until the returned function is called. */
async function hold(during: (bound: RuntimeStore) => Promise<unknown>): Promise<() => Promise<void>> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const held = new Promise<void>((resolve) => (ready = resolve));
  const done = store.transaction(await store.designRevision(), async (bound) => {
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
  invalidateSearchContext();
  app = await createApp();
  await app.ready();
  h = await buildProjectHierarchy(app);
  e = h.entities;
  store = await getRuntimeStore(O);
}, 60_000);

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("a check that passes", () => {
  it("answers the version and what the commit then answers; nothing is persisted, the changeset untouched", async () => {
    const cs = await start();
    await staged(cs, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9" },
      parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "build" } },
    });
    await staged(cs, { operation: "update_entity", type: "project", id: e.P2, properties: { name: "P2 Website" } });
    await staged(cs, { operation: "update_entity", type: "task", id: e.T5, properties: { notes: "A whole new text" } });
    await staged(cs, { operation: "delete_relation", type: "mentors", id: h.relations["Ben mentors Kim"] });
    const { version } = (await changesetRow(cs)) as { version: number };

    const res = await checkedUnchanged(cs);
    expect(res).toEqual({ status: 200, body: { version, committed: 5, alreadyGone: [] } });
    expect((await call("GET", `${ALL}/entities/project/${e.P2}`)).body.name).toBe("P2");
    expect((await call("GET", `${ALL}/changesets/${cs}`)).body).toMatchObject({ state: "draft", version });

    // Checked twice, the same; then the commit answers it.
    expect(await check(cs)).toEqual(res);
    expect(await commit(cs)).toEqual({ status: 200, body: { committed: 5, alreadyGone: [] } });
    expect((await call("GET", `${ALL}/entities/project/${e.P2}`)).body.name).toBe("P2 Website");
  });

  it("a submitted changeset checks and stays submitted", async () => {
    const cs = await start();
    await staged(cs, { operation: "update_entity", type: "person", id: e.Lea, properties: { name: "Lea M" } });
    expect((await call("POST", `${ALL}/changesets/${cs}/submit`, {})).status).toBe(200);
    const { version } = (await changesetRow(cs)) as { version: number };
    expect(await checkedUnchanged(cs)).toEqual({ status: 200, body: { version, committed: 1, alreadyGone: [] } });
    expect((await call("GET", `${ALL}/changesets/${cs}`)).body.state).toBe("submitted");
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(409);
    expect((await call("POST", `${ALL}/changesets/${cs}/unsubmit`, { note: "done" })).status).toBe(200);
    expect((await call("DELETE", `${ALL}/changesets/${cs}`)).status).toBe(204);
  });
});

describe("a check that fails is the commit's rejection with the version", () => {
  /** Check, then commit: the same violations; the check's 422 names the
   * version, and only the commit refreshes the last change. */
  async function failsAsCommit(cs: string): Promise<Row[]> {
    const { version } = (await changesetRow(cs)) as { version: number };
    const checked = await checkedUnchanged(cs);
    expect(checked.status, JSON.stringify(checked.body)).toBe(422);
    expect(checked.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: `Checked version ${version}: the commit would be rejected`,
      details: { version },
    });
    const committed = await commit(cs);
    expect(committed.status).toBe(422);
    const { version: _version, ...details } = checked.body.error.details as Row;
    expect(committed.body.error.details).toEqual(details);
    return details.violations as Row[];
  }

  it("has_children, which the lock-free pass cannot see: submit takes it, the check rejects it as the commit does", async () => {
    const cs = await start();
    await staged(cs, { operation: "delete_entity", type: "project", id: e.P2 });
    const submitted = await call("POST", `${ALL}/changesets/${cs}/submit`, {});
    expect(submitted.body.state, JSON.stringify(submitted.body)).toBe("submitted");
    expect(await failsAsCommit(cs)).toEqual([{ object: e.P2, kind: "has_children", message: "Still has children" }]);
    expect((await call("GET", `${ALL}/changesets/${cs}`)).body.state).toBe("submitted");
  });

  it("two_parents in a draft", async () => {
    const cs = await start();
    const second = await staged(cs, {
      operation: "create_relation",
      type: "has_task",
      fromEntityId: e.P2,
      toEntityId: e.T1,
      properties: { phase: "x" },
    });
    expect(await failsAsCommit(cs)).toEqual([
      { object: second.id, kind: "two_parents", message: "The target end already has a parent" },
    ]);
  });

  it("drift, found before any lock", async () => {
    const cs = await start();
    await staged(cs, { operation: "update_entity", type: "task", id: e.T2, properties: { name: "T2 staged" } });
    expect((await call("PATCH", `${ALL}/entities/task/${e.T2}`, { name: "T2 live" })).status).toBe(200);
    expect(await failsAsCommit(cs)).toEqual([
      { object: e.T2, property: "name", kind: "drift", message: "Changed since it was staged" },
    ]);
  });
});

describe("refusals", () => {
  it("an unknown changeset is 404", async () => {
    expect((await check("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("another commit holding the ontology's commit lock is 409; the check then runs", async () => {
    const cs = await start();
    await staged(cs, { operation: "update_entity", type: "person", id: e.Kim, properties: { name: "Kim K" } });
    const other = await start();
    const release = await hold((bound) => bound.changesets().lockForCommit(other));
    try {
      const res = await check(cs);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
    } finally {
      await release();
    }
    expect(await check(cs)).toMatchObject({ status: 200, body: { committed: 1 } });
  });
});
