/**
 * The two validation operations over a mocked store, including the
 * ordering hazard: a relation inclusion accepted before any entity
 * inclusions existed is reported invalid once entity inclusions appear.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => holder.store,
  getRuntimeStore: () => ({}),
}));

const ONTOLOGY_DATA = {
  ontologyId: "ont-1",
  key: "my_ontology",
  name: "My Ontology",
  description: null,
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

describe("validate one lens", () => {
  it("a valid scoped lens answers valid", async () => {
    holder.store.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [
        {
          entityTypeId: "et-1",
          key: "person",
          displayName: "Person",
          properties: [
            { key: "full_name", dataType: "string", required: true, defaultValue: null },
          ],
        },
      ],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "my_ontology",
          name: "My Ontology",
          entityInclusions: [{ key: "person", properties: ["full_name"] }],
          relationInclusions: [],
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/ontologies/ont-1/validate",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(true);
    expect(res.json().errors).toEqual([]);
  });

  it("an allowlist omitting a required-no-default property is reported", async () => {
    holder.store.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [
        {
          entityTypeId: "et-1",
          key: "person",
          displayName: "Person",
          properties: [
            { key: "full_name", dataType: "string", required: true, defaultValue: null },
          ],
        },
      ],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "my_ontology",
          name: "My Ontology",
          entityInclusions: [{ key: "person", properties: [] }],
          relationInclusions: [],
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/ontologies/ont-1/validate",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(
      body.errors.some((e: { message: string }) => e.message.includes("full_name")),
    ).toBe(true);
  });

  it("an unscoped lens is valid by definition", async () => {
    holder.store.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "my_ontology",
          name: "My Ontology",
          entityInclusions: [],
          relationInclusions: [],
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/ontologies/ont-1/validate",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, errors: [] });
  });

  it("an unknown lens id answers 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/model/ontologies/nonexistent/validate",
    });
    expect(res.statusCode).toBe(404);
  });

  it("the ordering hazard is reported here: relation inclusion whose endpoints are not exposed", async () => {
    // The state the interactive path can reach: the relation inclusion was
    // accepted while the lens had no entity inclusions; entity inclusions
    // were added afterwards. Validation reports it; the runtime still
    // loads and serves the lens (untested here).
    holder.store.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [
        { entityTypeId: "et-1", key: "person", displayName: "Person", properties: [] },
        { entityTypeId: "et-2", key: "company", displayName: "Company", properties: [] },
      ],
      relationTypes: [
        {
          relationTypeId: "rt-1",
          key: "works_for",
          displayName: "Works For",
          sourceKey: "person",
          targetKey: "company",
          properties: [],
        },
      ],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "my_ontology",
          name: "My Ontology",
          entityInclusions: [{ key: "person", properties: null }],
          relationInclusions: [{ key: "works_for", properties: null }],
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/ontologies/ont-1/validate",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual([
      {
        path: "ontologies.my_ontology.includes.relationTypes.works_for",
        message: "Target entity type 'company' is not included",
      },
    ]);
  });

  it("an inclusion naming a type that no longer exists is reported", async () => {
    holder.store.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "my_ontology",
          name: "My Ontology",
          entityInclusions: [{ key: "ghost", properties: null }],
          relationInclusions: [],
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/ontologies/ont-1/validate",
    });
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors[0].message).toBe("Entity type 'ghost' does not exist");
  });

  it("a stale allowlist key (property deleted without cascade) is reported", async () => {
    holder.store.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [
        {
          entityTypeId: "et-1",
          key: "person",
          displayName: "Person",
          properties: [{ key: "full_name", dataType: "string", required: false, defaultValue: null }],
        },
      ],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "my_ontology",
          name: "My Ontology",
          entityInclusions: [{ key: "person", properties: ["full_name", "deleted_prop"] }],
          relationInclusions: [],
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/model/ontologies/ont-1/validate",
    });
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors[0].message).toBe(
      "Property 'deleted_prop' does not exist on entity type 'person'",
    );
  });
});

describe("validate the whole schema", () => {
  const FULL_SCHEMA = {
    entityTypes: [
      {
        entityTypeId: "et-1",
        key: "person",
        displayName: "Person",
        description: null,
        properties: [
          {
            propertyId: "p-1",
            key: "full_name",
            displayName: "Full Name",
            dataType: "string",
            required: true,
            defaultValue: null,
          },
        ],
      },
      {
        entityTypeId: "et-2",
        key: "company",
        displayName: "Company",
        description: null,
        properties: [],
      },
    ],
    relationTypes: [
      {
        relationTypeId: "rt-1",
        key: "works_for",
        displayName: "Works For",
        description: null,
        sourceKey: "person",
        targetKey: "company",
        properties: [],
      },
    ],
    ontologies: [
      {
        ontologyId: "ont-1",
        key: "test_ontology",
        name: "Test Ontology",
        description: null,
        createdAt: NOW,
        updatedAt: NOW,
        entityInclusions: [
          { key: "person", properties: ["full_name"] },
          { key: "company", properties: null },
        ],
        relationInclusions: [{ key: "works_for", properties: null }],
      },
    ],
  };

  it("a consistent schema and lenses answer valid with no errors", async () => {
    holder.store.getFullSchema.mockResolvedValue(FULL_SCHEMA);
    holder.store.listOntologies.mockResolvedValue(FULL_SCHEMA.ontologies);
    holder.store.getOntology.mockResolvedValue(FULL_SCHEMA.ontologies[0]);
    const res = await app.inject({ method: "POST", url: "/api/model/schema/validate" });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(true);
    expect(res.json().errors).toEqual([]);
  });

  it("reports an invalid data type and a missing relation endpoint — always 200", async () => {
    const badSchema = {
      entityTypes: [
        {
          entityTypeId: "et-1",
          key: "person",
          displayName: "Person",
          properties: [{ key: "age", displayName: "Age", dataType: "invalid_type", required: false }],
        },
      ],
      relationTypes: [
        {
          relationTypeId: "rt-1",
          key: "works_for",
          displayName: "Works For",
          sourceKey: "nonexistent",
          targetKey: "person",
          properties: [],
        },
      ],
      ontologies: [],
    };
    holder.store.getFullSchema.mockResolvedValue(badSchema);
    holder.store.listOntologies.mockResolvedValue([]);
    const res = await app.inject({ method: "POST", url: "/api/model/schema/validate" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
    const messages = body.errors.map((e: { message: string }) => e.message);
    expect(messages.some((m: string) => m.includes("invalid_type"))).toBe(true);
    expect(messages.some((m: string) => m.includes("nonexistent"))).toBe(true);
  });

  it("reports duplicate type keys and duplicate property keys within one type", async () => {
    const badSchema = {
      entityTypes: [
        { entityTypeId: "et-1", key: "person", displayName: "Person", properties: [] },
        {
          entityTypeId: "et-2",
          key: "person",
          displayName: "Person Again",
          properties: [
            { key: "name", dataType: "string", required: false },
            { key: "name", dataType: "string", required: false },
          ],
        },
      ],
      relationTypes: [],
      ontologies: [],
    };
    holder.store.getFullSchema.mockResolvedValue(badSchema);
    holder.store.listOntologies.mockResolvedValue([]);
    const res = await app.inject({ method: "POST", url: "/api/model/schema/validate" });
    const messages = res.json().errors.map((e: { message: string }) => e.message);
    expect(messages).toContain("Duplicate entity type key 'person'");
    expect(messages).toContain("Duplicate property key 'name'");
  });

  it("combines the global half with every lens's errors in one list", async () => {
    const schema = {
      entityTypes: [
        {
          entityTypeId: "et-1",
          key: "person",
          displayName: "Person",
          properties: [{ key: "full_name", dataType: "string", required: true, defaultValue: null }],
        },
      ],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "broken_lens",
          name: "Broken",
          entityInclusions: [{ key: "person", properties: [] }],
          relationInclusions: [],
        },
      ],
    };
    holder.store.getFullSchema.mockResolvedValue(schema);
    holder.store.listOntologies.mockResolvedValue(schema.ontologies);
    holder.store.getOntology.mockResolvedValue(schema.ontologies[0]);
    const res = await app.inject({ method: "POST", url: "/api/model/schema/validate" });
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual([
      {
        path: "ontologies.broken_lens.includes.entityTypes.person.properties",
        message: "Required property 'full_name' without default must be included",
      },
    ]);
  });
});
