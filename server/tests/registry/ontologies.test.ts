/**
 * Ontology registry CRUD over a mocked registry port: response shapes,
 * the key rules (format, 59-char cap, immutability), both uniqueness
 * dimensions, and the rename/delete semantics.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OntologyRegistry } from "../../src/core/ports.js";
import { NOW } from "../modeling/helpers.js";

/** Every registry port method as a mock — completeness is compiler-enforced. */
type MockOntologyRegistry = { [K in keyof OntologyRegistry]: ReturnType<typeof vi.fn> };

function createMockRegistry(): MockOntologyRegistry {
  return {
    createOntology: vi.fn(),
    listOntologies: vi.fn(async () => []),
    getOntology: vi.fn(async () => null),
    getOntologyByDisplayName: vi.fn(async () => null),
    renameOntology: vi.fn(async () => null),
    deleteOntology: vi.fn(async () => false),
  };
}

const holder: { registry: MockOntologyRegistry } = { registry: createMockRegistry() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => ({}),
  getRuntimeStore: () => ({}),
  getOntologyRegistry: () => holder.registry,
}));

const ONTOLOGY_DATA = {
  ontologyId: "11111111-1111-4111-8111-111111111111",
  key: "crm",
  displayName: "Customer Relations",
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
  holder.registry = createMockRegistry();
});

describe("ontology create", () => {
  it("answers 201 with the id-bearing response shape", async () => {
    holder.registry.createOntology.mockResolvedValue(ONTOLOGY_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "crm", displayName: "Customer Relations" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ontologyId).toBe(ONTOLOGY_DATA.ontologyId);
    expect(body.key).toBe("crm");
    expect(body.displayName).toBe("Customer Relations");
    expect(body.createdAt).toBe(NOW.toISOString());
    expect(body.updatedAt).toBe(NOW.toISOString());
  });

  it("the display name is optional and reads back as explicit null", async () => {
    holder.registry.createOntology.mockResolvedValue({ ...ONTOLOGY_DATA, displayName: null });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "crm" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().displayName).toBeNull();
    // No embedding provider is configured in the unit environment, so the
    // port receives no width for the fixed semantic indexes.
    const [, key, displayName, dimensions] = holder.registry.createOntology.mock.calls[0]!;
    expect(key).toBe("crm");
    expect(displayName).toBeNull();
    expect(dimensions).toBeNull();
  });

  it.each(["Crm", "1crm", "my-ontology", "_crm", "crm ", ""])(
    "rejects the malformed key '%s' with 422",
    async (key) => {
      const res = await app.inject({ method: "POST", url: "/api/ontologies", payload: { key } });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(holder.registry.createOntology).not.toHaveBeenCalled();
    },
  );

  it("accepts a 59-character key and rejects a 60-character one", async () => {
    const key59 = "a".repeat(59);
    holder.registry.createOntology.mockResolvedValue({ ...ONTOLOGY_DATA, key: key59 });
    const ok = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: key59 },
    });
    expect(ok.statusCode).toBe(201);

    const tooLong = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "a".repeat(60) },
    });
    expect(tooLong.statusCode).toBe(422);
    expect(tooLong.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("a duplicate key answers 409 RESOURCE_CONFLICT", async () => {
    holder.registry.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "crm" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(holder.registry.createOntology).not.toHaveBeenCalled();
  });

  it("a duplicate display name answers 409 RESOURCE_CONFLICT", async () => {
    holder.registry.getOntologyByDisplayName.mockResolvedValue({
      ...ONTOLOGY_DATA,
      key: "other",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "crm", displayName: "Customer Relations" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    expect(holder.registry.createOntology).not.toHaveBeenCalled();
  });
});

describe("ontology list and read", () => {
  it("list answers every registered ontology", async () => {
    holder.registry.listOntologies.mockResolvedValue([
      ONTOLOGY_DATA,
      { ...ONTOLOGY_DATA, ontologyId: "22222222-2222-4222-8222-222222222222", key: "hr", displayName: null },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/ontologies" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].key).toBe("crm");
    expect(body[1].key).toBe("hr");
    expect(body[1].displayName).toBeNull();
  });

  it("read addresses by key", async () => {
    holder.registry.getOntology.mockResolvedValue(ONTOLOGY_DATA);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/crm" });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("crm");
    expect(holder.registry.getOntology).toHaveBeenCalledWith("crm");
  });

  it("an unknown key answers 404 RESOURCE_NOT_FOUND", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ontologies/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });
});

describe("ontology rename", () => {
  it("sets the display name and nothing else", async () => {
    holder.registry.renameOntology.mockResolvedValue({
      ...ONTOLOGY_DATA,
      displayName: "Sales",
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/crm",
      payload: { displayName: "Sales" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Sales");
    expect(res.json().key).toBe("crm");
    expect(holder.registry.renameOntology).toHaveBeenCalledWith("crm", "Sales");
  });

  it("a display name held by another ontology answers 409", async () => {
    holder.registry.getOntologyByDisplayName.mockResolvedValue({
      ...ONTOLOGY_DATA,
      key: "other",
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/crm",
      payload: { displayName: "Customer Relations" },
    });
    expect(res.statusCode).toBe(409);
    expect(holder.registry.renameOntology).not.toHaveBeenCalled();
  });

  it("renaming to the ontology's own display name is a no-op success", async () => {
    holder.registry.getOntologyByDisplayName.mockResolvedValue(ONTOLOGY_DATA);
    holder.registry.renameOntology.mockResolvedValue(ONTOLOGY_DATA);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/crm",
      payload: { displayName: "Customer Relations" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("an unknown key answers 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/nope",
      payload: { displayName: "Sales" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a body without displayName answers 422 — the key is immutable", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/crm",
      payload: { key: "new_key" },
    });
    expect(res.statusCode).toBe(422);
    expect(holder.registry.renameOntology).not.toHaveBeenCalled();
  });
});

describe("ontology delete", () => {
  it("answers 204 on success", async () => {
    holder.registry.deleteOntology.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/crm" });
    expect(res.statusCode).toBe(204);
    expect(holder.registry.deleteOntology).toHaveBeenCalledWith("crm");
  });

  it("an unknown key answers 404", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/nope" });
    expect(res.statusCode).toBe(404);
  });
});
