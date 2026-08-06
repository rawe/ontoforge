/**
 * Modeling-side document property lifecycle: the chunk cascade. Chunk
 * cleanup is unconditional and lives here; `document` rejected on relation
 * types is covered in `properties.test.ts`.
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
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const DOC_PROP_DATA = {
  propertyId: "prop-1",
  key: "bio",
  displayName: "Bio",
  description: null,
  dataType: "document",
  required: false,
  defaultValue: null,
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

describe("document property creation", () => {
  it("accepts the type on an entity type", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getPropertyByKey.mockResolvedValue(null);
    holder.store.createProperty.mockResolvedValue(DOC_PROP_DATA);

    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/et-1/properties",
      payload: { key: "bio", displayName: "Bio", dataType: "document" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().dataType).toBe("document");
  });
});

describe("document property deletion", () => {
  it("drops the property's chunks", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getProperty.mockResolvedValue(DOC_PROP_DATA);
    holder.store.deleteProperty.mockResolvedValue(true);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1/properties/prop-1",
    });

    expect(res.statusCode).toBe(204);
    expect(holder.store.deleteChunksForTypeProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.deleteChunksForTypeProperty).toHaveBeenCalledWith("person", "bio");
  });

  it("deleting a string property leaves chunks alone", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getProperty.mockResolvedValue({
      ...DOC_PROP_DATA,
      key: "name",
      dataType: "string",
    });
    holder.store.deleteProperty.mockResolvedValue(true);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1/properties/prop-1",
    });

    expect(res.statusCode).toBe(204);
    expect(holder.store.deleteChunksForTypeProperty).not.toHaveBeenCalled();
  });
});

describe("entity type deletion", () => {
  it("cascades chunk cleanup for each document property only", async () => {
    holder.store.isEntityTypeReferenced.mockResolvedValue(false);
    holder.store.findOntologiesIncludingType.mockResolvedValue([]);
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { ...DOC_PROP_DATA },
      { ...DOC_PROP_DATA, propertyId: "prop-2", key: "name", dataType: "string" },
    ]);
    holder.store.deleteEntityType.mockResolvedValue(true);

    const res = await app.inject({ method: "DELETE", url: "/api/model/entity-types/et-1" });

    expect(res.statusCode).toBe(204);
    // Only the document property cascades chunk cleanup.
    expect(holder.store.deleteChunksForTypeProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.deleteChunksForTypeProperty).toHaveBeenCalledWith("person", "bio");
  });
});
