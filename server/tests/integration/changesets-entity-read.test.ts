/**
 * The staged entity read over REST, on the in-test project hierarchy
 * (`buildProjectHierarchy`: task carries the document `notes`): one entity
 * as a commit of the changeset would leave it, stored or created by it,
 * with its own staged writes as the review shows them and their markers;
 * a staged delete; not found as the other changeset reads; the anchored
 * mirror. The entity read itself still answers the stored data alone.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import { runtimePrefix } from "./fixture.js";
import {
  buildProjectHierarchy,
  PROJECT_HIERARCHY_ONTOLOGY_KEY as O,
  type ProjectHierarchyIds,
} from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const ALL = runtimePrefix(O, "all");
const RULESETS = `/api/ontologies/${O}/runtime/rulesets`;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

let app: FastifyInstance;
let e: ProjectHierarchyIds["entities"];

async function rest(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function start(base = ALL): Promise<string> {
  const res = await rest("POST", `${base}/changesets`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function staged(base: string, cs: string, write: Row): Promise<Row> {
  const res = await rest("POST", `${base}/changesets/${cs}/writes`, write);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

function entityRead(cs: string, type: string, id: string, base = ALL): Promise<{ status: number; body: Row }> {
  return rest("GET", `${base}/changesets/${cs}/entities/${type}/${id}`);
}

beforeAll(async () => {
  await initStores();
  app = await createApp();
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  e = (await buildProjectHierarchy(app)).entities;
}, 60_000);

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("one entity as the changeset leaves it", () => {
  let cs: string;
  let created: Row;

  beforeAll(async () => {
    cs = await start();
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: e.T1, properties: { name: "T1 b", notes: "New plan" } });
    created = await staged(ALL, cs, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9", notes: "Draft" },
      parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "plan" } },
    });
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: created.id, properties: { name: "T9 b", notes: null } });
    await staged(ALL, cs, { operation: "delete_entity", type: "task", id: e.T2 });
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: e.T3, properties: { name: "T3 b" } });
  });

  it("a stored entity with its update folded in, the document a stub; its write as the review shows it", async () => {
    const res = await entityRead(cs, "task", e.T1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deleted).toBe(false);
    expect(res.body.entity).toMatchObject({ _id: e.T1, _entityTypeKey: "task", name: "T1 b", notes: { document: true, length: 8 } });
    expect(res.body.writes).toHaveLength(1);
    expect(res.body.writes[0]).toMatchObject({
      seq: 1,
      operation: "update_entity",
      type: "task",
      id: e.T1,
      name: "T1",
      before: { name: "T1", notes: { document: true, length: 11 } },
      current: { name: "T1", notes: { document: true, length: 11 } },
      after: { name: "T1 b", notes: { document: true, length: 8 } },
      markers: [],
    });
    expect(JSON.stringify(res.body)).not.toContain("New plan");
    // The entity read itself answers the stored data alone.
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}`)).body.name).toBe("T1");
  });

  it("an entity this changeset creates: its create and update folded, a null removing a key; its parent relation is no write of it", async () => {
    const res = await entityRead(cs, "task", created.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ deleted: false, entity: { _id: created.id, _entityTypeKey: "task", name: "T9 b" } });
    expect(res.body.entity).not.toHaveProperty("notes");
    expect(res.body.writes.map((w: Row) => [w.seq, w.operation])).toEqual([
      [created.seq, "create_entity"],
      [created.seq + 2, "update_entity"],
    ]);
    expect(res.body.writes[1]).toMatchObject({ name: "T9", before: null, current: null, after: { name: "T9 b", notes: null } });
    // Not stored: the entity read does not see it.
    expect((await rest("GET", `${ALL}/entities/task/${created.id}`)).status).toBe(404);
  });

  it("a staged delete: deleted, with the stored values", async () => {
    const res = await entityRead(cs, "task", e.T2);
    expect(res.body).toMatchObject({ deleted: true, entity: { _id: e.T2, name: "T2" } });
    expect(res.body.writes).toEqual([expect.objectContaining({ operation: "delete_entity", id: e.T2, name: "T2", markers: [] })]);
  });

  it("a stored entity no write of it names: as stored, with no writes", async () => {
    const res = await entityRead(cs, "project", e.P1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ deleted: false, entity: { _id: e.P1, name: "P1" }, writes: [] });
  });

  it("drift since staging is a marker, current showing the stored value now", async () => {
    expect((await rest("PATCH", `${ALL}/entities/task/${e.T3}`, { name: "T3 live" })).status).toBe(200);
    const res = await entityRead(cs, "task", e.T3);
    expect(res.body.entity.name).toBe("T3 b");
    expect(res.body.writes[0]).toMatchObject({ before: { name: "T3" }, current: { name: "T3 live" }, after: { name: "T3 b" } });
    expect(res.body.writes[0].markers).toEqual([{ kind: "drift", message: "Changed since this write was staged" }]);
  });

  it("not found: neither stored nor created by this changeset, another type, a hidden type, another lens, a gone changeset", async () => {
    for (const [type, id] of [
      ["task", UNKNOWN],
      ["task", "not-a-uuid"],
      ["project", e.T1],
    ] as const) {
      const res = await entityRead(cs, type, id);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe(`Entity '${id}' not found`);
    }
    expect((await entityRead(cs, "nope", e.T1)).body.error.message).toBe("Entity type 'nope' not found");

    const NO_PROJECTS = runtimePrefix(O, "no_projects");
    const hidden = await start(NO_PROJECTS);
    const res = await entityRead(hidden, "project", e.P1, NO_PROJECTS);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("Entity type 'project' not found");
    expect((await entityRead(cs, "task", e.T1, NO_PROJECTS)).body.error.message).toBe(`Changeset '${cs}' not found`);

    const discarded = await start();
    expect((await rest("DELETE", `${ALL}/changesets/${discarded}`)).status).toBe(204);
    expect((await entityRead(discarded, "task", e.T1)).body.error.message).toBe(`Changeset '${discarded}' not found`);
  });
});

describe("the anchored mirror", () => {
  it("an anchored changeset is read through its anchor and the plain lens URL, not another anchor", async () => {
    expect((await rest("PUT", `${RULESETS}/agent-a`, { anchor: { type: "project", id: e.P1 } })).status).toBe(200);
    expect((await rest("PUT", `${RULESETS}/agent-b`, { anchor: { type: "project", id: e.P3 } })).status).toBe(200);
    const A = `${ALL}/rulesets/agent-a`;
    const cs = await start(A);
    await staged(A, cs, { operation: "update_entity", type: "task", id: e.T5, properties: { name: "T5 b" } });

    const anchored = await entityRead(cs, "task", e.T5, A);
    expect(anchored.status, JSON.stringify(anchored.body)).toBe(200);
    expect(anchored.body.entity.name).toBe("T5 b");
    expect((await entityRead(cs, "task", e.T5)).body).toEqual(anchored.body);
    const other = await entityRead(cs, "task", e.T5, `${ALL}/rulesets/agent-b`);
    expect(other.status).toBe(404);
    expect(other.body.error.message).toBe(`Changeset '${cs}' not found`);
  });
});
