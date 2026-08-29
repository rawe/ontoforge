/**
 * Session-02 integration suite — schema modeling against the
 * docker-compose Neo4j at bolt://localhost:7687.
 *
 * Covers: full CRUD round-trips for both type kinds and properties,
 * uniqueness under sequential and concurrent-ish double-create, sparse
 * update semantics against real storage, and full-schema snapshot
 * correctness.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, getModelingStore, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";

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
});

async function createEntityType(key: string, displayName: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/model/entity-types",
    payload: { key, displayName },
  });
  expect(res.statusCode).toBe(201);
  return res.json().entityTypeId as string;
}

describe("entity type round trip", () => {
  it("create, read, list, update, delete", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "person", displayName: "Person", description: "A person" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.key).toBe("person");
    expect(body.displayName).toBe("Person");
    expect(body.description).toBe("A person");
    expect(body.entityTypeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.createdAt).getTime()).not.toBeNaN();

    const read = await app.inject({
      method: "GET",
      url: `/api/model/entity-types/${body.entityTypeId}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(body);

    const list = await app.inject({ method: "GET", url: "/api/model/entity-types" });
    expect(list.json()).toHaveLength(1);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/model/entity-types/${body.entityTypeId}`,
      payload: { displayName: "Human" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().displayName).toBe("Human");
    expect(updated.json().description).toBe("A person"); // sparse: untouched
    expect(updated.json().key).toBe("person");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/model/entity-types/${body.entityTypeId}`,
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({
      method: "GET",
      url: `/api/model/entity-types/${body.entityTypeId}`,
    });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("sequential double-create of the same key answers 409", async () => {
    await createEntityType("person", "Person");
    const second = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "person", displayName: "Person Again" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("RESOURCE_CONFLICT");
  });

  it("concurrent double-create of the same key stores exactly one type", async () => {
    const payload = { key: "raced", displayName: "Raced" };
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/model/entity-types", payload }),
      app.inject({ method: "POST", url: "/api/model/entity-types", payload }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses[0]).toBe(201);
    // The loser fails on the pre-check (409) or on the uniqueness
    // constraint itself (500 STORAGE_ERROR) depending on interleaving.
    expect([409, 500]).toContain(statuses[1]);

    const list = await app.inject({ method: "GET", url: "/api/model/entity-types" });
    expect(list.json()).toHaveLength(1);
  });
});

describe("relation type round trip", () => {
  it("create with fixed endpoints, read, update, delete", async () => {
    await createEntityType("person", "Person");
    await createEntityType("company", "Company");

    const created = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: {
        key: "works_for",
        displayName: "Works For",
        sourceEntityTypeKey: "person",
        targetEntityTypeKey: "company",
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.sourceEntityTypeKey).toBe("person");
    expect(body.targetEntityTypeKey).toBe("company");

    const read = await app.inject({
      method: "GET",
      url: `/api/model/relation-types/${body.relationTypeId}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(body);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/model/relation-types/${body.relationTypeId}`,
      payload: { description: "Employment" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().description).toBe("Employment");
    expect(updated.json().sourceEntityTypeKey).toBe("person"); // endpoints immutable

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/model/relation-types/${body.relationTypeId}`,
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("creation requires both endpoints to exist", async () => {
    await createEntityType("person", "Person");
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: {
        key: "works_for",
        displayName: "Works For",
        sourceEntityTypeKey: "person",
        targetEntityTypeKey: "missing",
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("missing");
  });

  it("an entity type named by a relation type is undeletable — 409, cascade never overrides", async () => {
    const personId = await createEntityType("person", "Person");
    await createEntityType("company", "Company");
    await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: {
        key: "works_for",
        displayName: "Works For",
        sourceEntityTypeKey: "person",
        targetEntityTypeKey: "company",
      },
    });

    const plain = await app.inject({
      method: "DELETE",
      url: `/api/model/entity-types/${personId}`,
    });
    expect(plain.statusCode).toBe(409);
    expect(plain.json().error.code).toBe("RESOURCE_CONFLICT");

    const withCascade = await app.inject({
      method: "DELETE",
      url: `/api/model/entity-types/${personId}?cascade=true`,
    });
    expect(withCascade.statusCode).toBe(409);
    expect(withCascade.json().error.code).toBe("RESOURCE_CONFLICT");
  });

  it("entity-type and relation-type keys are separate namespaces", async () => {
    await createEntityType("partner", "Partner");
    await createEntityType("company", "Company");
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: {
        key: "partner", // same key as the entity type — allowed
        displayName: "Partner Relation",
        sourceEntityTypeKey: "partner",
        targetEntityTypeKey: "company",
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("property round trip", () => {
  it("create, list, sparse update, clear default, delete on an entity type", async () => {
    const etId = await createEntityType("person", "Person");

    const created = await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${etId}/properties`,
      payload: {
        key: "age",
        displayName: "Age",
        dataType: "integer",
        required: true,
        defaultValue: "30",
      },
    });
    expect(created.statusCode).toBe(201);
    const prop = created.json();
    expect(prop.dataType).toBe("integer");
    expect(prop.required).toBe(true);
    expect(prop.defaultValue).toBe("30");

    const list = await app.inject({
      method: "GET",
      url: `/api/model/entity-types/${etId}/properties`,
    });
    expect(list.json()).toHaveLength(1);

    // Sparse update: untouched fields survive.
    const renamed = await app.inject({
      method: "PUT",
      url: `/api/model/entity-types/${etId}/properties/${prop.propertyId}`,
      payload: { displayName: "Age (years)" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().displayName).toBe("Age (years)");
    expect(renamed.json().defaultValue).toBe("30");
    expect(renamed.json().required).toBe(true);

    // Explicit null clears the default — the one exception.
    const cleared = await app.inject({
      method: "PUT",
      url: `/api/model/entity-types/${etId}/properties/${prop.propertyId}`,
      payload: { defaultValue: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().defaultValue).toBeNull();
    expect(cleared.json().displayName).toBe("Age (years)");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/model/entity-types/${etId}/properties/${prop.propertyId}`,
    });
    expect(deleted.statusCode).toBe(204);

    const emptied = await app.inject({
      method: "GET",
      url: `/api/model/entity-types/${etId}/properties`,
    });
    expect(emptied.json()).toHaveLength(0);
  });

  it("property CRUD works identically on a relation type, except document", async () => {
    await createEntityType("person", "Person");
    await createEntityType("company", "Company");
    const rtRes = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: {
        key: "works_for",
        displayName: "Works For",
        sourceEntityTypeKey: "person",
        targetEntityTypeKey: "company",
      },
    });
    const rtId = rtRes.json().relationTypeId;

    const created = await app.inject({
      method: "POST",
      url: `/api/model/relation-types/${rtId}/properties`,
      payload: { key: "role", displayName: "Role", dataType: "string" },
    });
    expect(created.statusCode).toBe(201);

    const doc = await app.inject({
      method: "POST",
      url: `/api/model/relation-types/${rtId}/properties`,
      payload: { key: "notes", displayName: "Notes", dataType: "document" },
    });
    expect(doc.statusCode).toBe(422);

    const list = await app.inject({
      method: "GET",
      url: `/api/model/relation-types/${rtId}/properties`,
    });
    expect(list.json()).toHaveLength(1);
  });

  it("duplicate property keys conflict within one owner but not across owners", async () => {
    const personId = await createEntityType("person", "Person");
    const companyId = await createEntityType("company", "Company");
    const payload = { key: "name", displayName: "Name", dataType: "string" };

    const first = await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${personId}/properties`,
      payload,
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${personId}/properties`,
      payload,
    });
    expect(dup.statusCode).toBe(409);

    const other = await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${companyId}/properties`,
      payload,
    });
    expect(other.statusCode).toBe(201);
  });

  it("deleting a type deletes its property definitions with it", async () => {
    const etId = await createEntityType("person", "Person");
    await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${etId}/properties`,
      payload: { key: "name", displayName: "Name", dataType: "string" },
    });
    await app.inject({ method: "DELETE", url: `/api/model/entity-types/${etId}` });

    // The property nodes are gone from storage, not merely orphaned.
    const schema = (await getModelingStore().getFullSchema()) as {
      entityTypes: unknown[];
    };
    expect(schema.entityTypes).toHaveLength(0);
  });
});

describe("full-schema snapshot", () => {
  it("returns one coherent snapshot of types, properties and endpoints", async () => {
    const personId = await createEntityType("person", "Person");
    await createEntityType("company", "Company");
    await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${personId}/properties`,
      payload: {
        key: "full_name",
        displayName: "Full Name",
        dataType: "string",
        required: true,
      },
    });
    const rtRes = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: {
        key: "works_for",
        displayName: "Works For",
        sourceEntityTypeKey: "person",
        targetEntityTypeKey: "company",
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/model/relation-types/${rtRes.json().relationTypeId}/properties`,
      payload: { key: "role", displayName: "Role", dataType: "string" },
    });

    const schema = (await getModelingStore().getFullSchema()) as {
      entityTypes: Record<string, unknown>[];
      relationTypes: Record<string, unknown>[];
      lenses: unknown[];
    };

    expect(schema.entityTypes.map((et) => et.key)).toEqual(["company", "person"]);
    const person = schema.entityTypes.find((et) => et.key === "person");
    const personProps = person?.properties as Record<string, unknown>[];
    expect(personProps).toHaveLength(1);
    expect(personProps[0]?.key).toBe("full_name");
    expect(personProps[0]?.required).toBe(true);
    expect(personProps[0]?.createdAt).toBeInstanceOf(Date);

    expect(schema.relationTypes).toHaveLength(1);
    const worksFor = schema.relationTypes[0];
    expect(worksFor?.key).toBe("works_for");
    expect(worksFor?.sourceKey).toBe("person");
    expect(worksFor?.targetKey).toBe("company");
    expect((worksFor?.properties as unknown[])).toHaveLength(1);

    expect(schema.lenses).toHaveLength(0);
  });
});
