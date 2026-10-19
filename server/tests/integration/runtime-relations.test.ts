/**
 * Session-05 integration suite — relation lifecycle and neighbourhood
 * traversal against the docker-compose PostgreSQL, through scoped and
 * unscoped lenses built via the modeling API.
 *
 * Beyond the CRUD round trip: endpoint validation against the FULL schema,
 * lens-dropping of out-of-scope relation types, the shared direction
 * budget, both neighbour projections, the entity-delete cascade that
 * removes relations the lens cannot see, and the parent rules on a
 * relation create, with the hierarchy reads beneath them.
 */

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, getRuntimeStore, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture, type FixtureIds } from "./fixture.js";
import { buildHierarchy, HIERARCHY_ONTOLOGY_KEY, type HierarchyIds } from "./hierarchy.js";

let app: FastifyInstance;
let fixture: FixtureIds;

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
  fixture = await buildFixture(app);
});

type Row = Record<string, unknown>;

async function createEntity(lens: string, typeKey: string, payload: Row): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/ontologies/test_ont/runtime/lenses/${lens}/entities/${typeKey}`,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Row;
}

async function createRelation(
  lens: string,
  typeKey: string,
  payload: Row,
  expectedStatus = 201,
): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/ontologies/test_ont/runtime/lenses/${lens}/relations/${typeKey}`,
    payload,
  });
  expect(res.statusCode, res.body).toBe(expectedStatus);
  return res.json() as Row;
}

/** Add a second relation type `founded_by` (company -> person) that the
 * hr_view lens does NOT include — the cross-lens counterpart for dropping
 * and cascade scenarios. */
async function addFoundedBy(): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: "/api/ontologies/test_ont/model/relation-types",
    payload: {
      key: "founded_by",
      displayName: "Founded By",
      sourceEntityTypeKey: "company",
      targetEntityTypeKey: "person",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  invalidateLoadedSchemaCache();
}

