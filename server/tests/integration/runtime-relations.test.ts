/**
 * Session-05 integration suite — relation lifecycle and neighbourhood
 * traversal against the docker-compose Neo4j at bolt://localhost:7687,
 * through scoped and unscoped lenses built via the modeling API.
 *
 * Beyond the CRUD round trip: endpoint validation against the FULL schema,
 * lens-dropping of out-of-scope relation types, the shared direction
 * budget, both neighbour projections, and the entity-delete cascade that
 * removes relations the lens cannot see.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores, wipeDatabase } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture, type FixtureIds } from "./fixture.js";

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

async function createEntity(ontology: string, typeKey: string, payload: Row): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/runtime/${ontology}/entities/${typeKey}`,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Row;
}

async function createRelation(
  ontology: string,
  typeKey: string,
  payload: Row,
  expectedStatus = 201,
): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/runtime/${ontology}/relations/${typeKey}`,
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
    url: "/api/model/relation-types",
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
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });

    const created = await createRelation("test_ontology", "works_for", {
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
      url: "/api/runtime/test_ontology/relations/works_for",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().total).toBe(1);
    expect(listed.json().items[0]._id).toBe(relId);

    const read = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/relations/works_for/${relId}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().role).toBe("Engineer");
    expect(read.json().fromEntityId).toBe(alice._id);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/runtime/test_ontology/relations/works_for/${relId}`,
      payload: { role: "Senior Engineer", since: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().role).toBe("Senior Engineer");
    expect(patched.json()).not.toHaveProperty("since");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/runtime/test_ontology/relations/works_for/${relId}`,
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/relations/works_for/${relId}`,
    });
    expect(gone.statusCode).toBe(404);

    // Neither endpoint was touched by the relation delete.
    const aliceStill = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${alice._id}`,
    });
    expect(aliceStill.statusCode).toBe(200);
  });

  it("collects endpoint and property errors in one response, against the full schema", async () => {
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });

    // Through the NARROW lens: source is a company (mismatch), target does
    // not exist, and the property is unknown — one response, three fields.
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/hr_view/relations/works_for",
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
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const bob = await createEntity("test_ontology", "person", { name: "Bob" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });

    const rel = await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/runtime/test_ontology/relations/works_for/${rel._id}`,
      payload: { fromEntityId: bob._id, role: "Manager" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("Manager");
    expect(body.fromEntityId).toBe(alice._id); // unchanged, no error
  });

  it("filters and pages relations by endpoint id — the only way to count them", async () => {
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const bob = await createEntity("test_ontology", "person", { name: "Bob" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });
    const globex = await createEntity("test_ontology", "company", { name: "Globex" });

    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
    });
    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: globex._id,
      role: "Advisor",
    });
    await createRelation("test_ontology", "works_for", {
      fromEntityId: bob._id,
      toEntityId: acme._id,
      role: "Manager",
    });

    const fromAlice = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/relations/works_for?fromEntityId=${alice._id}`,
    });
    expect(fromAlice.json().total).toBe(2);

    const toAcme = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/relations/works_for?toEntityId=${acme._id}`,
    });
    expect(toAcme.json().total).toBe(2);

    const both = await app.inject({
      method: "GET",
      url:
        `/api/runtime/test_ontology/relations/works_for` +
        `?fromEntityId=${alice._id}&toEntityId=${acme._id}`,
    });
    expect(both.json().total).toBe(1);
    expect(both.json().items[0].role).toBe("Engineer");

    // Endpoint filters combine with property filters.
    const filtered = await app.inject({
      method: "GET",
      url:
        `/api/runtime/test_ontology/relations/works_for` +
        `?fromEntityId=${alice._id}&filter.role=Advisor`,
    });
    expect(filtered.json().total).toBe(1);
    expect(filtered.json().items[0].role).toBe("Advisor");
  });

  it("a garbage relation id answers not-found on read, update and delete", async () => {
    for (const id of ["not-a-uuid", "4F2D8A31-0000-4000-8000-000000000000"]) {
      const read = await app.inject({
        method: "GET",
        url: `/api/runtime/test_ontology/relations/works_for/${id}`,
      });
      expect(read.statusCode).toBe(404);

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/runtime/test_ontology/relations/works_for/${id}`,
        payload: { role: "Ghost" },
      });
      expect(patched.statusCode).toBe(404);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/runtime/test_ontology/relations/works_for/${id}`,
      });
      expect(deleted.statusCode).toBe(404);
    }
  });

  it("a garbage endpoint filter yields the empty page, never an error", async () => {
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });
    await createRelation("test_ontology", "works_for", {
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
        url: `/api/runtime/test_ontology/relations/works_for?${query}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(0);
      expect(res.json().items).toEqual([]);
    }
  });

  it("the scoped lens hides relation properties its inclusion excludes", async () => {
    // Narrow works_for in hr_view to role only.
    const narrowed = await app.inject({
      method: "PUT",
      url: `/api/model/ontologies/${fixture.hrViewId}/includes/relation-types/${fixture.worksForId}`,
      payload: { properties: ["role"] },
    });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    invalidateLoadedSchemaCache();

    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });
    const rel = await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
      since: "2024-01-15",
    });

    const scoped = await app.inject({
      method: "GET",
      url: `/api/runtime/hr_view/relations/works_for/${rel._id}`,
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
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });
    const globex = await createEntity("test_ontology", "company", { name: "Globex" });

    // Two outgoing (works_for), one incoming (founded_by).
    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: globex._id,
    });
    await createRelation("test_ontology", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });

    const all = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${alice._id}/neighbors`,
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
      url: `/api/runtime/test_ontology/entities/person/${alice._id}/neighbors?limit=2`,
    });
    const budgetDirections = (budget.json().neighbors as Row[]).map(
      (n) => (n.relation as Row).direction,
    );
    expect(budgetDirections).toEqual(["outgoing", "outgoing"]);

    // Asking for each direction separately is the way to see both.
    const incoming = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${alice._id}/neighbors?direction=incoming&limit=2`,
    });
    expect(incoming.json().neighbors).toHaveLength(1);
    expect((incoming.json().neighbors[0].relation as Row)._relationTypeKey).toBe("founded_by");
  });

  it("a garbage root entity id answers not-found", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/entities/person/not-a-uuid/neighbors",
    });
    expect(res.statusCode).toBe(404);
  });

  it("filters by relation type; an unknown key yields no neighbours, not an error", async () => {
    await addFoundedBy();
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });
    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_ontology", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });

    const filtered = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${alice._id}/neighbors?relationTypeKey=works_for`,
    });
    expect(filtered.json().neighbors).toHaveLength(1);
    expect((filtered.json().neighbors[0].relation as Row)._relationTypeKey).toBe("works_for");

    const unknown = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${alice._id}/neighbors?relationTypeKey=no_such_type`,
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().neighbors).toEqual([]);
  });

  it("drops relations whose type the lens does not expose, with their neighbour", async () => {
    await addFoundedBy();
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });
    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_ontology", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });

    // hr_view does not include founded_by: only the works_for neighbour remains.
    const scoped = await app.inject({
      method: "GET",
      url: `/api/runtime/hr_view/entities/person/${alice._id}/neighbors`,
    });
    expect(scoped.statusCode).toBe(200);
    const neighbors = scoped.json().neighbors as Row[];
    expect(neighbors).toHaveLength(1);
    expect((neighbors[0]!.relation as Row)._relationTypeKey).toBe("works_for");

    // The unscoped lens still sees both.
    const unscoped = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${alice._id}/neighbors`,
    });
    expect(unscoped.json().neighbors).toHaveLength(2);
  });

  it("applies both projections independently, keeping the system fields", async () => {
    const alice = await createEntity("test_ontology", "person", {
      name: "Alice",
      email: "a@b.com",
    });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });
    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
      role: "Engineer",
      since: "2024-01-15",
    });

    const res = await app.inject({
      method: "GET",
      url:
        `/api/runtime/test_ontology/entities/person/${alice._id}/neighbors` +
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
    const alice = await createEntity("test_ontology", "person", { name: "Alice" });
    const bob = await createEntity("test_ontology", "person", { name: "Bob" });
    const acme = await createEntity("test_ontology", "company", { name: "Acme" });

    // Outgoing from Alice, incoming to Alice (via a type hr_view cannot
    // see), and a control relation not touching Alice at all.
    await createRelation("test_ontology", "works_for", {
      fromEntityId: alice._id,
      toEntityId: acme._id,
    });
    await createRelation("test_ontology", "founded_by", {
      fromEntityId: acme._id,
      toEntityId: alice._id,
    });
    const bobRel = await createRelation("test_ontology", "works_for", {
      fromEntityId: bob._id,
      toEntityId: acme._id,
    });

    // Delete Alice THROUGH THE NARROW LENS, which cannot see founded_by.
    const del = await app.inject({
      method: "DELETE",
      url: `/api/runtime/hr_view/entities/person/${alice._id}`,
    });
    expect(del.statusCode).toBe(204);

    // Both of Alice's relations are gone — verified through the wide lens.
    const worksFor = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/relations/works_for",
    });
    expect(worksFor.json().total).toBe(1); // only Bob's survives
    expect(worksFor.json().items[0]._id).toBe(bobRel._id);

    const foundedBy = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/relations/founded_by",
    });
    expect(foundedBy.json().total).toBe(0);

    // The far endpoints are untouched.
    const acmeStill = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/company/${acme._id}`,
    });
    expect(acmeStill.statusCode).toBe(200);
  });
});
