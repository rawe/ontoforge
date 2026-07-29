/**
 * Runtime schema introspection with scope filtering, ported from
 * `tests/runtime/test_schema_introspection.py`. Out-of-scope type reads
 * answer not-found indistinguishably from nonexistent — the lens never
 * advertises what it hides.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  createMockRuntimeStore,
  makeScopedSchema,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => ({}),
  getRuntimeStore: () => holder.store,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
});

describe("GET /schema", () => {
  it("scoped: only included types, each with only its scoped properties", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({ method: "GET", url: "/api/runtime/hr_view/schema" });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.ontology.key).toBe("hr_view");

    const etKeys = body.entityTypes.map((et: { key: string }) => et.key).sort();
    expect(etKeys).toEqual(["company", "person"]);

    const person = body.entityTypes.find((et: { key: string }) => et.key === "person");
    const personProps = person.properties.map((p: { key: string }) => p.key).sort();
    expect(personProps).toEqual(["email", "name"]);

    const company = body.entityTypes.find((et: { key: string }) => et.key === "company");
    expect(company.properties.map((p: { key: string }) => p.key)).toEqual(["name"]);

    const rtKeys = body.relationTypes.map((rt: { key: string }) => rt.key);
    expect(rtKeys).toEqual(["works_for"]);
  });

  it("unscoped: the full schema", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({ method: "GET", url: "/api/runtime/full_ontology/schema" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entityTypes.map((et: { key: string }) => et.key).sort()).toEqual([
      "company",
      "department",
      "person",
    ]);
    expect(body.relationTypes.map((rt: { key: string }) => rt.key).sort()).toEqual([
      "belongs_to",
      "works_for",
    ]);
    const person = body.entityTypes.find((et: { key: string }) => et.key === "person");
    expect(person.properties.map((p: { key: string }) => p.key).sort()).toEqual([
      "active",
      "age",
      "email",
      "name",
    ]);
  });

  it("relation types carry their endpoint keys in the wire shape", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({ method: "GET", url: "/api/runtime/hr_view/schema" });

    const worksFor = res.json().relationTypes[0];
    expect(worksFor.fromEntityTypeKey).toBe("person");
    expect(worksFor.toEntityTypeKey).toBe("company");
  });

  it("an unknown ontology answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runtime/nonexistent/schema" });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /schema/entity-types", () => {
  it("scoped: lists only included entity types", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/entity-types",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((et: { key: string }) => et.key).sort()).toEqual([
      "company",
      "person",
    ]);
  });

  it("unscoped: lists every entity type", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/schema/entity-types",
    });

    expect(res.json().map((et: { key: string }) => et.key).sort()).toEqual([
      "company",
      "department",
      "person",
    ]);
  });
});

describe("GET /schema/entity-types/{key}", () => {
  it("scoped: returns only the scoped properties", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/entity-types/person",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.key).toBe("person");
    expect(body.properties.map((p: { key: string }) => p.key).sort()).toEqual([
      "email",
      "name",
    ]);
  });

  it("an out-of-scope type answers 404 — indistinguishable from nonexistent", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const outOfScope = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/entity-types/department",
    });
    const nonexistent = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/entity-types/ghost",
    });

    expect(outOfScope.statusCode).toBe(404);
    expect(nonexistent.statusCode).toBe(404);
    // Same code; the message names the requested key in both cases.
    expect(outOfScope.json().error.code).toBe(nonexistent.json().error.code);
  });
});

describe("GET /schema/relation-types", () => {
  it("scoped: lists only included relation types", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/relation-types",
    });

    expect(res.json().map((rt: { key: string }) => rt.key)).toEqual(["works_for"]);
  });

  it("unscoped: lists every relation type", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/schema/relation-types",
    });

    expect(res.json().map((rt: { key: string }) => rt.key).sort()).toEqual([
      "belongs_to",
      "works_for",
    ]);
  });
});

describe("GET /schema/relation-types/{key}", () => {
  it("scoped: returns the relation type with its properties", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/relation-types/works_for",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.key).toBe("works_for");
    expect(body.properties.map((p: { key: string }) => p.key).sort()).toEqual([
      "role",
      "since",
    ]);
  });

  it("an out-of-scope relation type answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/schema/relation-types/belongs_to",
    });

    expect(res.statusCode).toBe(404);
  });
});