describe("relation CRUD round trip", () => {
  it("creates, lists, reads, patches and deletes through the unscoped lens", async () => {
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });

    const created = await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
      since: "2024-01-15",
    });
    expect(created.fromEntityId).toBe(alice._id);
    expect(created.toEntityId).toBe(acme._id);
    expect(created.role).toBe("Engineer");
    expect(created.since).toBe("2024-01-15"); // date round-trips as ISO text
    expect(created._relationTypeKey).toBe("works_for");
    expect(created._createdAt).toBeDefined();
    const relId = created._id as string;

    const listed = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().total).toBe(1);
    expect(listed.json().items[0]._id).toBe(relId);

    const read = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${relId}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().role).toBe("Engineer");
    expect(read.json().fromEntityId).toBe(alice._id);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${relId}`,
      payload: { role: "Senior Engineer", since: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().role).toBe("Senior Engineer");
    expect(patched.json()).not.toHaveProperty("since");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${relId}`,
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${relId}`,
    });
    expect(gone.statusCode).toBe(404);

    // Neither endpoint was touched by the relation delete.
    const aliceStill = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}`,
    });
    expect(aliceStill.statusCode).toBe(200);
  });

  it("collects endpoint and property errors in one response, against the full schema", async () => {
    const acme = await createEntity("test_lens", "company", { name: "Acme" });

    // Through the NARROW lens: source is a company (mismatch), target does
    // not exist, and the property is unknown — one response, three fields.
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/relations/works_for",
      payload: {
        fromEntityId: acme._id,
        toEntityId: "no-such-entity",
        bogus: "x",
      },
    });
    expect(res.statusCode).toBe(422);
    const fields = res.json().error.details.fields;
    expect(fields.fromEntityId).toBe(
      `Source entity type mismatch: expected 'person', got 'company'`,
    );
    expect(fields.toEntityId).toBe("Target entity 'no-such-entity' not found");
    expect(fields.bogus).toBe("Unknown property: not defined in type 'works_for'");
  });

  it("silently ignores endpoint ids on update; properties still apply", async () => {
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const bob = await createEntity("test_lens", "person", { name: "Bob" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });

    const rel = await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${rel._id}`,
      payload: { fromEntityId: bob._id, role: "Manager" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("Manager");
    expect(body.fromEntityId).toBe(alice._id); // unchanged, no error
  });

  it("filters and pages relations by endpoint id — the only way to count them", async () => {
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const bob = await createEntity("test_lens", "person", { name: "Bob" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    const globex = await createEntity("test_lens", "company", { name: "Globex" });

    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
    });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: globex._id,
      role: "Advisor",
    });
    await createRelation("test_lens", "works_for", {
      fromEntityId: bob._id,
      toEntityId: acme._id,
      role: "Manager",
    });

    const fromAlice = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for?fromEntityId=${alice._id}`,
    });
    expect(fromAlice.json().total).toBe(2);

    const toAcme = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for?toEntityId=${acme._id}`,
    });
    expect(toAcme.json().total).toBe(2);

    const both = await app.inject({
      method: "GET",
      url:
        `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for` +
        `?fromEntityId=${alice._id}&toEntityId=${acme._id}`,
    });
    expect(both.json().total).toBe(1);
    expect(both.json().items[0].role).toBe("Engineer");

    // Endpoint filters combine with property filters.
    const filtered = await app.inject({
      method: "GET",
      url:
        `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for` +
        `?fromEntityId=${alice._id}&filter.role=Advisor`,
    });
    expect(filtered.json().total).toBe(1);
    expect(filtered.json().items[0].role).toBe("Advisor");
  });

  it("negation and existence filter relation properties; a relation type is never a subject here", async () => {
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    const globex = await createEntity("test_lens", "company", { name: "Globex" });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
    });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: globex._id,
    });
    const roles = async (query: string): Promise<unknown[]> => {
      const res = await app.inject({
        method: "GET",
        url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for?${query}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json().items as Row[]).map((r) => r.role ?? null);
    };
    expect(await roles("filter.role__ne=Advisor")).toEqual(["Engineer"]);
    expect(await roles("filter.role__exists=true")).toEqual(["Engineer"]);
    expect(await roles("filter.role__missing=true")).toEqual([null]);
    expect(await roles(`filter.role__missing=true&toEntityId=${acme._id}`)).toEqual([]);

    const res = await app.inject({
      method: "GET",
      url:
        "/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for" +
        "?filter.works_for__exists=true&filter.role__exists=maybe",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({
      works_for__exists: "Not defined in type 'works_for'",
      role__exists: "Expected boolean for 'role', got 'maybe'",
    });
  });

  it("several faulty filters are rejected once, every fault under its own filter key", async () => {
    const res = await app.inject({
      method: "GET",
      url:
        "/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for" +
        "?filter.ghost=1&filter.since=not-a-date&filter.role__between=1&filter.role=Engineer",
    });
    expect(res.statusCode).toBe(422);
    const error = res.json().error as { message: string; details: { fields: Record<string, string> } };
    expect(error.message).toBe(
      "Unknown filter property: 'ghost'; " +
        "Invalid filter value for 'since'; " +
        "Unknown filter operator: 'between'",
    );
    expect(error.details.fields).toEqual({
      ghost: "Not defined in type 'works_for'",
      since: expect.stringContaining("date"),
      role__between: "Unsupported operator 'between'",
    });
  });

  it("a garbage relation id answers not-found on read, update and delete", async () => {
    for (const id of ["not-a-uuid", "4F2D8A31-0000-4000-8000-000000000000"]) {
      const read = await app.inject({
        method: "GET",
        url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${id}`,
      });
      expect(read.statusCode).toBe(404);

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${id}`,
        payload: { role: "Ghost" },
      });
      expect(patched.statusCode).toBe(404);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for/${id}`,
      });
      expect(deleted.statusCode).toBe(404);
    }
  });

  it("a garbage endpoint filter yields the empty page, never an error", async () => {
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });

    for (const query of [
      "fromEntityId=not-a-uuid",
      "toEntityId=not-a-uuid",
      `fromEntityId=${alice._id}&toEntityId=not-a-uuid`,
    ]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for?${query}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(0);
      expect(res.json().items).toEqual([]);
    }
  });

  it("an empty-string endpoint filter behaves as filter-absent — the unfiltered listing", async () => {
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const bob = await createEntity("test_lens", "person", { name: "Bob" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_lens", "works_for", {
      fromEntityId: bob._id,
      toEntityId: acme._id,
    });

    for (const query of ["fromEntityId=", "toEntityId=", "fromEntityId=&toEntityId="]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for?${query}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(2);
      expect(res.json().items).toHaveLength(2);
    }
  });

  it("the scoped lens hides relation properties its inclusion excludes", async () => {
    // Narrow works_for in hr_view to role only.
    const narrowed = await app.inject({
      method: "PUT",
      url: `/api/ontologies/test_ont/model/lenses/${fixture.hrViewId}/includes/relation-types/${fixture.worksForId}`,
      payload: { properties: ["role"] },
    });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    invalidateLoadedSchemaCache();

    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    const rel = await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
      since: "2024-01-15",
    });

    const scoped = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/hr_view/relations/works_for/${rel._id}`,
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().role).toBe("Engineer");
    expect(scoped.json()).not.toHaveProperty("since");
    expect(scoped.json().fromEntityId).toBe(alice._id); // endpoints always survive
  });
});

describe("neighbours", () => {
  it("returns mixed directions with computed direction, honouring the shared budget", async () => {
    await addFoundedBy();
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    const globex = await createEntity("test_lens", "company", { name: "Globex" });

    // Two outgoing (works_for), one incoming (founded_by).
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: globex._id,
    });
    await createRelation("test_lens", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });

    const all = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}/neighbors`,
    });
    expect(all.statusCode).toBe(200);
    const directions = (all.json().neighbors as Row[]).map(
      (n) => (n.relation as Row).direction,
    );
    expect(directions.filter((d) => d === "outgoing")).toHaveLength(2);
    expect(directions.filter((d) => d === "incoming")).toHaveLength(1);

    // The trap: limit 2 is exhausted by outgoing edges — the incoming
    // neighbour vanishes entirely.
    const budget = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}/neighbors?limit=2`,
    });
    const budgetDirections = (budget.json().neighbors as Row[]).map(
      (n) => (n.relation as Row).direction,
    );
    expect(budgetDirections).toEqual(["outgoing", "outgoing"]);

    // Asking for each direction separately is the way to see both.
    const incoming = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}/neighbors?direction=incoming&limit=2`,
    });
    expect(incoming.json().neighbors).toHaveLength(1);
    expect((incoming.json().neighbors[0].relation as Row)._relationTypeKey).toBe("founded_by");
  });

  it("a garbage root entity id answers not-found", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/not-a-uuid/neighbors",
    });
    expect(res.statusCode).toBe(404);
  });

  it("filters by relation type; an unknown key yields no neighbours, not an error", async () => {
    await addFoundedBy();
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_lens", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });

    const filtered = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}/neighbors?relationTypeKey=works_for`,
    });
    expect(filtered.json().neighbors).toHaveLength(1);
    expect((filtered.json().neighbors[0].relation as Row)._relationTypeKey).toBe("works_for");

    const unknown = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}/neighbors?relationTypeKey=no_such_type`,
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().neighbors).toEqual([]);
  });

  it("drops relations whose type the lens does not expose, with their neighbour", async () => {
    await addFoundedBy();
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_lens", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });

    // hr_view does not include founded_by: only the works_for neighbour remains.
    const scoped = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/${alice._id}/neighbors`,
    });
    expect(scoped.statusCode).toBe(200);
    const neighbors = scoped.json().neighbors as Row[];
    expect(neighbors).toHaveLength(1);
    expect((neighbors[0]!.relation as Row)._relationTypeKey).toBe("works_for");

    // The unscoped lens still sees both.
    const unscoped = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}/neighbors`,
    });
    expect(unscoped.json().neighbors).toHaveLength(2);
  });

  it("applies both projections independently, keeping the system fields", async () => {
    const alice = await createEntity("test_lens", "person", {
      name: "Alice",
      email: "a@b.com",
    });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
      since: "2024-01-15",
    });

    const res = await app.inject({
      method: "GET",
      url:
        `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/person/${alice._id}/neighbors` +
        `?fields=name&relationFields=role`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body.entity).sort()).toEqual(["_id", "name"]);
    const neighbor = body.neighbors[0];
    expect(Object.keys(neighbor.entity).sort()).toEqual(["_entityTypeKey", "_id", "name"]);
    expect(Object.keys(neighbor.relation).sort()).toEqual([
      "_id",
      "_relationTypeKey",
      "direction",
      "role",
    ]);
  });
});

