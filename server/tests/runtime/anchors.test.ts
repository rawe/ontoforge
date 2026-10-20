/**
 * Anchor maintenance over a mocked store, through the lensless REST
 * routes: the state decided on every read against the full schema, the
 * PUT's checks of its key and entity, and not found for an unknown key.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnchorRecord } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeEntity, makeFullSchema, type MockRuntimeStore } from "./helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
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
  // The full schema: person, company and department.
  holder.store.indices.readFullSchema.mockResolvedValue(makeFullSchema());
  invalidateLoadedSchemaCache();
});

const URL = "/api/ontologies/test_ont/runtime/anchors";
const ID = "11111111-1111-4111-8111-111111111111";

function record(key: string, entity: AnchorRecord["entity"], entityFound: boolean, stagedOnly = false): AnchorRecord {
  return { key, entity, entityFound, stagedOnly };
}

function put(key: string, payload: object) {
  return app.inject({ method: "PUT", url: `${URL}/${key}`, payload });
}

describe("the state on every read", () => {
  it("is anchored when the entity is stored under a type of the full schema", async () => {
    holder.store.anchorStore.getAnchor.mockResolvedValue(record("agent-a", { type: "person", id: ID }, true));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-a` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: "agent-a", entity: { type: "person", id: ID }, state: "anchored", stagedOnly: false });
    expect(holder.store.anchorStore.getAnchor).toHaveBeenCalledWith("agent-a");
  });

  it("is unanchored without an entity", async () => {
    holder.store.anchorStore.getAnchor.mockResolvedValue(record("agent-u", null, false));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-u` });
    expect(res.json()).toEqual({ key: "agent-u", entity: null, state: "unanchored", stagedOnly: false });
  });

  it("is dangling when the entity is no longer stored", async () => {
    holder.store.anchorStore.getAnchor.mockResolvedValue(record("agent-d", { type: "person", id: ID }, false));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-d` });
    expect(res.json()).toEqual({ key: "agent-d", entity: { type: "person", id: ID }, state: "dangling", stagedOnly: false });
  });

  it("is dangling when the entity's type is no longer in the full schema", async () => {
    holder.store.anchorStore.getAnchor.mockResolvedValue(record("agent-d", { type: "robot", id: ID }, true));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-d` });
    expect(res.json().state).toBe("dangling");
  });

  it("lists every anchor with its state", async () => {
    holder.store.anchorStore.listAnchors.mockResolvedValue([
      record("a", { type: "person", id: ID }, true),
      record("b", null, false),
      record("c", { type: "person", id: ID }, false),
    ]);
    const res = await app.inject({ method: "GET", url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((a: { state: string }) => a.state)).toEqual(["anchored", "unanchored", "dangling"]);
  });

  it("an unknown key is not found, on read and delete", async () => {
    const read = await app.inject({ method: "GET", url: `${URL}/nope` });
    expect(read.statusCode).toBe(404);
    expect(read.json().error.message).toBe("Anchor 'nope' not found");
    const deleted = await app.inject({ method: "DELETE", url: `${URL}/nope` });
    expect(deleted.statusCode).toBe(404);
  });

  it("DELETE removes a known key with 204", async () => {
    holder.store.anchorStore.deleteAnchor.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: `${URL}/agent-a` });
    expect(res.statusCode).toBe(204);
    expect(holder.store.anchorStore.deleteAnchor).toHaveBeenCalledWith("agent-a");
  });
});

describe("PUT", () => {
  it("points the anchor at a stored entity and answers 200 with the record", async () => {
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ann" }, "person", ID));
    holder.store.anchorStore.saveAnchor.mockResolvedValue(record("agent-a", { type: "person", id: ID }, true));
    const res = await put("agent-a", { entity: { type: "person", id: ID } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: "agent-a", entity: { type: "person", id: ID }, state: "anchored", stagedOnly: false });
    expect(holder.store.getEntity).toHaveBeenCalledWith("person", ID);
    // No stagedOnly sent: the store keeps the stored flag.
    expect(holder.store.anchorStore.saveAnchor).toHaveBeenCalledWith("agent-a", { type: "person", id: ID }, undefined);
  });

  it("null unanchors without reading an entity", async () => {
    holder.store.anchorStore.saveAnchor.mockResolvedValue(record("agent-a", null, false));
    const res = await put("agent-a", { entity: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: "agent-a", entity: null, state: "unanchored", stagedOnly: false });
    expect(holder.store.getEntity).not.toHaveBeenCalled();
    expect(holder.store.anchorStore.saveAnchor).toHaveBeenCalledWith("agent-a", null, undefined);
  });

  it("a type not in the full schema is a field error on entity.type", async () => {
    const res = await put("agent-a", { entity: { type: "robot", id: ID } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({ "entity.type": "Entity type 'robot' not found" });
    expect(holder.store.anchorStore.saveAnchor).not.toHaveBeenCalled();
  });

  it("a missing entity is a field error on entity.id", async () => {
    const res = await put("agent-a", { entity: { type: "person", id: ID } });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().error.details.fields)).toEqual(["entity.id"]);
    expect(holder.store.anchorStore.saveAnchor).not.toHaveBeenCalled();
  });

  it("passes stagedOnly to the store and reports it", async () => {
    holder.store.anchorStore.saveAnchor.mockResolvedValue(record("agent-s", null, false, true));
    const res = await put("agent-s", { entity: null, stagedOnly: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: "agent-s", entity: null, state: "unanchored", stagedOnly: true });
    expect(holder.store.anchorStore.saveAnchor).toHaveBeenCalledWith("agent-s", null, true);
    await put("agent-s", { entity: null, stagedOnly: false });
    expect(holder.store.anchorStore.saveAnchor).toHaveBeenLastCalledWith("agent-s", null, false);
  });

  it("a stagedOnly that is not a boolean is refused", async () => {
    for (const stagedOnly of ["true", 1, null]) {
      expect((await put("agent-a", { entity: null, stagedOnly })).statusCode, String(stagedOnly)).toBe(422);
    }
    expect(holder.store.anchorStore.saveAnchor).not.toHaveBeenCalled();
  });

  it("a body without entity, or with an extra key, is refused", async () => {
    expect((await put("agent-a", {})).statusCode).toBe(422);
    expect((await put("agent-a", { entity: null, lens: "all" })).statusCode).toBe(422);
    expect((await put("agent-a", { entity: { type: "person" } })).statusCode).toBe(422);
    expect((await put("agent-a", { stagedOnly: true })).statusCode).toBe(422);
    expect(holder.store.anchorStore.saveAnchor).not.toHaveBeenCalled();
  });
});

describe("anchor keys", () => {
  it.each(["agent-a", "a", "agent_b-2", "a".repeat(64)])("accepts %s", async (key) => {
    holder.store.anchorStore.saveAnchor.mockResolvedValue(record(key, null, false));
    const res = await put(key, { entity: null });
    expect(res.statusCode).toBe(200);
  });

  it.each(["Agent-A", "agent%20a", "1agent", "-agent", "a".repeat(65)])("refuses %s with 422", async (key) => {
    const res = await put(key, { entity: null });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/^Invalid anchor key/);
    expect(holder.store.anchorStore.saveAnchor).not.toHaveBeenCalled();
  });
});
