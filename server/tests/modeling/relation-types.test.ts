/**
 * Relation-type REST behavior over a mocked store, including the
 * key-pattern rejections.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => holder.store,
  getRuntimeStore: () => ({}),
}));

const SOURCE_ET = {
  entityTypeId: "et-src",
  key: "person",
  displayName: "Person",
  createdAt: NOW,
  updatedAt: NOW,
};

const TARGET_ET = {
  entityTypeId: "et-tgt",
  key: "company",
  displayName: "Company",
  createdAt: NOW,
  updatedAt: NOW,
};

const RT_DATA = {
  relationTypeId: "rt-1",
  key: "works_for",
  displayName: "Works For",
  description: null,
  sourceEntityTypeKey: "person",
  targetEntityTypeKey: "company",
  createdAt: NOW,
  updatedAt: NOW,
};

const CREATE_PAYLOAD = {
  key: "works_for",
  displayName: "Works For",
  sourceEntityTypeKey: "person",
  targetEntityTypeKey: "company",
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

describe("relation type CRUD", () => {
  it("create answers 201 with the fixed endpoints in the response", async () => {
    holder.store.getEntityTypeByKey
      .mockResolvedValueOnce(SOURCE_ET)
      .mockResolvedValueOnce(TARGET_ET);
    holder.store.createRelationType.mockResolvedValue(RT_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.relationTypeId).toBe("rt-1");
    expect(body.sourceEntityTypeKey).toBe("person");
    expect(body.targetEntityTypeKey).toBe("company");
  });

  it("a duplicate key answers 409", async () => {
    holder.store.getRelationTypeByKey.mockResolvedValue(RT_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(409);
  });

  it("a missing source endpoint answers 422 naming it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: { ...CREATE_PAYLOAD, sourceEntityTypeKey: "nonexistent" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.message).toContain("nonexistent");
  });

  it("a missing target endpoint answers 422 naming it", async () => {
    holder.store.getEntityTypeByKey
      .mockResolvedValueOnce(SOURCE_ET)
      .mockResolvedValueOnce(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: { ...CREATE_PAYLOAD, targetEntityTypeKey: "nonexistent" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("nonexistent");
  });

  it("list returns every stored type", async () => {
    holder.store.listRelationTypes.mockResolvedValue([RT_DATA]);
    const res = await app.inject({ method: "GET", url: "/api/model/relation-types" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key).toBe("works_for");
  });

  it("read by id answers the stored type", async () => {
    holder.store.getRelationType.mockResolvedValue(RT_DATA);
    const res = await app.inject({ method: "GET", url: "/api/model/relation-types/rt-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("works_for");
  });

  it("read of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/model/relation-types/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("update changes the display name", async () => {
    holder.store.updateRelationType.mockResolvedValue({
      ...RT_DATA,
      displayName: "Employed By",
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/model/relation-types/rt-1",
      payload: { displayName: "Employed By" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Employed By");
  });

  it("update of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/model/relation-types/nonexistent",
      payload: { displayName: "Whatever" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("delete answers 204", async () => {
    holder.store.deleteRelationType.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/model/relation-types/rt-1" });
    expect(res.statusCode).toBe(204);
  });

  it("a type included by a lens without cascade answers 409 CASCADE_REQUIRED", async () => {
    holder.store.findOntologiesIncludingType.mockResolvedValue(["my_ontology"]);
    const res = await app.inject({ method: "DELETE", url: "/api/model/relation-types/rt-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
  });

  it("a type included by a lens deletes with cascade", async () => {
    holder.store.findOntologiesIncludingType.mockResolvedValue(["my_ontology"]);
    holder.store.removeAllIncludesForType.mockResolvedValue(1);
    holder.store.deleteRelationType.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/relation-types/rt-1?cascade=true",
    });
    expect(res.statusCode).toBe(204);
  });

  it("delete of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/relation-types/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("key pattern", () => {
  it.each([["WorksFor"], ["_works_for"], ["1works"]])(
    "rejects the invalid key %s with 422 VALIDATION_ERROR",
    async (key) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/model/relation-types",
        payload: { ...CREATE_PAYLOAD, key },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(holder.store.createRelationType).not.toHaveBeenCalled();
    },
  );

  // The cap is 64 characters, uniformly on every key kind. Endpoints are
  // mocked present so the key length is the only possible rejection cause.
  it("rejects a 65-character key with 422", async () => {
    holder.store.getEntityTypeByKey
      .mockResolvedValueOnce(SOURCE_ET)
      .mockResolvedValueOnce(TARGET_ET);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types",
      payload: { ...CREATE_PAYLOAD, key: "k".repeat(65) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(holder.store.createRelationType).not.toHaveBeenCalled();
  });
});
