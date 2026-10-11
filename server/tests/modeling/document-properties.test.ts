/**
 * Modeling-side document properties: accepted on an entity type;
 * `document` rejected on relation types is covered in
 * `properties.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getSearchIndexStore: async () => holder.store.searchIndices(),
  getRuntimeStore: async () => ({}),
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
      url: "/api/ontologies/onto/model/entity-types/et-1/properties",
      payload: { key: "bio", displayName: "Bio", dataType: "document" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().dataType).toBe("document");
  });
});