describe("entity delete cascade", () => {
  it("removes attached relations in both directions, including cross-lens ones", async () => {
    await addFoundedBy();
    const alice = await createEntity("test_lens", "person", { name: "Alice" });
    const bob = await createEntity("test_lens", "person", { name: "Bob" });
    const acme = await createEntity("test_lens", "company", { name: "Acme" });

    // Outgoing from Alice, incoming to Alice (via a type hr_view cannot
    // see), and a control relation not touching Alice at all.
    await createRelation("test_lens", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_lens", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });
    const bobRel = await createRelation("test_lens", "works_for", {
      fromEntityId: bob._id,
      toEntityId: acme._id,
    });

    // Delete Alice THROUGH THE NARROW LENS, which cannot see founded_by.
    const del = await app.inject({
      method: "DELETE",
      url: `/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/${alice._id}`,
    });
    expect(del.statusCode).toBe(204);

    // Both of Alice's relations are gone — verified through the wide lens.
    const worksFor = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/relations/works_for",
    });
    expect(worksFor.json().total).toBe(1); // only Bob's survives
    expect(worksFor.json().items[0]._id).toBe(bobRel._id);

    const foundedBy = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/relations/founded_by",
    });
    expect(foundedBy.json().total).toBe(0);

    // The far endpoints are untouched.
    const acmeStill = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens/entities/company/${acme._id}`,
    });
    expect(acmeStill.statusCode).toBe(200);
  });
});

describe("the parent rules on a relation create", () => {
  let ids: HierarchyIds;

  beforeEach(async () => {
    ids = await buildHierarchy(app);
  });

  async function relate(
    lens: string,
    typeKey: string,
    from: string,
    to: string,
  ): Promise<{ status: number; body: Row }> {
    const res = await app.inject({
      method: "POST",
      url: `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}/runtime/lenses/${lens}/relations/${typeKey}`,
      payload: { fromEntityId: from, toEntityId: to },
    });
    return { status: res.statusCode, body: res.json() as Row };
  }

  async function task(name: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}/runtime/lenses/all/entities/task`,
      payload: { name },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json()._id as string;
  }

  function fields(body: Row): Row {
    return ((body.error as Row).details as Row).fields as Row;
  }

  it("a second parent through the same parent relation: 422 on the child end, naming no parent", async () => {
    const res = await relate("all", "has_task", ids.P2, ids.T1);
    expect(res.status).toBe(422);
    expect(fields(res.body)).toEqual({ toEntityId: `Entity '${ids.T1}' already has a parent` });
    expect(JSON.stringify(res.body)).not.toContain(ids.P1);
  });

  it("a second parent through another parent relation: counted across all of them", async () => {
    const res = await relate("all", "has_subtask", ids.T2, ids.T1);
    expect(res.status).toBe(422);
    expect(fields(res.body)).toEqual({ toEntityId: `Entity '${ids.T1}' already has a parent` });
  });

  it("an up-pointing parent relation refuses on its source, the child end", async () => {
    const res = await relate("all", "belongs_to", ids.M1, ids.P2);
    expect(res.status).toBe(422);
    expect(fields(res.body)).toEqual({ fromEntityId: `Entity '${ids.M1}' already has a parent` });
  });

  it("a cycle, direct or deeper, gives 422 on the parent end", async () => {
    const r = await task("R");
    const r1 = await task("R1");
    const r2 = await task("R2");
    expect((await relate("all", "has_subtask", r, r1)).status).toBe(201);
    expect((await relate("all", "has_subtask", r1, r2)).status).toBe(201);

    const direct = await relate("all", "has_subtask", r1, r);
    expect(direct.status).toBe(422);
    expect(fields(direct.body)).toEqual({
      fromEntityId: `Entity '${r1}' cannot be the parent: this would close a cycle`,
    });

    const deeper = await relate("all", "has_subtask", r2, r);
    expect(deeper.status).toBe(422);
    expect(fields(deeper.body)).toEqual({
      fromEntityId: `Entity '${r2}' cannot be the parent: this would close a cycle`,
    });
  });

  it("a self-loop is a cycle", async () => {
    const r = await task("R");
    const res = await relate("all", "has_subtask", r, r);
    expect(res.status).toBe(422);
    expect(fields(res.body)).toEqual({
      fromEntityId: `Entity '${r}' cannot be the parent: this would close a cycle`,
    });
  });

  it("the rules hold through a lens that hides the other parent relations", async () => {
    // portfolio hides task and has_task: P1 already has ACME, and a second
    // parent through has_project is refused all the same.
    const beta = await app.inject({
      method: "POST",
      url: `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}/runtime/lenses/portfolio/entities/customer`,
      payload: { name: "BETA" },
    });
    const res = await relate("portfolio", "has_project", beta.json()._id as string, ids.P1);
    expect(res.status).toBe(422);
    expect(fields(res.body)).toEqual({ toEntityId: `Entity '${ids.P1}' already has a parent` });
  });

  it("a child without a parent, under a parent not below it: created", async () => {
    const r = await task("R");
    expect((await relate("all", "has_subtask", ids.T1a, r)).status).toBe(201);
  });

  it("ordinary relations are unaffected", async () => {
    const kim = await app.inject({
      method: "POST",
      url: `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}/runtime/lenses/all/entities/person`,
      payload: { name: "Kim" },
    });
    // T1 already has a parent and a person; neither matters here.
    expect((await relate("all", "assigned_to", ids.T1, kim.json()._id as string)).status).toBe(201);
    expect((await relate("all", "assigned_to", ids.T2, ids.Ben)).status).toBe(201);
  });

  it("an ontology without flags is unchanged: two managers and a loop are fine", async () => {
    const a = await createEntity("test_lens", "person", { name: "A" });
    const b = await createEntity("test_lens", "person", { name: "B" });
    const c = await createEntity("test_lens", "person", { name: "C" });
    await createRelation("test_lens", "manages", { fromEntityId: a._id, toEntityId: c._id });
    await createRelation("test_lens", "manages", { fromEntityId: b._id, toEntityId: c._id });
    await createRelation("test_lens", "manages", { fromEntityId: c._id, toEntityId: a._id });
    await createRelation("test_lens", "manages", { fromEntityId: a._id, toEntityId: a._id });
  });
});

