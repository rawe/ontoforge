/**
 * Anchor maintenance through the lensless REST routes on PostgreSQL, over
 * the in-test hierarchy (`hierarchy.ts`): create and re-point with 200,
 * read, list and delete; the PUT's checks of its key and entity against
 * the full schema; the state decided on each read, dangling once the
 * entity or its type is gone; no anchors in the export; and the anchors
 * gone with their ontology. Then the anchored REST mirror
 * `…/lenses/{lens}/anchors/{anchorKey}`: its root through the lens in
 * every state, the runtime router below it, and not found in the order
 * ontology, lens, anchor on every route, reads included.
 */

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createOntology, modelPrefix, runtimePrefix } from "./fixture.js";
import { addLensHidingProject, buildHierarchy, HIERARCHY_ONTOLOGY_KEY, type HierarchyIds } from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

let app: FastifyInstance;
let ids: HierarchyIds;

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  ids = await buildHierarchy(app);
});

const anchors = (o = HIERARCHY_ONTOLOGY_KEY) => `/api/ontologies/${o}/runtime/anchors`;

function put(key: string, entity: { type: string; id: string } | null, o?: string) {
  return app.inject({ method: "PUT", url: `${anchors(o)}/${key}`, payload: { entity } });
}
function get(key: string, o?: string) {
  return app.inject({ method: "GET", url: `${anchors(o)}/${key}` });
}
async function list(o?: string): Promise<Row[]> {
  const res = await app.inject({ method: "GET", url: anchors(o) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

describe("maintenance", () => {
  it("PUT creates and re-points with 200, GET reads, the list lists, DELETE removes", async () => {
    const created = await put("agent-a", { type: "project", id: ids.P1 });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json()).toEqual({ key: "agent-a", entity: { type: "project", id: ids.P1 }, state: "anchored", stagedOnly: false });

    const repointed = await put("agent-a", { type: "project", id: ids.P2 });
    expect(repointed.statusCode, repointed.body).toBe(200);
    expect(repointed.json().entity).toEqual({ type: "project", id: ids.P2 });

    const read = await get("agent-a");
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ key: "agent-a", entity: { type: "project", id: ids.P2 }, state: "anchored", stagedOnly: false });

    expect((await put("agent-b", null)).statusCode).toBe(200);
    expect(await list()).toEqual([
      { key: "agent-a", entity: { type: "project", id: ids.P2 }, state: "anchored", stagedOnly: false },
      { key: "agent-b", entity: null, state: "unanchored", stagedOnly: false },
    ]);

    const deleted = await app.inject({ method: "DELETE", url: `${anchors()}/agent-a` });
    expect(deleted.statusCode).toBe(204);
    const gone = await get("agent-a");
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.message).toBe("Anchor 'agent-a' not found");
    expect((await app.inject({ method: "DELETE", url: `${anchors()}/agent-a` })).statusCode).toBe(404);
    expect((await list()).map((a) => a.key)).toEqual(["agent-b"]);
  });

  it("PUT null unanchors an anchored key", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const res = await put("agent-a", null);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: "agent-a", entity: null, state: "unanchored", stagedOnly: false });
    expect((await get("agent-a")).json().state).toBe("unanchored");
  });

  it("stagedOnly: stored by PUT, reported by GET and the list, kept by a PUT without it (V43)", async () => {
    const putBody = (key: string, payload: Row) => app.inject({ method: "PUT", url: `${anchors()}/${key}`, payload });
    const flagged = await putBody("agent-s", { entity: { type: "project", id: ids.P1 }, stagedOnly: true });
    expect(flagged.statusCode, flagged.body).toBe(200);
    expect(flagged.json()).toEqual({ key: "agent-s", entity: { type: "project", id: ids.P1 }, state: "anchored", stagedOnly: true });
    expect((await get("agent-s")).json().stagedOnly).toBe(true);
    // Re-pointed and unanchored without the field: the flag stays.
    expect((await put("agent-s", { type: "project", id: ids.P2 })).json().stagedOnly).toBe(true);
    expect((await put("agent-s", null)).json()).toEqual({ key: "agent-s", entity: null, state: "unanchored", stagedOnly: true });
    // A new anchor without the field is not staged-only.
    await put("agent-a", { type: "project", id: ids.P1 });
    expect(await list()).toEqual([
      { key: "agent-a", entity: { type: "project", id: ids.P1 }, state: "anchored", stagedOnly: false },
      { key: "agent-s", entity: null, state: "unanchored", stagedOnly: true },
    ]);
    // An unknown field and a non-boolean are refused, and nothing changes.
    for (const payload of [{ entity: null, stagedOnly: true, lens: "all" }, { entity: null, stagedOnly: "no" }]) {
      expect((await putBody("agent-s", payload)).statusCode).toBe(422);
    }
    expect((await get("agent-s")).json().stagedOnly).toBe(true);
    // Lifted with false.
    expect((await putBody("agent-s", { entity: null, stagedOnly: false })).json().stagedOnly).toBe(false);
    expect((await get("agent-s")).json().stagedOnly).toBe(false);
  });

  it("an entity that is not stored is a 422 field error, and nothing is written", async () => {
    for (const [entity, field] of [
      [{ type: "project", id: randomUUID() }, "entity.id"],
      [{ type: "project", id: "not-a-uuid" }, "entity.id"],
      [{ type: "project", id: ids.T1 }, "entity.id"], // a task's id under project
      [{ type: "robot", id: ids.P1 }, "entity.type"],
    ] as const) {
      const res = await put("agent-a", entity);
      expect(res.statusCode, res.body).toBe(422);
      expect(Object.keys(res.json().error.details.fields)).toEqual([field]);
    }
    expect((await get("agent-a")).statusCode).toBe(404);
  });

  it("keys follow the lens-resource rule, at most 64 characters", async () => {
    for (const key of ["agent-a", "a".repeat(64)]) {
      expect((await put(key, null)).statusCode, key).toBe(200);
    }
    for (const key of ["Agent-A", "agent%20a", "1agent", "a".repeat(65)]) {
      const res = await put(key, null);
      expect(res.statusCode, key).toBe(422);
    }
    expect((await list()).length).toBe(2);
  });

  it("an unknown ontology is not found on every route", async () => {
    for (const res of [
      await app.inject({ method: "GET", url: anchors("nope") }),
      await get("agent-a", "nope"),
      await put("agent-a", null, "nope"),
      await app.inject({ method: "DELETE", url: `${anchors("nope")}/agent-a` }),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toBe("Ontology 'nope' not found");
    }
  });
});

