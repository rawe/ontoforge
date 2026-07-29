/**
 * Property-definition REST behavior over a mocked store. Ported from the
 * Python suite (`backend/tests/modeling/test_properties.py`) — same
 * scenarios, same expected wire shapes — plus the spec's traps: sparse
 * updates with the clear-default exception, `document` rejected on
 * relation types, defaults not validated at definition time.
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
  key: "full_name",
  displayName: "Full Name",
  description: null,
  dataType: "string",
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

describe("entity type properties", () => {
  it("create answers 201 with the property shape", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.createProperty.mockResolvedValue(PROP_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/et-1/properties",
      payload: { key: "full_name", displayName: "Full Name", dataType: "string" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.propertyId).toBe("prop-1");
    expect(body.key).toBe("full_name");
    expect(body.dataType).toBe("string");
  });

  it("a duplicate key on the same owner answers 409", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getPropertyByKey.mockResolvedValue(PROP_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/et-1/properties",
      payload: { key: "full_name", displayName: "Full Name", dataType: "string" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
  });

  it("a missing owner answers 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/nonexistent/properties",
      payload: { key: "full_name", displayName: "Full Name", dataType: "string" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("list returns the owner's properties", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.listProperties.mockResolvedValue([PROP_DATA]);
    const res = await app.inject({
      method: "GET",
      url: "/api/model/entity-types/et-1/properties",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key).toBe("full_name");
  });

  it("update changes metadata", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.updateProperty.mockResolvedValue({
      ...PROP_DATA,
      displayName: "Name",
      required: true,
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/et-1/properties/prop-1",
      payload: { displayName: "Name", required: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Name");
  });

  it("update of a missing property answers 404", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    const res = await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/et-1/properties/nonexistent",
      payload: { displayName: "Name" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("delete answers 204", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getProperty.mockResolvedValue(PROP_DATA);
    holder.store.deleteProperty.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1/properties/prop-1",
    });
    expect(res.statusCode).toBe(204);
  });

  it("delete of a missing property answers 404", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1/properties/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("relation type properties", () => {
  it("create answers 201", async () => {
    holder.store.getRelationType.mockResolvedValue(RT_DATA);
    holder.store.createProperty.mockResolvedValue(PROP_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types/rt-1/properties",
      payload: { key: "full_name", displayName: "Full Name", dataType: "string" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().key).toBe("full_name");
  });

  it("the document data type is rejected on a relation type", async () => {
    holder.store.getRelationType.mockResolvedValue(RT_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/relation-types/rt-1/properties",
      payload: { key: "notes", displayName: "Notes", dataType: "document" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.message).toBe(
      "Document properties are only supported on entity types",
    );
    expect(holder.store.createProperty).not.toHaveBeenCalled();
  });
});

describe("required-property cascade plumbing", () => {
  it("a required property without default breaking explicit allowlists answers 409 CASCADE_REQUIRED", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.findOntologiesWithExplicitProperty.mockResolvedValue(["my_ontology"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/et-1/properties",
      payload: { key: "email", displayName: "Email", dataType: "string", required: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CASCADE_REQUIRED");
  });

  it("the same create with cascade appends to the allowlists and answers 201", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.findOntologiesWithExplicitProperty.mockResolvedValue(["my_ontology"]);
    holder.store.addPropertyToIncludesLists.mockResolvedValue(1);
    holder.store.createProperty.mockResolvedValue({
      ...PROP_DATA,
      key: "email",
      required: true,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/et-1/properties?cascade=true",
      payload: { key: "email", displayName: "Email", dataType: "string", required: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().required).toBe(true);
    expect(holder.store.addPropertyToIncludesLists).toHaveBeenCalledWith(
      "EntityType",
      "et-1",
      "email",
    );
  });

  it("delete with cascade removes the key from explicit allowlists", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getProperty.mockResolvedValue(PROP_DATA);
    holder.store.findOntologiesIncludingType.mockResolvedValue(["my_ontology"]);
    holder.store.removePropertyFromIncludesLists.mockResolvedValue(1);
    holder.store.deleteProperty.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1/properties/prop-1?cascade=true",
    });
    expect(res.statusCode).toBe(204);
    expect(holder.store.removePropertyFromIncludesLists).toHaveBeenCalledWith(
      "EntityType",
      "et-1",
      "full_name",
    );
  });

  it("delete without cascade never touches allowlists (property deletion is not a cascade trigger)", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.getProperty.mockResolvedValue(PROP_DATA);
    holder.store.findOntologiesIncludingType.mockResolvedValue(["my_ontology"]);
    holder.store.deleteProperty.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/entity-types/et-1/properties/prop-1",
    });
    expect(res.statusCode).toBe(204);
    expect(holder.store.removePropertyFromIncludesLists).not.toHaveBeenCalled();
  });
});

describe("sparse update semantics", () => {
  beforeEach(() => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.updateProperty.mockResolvedValue(PROP_DATA);
  });

  it("an omitted defaultValue leaves the default unchanged (no clear flag)", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/et-1/properties/prop-1",
      payload: { displayName: "Name" },
    });
    expect(holder.store.updateProperty).toHaveBeenCalledWith(
      "et-1",
      "EntityType",
      "prop-1",
      "Name",
      null,
      null,
      null,
      false,
    );
  });

  it("an explicit null defaultValue sets the separate clear-default flag", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/et-1/properties/prop-1",
      payload: { defaultValue: null },
    });
    expect(holder.store.updateProperty).toHaveBeenCalledWith(
      "et-1",
      "EntityType",
      "prop-1",
      null,
      null,
      null,
      null,
      true,
    );
  });

  it("a new defaultValue is passed through without the clear flag", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/et-1/properties/prop-1",
      payload: { defaultValue: "42" },
    });
    expect(holder.store.updateProperty).toHaveBeenCalledWith(
      "et-1",
      "EntityType",
      "prop-1",
      null,
      null,
      null,
      "42",
      false,
    );
  });

  it("an explicit null description is indistinguishable from omission — nothing is cleared", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/model/entity-types/et-1/properties/prop-1",
      payload: { description: null },
    });
    expect(holder.store.updateProperty).toHaveBeenCalledWith(
      "et-1",
      "EntityType",
      "prop-1",
      null,
      null,
      null,
      null,
      false,
    );
  });
});

describe("definition-time traps", () => {
  it("a default that cannot coerce to the data type is legal to store", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    holder.store.createProperty.mockResolvedValue({
      ...PROP_DATA,
      key: "age",
      dataType: "integer",
      defaultValue: "not_a_number",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/et-1/properties",
      payload: {
        key: "age",
        displayName: "Age",
        dataType: "integer",
        defaultValue: "not_a_number",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().defaultValue).toBe("not_a_number");
  });

  it.each([["FullName"], ["_name"], ["1name"]])(
    "rejects the invalid property key %s with 422",
    async (key) => {
      holder.store.getEntityType.mockResolvedValue(ET_DATA);
      const res = await app.inject({
        method: "POST",
        url: "/api/model/entity-types/et-1/properties",
        payload: { key, displayName: "X", dataType: "string" },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    },
  );

  it("an unknown data type is rejected with 422", async () => {
    holder.store.getEntityType.mockResolvedValue(ET_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types/et-1/properties",
      payload: { key: "x", displayName: "X", dataType: "uuid" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