describe("hierarchy reads (store port)", () => {
  let ids: HierarchyIds;

  const READINGS = {
    has_project: "source",
    has_task: "source",
    has_subtask: "source",
    belongs_to: "target",
  } as const;

  beforeEach(async () => {
    ids = await buildHierarchy(app);
  });

  it("the ancestor walk answers nearest first, across parent relations and both ends", async () => {
    const store = await getRuntimeStore(HIERARCHY_ONTOLOGY_KEY);
    expect(await store.getAncestors(ids.T1a, READINGS)).toEqual([
      { type: "task", id: ids.T1 },
      { type: "project", id: ids.P1 },
      { type: "customer", id: ids.ACME },
    ]);
    expect(await store.getAncestors(ids.M1, READINGS)).toEqual([
      { type: "project", id: ids.P1 },
      { type: "customer", id: ids.ACME },
    ]);
    expect(await store.getAncestors(ids.ACME, READINGS)).toEqual([]);
    // Only the readings passed are followed.
    expect(await store.getAncestors(ids.T1a, { has_subtask: "source" })).toEqual([
      { type: "task", id: ids.T1 },
    ]);
    expect(await store.getAncestors(ids.T1a, {})).toEqual([]);
    expect(await store.getAncestors("not-a-uuid", READINGS)).toEqual([]);
  });

  it("the walk terminates on cyclic data", async () => {
    // A cycle written past the service, as the accepted race can leave
    // one: X → Y → X, plus a self-loop on Z.
    const store = await getRuntimeStore(HIERARCHY_ONTOLOGY_KEY);
    const x = randomUUID();
    const y = randomUUID();
    const z = randomUUID();
    for (const [id, name] of [[x, "X"], [y, "Y"], [z, "Z"]]) {
      await store.createEntity("task", id!, { name }, {});
    }
    await store.createRelation("has_subtask", randomUUID(), x, y, {}, {});
    await store.createRelation("has_subtask", randomUUID(), y, x, {}, {});
    await store.createRelation("has_subtask", randomUUID(), z, z, {}, {});

    expect(await store.getAncestors(y, READINGS)).toEqual([{ type: "task", id: x }]);
    expect(await store.getAncestors(x, READINGS)).toEqual([{ type: "task", id: y }]);
    expect(await store.getAncestors(z, READINGS)).toEqual([]);

    // The service's rules still answer over it.
    const res = await app.inject({
      method: "POST",
      url: `/api/ontologies/${HIERARCHY_ONTOLOGY_KEY}/runtime/lenses/all/relations/has_subtask`,
      payload: { fromEntityId: x, toEntityId: ids.T2 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("the children lookup sees a child over any parent relation, at either end", async () => {
    const store = await getRuntimeStore(HIERARCHY_ONTOLOGY_KEY);
    expect(await store.hasChildren(ids.ACME, READINGS)).toBe(true);
    expect(await store.hasChildren(ids.T1, READINGS)).toBe(true);
    expect(await store.hasChildren(ids.T1a, READINGS)).toBe(false);
    // P1's children are T1 (has_task) and M1 (belongs_to, at the target end).
    expect(await store.hasChildren(ids.P1, { belongs_to: "target" })).toBe(true);
    expect(await store.hasChildren(ids.P2, { belongs_to: "target" })).toBe(false);
    // An ordinary relation is no parent relation: Ben has none.
    expect(await store.hasChildren(ids.Ben, READINGS)).toBe(false);
    expect(await store.hasChildren(ids.ACME, {})).toBe(false);
  });
});
