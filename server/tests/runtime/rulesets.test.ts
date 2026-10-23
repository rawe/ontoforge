/**
 * Ruleset maintenance over a mocked store, through the lensless REST
 * routes: the anchor's state decided on every read against the full
 * schema, the PUT as a patch with its checks of the key, the level and the
 * anchor, and not found for an unknown key.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RulesetRecord, WriteAccess } from "../../src/core/ports.js";
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
  holder.store.indices.readFullSchema.mockResolvedValue({ ...makeFullSchema(), indices: [] });
  invalidateLoadedSchemaCache();
});

const URL = "/api/ontologies/test_ont/runtime/rulesets";
const ID = "11111111-1111-4111-8111-111111111111";

function record(
  key: string,
  anchor: RulesetRecord["anchor"],
  anchorFound: boolean,
  writeAccess: WriteAccess = "full",
): RulesetRecord {
  return { key, anchor, anchorFound, writeAccess };
}

function put(key: string, payload: object) {
  return app.inject({ method: "PUT", url: `${URL}/${key}`, payload });
}

describe("the anchor's state on every read", () => {
  it("is found when the entity is stored under a type of the full schema", async () => {
    holder.store.rulesetStore.get.mockResolvedValue(record("agent-a", { type: "person", id: ID }, true));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-a` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      key: "agent-a",
      anchor: { type: "person", id: ID, state: "found" },
      writeAccess: "full",
    });
    expect(holder.store.rulesetStore.get).toHaveBeenCalledWith("agent-a");
  });

  it("is no anchor (null) without an entity", async () => {
    holder.store.rulesetStore.get.mockResolvedValue(record("agent-u", null, false));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-u` });
    expect(res.json()).toEqual({ key: "agent-u", anchor: null, writeAccess: "full" });
  });

  it("is deleted when the entity is no longer stored", async () => {
    holder.store.rulesetStore.get.mockResolvedValue(record("agent-d", { type: "person", id: ID }, false));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-d` });
    expect(res.json()).toEqual({
      key: "agent-d",
      anchor: { type: "person", id: ID, state: "deleted" },
      writeAccess: "full",
    });
  });

  it("is deleted when the entity's type is no longer in the full schema", async () => {
    holder.store.rulesetStore.get.mockResolvedValue(record("agent-d", { type: "robot", id: ID }, true));
    const res = await app.inject({ method: "GET", url: `${URL}/agent-d` });
    expect(res.json().anchor.state).toBe("deleted");
  });

  it("shows each level of write access as stored", async () => {
    for (const level of ["none", "propose", "full"] as const) {
      holder.store.rulesetStore.get.mockResolvedValue(record("agent-w", null, false, level));
      const res = await app.inject({ method: "GET", url: `${URL}/agent-w` });
      expect(res.json()).toEqual({ key: "agent-w", anchor: null, writeAccess: level });
    }
  });

  it("lists every ruleset with its anchor's state", async () => {
    holder.store.rulesetStore.list.mockResolvedValue([
      record("a", { type: "person", id: ID }, true),
      record("b", null, false),
      record("c", { type: "person", id: ID }, false),
    ]);
    const res = await app.inject({ method: "GET", url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: { anchor: { state: string } | null }) => r.anchor?.state ?? null)).toEqual([
      "found",
      null,
      "deleted",
    ]);
  });

  it("an unknown key is not found, on read and delete", async () => {
    const read = await app.inject({ method: "GET", url: `${URL}/nope` });
    expect(read.statusCode).toBe(404);
    expect(read.json().error.message).toBe("Ruleset 'nope' not found");
    const deleted = await app.inject({ method: "DELETE", url: `${URL}/nope` });
    expect(deleted.statusCode).toBe(404);
  });

  it("DELETE removes a known key with 204", async () => {
    holder.store.rulesetStore.delete.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: `${URL}/agent-a` });
    expect(res.statusCode).toBe(204);
    expect(holder.store.rulesetStore.delete).toHaveBeenCalledWith("agent-a");
  });

  it("no /anchors route is registered", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/anchors" });
    expect(res.statusCode).toBe(404);
    expect(holder.store.rulesetStore.list).not.toHaveBeenCalled();
  });
});

describe("PUT, a patch", () => {
  it("sets the anchor at a stored entity and answers 200 with the ruleset", async () => {
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ann" }, "person", ID));
    holder.store.rulesetStore.save.mockResolvedValue(record("agent-a", { type: "person", id: ID }, true));
    const res = await put("agent-a", { anchor: { type: "person", id: ID } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      key: "agent-a",
      anchor: { type: "person", id: ID, state: "found" },
      writeAccess: "full",
    });
    expect(holder.store.getEntity).toHaveBeenCalledWith("person", ID);
    // No writeAccess sent: the store keeps the stored level.
    expect(holder.store.rulesetStore.save).toHaveBeenCalledWith("agent-a", {
      anchor: { type: "person", id: ID },
      writeAccess: undefined,
    });
  });

  it("null removes the anchor without reading an entity, and keeps write access", async () => {
    holder.store.rulesetStore.save.mockResolvedValue(record("agent-a", null, false, "propose"));
    const res = await put("agent-a", { anchor: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: "agent-a", anchor: null, writeAccess: "propose" });
    expect(holder.store.getEntity).not.toHaveBeenCalled();
    expect(holder.store.rulesetStore.save).toHaveBeenCalledWith("agent-a", { anchor: null, writeAccess: undefined });
  });

  it("an empty body creates or keeps the ruleset as it is", async () => {
    holder.store.rulesetStore.save.mockResolvedValue(record("agent-e", null, false));
    const res = await put("agent-e", {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: "agent-e", anchor: null, writeAccess: "full" });
    expect(holder.store.getEntity).not.toHaveBeenCalled();
    expect(holder.store.rulesetStore.save).toHaveBeenCalledWith("agent-e", {});
  });

  it("passes each level to the store and keeps the anchor", async () => {
    for (const level of ["none", "propose", "full"] as const) {
      holder.store.rulesetStore.save.mockResolvedValue(record("agent-s", { type: "person", id: ID }, true, level));
      const res = await put("agent-s", { writeAccess: level });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        key: "agent-s",
        anchor: { type: "person", id: ID, state: "found" },
        writeAccess: level,
      });
      expect(holder.store.rulesetStore.save).toHaveBeenLastCalledWith("agent-s", { anchor: undefined, writeAccess: level });
    }
    expect(holder.store.getEntity).not.toHaveBeenCalled();
  });

  it("an unknown level is a field error on writeAccess", async () => {
    for (const writeAccess of ["read", "FULL", ""]) {
      const res = await put("agent-a", { writeAccess });
      expect(res.statusCode, writeAccess).toBe(422);
      expect(res.json().error.details.fields).toEqual({
        writeAccess: `Must be one of none, propose, full, got '${writeAccess}'`,
      });
    }
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });

  it("an unknown level and a bad anchor are refused together", async () => {
    const res = await put("agent-a", { anchor: { type: "robot", id: ID }, writeAccess: "read" });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().error.details.fields)).toEqual(["writeAccess", "anchor.type"]);
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });

  it("a type not in the full schema is a field error on anchor.type", async () => {
    const res = await put("agent-a", { anchor: { type: "robot", id: ID } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({ "anchor.type": "Entity type 'robot' not found" });
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });

  it("a missing entity is a field error on anchor.id", async () => {
    const res = await put("agent-a", { anchor: { type: "person", id: ID } });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().error.details.fields)).toEqual(["anchor.id"]);
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });

  it("a writeAccess that is not a string is refused", async () => {
    for (const writeAccess of [true, 1, null]) {
      expect((await put("agent-a", { writeAccess })).statusCode, String(writeAccess)).toBe(422);
    }
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });

  it("an extra key, an old key, or a half anchor is refused", async () => {
    expect((await put("agent-a", { anchor: null, lens: "all" })).statusCode).toBe(422);
    expect((await put("agent-a", { entity: null })).statusCode).toBe(422);
    expect((await put("agent-a", { stagedOnly: true })).statusCode).toBe(422);
    expect((await put("agent-a", { anchor: { type: "person" } })).statusCode).toBe(422);
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });
});

describe("ruleset keys", () => {
  it.each(["agent-a", "a", "agent_b-2", "a".repeat(64)])("accepts %s", async (key) => {
    holder.store.rulesetStore.save.mockResolvedValue(record(key, null, false));
    const res = await put(key, { anchor: null });
    expect(res.statusCode).toBe(200);
  });

  it.each(["Agent-A", "agent%20a", "1agent", "-agent", "a".repeat(65)])("refuses %s with 422", async (key) => {
    const res = await put(key, { anchor: null });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/^Invalid ruleset key/);
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });
});
