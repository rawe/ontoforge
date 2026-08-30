/**
 * Type keys reserved by the storage adapter are rejected at creation time.
 * The adapter-declared sets themselves are pinned in
 * `tests/adapters/reserved-keys.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockModelingStore,
  NOW,
  RESERVED_ENTITY_TYPE_KEYS,
  RESERVED_RELATION_TYPE_KEYS,
  type MockModelingStore,
} from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getLegacyModelingStore: async () => holder.store,
  getRuntimeStore: async () => ({}),
  getLegacyRuntimeStore: async () => ({}),
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
  holder.store = createMockModelingStore();
});

describe("entity types", () => {
  it.each(RESERVED_ENTITY_TYPE_KEYS.map((key) => [key]))(
    "rejects the reserved key %s before any store write",
    async (key) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies/onto/model/entity-types",
        payload: { key, displayName: "Injected" },
      });
      expect(res.statusCode).toBe(422);
      const error = res.json().error;
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain(key);
      expect(error.message).toContain("reserved");
      expect(holder.store.createEntityType).not.toHaveBeenCalled();
    },
  );

  it("the message lists the whole reserved set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types",
      payload: { key: "ontology", displayName: "Injected" },
    });
    const message = res.json().error.message;
    for (const key of RESERVED_ENTITY_TYPE_KEYS) {
      expect(message).toContain(key);
    }
  });

  it("the message names no vendor and no physical name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types",
      payload: { key: "ontology", displayName: "Injected" },
    });
    const message = res.json().error.message as string;
    expect(message.toLowerCase()).not.toContain("neo4j");
    expect(message.toLowerCase()).not.toContain("label");
    expect(message).not.toContain("Ontology"); // the physical label never leaks
  });

  it("only exact collisions are reserved — a near-miss key is fine", async () => {
    holder.store.createEntityType.mockResolvedValue({
      entityTypeId: "et-1",
      key: "ontology_note",
      displayName: "Ontology Note",
      description: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types",
      payload: { key: "ontology_note", displayName: "Ontology Note" },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("relation types", () => {
  it.each(RESERVED_RELATION_TYPE_KEYS.map((key) => [key]))(
    "rejects the reserved key %s before any store write",
    async (key) => {
      holder.store.getEntityTypeByKey.mockResolvedValue({ key: "person" });
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies/onto/model/relation-types",
        payload: {
          key,
          displayName: "Injected",
          sourceEntityTypeKey: "person",
          targetEntityTypeKey: "person",
        },
      });
      expect(res.statusCode).toBe(422);
      const error = res.json().error;
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain(key);
      expect(error.message).toContain("reserved");
      expect(holder.store.createRelationType).not.toHaveBeenCalled();
    },
  );

  it("the message names no vendor and no physical name", async () => {
    holder.store.getEntityTypeByKey.mockResolvedValue({ key: "person" });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types",
      payload: {
        key: "has_property",
        displayName: "Injected",
        sourceEntityTypeKey: "person",
        targetEntityTypeKey: "person",
      },
    });
    const message = res.json().error.message as string;
    expect(message.toLowerCase()).not.toContain("neo4j");
    expect(message).not.toContain("HAS_PROPERTY"); // the physical type never leaks
  });
});
