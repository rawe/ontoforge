/**
 * Session-04 integration suite — runtime schema introspection and entity
 * CRUD against the docker-compose Neo4j at bolt://localhost:7687, through
 * scoped and unscoped lenses built via the modeling API.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores, wipeDatabase } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture } from "./fixture.js";

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

type Row = Record<string, unknown>;

async function createPerson(ontology: string, payload: Row): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/runtime/${ontology}/entities/person`,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Row;
}

describe("schema introspection through both lenses", () => {
  it("the unscoped lens exposes the whole schema", async () => {
    const res = await app.inject({ method: "GET", url: "/api/runtime/test_ontology/schema" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ontology.key).toBe("test_ontology");
    expect(body.entityTypes.map((et: Row) => et.key).sort()).toEqual(["company", "person"]);
    expect(body.relationTypes.map((rt: Row) => rt.key)).toEqual(["works_for"]);
    const person = body.entityTypes.find((et: Row) => et.key === "person");
    expect(person.properties.map((p: Row) => p.key).sort()).toEqual([
      "active",
      "age",
      "email",
      "hired_at",
      "name",
    ]);
  });

  it("the scoped lens narrows types and properties; out-of-scope reads answer 404", async () => {
    const schema = await app.inject({ method: "GET", url: "/api/runtime/hr_view/schema" });
    const person = schema.json().entityTypes.find((et: Row) => et.key === "person");
    expect(person.properties.map((p: Row) => p.key).sort()).toEqual(["email", "name"]);

    const single = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/entity-types/person",
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().properties.map((p: Row) => p.key).sort()).toEqual(["email", "name"]);

    const relations = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/relation-types/works_for",
    });
    expect(relations.statusCode).toBe(200);
    expect(relations.json().fromEntityTypeKey).toBe("person");

    const ghost = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/entity-types/ghost",
    });
    expect(ghost.statusCode).toBe(404);
  });

  it("an unknown ontology key answers 404 everywhere", async () => {
    const res = await app.inject({ method: "GET", url: "/api/runtime/no_such_lens/schema" });
    expect(res.statusCode).toBe(404);
  });
});

describe("entity CRUD through the unscoped lens", () => {
  it("full lifecycle with defaults, temporals and system properties", async () => {
    const created = await createPerson("test_ontology", {
      name: "Alice",
      age: 30,
      email: "a@b.com",
      hired_at: "2024-01-15T10:30:00",
    });

    expect(created._id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created._entityTypeKey).toBe("person");
    expect(created.name).toBe("Alice");
    expect(created.age).toBe(30);
    expect(created.active).toBe(true); // default applied at creation
    expect(String(created.hired_at)).toContain("2024-01-15T10:30:00"); // naive read back as UTC
    expect(new Date(created._createdAt as string).getTime()).not.toBeNaN();

    const read = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(created);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
      payload: { email: "new@b.com" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().email).toBe("new@b.com");
    expect(updated.json().name).toBe("Alice");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
    });
    expect(gone.statusCode).toBe(404);
  });

  it("a date property round-trips as an ISO calendar date", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/test_ontology/entities/company",
      payload: { name: "Acme", founded: "2020-01-15", employee_count: 12 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().founded).toBe("2020-01-15");
    expect(res.json().employee_count).toBe(12);
  });

  it("null removes an optional property; a no-change update keeps _updatedAt", async () => {
    const created = await createPerson("test_ontology", { name: "Bob", age: 25 });

    const noChange = await app.inject({
      method: "PATCH",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
      payload: {},
    });
    expect(noChange.statusCode).toBe(200);
    expect(noChange.json()._updatedAt).toBe(created._updatedAt);

    const removed = await app.inject({
      method: "PATCH",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
      payload: { age: null },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).not.toHaveProperty("age");
    expect(removed.json()._updatedAt).not.toBe(created._updatedAt);

    const read = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
    });
    expect(read.json()).not.toHaveProperty("age");
  });

  it("validation collects every offending field in one response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/test_ontology/entities/person",
      payload: { age: "abc", active: 7, nickname: "x" },
    });
    expect(res.statusCode).toBe(422);
    const fields = res.json().error.details.fields;
    expect(Object.keys(fields).sort()).toEqual(["active", "age", "name", "nickname"]);
  });
});

describe("entity CRUD through the scoped lens", () => {
  it("writes validate against the lens; defaults come from the full schema", async () => {
    const created = await createPerson("hr_view", { name: "Carol", email: "c@b.com" });

    // The scoped response hides age/active/hired_at.
    expect(created.name).toBe("Carol");
    expect(created).not.toHaveProperty("active");
    expect(created).not.toHaveProperty("age");

    // The wide lens sees the hidden default that was still applied.
    const wide = await app.inject({
      method: "GET",
      url: `/api/runtime/test_ontology/entities/person/${created._id}`,
    });
    expect(wide.json().active).toBe(true);

    // A hidden property is an unknown property through the narrow lens.
    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/runtime/hr_view/entities/person/${created._id}`,
      payload: { age: 31 },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.details.fields).toHaveProperty("age");

    // Instance data is shared: the same record through every lens.
    const narrow = await app.inject({
      method: "GET",
      url: `/api/runtime/hr_view/entities/person/${created._id}`,
    });
    expect(narrow.json()._id).toBe(created._id);
    expect(narrow.json()).not.toHaveProperty("active");
  });

  it("hidden properties written through a wide lens are stripped from narrow reads", async () => {
    const created = await createPerson("test_ontology", { name: "Dan", age: 44 });
    const narrow = await app.inject({
      method: "GET",
      url: `/api/runtime/hr_view/entities/person/${created._id}`,
    });
    expect(narrow.statusCode).toBe(200);
    expect(narrow.json()).not.toHaveProperty("age");
  });
});

describe("listing with q + filters + sort + paging", () => {
  beforeEach(async () => {
    await createPerson("test_ontology", { name: "Alice", age: 30 });
    await createPerson("test_ontology", { name: "Anna", age: 35 });
    await createPerson("test_ontology", { name: "Albert", age: 28 });
    await createPerson("test_ontology", { name: "Bob", age: 25 });
  });

  it("combines the free-text term, a property filter, sort and paging with a correct total", async () => {
    const res = await app.inject({
      method: "GET",
      url:
        "/api/runtime/test_ontology/entities/person" +
        "?q=a&filter.age__gte=29&sort=age&order=desc&limit=1&offset=0",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Names containing "a": Alice, Anna, Albert; age >= 29: Alice, Anna.
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Anna"); // highest age first
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);

    const secondPage = await app.inject({
      method: "GET",
      url:
        "/api/runtime/test_ontology/entities/person" +
        "?q=a&filter.age__gte=29&sort=age&order=desc&limit=1&offset=1",
    });
    expect(secondPage.json().items[0].name).toBe("Alice");
  });

  it("filters coerce per declared type and reject uncoercible values", async () => {
    const exact = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/entities/person?filter.age=30",
    });
    expect(exact.json().total).toBe(1);
    expect(exact.json().items[0].name).toBe("Alice");

    const contains = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/entities/person?filter.name__contains=AL",
    });
    expect(contains.json().total).toBe(2); // Alice, Albert — case-insensitive

    const bad = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/entities/person?filter.age=abc",
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details.fields.age).toContain("Expected integer");

    const unknown = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/entities/person?filter.ghost=1",
    });
    expect(unknown.statusCode).toBe(422);

    const badOp = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/entities/person?filter.age__between=1",
    });
    expect(badOp.statusCode).toBe(422);
  });

  it("out-of-range paging is rejected", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/test_ontology/entities/person?limit=201",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("q is restricted to in-scope string properties", async () => {
    // Through hr_view the only string props are name and email; matching
    // still works on name.
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/person?q=anna",
    });
    expect(res.json().total).toBe(1);
  });
});

describe("cache invalidation across a modeling change", () => {
  it("a type created after the lens was cached is visible without restart", async () => {
    // Prime the cache.
    const before = await app.inject({ method: "GET", url: "/api/runtime/test_ontology/schema" });
    expect(before.json().entityTypes.map((et: Row) => et.key)).not.toContain("project");

    // Modeling mutation: create a new entity type.
    const created = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "project", displayName: "Project" },
    });
    expect(created.statusCode).toBe(201);

    // The unscoped lens tracks the schema automatically — no restart.
    const after = await app.inject({ method: "GET", url: "/api/runtime/test_ontology/schema" });
    expect(after.json().entityTypes.map((et: Row) => et.key)).toContain("project");

    // The scoped lens keeps hiding it.
    const scoped = await app.inject({ method: "GET", url: "/api/runtime/hr_view/schema" });
    expect(scoped.json().entityTypes.map((et: Row) => et.key)).not.toContain("project");
  });

  it("a property allowlist change is visible immediately", async () => {
    await app.inject({ method: "GET", url: "/api/runtime/hr_view/schema" }); // prime

    // Re-adding an inclusion is an upsert; widen person to include age.
    const ontologies = await app.inject({ method: "GET", url: "/api/model/ontologies" });
    const hrView = ontologies
      .json()
      .find((o: Row) => o.key === "hr_view") as Row;
    const res = await app.inject({
      method: "POST",
      url: `/api/model/ontologies/${hrView.ontologyId}/includes/entity-types`,
      payload: { key: "person", properties: ["name", "email", "age"] },
    });
    expect(res.statusCode).toBe(201);

    const schema = await app.inject({ method: "GET", url: "/api/runtime/hr_view/schema" });
    const person = schema.json().entityTypes.find((et: Row) => et.key === "person");
    expect(person.properties.map((p: Row) => p.key).sort()).toEqual(["age", "email", "name"]);
  });
});
