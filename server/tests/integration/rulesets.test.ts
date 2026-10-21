/**
 * Ruleset maintenance through the lensless REST routes on PostgreSQL, over
 * the in-test hierarchy (`hierarchy.ts`): create and change with 200,
 * read, list and delete; the PUT as a patch of its rules; its checks of
 * the key, the level and the anchor against the full schema; the anchor's
 * state decided on each read, deleted once the entity or its type is gone;
 * no rulesets in the export; and the rulesets gone with their ontology.
 * Then the ruleset REST mirror `…/lenses/{lens}/rulesets/{rulesetKey}`:
 * its root through the lens in every state, the runtime router below it,
 * and not found in the order ontology, lens, ruleset on every route,
 * reads included.
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

const rulesets = (o = HIERARCHY_ONTOLOGY_KEY) => `/api/ontologies/${o}/runtime/rulesets`;

function put(key: string, anchor: { type: string; id: string } | null, o?: string) {
  return app.inject({ method: "PUT", url: `${rulesets(o)}/${key}`, payload: { anchor } });
}
function putBody(key: string, payload: Row) {
  return app.inject({ method: "PUT", url: `${rulesets()}/${key}`, payload });
}
/** The maintenance answer of a ruleset. */
function ruleset(key: string, anchor: Row | null, writeAccess = "full"): Row {
  return { key, anchor, writeAccess };
}
function get(key: string, o?: string) {
  return app.inject({ method: "GET", url: `${rulesets(o)}/${key}` });
}
async function list(o?: string): Promise<Row[]> {
  const res = await app.inject({ method: "GET", url: rulesets(o) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

describe("maintenance", () => {
  it("PUT creates and re-points with 200, GET reads, the list lists, DELETE removes", async () => {
    const created = await put("agent-a", { type: "project", id: ids.P1 });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json()).toEqual(ruleset("agent-a", { type: "project", id: ids.P1, state: "found" }));

    const repointed = await put("agent-a", { type: "project", id: ids.P2 });
    expect(repointed.statusCode, repointed.body).toBe(200);
    expect(repointed.json().anchor).toEqual({ type: "project", id: ids.P2, state: "found" });

    const read = await get("agent-a");
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(ruleset("agent-a", { type: "project", id: ids.P2, state: "found" }));

    expect((await put("agent-b", null)).statusCode).toBe(200);
    expect(await list()).toEqual([
      ruleset("agent-a", { type: "project", id: ids.P2, state: "found" }),
      ruleset("agent-b", null),
    ]);

    const deleted = await app.inject({ method: "DELETE", url: `${rulesets()}/agent-a` });
    expect(deleted.statusCode).toBe(204);
    const gone = await get("agent-a");
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.message).toBe("Anchor 'agent-a' not found");
    expect((await app.inject({ method: "DELETE", url: `${rulesets()}/agent-a` })).statusCode).toBe(404);
    expect((await list()).map((a) => a.key)).toEqual(["agent-b"]);
  });

  it("PUT anchor null removes the anchor", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const res = await put("agent-a", null);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(ruleset("agent-a", null));
    expect((await get("agent-a")).json().anchor).toBeNull();
  });

  it("PUT is a patch: a rule left out keeps its value, {} creates an empty ruleset", async () => {
    const empty = await putBody("agent-e", {});
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toEqual(ruleset("agent-e", null));
    const P1 = { type: "project", id: ids.P1, state: "found" };
    // Write access alone keeps the anchor, at each level.
    await put("agent-s", { type: "project", id: ids.P1 });
    for (const level of ["none", "propose", "full", "propose"]) {
      const res = await putBody("agent-s", { writeAccess: level });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual(ruleset("agent-s", P1, level));
    }
    expect((await get("agent-s")).json()).toEqual(ruleset("agent-s", P1, "propose"));
    // The anchor alone keeps write access: re-pointed, then removed.
    expect((await put("agent-s", { type: "project", id: ids.P2 })).json()).toEqual(
      ruleset("agent-s", { type: "project", id: ids.P2, state: "found" }, "propose"),
    );
    expect((await put("agent-s", null)).json()).toEqual(ruleset("agent-s", null, "propose"));
    // {} keeps both; both together set both.
    expect((await putBody("agent-s", {})).json()).toEqual(ruleset("agent-s", null, "propose"));
    expect(
      (await putBody("agent-s", { anchor: { type: "project", id: ids.P1 }, writeAccess: "none" })).json(),
    ).toEqual(ruleset("agent-s", P1, "none"));
    // A new ruleset sent only an anchor gets write access full.
    await put("agent-a", { type: "project", id: ids.P1 });
    expect(await list()).toEqual([
      ruleset("agent-a", P1),
      ruleset("agent-e", null),
      ruleset("agent-s", P1, "none"),
    ]);
  });

  it("an unknown level, an extra or an old field is refused, and nothing changes", async () => {
    await putBody("agent-s", { writeAccess: "propose" });
    const unknown = await putBody("agent-s", { writeAccess: "read" });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error.details.fields).toEqual({
      writeAccess: "Must be one of none, propose, full, got 'read'",
    });
    for (const payload of [
      { writeAccess: "full", lens: "all" },
      { writeAccess: true },
      { entity: null },
      { stagedOnly: false },
    ]) {
      expect((await putBody("agent-s", payload)).statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect((await get("agent-s")).json()).toEqual(ruleset("agent-s", null, "propose"));
    expect((await putBody("agent-n", { writeAccess: "all" })).statusCode).toBe(422);
    expect((await get("agent-n")).statusCode).toBe(404);
  });

  it("an anchor that is not stored is a 422 field error, and nothing is written", async () => {
    for (const [anchor, field] of [
      [{ type: "project", id: randomUUID() }, "anchor.id"],
      [{ type: "project", id: "not-a-uuid" }, "anchor.id"],
      [{ type: "project", id: ids.T1 }, "anchor.id"], // a task's id under project
      [{ type: "robot", id: ids.P1 }, "anchor.type"],
    ] as const) {
      const res = await put("agent-a", anchor);
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
      await app.inject({ method: "GET", url: rulesets("nope") }),
      await get("agent-a", "nope"),
      await put("agent-a", null, "nope"),
      await app.inject({ method: "DELETE", url: `${rulesets("nope")}/agent-a` }),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toBe("Ontology 'nope' not found");
    }
  });
});

describe("deleted", () => {
  it("deleting the anchor entity makes the anchor deleted, never null", async () => {
    await put("agent-a", { type: "task", id: ids.T1a });
    const res = await app.inject({
      method: "DELETE",
      url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task/${ids.T1a}`,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await get("agent-a")).json()).toEqual(ruleset("agent-a", { type: "task", id: ids.T1a, state: "deleted" }));
    expect((await list())[0]!.anchor.state).toBe("deleted");
    // Re-pointing it heals it.
    expect((await put("agent-a", { type: "project", id: ids.P1 })).json().anchor.state).toBe("found");
  });

  it("deleting the entity's type makes it deleted while the instance stays", async () => {
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
    expect((await put("agent-a", { type: "thing", id }, o)).json().anchor.state).toBe("found");

    const deleted = await app.inject({
      method: "DELETE",
      url: `${model}/entity-types/${type.json().entityTypeId as string}?cascade=true`,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect((await get("agent-a", o)).json()).toEqual(ruleset("agent-a", { type: "thing", id, state: "deleted" }));
  });
});

describe("lifecycle", () => {
  it("the export carries no rulesets", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const res = await app.inject({ method: "GET", url: `${modelPrefix(HIERARCHY_ONTOLOGY_KEY)}/export` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("rulesets");
    expect(res.body).not.toContain("agent-a");
  });

  it("deleting the ontology removes its rulesets", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    expect((await app.inject({ method: "DELETE", url: `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}` })).statusCode).toBe(204);
    await createOntology(app, HIERARCHY_ONTOLOGY_KEY);
    expect(await list()).toEqual([]);
  });
});

describe("the ruleset REST mirror", () => {
  const mirror = (lens: string, key: string, o = HIERARCHY_ONTOLOGY_KEY) =>
    `${runtimePrefix(o, lens)}/rulesets/${key}`;
  const root = (lens: string, key: string) => app.inject({ method: "GET", url: mirror(lens, key) });

  it("its root gives the ruleset through the lens: the anchor with its name, and the path ending with it", async () => {
    await putBody("agent-a", { anchor: { type: "project", id: ids.P1 }, writeAccess: "propose" });
    const res = await root("all", "agent-a");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      key: "agent-a",
      writeAccess: "propose",
      anchor: {
        type: "project",
        id: ids.P1,
        name: "P1",
        state: "found",
        visible: true,
        path: [
          { type: "customer", id: ids.ACME, name: "ACME" },
          { type: "project", id: ids.P1, name: "P1" },
        ],
      },
    });
  });

  it("the path starts below the nearest hidden ancestor", async () => {
    await addLensHidingProject(app);
    await put("agent-a", { type: "task", id: ids.T1a });
    expect((await root("delivery", "agent-a")).json()).toEqual({
      key: "agent-a",
      writeAccess: "full",
      anchor: {
        type: "task",
        id: ids.T1a,
        name: "T1a",
        state: "found",
        visible: true,
        path: [
          { type: "task", id: ids.T1, name: "T1" },
          { type: "task", id: ids.T1a, name: "T1a" },
        ],
      },
    });
  });

  it("a lens hiding the anchor entity: found, not visible, no entity, no path", async () => {
    await put("agent-a", { type: "task", id: ids.T1 });
    const res = await root("portfolio", "agent-a");
    expect(res.json()).toEqual({
      key: "agent-a",
      writeAccess: "full",
      anchor: { type: null, id: null, name: null, state: "found", visible: false, path: [] },
    });
    expect(res.body).not.toContain(ids.T1);
  });

  it("no anchor: null; deleted: visible, no entity, no path", async () => {
    await put("agent-u", null);
    expect((await root("all", "agent-u")).json()).toEqual({ key: "agent-u", writeAccess: "full", anchor: null });
    await put("agent-d", { type: "task", id: ids.T1a });
    await app.inject({ method: "DELETE", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task/${ids.T1a}` });
    expect((await root("all", "agent-d")).json()).toEqual({
      key: "agent-d",
      writeAccess: "full",
      anchor: { type: null, id: null, name: null, state: "deleted", visible: true, path: [] },
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

  it("not found in the order ontology, lens, ruleset, on every route, reads included", async () => {
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
    // Nothing written, no ruleset created.
    expect((await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task/${ids.T2}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task` })).json().total).toBe(3);
    expect((await list()).map((a) => a.key)).toEqual(["agent-a"]);
  });

  it("the plain lens URLs are unchanged, and no /anchors route is registered", async () => {
    await put("agent-a", { type: "project", id: ids.P1 });
    const res = await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/entities/task` });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/rulesets` })).statusCode).toBe(404);
    for (const url of [
      `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}/runtime/anchors`,
      `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}/runtime/anchors/agent-a`,
      `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/anchors/agent-a`,
      `${runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all")}/anchors/agent-a/entities/task`,
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(404);
    }
  });
});
