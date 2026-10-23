/**
 * A scoped lens as a boundary, end to end against PostgreSQL: what it
 * hides stays hidden from OQL projections inside lists and maps, from
 * untyped and anonymous pattern elements, from a relation type whose end
 * it hides, from an entity delete's cascade (immediate and committed
 * through a changeset), and from the path read over a parent relation it
 * hides.
 *
 * The main fixture's `hr_view` shows person (name and email), company and
 * works_for; it hides person.age and the self-relation manages.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture, modelPrefix, runtimePrefix } from "./fixture.js";
import { buildHierarchy, HIERARCHY_ONTOLOGY_KEY, type HierarchyIds } from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const WIDE = runtimePrefix("test_ont", "test_lens");
const HR = runtimePrefix("test_ont", "hr_view");
const MODEL = modelPrefix("test_ont");

let app: FastifyInstance;

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
  await buildFixture(app);
});

async function call(method: string, url: string, payload?: Row): Promise<{ status: number; body: any; text: string }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : res.json(), text: res.body };
}

async function created(url: string, payload: Row): Promise<string> {
  const res = await call("POST", url, payload);
  expect(res.status, res.text).toBe(201);
  return res.body._id as string;
}

/** Alice (age 41) works for Acme and manages Bob. */
async function people(): Promise<{ alice: string; bob: string; acme: string }> {
  const alice = await created(`${WIDE}/entities/person`, { name: "Alice", age: 41, email: "a@x" });
  const bob = await created(`${WIDE}/entities/person`, { name: "Bob", age: 52 });
  const acme = await created(`${WIDE}/entities/company`, { name: "Acme" });
  await created(`${WIDE}/relations/works_for`, { fromEntityId: alice, toEntityId: acme });
  await created(`${WIDE}/relations/manages`, { fromEntityId: alice, toEntityId: bob, since: "2020-01-01" });
  return { alice, bob, acme };
}

async function query(base: string, text: string): Promise<Row[]> {
  const res = await call("POST", `${base}/query`, { query: text });
  expect(res.status, res.text).toBe(200);
  return res.body.results as Row[];
}

describe("OQL through a scoped lens", () => {
  it("strips hidden properties from whole nodes inside lists and maps", async () => {
    await people();
    for (const text of [
      "MATCH (p:person) RETURN collect(p) AS ps",
      "MATCH (p:person) RETURN [p] AS l",
      "MATCH (p:person) RETURN {x: p} AS m",
      "MATCH (p:person) WITH collect(p) AS ps RETURN ps",
    ]) {
      const res = await call("POST", `${HR}/query`, { query: text });
      expect(res.status, res.text).toBe(200);
      expect(res.text, text).toContain("Alice");
      expect(res.text, text).not.toContain('"age"');
    }
  });

  it("an untyped relationship matches only relation types the lens shows", async () => {
    await people();
    expect(await query(HR, "MATCH (a:person)-[r]->(b:person) RETURN r")).toEqual([]);
    expect(await query(HR, "MATCH (a:person)-[r]-() RETURN r._relationTypeKey AS t, count(*) AS n")).toEqual([
      { t: "works_for", n: 1 },
    ]);
    expect(await query(HR, "MATCH (a:person {name: 'Alice'})-[]-() RETURN count(*) AS n")).toEqual([{ n: 1 }]);
    // The wide lens sees both.
    expect(await query(WIDE, "MATCH (a:person {name: 'Alice'})-[]-() RETURN count(*) AS n")).toEqual([{ n: 2 }]);
  });

  it("an anonymous element reaches no entity of a type the lens hides", async () => {
    await people();
    // `people` shows person only: works_for (into company) is not inferred.
    const lens = await call("POST", `${MODEL}/lenses`, { key: "people", name: "People" });
    await call("POST", `${MODEL}/lenses/${lens.body.lensId}/includes/entity-types`, { key: "person" });
    invalidateLoadedSchemaCache();
    const base = runtimePrefix("test_ont", "people");
    expect(await query(base, "MATCH (a:person {name: 'Alice'})-[]-() RETURN count(*) AS n")).toEqual([{ n: 1 }]);
  });
});

