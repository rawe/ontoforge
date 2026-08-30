/**
 * Lens CRUD over a mocked store, including the key-immutability
 * and key-pattern rules.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getLegacyModelingStore: async () => holder.store,
  getRuntimeStore: async () => ({}),
  getLegacyRuntimeStore: async () => ({}),
}));

const LENS_DATA = {
  lensId: "lens-1",
  key: "test_lens",
  name: "Test Lens",
  description: "A test lens",
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

describe("lens CRUD", () => {
  it("create answers 201 with the id-bearing response shape", async () => {
    holder.store.createLens.mockResolvedValue(LENS_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses",
      payload: { key: "test_lens", name: "Test Lens", description: "A test lens" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.lensId).toBe("lens-1");
    expect(body.key).toBe("test_lens");
    expect(body.name).toBe("Test Lens");
  });

  it("a duplicate key answers 409 RESOURCE_CONFLICT", async () => {
    holder.store.getLensByKey.mockResolvedValue(LENS_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses",
      payload: { key: "test_lens", name: "Other Name" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(res.json().error.message).toContain("key 'test_lens'");
  });

  it("a duplicate name answers 409 RESOURCE_CONFLICT — names are unique too", async () => {
    holder.store.getLensByName.mockResolvedValue(LENS_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses",
      payload: { key: "other_key", name: "Test Lens" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(res.json().error.message).toContain("name 'Test Lens'");
  });

  it("a key violating the pattern is rejected 422", async () => {
    for (const key of ["BadKey", "1starts_with_digit", "has-dash", "_underscore_first"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies/onto/model/lenses",
        payload: { key, name: "Whatever" },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  // The cap is 64 characters, uniformly on every key kind.
  it("a key longer than 64 characters is rejected 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses",
      payload: { key: "k".repeat(65), name: "Whatever" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(holder.store.createLens).not.toHaveBeenCalled();
  });

  it("list returns every stored lens", async () => {
    holder.store.listLenses.mockResolvedValue([LENS_DATA]);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/lenses" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key).toBe("test_lens");
  });

  it("read by id answers the stored lens", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/lenses/lens-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lensId).toBe("lens-1");
  });

  it("read of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/onto/model/lenses/nonexistent",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("update changes the name", async () => {
    holder.store.updateLens.mockResolvedValue({ ...LENS_DATA, name: "Updated Name" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/lens-1",
      payload: { name: "Updated Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
  });

  it("update to a name held by another lens answers 409", async () => {
    holder.store.getLensByName.mockResolvedValue({ ...LENS_DATA, lensId: "lens-2" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/lens-1",
      payload: { name: "Test Lens" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("update keeping one's own name is not a conflict", async () => {
    holder.store.getLensByName.mockResolvedValue(LENS_DATA);
    holder.store.updateLens.mockResolvedValue(LENS_DATA);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/lens-1",
      payload: { name: "Test Lens" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("update of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/nonexistent",
      payload: { name: "Whatever" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("the key is immutable — absent from the update surface, ignored if sent", async () => {
    holder.store.updateLens.mockResolvedValue(LENS_DATA);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/lens-1",
      payload: { key: "new_key", name: "Test Lens" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("test_lens");
    // The store never receives a key argument on update.
    expect(holder.store.updateLens).toHaveBeenCalledWith("lens-1", "Test Lens", null);
  });

  it("delete answers 204 — always permitted, no consent step", async () => {
    holder.store.deleteLens.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/onto/model/lenses/lens-1" });
    expect(res.statusCode).toBe(204);
  });

  it("delete of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});
