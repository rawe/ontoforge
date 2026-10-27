/**
 * Relation-type REST behavior over a mocked store, including the
 * key-pattern rejections.
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
  parent: null,
  onePerPair: false,
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
    holder.store.createRelationType.mockResolvedValue({ row: RT_DATA });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types",
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
      url: "/api/ontologies/onto/model/relation-types",
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(409);
  });

  it("a missing source endpoint answers 422 naming it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types",
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
      url: "/api/ontologies/onto/model/relation-types",
      payload: { ...CREATE_PAYLOAD, targetEntityTypeKey: "nonexistent" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("nonexistent");
  });

  it("list returns every stored type", async () => {
    holder.store.listRelationTypes.mockResolvedValue([RT_DATA]);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/relation-types" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key).toBe("works_for");
  });

  it("read by id answers the stored type", async () => {
    holder.store.getRelationType.mockResolvedValue(RT_DATA);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/relation-types/rt-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("works_for");
  });

  it("read of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/onto/model/relation-types/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("update changes the display name", async () => {
    holder.store.getRelationType.mockResolvedValue(RT_DATA);
    holder.store.updateRelationType.mockResolvedValue({
      ...RT_DATA,
      displayName: "Employed By",
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/rt-1",
      payload: { displayName: "Employed By" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Employed By");
  });

  it("update of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/nonexistent",
      payload: { displayName: "Whatever" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("delete answers 204", async () => {
    holder.store.deleteRelationType.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/onto/model/relation-types/rt-1" });
    expect(res.statusCode).toBe(204);
  });

  it("a type included by a lens without cascade answers 409 CASCADE_REQUIRED", async () => {
    holder.store.findLensesIncludingType.mockResolvedValue(["my_lens"]);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/onto/model/relation-types/rt-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
  });

  it("a type included by a lens deletes with cascade", async () => {
    holder.store.findLensesIncludingType.mockResolvedValue(["my_lens"]);
    holder.store.removeAllIncludesForType.mockResolvedValue(1);
    holder.store.deleteRelationType.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/relation-types/rt-1?cascade=true",
    });
    expect(res.statusCode).toBe(204);
  });

  it("delete of a missing id answers 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/relation-types/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("the parent end", () => {
  it("create passes parent to the store and returns it", async () => {
    holder.store.getEntityTypeByKey
      .mockResolvedValueOnce(SOURCE_ET)
      .mockResolvedValueOnce(TARGET_ET);
    holder.store.createRelationType.mockResolvedValue({ row: { ...RT_DATA, parent: "target", onePerPair: true } });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types",
      payload: { ...CREATE_PAYLOAD, parent: "target" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().parent).toBe("target");
    expect(res.json().onePerPair).toBe(true);
    expect(holder.store.createRelationType).toHaveBeenCalledWith(
      expect.any(String),
      "works_for",
      "Works For",
      null,
      "person",
      "company",
      { parent: "target", onePerPair: true },
    );
  });

  it("create without parent stores null; reads return null when unset", async () => {
    holder.store.getEntityTypeByKey
      .mockResolvedValueOnce(SOURCE_ET)
      .mockResolvedValueOnce(TARGET_ET);
    holder.store.createRelationType.mockResolvedValue({ row: { ...RT_DATA, parent: null } });
    const created = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types",
      payload: CREATE_PAYLOAD,
    });
    expect(created.json().parent).toBeNull();
    expect(holder.store.createRelationType.mock.calls[0]![6]).toEqual({ parent: null, onePerPair: false });

    holder.store.getRelationType.mockResolvedValue({ ...RT_DATA, parent: null });
    const read = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/relation-types/rt-1" });
    expect(read.json().parent).toBeNull();
    holder.store.listRelationTypes.mockResolvedValue([{ ...RT_DATA, parent: "source" }]);
    const list = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/relation-types" });
    expect(list.json()[0].parent).toBe("source");
  });

  it.each([
    ["sets it", null, { parent: "source" }, "source"],
    ["flips it", "source", { parent: "target" }, "target"],
    ["clears it on an explicit null, keeping one per pair", "source", { parent: null }, null],
  ] as const)("update %s through the rules write", async (_case, stored, payload, parent) => {
    holder.store.getRelationType.mockResolvedValue({ ...RT_DATA, parent: stored, onePerPair: stored !== null });
    holder.store.setRelationTypeRules.mockResolvedValue({ row: { ...RT_DATA, parent, onePerPair: true } });
    holder.store.updateRelationType.mockResolvedValue({ ...RT_DATA, parent, onePerPair: true });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/rt-1",
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().parent).toBe(parent);
    expect(holder.store.setRelationTypeRules).toHaveBeenCalledWith("rt-1", { parent, onePerPair: true });
  });

  it.each([
    ["omitted", { displayName: "Owns" }],
    ["the stored one", { parent: "source", displayName: "Owns" }],
    ["one per pair on, as the parent end holds it", { onePerPair: true, displayName: "Owns" }],
  ])("update leaves the rules unwritten when they are %s", async (_case, payload) => {
    holder.store.getRelationType.mockResolvedValue({ ...RT_DATA, parent: "source", onePerPair: true });
    holder.store.updateRelationType.mockResolvedValue({ ...RT_DATA, displayName: "Owns", parent: "source" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/rt-1",
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(holder.store.setRelationTypeRules).not.toHaveBeenCalled();
    expect(holder.store.updateRelationType).toHaveBeenCalledWith("rt-1", "Owns", null);
  });

  const VIOLATIONS = [
    { rule: "two_parents", count: 1, entities: [{ type: "customer", id: "c-1" }] },
    { rule: "cycle", count: 2, entities: [{ type: "task", id: "t-1" }, { type: "task", id: "t-2" }] },
  ];

  it("a refused rules write answers 409 with the violation list and writes nothing else", async () => {
    holder.store.getRelationType.mockResolvedValue({ ...RT_DATA, parent: "source", onePerPair: true });
    holder.store.setRelationTypeRules.mockResolvedValue({ violations: VIOLATIONS });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/rt-1",
      payload: { parent: "target", displayName: "Renamed" },
    });
    expect(res.statusCode).toBe(409);
    const error = res.json().error;
    expect(error.code).toBe("RESOURCE_CONFLICT");
    expect(error.message).toContain("two_parents: 1, cycle: 2");
    expect(error.details).toEqual({ violations: VIOLATIONS });
    expect(holder.store.updateRelationType).not.toHaveBeenCalled();
  });

  it("a refused create with the flag answers 409 with the violation list", async () => {
    holder.store.getEntityTypeByKey
      .mockResolvedValueOnce(SOURCE_ET)
      .mockResolvedValueOnce(TARGET_ET);
    holder.store.createRelationType.mockResolvedValue({ violations: VIOLATIONS.slice(0, 1) });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types",
      payload: { ...CREATE_PAYLOAD, parent: "target" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(res.json().error.details).toEqual({ violations: VIOLATIONS.slice(0, 1) });
  });

  it("the rules write of a type deleted meanwhile answers 404", async () => {
    holder.store.getRelationType.mockResolvedValue({ ...RT_DATA, parent: null });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/rt-1",
      payload: { parent: "source" },
    });
    expect(res.statusCode).toBe(404);
  });

  it.each([["POST"], ["PUT"]] as const)("%s rejects a parent other than source or target with 422", async (method) => {
    const res = await app.inject({
      method,
      url: `/api/ontologies/onto/model/relation-types${method === "PUT" ? "/rt-1" : ""}`,
      payload: method === "PUT" ? { parent: "middle" } : { ...CREATE_PAYLOAD, parent: "middle" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(holder.store.createRelationType).not.toHaveBeenCalled();
    expect(holder.store.updateRelationType).not.toHaveBeenCalled();
    expect(holder.store.setRelationTypeRules).not.toHaveBeenCalled();
  });
});

describe("one per pair", () => {
  it("create passes it to the store and returns it", async () => {
    holder.store.getEntityTypeByKey
      .mockResolvedValueOnce(SOURCE_ET)
      .mockResolvedValueOnce(TARGET_ET);
    holder.store.createRelationType.mockResolvedValue({ row: { ...RT_DATA, onePerPair: true } });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types",
      payload: { ...CREATE_PAYLOAD, onePerPair: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().onePerPair).toBe(true);
    expect(holder.store.createRelationType.mock.calls[0]![6]).toEqual({ parent: null, onePerPair: true });
  });

  it.each([
    ["turns it on", false, true],
    ["turns it off", true, false],
  ] as const)("update %s through the rules write", async (_case, stored, onePerPair) => {
    holder.store.getRelationType.mockResolvedValue({ ...RT_DATA, onePerPair: stored });
    holder.store.setRelationTypeRules.mockResolvedValue({ row: { ...RT_DATA, onePerPair } });
    holder.store.updateRelationType.mockResolvedValue({ ...RT_DATA, onePerPair });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/rt-1",
      payload: { onePerPair },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().onePerPair).toBe(onePerPair);
    expect(holder.store.setRelationTypeRules).toHaveBeenCalledWith("rt-1", { parent: null, onePerPair });
  });

  it.each([
    ["create", "POST", { ...CREATE_PAYLOAD, parent: "source", onePerPair: false }],
    ["update", "PUT", { onePerPair: false }],
  ] as const)("%s refuses it off with a parent end, with a field error", async (_case, method, payload) => {
    holder.store.getRelationType.mockResolvedValue({ ...RT_DATA, parent: "source", onePerPair: true });
    holder.store.getEntityTypeByKey.mockResolvedValueOnce(SOURCE_ET).mockResolvedValueOnce(TARGET_ET);
    const res = await app.inject({
      method,
      url: `/api/ontologies/onto/model/relation-types${method === "PUT" ? "/rt-1" : ""}`,
      payload,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields.onePerPair).toContain("always one per pair");
    expect(holder.store.createRelationType).not.toHaveBeenCalled();
    expect(holder.store.setRelationTypeRules).not.toHaveBeenCalled();
  });

  it("a refused turn on answers 409 with the duplicate pairs", async () => {
    const violations = [{ rule: "duplicate_pair", count: 3, entities: [{ type: "person", id: "p-1" }] }];
    holder.store.getRelationType.mockResolvedValue(RT_DATA);
    holder.store.setRelationTypeRules.mockResolvedValue({ violations });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/relation-types/rt-1",
      payload: { onePerPair: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("cannot take one per pair");
    expect(res.json().error.details).toEqual({ violations });
  });
});

describe("key pattern", () => {
  it.each([["WorksFor"], ["_works_for"], ["1works"]])(
    "rejects the invalid key %s with 422 VALIDATION_ERROR",
    async (key) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies/onto/model/relation-types",
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
      url: "/api/ontologies/onto/model/relation-types",
      payload: { ...CREATE_PAYLOAD, key: "k".repeat(65) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(holder.store.createRelationType).not.toHaveBeenCalled();
  });
});
