/**
 * Schema transfer (export / import) over a mocked store, including the two
 * import guarantees: key patterns are validated, and import is
 * validate-then-write with collect-all reporting — a rejected payload
 * writes NOTHING.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => holder.store,
  getRuntimeStore: () => ({}),
}));

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

afterEach(() => {
  setEmbeddingProvider(null);
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe("export", () => {
  it("exports the whole design in the transfer format", async () => {
    holder.store.getFullSchema.mockResolvedValue(FULL_SCHEMA);
    const res = await app.inject({ method: "GET", url: "/api/model/export" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.formatVersion).toBe("3.0");
    expect(body.entityTypes).toHaveLength(2);
    expect(body.relationTypes).toHaveLength(1);
    expect(body.ontologies).toHaveLength(1);
    const person = body.entityTypes[0];
    expect(person.key).toBe("person");
    expect(person.properties).toHaveLength(1);
    expect(person.properties[0].key).toBe("full_name");
    const rt = body.relationTypes[0];
    expect(rt.fromEntityTypeKey).toBe("person");
    expect(rt.toEntityTypeKey).toBe("company");
    const ont = body.ontologies[0];
    expect(ont.key).toBe("test_ontology");
    expect(ont.includes.entityTypes[0].key).toBe("person");
    expect(ont.includes.relationTypes[0].key).toBe("works_for");
    // No timestamps, no internal ids anywhere.
    expect(ont.ontologyId).toBeUndefined();
    expect(ont.createdAt).toBeUndefined();
    expect(person.entityTypeId).toBeUndefined();
    expect(person.properties[0].propertyId).toBeUndefined();
  });

  it("exports an empty design", async () => {
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      ontologies: [],
    });
    const res = await app.inject({ method: "GET", url: "/api/model/export" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      formatVersion: "3.0",
      entityTypes: [],
      relationTypes: [],
      ontologies: [],
    });
  });

  it("omits the includes key entirely for an unscoped lens", async () => {
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "everything",
          name: "Everything",
          description: null,
          entityInclusions: [],
          relationInclusions: [],
        },
      ],
    });
    const res = await app.inject({ method: "GET", url: "/api/model/export" });
    expect(res.statusCode).toBe(200);
    const ont = res.json().ontologies[0];
    expect("includes" in ont).toBe(false);
    expect(ont.aiAgents).toEqual([]);
    expect(ont.savedQueries).toEqual([]);
  });

  it("nests agents and saved queries in their lens, steps with explicit nulls", async () => {
    holder.store.getFullSchema.mockResolvedValue({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          ontologyId: "ont-1",
          key: "hr_view",
          name: "HR View",
          description: "HR lens",
          entityInclusions: [],
          relationInclusions: [],
        },
      ],
    });
    holder.store.listAiAgentsForExport.mockResolvedValue([
      {
        key: "assistant",
        name: "Assistant",
        description: "Helps",
        systemPrompt: null,
        tools: ["query", "get_entity"],
      },
    ]);
    holder.store.listSavedQueriesForExport.mockResolvedValue([
      {
        key: "find-people",
        name: "Find People",
        description: "Find people by name",
        steps: JSON.stringify([
          { name: "main", type: "oql", oql: "MATCH (p:person) RETURN p", limit: 5 },
        ]),
        parameters: JSON.stringify([
          { name: "q", description: "Query", dataType: "string" },
        ]),
      },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/model/export" });
    expect(res.statusCode).toBe(200);
    const ont = res.json().ontologies[0];
    expect(ont.aiAgents).toEqual([
      {
        key: "assistant",
        name: "Assistant",
        description: "Helps",
        systemPrompt: null,
        tools: ["query", "get_entity"],
      },
    ]);
    expect(ont.savedQueries).toEqual([
      {
        key: "find-people",
        name: "Find People",
        description: "Find people by name",
        steps: [
          {
            name: "main",
            type: "oql",
            oql: "MATCH (p:person) RETURN p",
            entityTypeKey: null,
            query: null,
            limit: 5,
            minScore: null,
            bindings: null,
          },
        ],
        parameters: [{ name: "q", description: "Query", dataType: "string" }],
      },
    ]);
    expect(holder.store.listAiAgentsForExport).toHaveBeenCalledWith("ont-1");
    expect(holder.store.listSavedQueriesForExport).toHaveBeenCalledWith("ont-1");
  });
});

// ---------------------------------------------------------------------------
// Import — happy path
// ---------------------------------------------------------------------------

const ONT_DATA = {
  ontologyId: "ont-new",
  key: "imported",
  name: "Imported",
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function importPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: "2.0",
    entityTypes: [
      {
        key: "person",
        displayName: "Person",
        properties: [
          { key: "full_name", displayName: "Full Name", dataType: "string", required: true },
        ],
      },
    ],
    relationTypes: [
      {
        key: "works_for",
        displayName: "Works For",
        fromEntityTypeKey: "person",
        toEntityTypeKey: "person",
        properties: [],
      },
    ],
    ontologies: [
      {
        key: "imported",
        name: "Imported",
        includes: {
          entityTypes: [{ key: "person" }],
          relationTypes: [{ key: "works_for" }],
        },
      },
    ],
    ...overrides,
  };
}

async function postImport(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/model/import", payload });
}

describe("import", () => {
  it("imports types, lenses and inclusions; answers 201 with the created lenses", async () => {
    holder.store.createOntology.mockResolvedValue(ONT_DATA);
    holder.store.addIncludesType.mockResolvedValue({ key: "person", properties: null });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ontologies).toHaveLength(1);
    expect(body.ontologies[0].key).toBe("imported");
    expect(holder.store.createEntityType).toHaveBeenCalledTimes(1);
    expect(holder.store.createProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createRelationType).toHaveBeenCalledTimes(1);
    expect(holder.store.createOntology).toHaveBeenCalledTimes(1);
    expect(holder.store.addIncludesType).toHaveBeenCalledTimes(2);
    // No provider: no vector-index DDL at all.
    expect(holder.store.createVectorIndex).not.toHaveBeenCalled();
    expect(holder.store.createDocumentVectorIndex).not.toHaveBeenCalled();
    expect(holder.store.ensureSavedQueryVectorIndex).not.toHaveBeenCalled();
  });

  it("regenerates internal identifiers — the payload never carries one", async () => {
    holder.store.createOntology.mockResolvedValue(ONT_DATA);
    holder.store.addIncludesType.mockResolvedValue({ key: "person", properties: null });
    await postImport(importPayload());
    const etId = holder.store.createEntityType.mock.calls[0]![0] as string;
    expect(etId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("processes old, unknown and missing format versions identically", async () => {
    for (const version of ["2.0", "unknown-version", undefined]) {
      holder.store = createMockModelingStore();
      holder.store.createOntology.mockResolvedValue(ONT_DATA);
      holder.store.addIncludesType.mockResolvedValue({ key: "person", properties: null });
      const payload = importPayload();
      if (version === undefined) {
        delete payload.formatVersion;
      } else {
        payload.formatVersion = version;
      }
      const res = await postImport(payload);
      expect(res.statusCode, `version ${String(version)}`).toBe(201);
    }
  });

  it("does NOT check property data types against the enum (preserved gap)", async () => {
    holder.store.createOntology.mockResolvedValue(ONT_DATA);
    const res = await postImport({
      entityTypes: [
        {
          key: "person",
          displayName: "Person",
          properties: [
            { key: "age", displayName: "Age", dataType: "invalid_type", required: false },
          ],
        },
      ],
      relationTypes: [],
      ontologies: [],
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.createProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createProperty.mock.calls[0]![6]).toBe("invalid_type");
  });
});

// ---------------------------------------------------------------------------
// Import — conflicts (all-or-fail, nothing written)
// ---------------------------------------------------------------------------

describe("import conflicts", () => {
  it("an existing entity type key answers 409 and writes nothing", async () => {
    holder.store.getEntityTypeByKey.mockResolvedValue({ entityTypeId: "et-x", key: "person" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(res.json().error.message).toContain("person");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createRelationType).not.toHaveBeenCalled();
    expect(holder.store.createOntology).not.toHaveBeenCalled();
  });

  it("an existing relation type key answers 409 and writes nothing", async () => {
    holder.store.getRelationTypeByKey.mockResolvedValue({ relationTypeId: "rt-x", key: "works_for" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("Relation type with key 'works_for' already exists");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("an existing ontology key answers 409 and writes nothing", async () => {
    holder.store.getOntologyByKey.mockResolvedValue({ ontologyId: "ont-x", key: "imported" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("Ontology with key 'imported' already exists");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createOntology).not.toHaveBeenCalled();
  });

  it("a mid-payload conflict writes nothing — validate-then-write", async () => {
    // First entity type is clean; the second one already exists.
    holder.store.getEntityTypeByKey.mockImplementation(async (key: string) =>
      key === "company" ? { entityTypeId: "et-x", key: "company" } : null,
    );
    const res = await postImport({
      entityTypes: [
        { key: "person", displayName: "Person", properties: [] },
        { key: "company", displayName: "Company", properties: [] },
      ],
      relationTypes: [],
      ontologies: [],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("company");
    // The clean first object was NOT written — no partial import.
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("names EVERY conflicting key in one response", async () => {
    holder.store.getEntityTypeByKey.mockResolvedValue({ entityTypeId: "et-x" });
    holder.store.getRelationTypeByKey.mockResolvedValue({ relationTypeId: "rt-x" });
    holder.store.getOntologyByKey.mockResolvedValue({ ontologyId: "ont-x" });
    const res = await postImport(importPayload());
    expect(res.statusCode).toBe(409);
    const message = res.json().error.message as string;
    expect(message).toContain("Entity type with key 'person' already exists");
    expect(message).toContain("Relation type with key 'works_for' already exists");
    expect(message).toContain("Ontology with key 'imported' already exists");
  });

  it("an intra-payload duplicate key conflicts like the sequential write would have", async () => {
    const res = await postImport({
      entityTypes: [
        { key: "person", displayName: "Person", properties: [] },
        { key: "person", displayName: "Person Again", properties: [] },
      ],
      relationTypes: [],
      ontologies: [],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("Entity type with key 'person' already exists");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Import — validations (collected, nothing written)
// ---------------------------------------------------------------------------

describe("import validations", () => {
  it("rejects a reserved entity type key", async () => {
    const res = await postImport({
      entityTypes: [{ key: "ontology", displayName: "Bad", properties: [] }],
      relationTypes: [],
      ontologies: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("reserved");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("rejects a relation type endpoint missing from the payload", async () => {
    const res = await postImport({
      entityTypes: [{ key: "person", displayName: "Person" }],
      relationTypes: [
        {
          key: "works_for",
          displayName: "Works For",
          fromEntityTypeKey: "nonexistent",
          toEntityTypeKey: "person",
        },
      ],
      ontologies: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("nonexistent");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
  });

  it("rejects a document property on a relation type", async () => {
    const res = await postImport({
      entityTypes: [{ key: "person", displayName: "Person" }],
      relationTypes: [
        {
          key: "knows",
          displayName: "Knows",
          fromEntityTypeKey: "person",
          toEntityTypeKey: "person",
          properties: [
            { key: "notes", displayName: "Notes", dataType: "document", required: false },
          ],
        },
      ],
      ontologies: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain(
      "document properties are only supported on entity types",
    );
  });

  it("rejects an agent allowlist naming an unknown tool", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          key: "lens",
          name: "Lens",
          aiAgents: [
            { key: "helper", name: "Helper", tools: ["query", "not_a_tool"] },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const message = res.json().error.message as string;
    expect(message).toContain("not_a_tool");
    expect(message).toContain("Available tools:");
    expect(holder.store.createOntology).not.toHaveBeenCalled();
    expect(holder.store.upsertAiAgent).not.toHaveBeenCalled();
  });

  it("rejects a document saved-query parameter", async () => {
    const res = await postImport({
      formatVersion: "2.2",
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          key: "imported",
          name: "Imported",
          savedQueries: [
            {
              key: "find-people",
              name: "Find People",
              description: "Find people by name",
              steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }],
              parameters: [{ name: "bio", description: "A document", dataType: "document" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("scalar");
    expect(holder.store.upsertSavedQuery).not.toHaveBeenCalled();
  });

  it("rejects an unknown saved-query step type", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          key: "lens",
          name: "Lens",
          savedQueries: [
            {
              key: "broken",
              name: "Broken",
              description: "Bad step",
              steps: [{ name: "main", type: "sql", oql: "SELECT 1" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("unknown type 'sql'");
  });

  it("validates pipelines structurally like definition time — but never against a lens", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          key: "lens",
          name: "Lens",
          savedQueries: [
            {
              key: "broken",
              name: "Broken",
              description: "Structural problems",
              steps: [
                { name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" },
                { name: "main", type: "oql" },
              ],
              parameters: [{ name: "unused", description: "Never used", dataType: "string" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const message = res.json().error.message as string;
    expect(message).toContain("already used by");
    expect(message).toContain("Required for oql steps");
    expect(message).toContain("unused");
  });

  it("imports a structurally sound pipeline whose OQL names types no lens exposes", async () => {
    // No lens check on import: this pipeline fails at first RUN, not here.
    holder.store.createOntology.mockResolvedValue(ONT_DATA);
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      ontologies: [
        {
          key: "imported",
          name: "Imported",
          savedQueries: [
            {
              key: "find-ghosts",
              name: "Find Ghosts",
              description: "Names a type that exists nowhere",
              steps: [{ name: "main", type: "oql", oql: "MATCH (g:ghost) RETURN g" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(holder.store.upsertSavedQuery).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Import — key patterns
// ---------------------------------------------------------------------------

describe("import key patterns", () => {
  it("rejects a property named '_id' — the documented identity-overwrite hole", async () => {
    const res = await postImport({
      entityTypes: [
        {
          key: "person",
          displayName: "Person",
          properties: [{ key: "_id", displayName: "Id", dataType: "string", required: false }],
        },
      ],
      relationTypes: [],
      ontologies: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.message).toContain("'_id'");
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createProperty).not.toHaveBeenCalled();
  });

  it("rejects an underscore-leading ontology key", async () => {
    const res = await postImport({
      entityTypes: [],
      relationTypes: [],
      ontologies: [{ key: "_hidden", name: "Hidden" }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("'_hidden'");
    expect(holder.store.createOntology).not.toHaveBeenCalled();
  });

  it("collects every offending key across kinds in one response", async () => {
    const res = await postImport({
      entityTypes: [{ key: "BadType", displayName: "Bad", properties: [] }],
      relationTypes: [
        {
          key: "BAD_REL",
          displayName: "Bad Rel",
          fromEntityTypeKey: "BadType",
          toEntityTypeKey: "BadType",
          properties: [],
        },
      ],
      ontologies: [
        {
          key: "lens",
          name: "Lens",
          aiAgents: [{ key: "Bad Agent", name: "Bad" }],
          savedQueries: [
            {
              key: "9bad",
              name: "Bad",
              description: "Bad key",
              steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    const message = body.error.message as string;
    expect(message).toContain("'BadType'");
    expect(message).toContain("'BAD_REL'");
    expect(message).toContain("'Bad Agent'");
    expect(message).toContain("'9bad'");
    expect(body.error.details.errors).toHaveLength(4);
    expect(holder.store.createEntityType).not.toHaveBeenCalled();
    expect(holder.store.createOntology).not.toHaveBeenCalled();
  });

  it("reports pattern violations, structural rules and reserved keys together", async () => {
    const res = await postImport({
      entityTypes: [{ key: "_bad", displayName: "Bad", properties: [] }],
      relationTypes: [
        {
          key: "knows",
          displayName: "Knows",
          fromEntityTypeKey: "_bad",
          toEntityTypeKey: "_bad",
          properties: [
            { key: "notes", displayName: "Notes", dataType: "document", required: false },
          ],
        },
      ],
      ontologies: [
        {
          key: "lens",
          name: "Lens",
          aiAgents: [{ key: "helper", name: "Helper", tools: ["nope"] }],
        },
      ],
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    const message = body.error.message as string;
    expect(message).toContain("'_bad'");
    expect(message).toContain("document properties are only supported on entity types");
    expect(message).toContain("nope");
    expect(body.error.details.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Import — side effects with an embedding provider
// ---------------------------------------------------------------------------

describe("import side effects with a provider", () => {
  it("creates vector indexes with filterables, chunk indexes per document property, and embeds saved-query descriptions", async () => {
    const embedded: string[] = [];
    setEmbeddingProvider({
      dimensions: 8,
      embed: async (text: string) => {
        embedded.push(text);
        return [0.1, 0.2];
      },
    });
    holder.store.createOntology.mockResolvedValue(ONT_DATA);
    const res = await postImport({
      entityTypes: [
        {
          key: "person",
          displayName: "Person",
          properties: [
            { key: "name", displayName: "Name", dataType: "string", required: true },
            { key: "bio", displayName: "Bio", dataType: "document", required: false },
          ],
        },
      ],
      relationTypes: [],
      ontologies: [
        {
          key: "imported",
          name: "Imported",
          savedQueries: [
            {
              key: "find-people",
              name: "Find People",
              description: "Find people by name",
              steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }],
            },
          ],
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    // Per-type index with the non-document properties as filterables.
    expect(holder.store.createVectorIndex).toHaveBeenCalledWith("person", 8, ["name"]);
    // One chunk index per document property.
    expect(holder.store.createDocumentVectorIndex).toHaveBeenCalledWith("person", "bio", 8);
    // The description was embedded as written and handed to the store.
    expect(embedded).toEqual(["Find people by name"]);
    expect(holder.store.upsertSavedQuery.mock.calls[0]![8]).toEqual([0.1, 0.2]);
    // The shared saved-query index is ensured once at the end.
    expect(holder.store.ensureSavedQueryVectorIndex).toHaveBeenCalledTimes(1);
    expect(holder.store.ensureSavedQueryVectorIndex).toHaveBeenCalledWith(8);
  });
});