describe("a relation type whose end the lens hides", () => {
  it("is not served: no schema entry, no relations, no neighbours, no create", async () => {
    const { alice, acme } = await people();
    // The ordering hazard: works_for included before person, company never.
    const lens = await call("POST", `${MODEL}/lenses`, { key: "narrow", name: "Narrow" });
    const lensId = lens.body.lensId as string;
    expect((await call("POST", `${MODEL}/lenses/${lensId}/includes/relation-types`, { key: "works_for" })).status).toBe(201);
    expect((await call("POST", `${MODEL}/lenses/${lensId}/includes/entity-types`, { key: "person" })).status).toBe(201);
    invalidateLoadedSchemaCache();
    const base = runtimePrefix("test_ont", "narrow");

    const schema = await call("GET", `${base}/schema`);
    expect(schema.status).toBe(200);
    expect(schema.text).not.toContain("company");
    expect(schema.text).not.toContain("works_for");

    const neighbours = await call("GET", `${base}/entities/person/${alice}/neighbors`);
    expect(neighbours.status).toBe(200);
    expect(neighbours.body.neighbors).toEqual([]);
    expect(neighbours.text).not.toContain(acme);

    expect((await call("GET", `${base}/relations/works_for?fromEntityId=${alice}`)).status).toBe(404);
    const create = await call("POST", `${base}/relations/works_for`, { fromEntityId: alice, toEntityId: acme });
    expect(create.status).toBe(404);
  });
});

describe("an entity delete through a lens hiding an attached relation", () => {
  const MESSAGE = "This entity has relations this lens does not show; it can only be deleted through a lens that shows them";

  it("is refused with a 409 naming nothing hidden; the wide lens deletes it with its relations", async () => {
    const { alice } = await people();

    const refused = await call("DELETE", `${HR}/entities/person/${alice}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toEqual({ code: "RESOURCE_CONFLICT", message: MESSAGE });
    expect((await call("GET", `${WIDE}/entities/person/${alice}`)).status).toBe(200);
    expect((await call("GET", `${WIDE}/relations/manages`)).body.total).toBe(1);

    expect((await call("DELETE", `${WIDE}/entities/person/${alice}`)).status).toBe(204);
    expect((await call("GET", `${WIDE}/relations/manages`)).body.total).toBe(0);
    expect((await call("GET", `${WIDE}/relations/works_for`)).body.total).toBe(0);
  });

  it("only visible relations attached: deleted through the narrow lens", async () => {
    const acme = await created(`${WIDE}/entities/company`, { name: "Acme" });
    const carl = await created(`${WIDE}/entities/person`, { name: "Carl" });
    await created(`${WIDE}/relations/works_for`, { fromEntityId: carl, toEntityId: acme });
    expect((await call("DELETE", `${HR}/entities/person/${carl}`)).status).toBe(204);
    expect((await call("GET", `${WIDE}/relations/works_for`)).body.total).toBe(0);
  });

  it("is rejected at commit when staged in a changeset; nothing persisted", async () => {
    const { alice } = await people();
    const started = await call("POST", `${HR}/changesets`);
    expect(started.status, started.text).toBe(201);
    const cs = started.body.id as string;
    expect((await call("POST", `${HR}/changesets/${cs}/writes`, { operation: "delete_entity", type: "person", id: alice })).status).toBe(201);

    const commit = await call("POST", `${HR}/changesets/${cs}/commit`);
    expect(commit.status, commit.text).toBe(422);
    expect(commit.body.error.details.violations).toEqual([{ object: alice, kind: "hidden_relations", message: MESSAGE }]);
    expect(commit.text).not.toContain("manages");
    expect((await call("GET", `${WIDE}/entities/person/${alice}`)).status).toBe(200);
    expect((await call("GET", `${WIDE}/relations/manages`)).body.total).toBe(1);
  });
});

describe("the path through a lens hiding a parent relation", () => {
  let ids: HierarchyIds;

  beforeEach(async () => {
    ids = await buildHierarchy(app);
  });

  it("starts below the hidden parent relation, though the ancestor's type shows", async () => {
    // `projects` shows project and task, and has_task, but not has_subtask.
    const model = modelPrefix(HIERARCHY_ONTOLOGY_KEY);
    const lens = await call("POST", `${model}/lenses`, { key: "projects", name: "Projects" });
    for (const key of ["project", "task"]) {
      await call("POST", `${model}/lenses/${lens.body.lensId}/includes/entity-types`, { key });
    }
    await call("POST", `${model}/lenses/${lens.body.lensId}/includes/relation-types`, { key: "has_task" });
    invalidateLoadedSchemaCache();
    const base = runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "projects");

    const sub = await call("GET", `${base}/entities/task/${ids.T1a}/path`);
    expect(sub.status, sub.text).toBe(200);
    expect(sub.body).toEqual([{ type: "task", id: ids.T1a, name: "T1a" }]);

    const top = await call("GET", `${base}/entities/task/${ids.T1}/path`);
    expect(top.body.map((step: Row) => step.name)).toEqual(["P1", "T1"]);
  });
});
