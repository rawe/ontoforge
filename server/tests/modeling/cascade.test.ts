/**
 * The cascade protocol, complete: the three triggers, the four mechanical
 * repairs, the sorted lens keys in `details.affectedLenses`, and the
 * two deliberate asymmetries — property deletion never triggers it, and
 * changing an existing property is never checked.
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

const PROP_DATA = {
  propertyId: "prop-1",
  key: "salary",
  displayName: "Salary",
  description: null,
  dataType: "float",
  required: true,
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

describe("trigger 1: delete an entity type included by a lens", () => {
  it("without cascade: 409 CASCADE_REQUIRED with the sorted lens keys", async () => {
    holder.store.findLensesIncludingType.mockResolvedValue(["alpha", "beta", "zulu"]);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/onto/model/entity-types/et-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
    expect(res.json().error.details.affectedLenses).toEqual(["alpha", "beta", "zulu"]);
    expect(holder.store.deleteEntityType).not.toHaveBeenCalled();
  });

  it("with cascade: removes the inclusions from every lens, then deletes", async () => {
    holder.store.findLensesIncludingType.mockResolvedValue(["alpha"]);
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.deleteEntityType.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/entity-types/et-1?cascade=true",
    });
    expect(res.statusCode).toBe(204);
    expect(holder.store.removeAllIncludesForType).toHaveBeenCalledWith("EntityType", "et-1");
    expect(holder.store.deleteEntityType).toHaveBeenCalledWith("et-1");
  });

  it("a lens-free type deletes without any of it", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.deleteEntityType.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/onto/model/entity-types/et-1" });
    expect(res.statusCode).toBe(204);
    expect(holder.store.removeAllIncludesForType).not.toHaveBeenCalled();
  });
});

describe("trigger 2: delete a relation type included by a lens", () => {
  it("without cascade: 409 CASCADE_REQUIRED with the sorted lens keys", async () => {
    holder.store.findLensesIncludingType.mockResolvedValue(["hr_lens", "sales_lens"]);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/onto/model/relation-types/rt-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
    expect(res.json().error.details.affectedLenses).toEqual(["hr_lens", "sales_lens"]);
  });

  it("with cascade: removes the inclusions, then deletes", async () => {
    holder.store.findLensesIncludingType.mockResolvedValue(["hr_lens"]);
    holder.store.deleteRelationType.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/relation-types/rt-1?cascade=true",
    });
    expect(res.statusCode).toBe(204);
    expect(holder.store.removeAllIncludesForType).toHaveBeenCalledWith("RelationType", "rt-1");
  });
});

describe("trigger 3: create a required property with no default", () => {
  it("refused when a lens's explicit allowlist for the owning type omits the key", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.findLensesWithExplicitProperty.mockResolvedValue(["alpha", "beta"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties",
      payload: { key: "salary", displayName: "Salary", dataType: "float", required: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
    expect(res.json().error.details.affectedLenses).toEqual(["alpha", "beta"]);
    expect(holder.store.createProperty).not.toHaveBeenCalled();
  });

  it("applies to relation types alike", async () => {
    holder.store.getRelationType.mockResolvedValue(RT_DATA);
    holder.store.findLensesWithExplicitProperty.mockResolvedValue(["hr_lens"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/relation-types/rt-1/properties",
      payload: { key: "since", displayName: "Since", dataType: "date", required: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
  });

  it("with cascade: appends the new key to every affected allowlist, then creates", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.findLensesWithExplicitProperty.mockResolvedValue(["alpha"]);
    holder.store.createProperty.mockResolvedValue(PROP_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties?cascade=true",
      payload: { key: "salary", displayName: "Salary", dataType: "float", required: true },
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.addPropertyToIncludesLists).toHaveBeenCalledWith(
      "EntityType",
      "et-1",
      "salary",
    );
  });

  it("a required property WITH a default never triggers", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.createProperty.mockResolvedValue({ ...PROP_DATA, defaultValue: "0" });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties",
      payload: {
        key: "salary",
        displayName: "Salary",
        dataType: "float",
        required: true,
        defaultValue: "0",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.findLensesWithExplicitProperty).not.toHaveBeenCalled();
  });

  it("an optional property never triggers", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.createProperty.mockResolvedValue({ ...PROP_DATA, required: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties",
      payload: { key: "salary", displayName: "Salary", dataType: "float" },
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.findLensesWithExplicitProperty).not.toHaveBeenCalled();
  });

  it("only lenses with an EXPLICIT allowlist are affected — none means no refusal", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    // Lenses including the type WITHOUT an allowlist track it automatically;
    // the store query reports none affected.
    holder.store.findLensesWithExplicitProperty.mockResolvedValue([]);
    holder.store.createProperty.mockResolvedValue(PROP_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties",
      payload: { key: "salary", displayName: "Salary", dataType: "float", required: true },
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.addPropertyToIncludesLists).not.toHaveBeenCalled();
  });
});

describe("the non-trigger: property deletion (cleanup, not consent)", () => {
  it("without cascade: deletes anyway, allowlists left holding the stale key", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getProperty.mockResolvedValue(PROP_DATA);
    holder.store.findLensesIncludingType.mockResolvedValue(["alpha", "beta"]);
    holder.store.deleteProperty.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties/prop-1",
    });
    // Never a refusal — CASCADE_REQUIRED is unreachable on this path.
    expect(res.statusCode).toBe(204);
    expect(holder.store.removePropertyFromIncludesLists).not.toHaveBeenCalled();
    expect(holder.store.deleteProperty).toHaveBeenCalled();
  });

  it("with cascade: removes the key from every explicit allowlist first", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getProperty.mockResolvedValue(PROP_DATA);
    holder.store.deleteProperty.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties/prop-1?cascade=true",
    });
    expect(res.statusCode).toBe(204);
    expect(holder.store.removePropertyFromIncludesLists).toHaveBeenCalledWith(
      "EntityType",
      "et-1",
      "salary",
    );
  });
});

describe("the unchecked gap: changing an existing property", () => {
  it("making a property required (or clearing its default) is never checked against lenses", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.updateProperty.mockResolvedValue({ ...PROP_DATA, required: true });
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/entity-types/et-1/properties/prop-1",
      payload: { required: true, defaultValue: null },
    });
    // Exactly the state trigger 3 exists to prevent — and nothing stops it.
    expect(res.statusCode).toBe(200);
    expect(holder.store.findLensesWithExplicitProperty).not.toHaveBeenCalled();
  });
});
