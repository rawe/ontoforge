/**
 * Entity-type REST behavior over a mocked store, including the key-pattern
 * rejections.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => holder.store,
  getRuntimeStore: () => ({}),
}));

const ET_DATA = {
  entityTypeId: "et-1",
  key: "person",
  displayName: "Person",
  description: "A person entity",
  createdAt: NOW,
  updatedAt: NOW,
};

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
  holder.store = createMockModelingStore();
});

describe("entity type CRUD", () => {
  it("create answers 201 with the id-bearing response shape", async () => {
    holder.store.createEntityType.mockResolvedValue(ET_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "person", displayName: "Person", description: "A person entity" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.entityTypeId).toBe("et-1");
    expect(body.key).toBe("person");
    expect(body.displayName).toBe("Person");
  });

  it("a duplicate key answers 409 RESOURCE_CONFLICT", async () => {
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "person", displayName: "Person" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
  });

  it("list returns every stored type", async () => {
    holder.store.listEntityTypes.mockResolvedValue([ET_DATA]);
    const res = await app.inject({ method: "GET", url: "/api/model/entity-types" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key).toBe("person");
  });

  it("read by id answers the stored type", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    const res = await app.inject({ method: "GET", url: "/api/model/entity-types/et-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().entityTypeId).toBe("et-1");
  });

  it("read of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/model/entity-types/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("update changes the display name", async () => {
    holder.store.updateEntityType.mockResolvedValue({ ...ET_DATA, displayName: "Updated Person" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/et-1",
      payload: { displayName: "Updated Person" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Updated Person");
  });

  it("update of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/nonexistent",
      payload: { displayName: "Whatever" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("delete answers 204", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.deleteEntityType.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/model/entity-types/et-1" });
    expect(res.statusCode).toBe(204);
  });

  it("delete of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("deletion protections", () => {
  it("a type referenced by a relation type answers an unconditional 409 RESOURCE_CONFLICT", async () => {
    holder.store.isEntityTypeReferenced.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/model/entity-types/et-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
  });

  it("cascade never overrides the referenced-by-relation-type conflict", async () => {
    holder.store.isEntityTypeReferenced.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1?cascade=true",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(holder.store.deleteEntityType).not.toHaveBeenCalled();
  });

  it("a type included by a lens without cascade answers 409 CASCADE_REQUIRED", async () => {
    holder.store.findOntologiesIncludingType.mockResolvedValue(["my_ontology"]);
    const res = await app.inject({ method: "DELETE", url: "/api/model/entity-types/et-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
    expect(res.json().error.details.affectedOntologies).toContain("my_ontology");
  });

  it("a type included by a lens deletes with cascade", async () => {
    holder.store.findOntologiesIncludingType.mockResolvedValue(["my_ontology"]);
    holder.store.removeAllIncludesForType.mockResolvedValue(1);
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.deleteEntityType.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1?cascade=true",
    });
    expect(res.statusCode).toBe(204);
    expect(holder.store.removeAllIncludesForType).toHaveBeenCalledWith("EntityType", "et-1");
  });
});

describe("key pattern", () => {
  it.each([["Person"], ["_person"], ["1person"], ["per-son"]])(
    "rejects the invalid key %s with 422 VALIDATION_ERROR in the envelope",
    async (key) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/model/entity-types",
        payload: { key, displayName: "Person" },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(holder.store.createEntityType).not.toHaveBeenCalled();
    },
  );

  // The cap is 64 characters, uniformly on every key kind.
  it("rejects a 65-character key with 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "k".repeat(65), displayName: "Person" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("accepts a key of exactly 64 characters", async () => {
    holder.store.createEntityType.mockResolvedValue({
      ...ET_DATA,
      key: "k".repeat(64),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "k".repeat(64), displayName: "Person" },
    });
    expect(res.statusCode).toBe(201);
  });
});
