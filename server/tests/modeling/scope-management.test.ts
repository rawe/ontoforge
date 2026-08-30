/**
 * Scope inclusion behavior over a mocked store, including
 * upsert-on-re-add, the absent-vs-empty allowlist round-trip, and the
 * id-vs-key addressing asymmetry.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getRuntimeStore: async () => ({}),
}));

const LENS_DATA = {
  lensId: "lens-1",
  key: "my_lens",
  name: "My Lens",
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const ET_DATA = {
  entityTypeId: "et-1",
  key: "person",
  displayName: "Person",
  description: null,
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

describe("add entity type inclusion", () => {
  it("include with properties omitted means all properties (allowlist absent)", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    holder.store.addIncludesType.mockResolvedValue({
      key: "person",
      typeId: "et-1",
      properties: null,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "person" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toBe("person");
    expect(body.properties).toBeNull();
    // The store receives null — allowlist absent, not empty.
    expect(holder.store.addIncludesType).toHaveBeenCalledWith(
      "lens-1",
      "EntityType",
      "person",
      null,
    );
  });

  it("include with an explicit property subset", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { propertyId: "p-1", key: "full_name", dataType: "string", required: false, defaultValue: null },
      { propertyId: "p-2", key: "age", dataType: "integer", required: false, defaultValue: null },
    ]);
    holder.store.addIncludesType.mockResolvedValue({
      key: "person",
      typeId: "et-1",
      properties: ["full_name"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "person", properties: ["full_name"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().properties).toEqual(["full_name"]);
  });

  it("an empty allowlist is passed through as [] — not collapsed to absent", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { propertyId: "p-1", key: "nickname", dataType: "string", required: false, defaultValue: null },
    ]);
    holder.store.addIncludesType.mockResolvedValue({
      key: "person",
      typeId: "et-1",
      properties: [],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "person", properties: [] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().properties).toEqual([]);
    expect(holder.store.addIncludesType).toHaveBeenCalledWith("lens-1", "EntityType", "person", []);
  });

  it("adding an already-included type again is an upsert, not a conflict", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    holder.store.listIncludesTypes.mockResolvedValue([
      { key: "person", typeId: "et-1", properties: ["full_name"] },
    ]);
    holder.store.addIncludesType.mockResolvedValue({
      key: "person",
      typeId: "et-1",
      properties: null,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "person" },
    });
    // No pre-check, no 409 — the store's MERGE replaces the declaration.
    expect(res.statusCode).toBe(201);
    expect(res.json().properties).toBeNull();
  });

  it("rejects an allowlist naming a property the type does not have", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { propertyId: "p-1", key: "full_name", dataType: "string", required: false, defaultValue: null },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "person", properties: ["nonexistent"] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("nonexistent");
  });

  it("rejects an allowlist omitting a required property without default", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { propertyId: "p-1", key: "full_name", dataType: "string", required: true, defaultValue: null },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "person", properties: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("full_name");
  });

  it("a required property WITH a default may be omitted from the allowlist", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityTypeByKey.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { propertyId: "p-1", key: "status", dataType: "string", required: true, defaultValue: "new" },
      { propertyId: "p-2", key: "full_name", dataType: "string", required: false, defaultValue: null },
    ]);
    holder.store.addIncludesType.mockResolvedValue({
      key: "person",
      typeId: "et-1",
      properties: ["full_name"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "person", properties: ["full_name"] },
    });
    expect(res.statusCode).toBe(201);
  });

  it("an unknown entity type key answers 404", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
      payload: { key: "nonexistent" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("an unknown lens id answers 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/nonexistent/includes/entity-types",
      payload: { key: "person" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("list entity type inclusions", () => {
  it("returns each inclusion with its allowlist, absent preserved as null", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.listIncludesTypes.mockResolvedValue([
      { key: "person", typeId: "et-1", properties: null },
      { key: "company", typeId: "et-2", properties: ["name"] },
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].key).toBe("person");
    expect(body[0].properties).toBeNull();
    expect(body[1].properties).toEqual(["name"]);
  });
});

describe("update entity type inclusion (by internal id in the path)", () => {
  it("replaces the allowlist", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { propertyId: "p-1", key: "full_name", dataType: "string", required: false, defaultValue: null },
      { propertyId: "p-2", key: "age", dataType: "integer", required: false, defaultValue: null },
    ]);
    holder.store.updateIncludesType.mockResolvedValue({
      key: "person",
      typeId: "et-1",
      properties: ["full_name", "age"],
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types/et-1",
      payload: { properties: ["full_name", "age"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().properties).toEqual(["full_name", "age"]);
  });

  it("update enforces the required-no-default rule too", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([
      { propertyId: "p-1", key: "full_name", dataType: "string", required: true, defaultValue: null },
    ]);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types/et-1",
      payload: { properties: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("full_name");
  });

  it("updating a type that is not included answers 404", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types/et-1",
      payload: { properties: null },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("remove entity type inclusion", () => {
  it("answers 204", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.removeIncludesType.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types/et-1",
    });
    expect(res.statusCode).toBe(204);
  });

  it("removing a type that is not included answers 404", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.removeIncludesType.mockResolvedValue(false);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/entity-types/et-1",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("relation type inclusion", () => {
  it("accepted when both endpoints are already included", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getRelationTypeByKey.mockResolvedValue(RT_DATA);
    holder.store.listIncludesTypes.mockResolvedValue([
      { key: "person", typeId: "et-1", properties: null },
      { key: "company", typeId: "et-2", properties: null },
    ]);
    holder.store.addIncludesType.mockResolvedValue({
      key: "works_for",
      typeId: "rt-1",
      properties: null,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/relation-types",
      payload: { key: "works_for" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().key).toBe("works_for");
  });

  it("rejected when the source endpoint is not included", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getRelationTypeByKey.mockResolvedValue(RT_DATA);
    holder.store.listIncludesTypes.mockResolvedValue([
      { key: "company", typeId: "et-2", properties: null },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/relation-types",
      payload: { key: "works_for" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("person");
  });

  it("the ordering hazard: with NO entity inclusions yet, any relation inclusion is accepted unchecked", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.getRelationTypeByKey.mockResolvedValue(RT_DATA);
    holder.store.listIncludesTypes.mockResolvedValue([]);
    holder.store.addIncludesType.mockResolvedValue({
      key: "works_for",
      typeId: "rt-1",
      properties: null,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/relation-types",
      payload: { key: "works_for" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("list returns the relation inclusions", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.listIncludesTypes.mockResolvedValue([
      { key: "works_for", typeId: "rt-1", properties: null },
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/relation-types",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key).toBe("works_for");
  });

  it("remove answers 204", async () => {
    holder.store.getLens.mockResolvedValue(LENS_DATA);
    holder.store.removeIncludesType.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/lens-1/includes/relation-types/rt-1",
    });
    expect(res.statusCode).toBe(204);
  });
});