describe("dangling", () => {
  it("deleting the anchored entity makes the anchor dangling, never unanchored", async () => {
    await put("agent-a", { type: "task", id: ids.T1a });
    const res = await app.inject({
      method: "DELETE",
      url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task/${ids.T1a}`,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await get("agent-a")).json()).toEqual({
      key: "agent-a",
      entity: { type: "task", id: ids.T1a },
      state: "dangling",
      stagedOnly: false,
    });
    expect((await list())[0]!.state).toBe("dangling");
    // Re-pointing it heals it.
    expect((await put("agent-a", { type: "project", id: ids.P1 })).json().state).toBe("anchored");
  });

  it("deleting the entity's type makes it dangling while the instance stays", async () => {
    const o = "anchor_scratch";
    const model = modelPrefix(o);
    await createOntology(app, o);
    await app.inject({ method: "POST", url: `${model}/lenses`, payload: { key: "all", name: "All" } });
    const type = await app.inject({
      method: "POST",
      url: `${model}/entity-types`,
      payload: { key: "thing", displayName: "Thing" },
    });
    const entity = await app.inject({
      method: "POST",
      url: `${runtimePrefix(o, "all")}/entities/thing`,
      payload: { name: "One" },
    });
    expect(entity.statusCode, entity.body).toBe(201);
    const id = entity.json()._id as string;
    expect((await put("agent-a", { type: "thing", id }, o)).json().state).toBe("anchored");

    const deleted = await app.inject({
      method: "DELETE",
      url: `${model}/entity-types/${type.json().entityTypeId as string}?cascade=true`,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect((await get("agent-a", o)).json()).toEqual({ key: "agent-a", entity: { type: "thing", id }, state: "dangling", stagedOnly: false });
  });
});

describe("lifecycle", () => {
  it("the export carries no anchors", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const res = await app.inject({ method: "GET", url: `${modelPrefix(HIERARCHY_ONTOLOGY_KEY)}/export` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("anchors");
    expect(res.body).not.toContain("agent-a");
  });

  it("deleting the ontology removes its anchors", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    expect((await app.inject({ method: "DELETE", url: `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}` })).statusCode).toBe(204);
    await createOntology(app, HIERARCHY_ONTOLOGY_KEY);
    expect(await list()).toEqual([]);
  });
});

describe("the anchored REST mirror", () => {
  const mirror = (lens: string, key: string, o = HIERARCHY_ONTOLOGY_KEY) =>
    `${runtimePrefix(o, lens)}/anchors/${key}`;
  const root = (lens: string, key: string) => app.inject({ method: "GET", url: mirror(lens, key) });

  it("its root gives the anchor through the lens: entity with name, and the path ending with it", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const res = await root("all", "agent-a");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      key: "agent-a",
      state: "anchored",
      stagedOnly: false,
      visible: true,
      entity: { type: "project", id: ids.P1, name: "P1" },
      path: [
        { type: "customer", id: ids.ACME, name: "ACME" },
        { type: "project", id: ids.P1, name: "P1" },
      ],
    });
  });

  it("the path starts below the nearest hidden ancestor", async () => {
    await addLensHidingProject(app);
    await put("agent-a", { type: "task", id: ids.T1a });
    expect((await root("delivery", "agent-a")).json()).toEqual({
      key: "agent-a",
      state: "anchored",
      stagedOnly: false,
      visible: true,
      entity: { type: "task", id: ids.T1a, name: "T1a" },
      path: [
        { type: "task", id: ids.T1, name: "T1" },
        { type: "task", id: ids.T1a, name: "T1a" },
      ],
    });
  });

  it("a lens hiding the anchored entity: not visible, no entity, no path", async () => {
    await put("agent-a", { type: "task", id: ids.T1 });
    const res = await root("portfolio", "agent-a");
    expect(res.json()).toEqual({ key: "agent-a", state: "anchored", stagedOnly: false, visible: false, entity: null, path: [] });
    expect(res.body).not.toContain(ids.T1);
  });

  it("unanchored and dangling: visible, no entity, no path", async () => {
    await put("agent-u", null);
    expect((await root("all", "agent-u")).json()).toEqual({
      key: "agent-u", state: "unanchored", stagedOnly: false, visible: true, entity: null, path: [],
    });
    await put("agent-d", { type: "task", id: ids.T1a });
    await app.inject({ method: "DELETE", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task/${ids.T1a}` });
    expect((await root("all", "agent-d")).json()).toEqual({
      key: "agent-d", state: "dangling", stagedOnly: false, visible: true, entity: null, path: [],
    });
  });

  it("carries the runtime router: reads, the path read and writes", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const base = mirror("all", "agent-a");
    const listed = await app.inject({ method: "GET", url: `${base}/entities/task` });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().total).toBe(3);
    const path = await app.inject({ method: "GET", url: `${base}/entities/task/${ids.T1}/path` });
    expect(path.json().map((step: Row) => step.name)).toEqual(["ACME", "P1", "T1"]);
    const created = await app.inject({
      method: "POST",
      url: `${base}/entities/task`,
      payload: { name: "T9", parentRelation: { type: "has_task", parentId: ids.P1 } },
    });
    expect(created.statusCode, created.body).toBe(201);
  });

  it("carries the runtime router only", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const plain = await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/ai/assistants/agents` });
    expect(plain.statusCode, plain.body).toBe(200);
    const res = await app.inject({ method: "GET", url: `${mirror("all", "agent-a")}/ai/assistants/agents` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("Not Found");
  });

  it("not found in the order ontology, lens, anchor, on every route, reads included", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const routes = [
      ["GET", ""],
      ["GET", "/schema"],
      ["GET", "/entities/task"],
      ["GET", `/entities/task/${ids.T1}`],
      ["GET", `/entities/task/${ids.T1}/path`],
      ["POST", "/entities/task", { name: "X" }],
      ["PATCH", `/entities/task/${ids.T1}`, { name: "X" }],
      ["DELETE", `/entities/task/${ids.T2}`],
      ["POST", "/relations/assigned_to", { fromEntityId: ids.T2, toEntityId: ids.Ben }],
    ] as const;
    for (const [o, lens, key, message] of [
      ["nope", "nope", "nope", "Ontology 'nope' not found"],
      [HIERARCHY_ONTOLOGY_KEY, "nope", "nope", "Lens 'nope' not found"],
      [HIERARCHY_ONTOLOGY_KEY, "all", "nope", "Anchor 'nope' not found"],
    ] as const) {
      for (const [method, path, payload] of routes) {
        const res = await app.inject({ method, url: `${mirror(lens, key, o)}${path}`, payload });
        expect(res.statusCode, `${method} ${path} ${res.body}`).toBe(404);
        expect(res.json().error.message, `${method} ${path}`).toContain(message);
      }
    }
    // Nothing written, no anchor created.
    expect((await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task/${ids.T2}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task` })).json().total).toBe(3);
    expect((await list()).map((a) => a.key)).toEqual(["agent-a"]);
  });

  it("the plain lens URLs are unchanged", async () => {
    const res = await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task` });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/anchors` })).statusCode).toBe(404);
  });
});
