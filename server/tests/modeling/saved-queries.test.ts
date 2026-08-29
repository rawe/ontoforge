/**
 * Saved-query modeling endpoints over mocked stores, including:
 * collect-all reporting across mixed failures, BOTH parameter cross-check
 * directions including the binding-name-must-not-be-declared consequence,
 * self-reference rejection, the definition-time OQL lens check (run and
 * skipped variants), and description embedding on write.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  createMockRuntimeStore,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "../runtime/helpers.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

type Row = Record<string, unknown>;

const holder: { store: MockModelingStore; runtimeStore: MockRuntimeStore } = {
  store: createMockModelingStore(),
  runtimeStore: createMockRuntimeStore(),
};

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => holder.store,
  getRuntimeStore: () => holder.runtimeStore,
}));

const MOCK_LENS = {
  lensId: "lens-1",
  key: "test_lens",
  name: "Test",
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const MOCK_QUERY = {
  savedQueryId: "sq-1",
  key: "find-people",
  name: "Find People",
  description: "Find people by name",
  steps:
    '[{"name": "main", "type": "oql", "oql": "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p"}]',
  parameters: '[{"name": "name", "description": "Name to search for", "dataType": "string"}]',
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
  // The default runtime store has no schema: the definition-time OQL check
  // is SKIPPED, because the lens's schema cannot be loaded.
  holder.runtimeStore = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
  setEmbeddingProvider(null);
});

async function put(key: string, payload: Row) {
  return app.inject({
    method: "PUT",
    url: `/api/model/lenses/test_lens/saved-queries/${key}`,
    payload,
  });
}

describe("list", () => {
  it("answers an empty list", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.listSavedQueries.mockResolvedValue([]);
    const res = await app.inject({
      method: "GET",
      url: "/api/model/lenses/test_lens/saved-queries",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("deserializes the stored steps and parameters JSON", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.listSavedQueries.mockResolvedValue([MOCK_QUERY]);
    const res = await app.inject({
      method: "GET",
      url: "/api/model/lenses/test_lens/saved-queries",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Row[];
    expect(body).toHaveLength(1);
    const query = body[0]!;
    expect(query.key).toBe("find-people");
    expect(query.name).toBe("Find People");
    expect(query.description).toBe("Find people by name");
    const steps = query.steps as Row[];
    expect(steps).toHaveLength(1);
    expect(steps[0]!.name).toBe("main");
    expect(steps[0]!.type).toBe("oql");
    expect(steps[0]!.oql).toContain("MATCH");
    const parameters = query.parameters as Row[];
    expect(parameters).toHaveLength(1);
    expect(parameters[0]!.name).toBe("name");
    expect(parameters[0]!.description).toBe("Name to search for");
    expect(parameters[0]!.dataType).toBe("string");
    expect(query).toHaveProperty("createdAt");
    expect(query).toHaveProperty("updatedAt");
  });

  it("an unknown lens key answers 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/model/lenses/nonexistent/saved-queries",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("upsert", () => {
  const VALID_BODY = {
    name: "Find People",
    description: "Find people by name",
    steps: [
      {
        name: "main",
        type: "oql",
        oql: "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p",
      },
    ],
    parameters: [{ name: "name", description: "Name to search for", dataType: "string" }],
  };

  it("create answers 201", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertSavedQuery.mockResolvedValue([MOCK_QUERY, true]);
    const res = await put("find-people", VALID_BODY);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toBe("find-people");
    expect(body.name).toBe("Find People");
  });

  it("replace answers 200", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertSavedQuery.mockResolvedValue([MOCK_QUERY, false]);
    const res = await put("find-people", VALID_BODY);
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("find-people");
  });

  it("rejects a document-typed parameter — parameters are scalars", async () => {
    const res = await put("find-people", {
      ...VALID_BODY,
      parameters: [{ name: "name", description: "Name to search for", dataType: "document" }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("scalar");
    expect(holder.store.upsertSavedQuery).not.toHaveBeenCalled();
  });

  it("embeds the description on write when a provider is configured", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertSavedQuery.mockResolvedValue([MOCK_QUERY, true]);
    const embed = vi.fn(async () => [0.1, 0.2, 0.3]);
    setEmbeddingProvider({ dimensions: 3, embed });
    const res = await put("find-people", VALID_BODY);
    expect(res.statusCode).toBe(201);
    expect(embed).toHaveBeenCalledWith("Find people by name");
    // embedding + denormalized lens key reach the store.
    const args = holder.store.upsertSavedQuery.mock.calls[0]!;
    expect(args[7]).toBe("test_lens");
    expect(args[8]).toEqual([0.1, 0.2, 0.3]);
  });

  it("passes a null embedding when no provider is configured", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertSavedQuery.mockResolvedValue([MOCK_QUERY, true]);
    const res = await put("find-people", VALID_BODY);
    expect(res.statusCode).toBe(201);
    expect(holder.store.upsertSavedQuery.mock.calls[0]![8]).toBeNull();
  });
});

describe("delete", () => {
  it("answers 204", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.deleteSavedQuery.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/lenses/test_lens/saved-queries/find-people",
    });
    expect(res.statusCode).toBe(204);
  });

  it("an unknown query key answers 404", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.deleteSavedQuery.mockResolvedValue(false);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/model/lenses/test_lens/saved-queries/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("key validation", () => {
  it("a key violating ^[a-z][a-z0-9_-]*$ is rejected 422", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("INVALID", {
      name: "Test",
      description: "test",
      steps: [{ name: "main", type: "oql", oql: "MATCH (n:person) RETURN n" }],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
  });

  // The cap is 64 characters, uniformly on every key kind.
  it("a key longer than 64 characters is rejected 422 naming the cap", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("k".repeat(65), {
      name: "Test",
      description: "test",
      steps: [{ name: "main", type: "oql", oql: "MATCH (n:person) RETURN n" }],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("64");
    expect(holder.store.upsertSavedQuery).not.toHaveBeenCalled();
  });
});

describe("parameter cross-checks (both directions)", () => {
  it("a $param referenced in a step but not declared is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) WHERE p.age > $age RETURN p" }],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors.join("\n")).toContain(
      "Parameters referenced in steps but not declared: ['age']",
    );
  });

  it("a declared parameter referenced by no step is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }],
      parameters: [{ name: "unused", description: "Not used", dataType: "string" }],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors.join("\n")).toContain(
      "Parameters declared but not referenced in any step: ['unused']",
    );
  });

  it("a binding-supplied name must NOT also be declared — it would be unreferenced", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        { name: "first", type: "oql", oql: "MATCH (p:person) RETURN p" },
        {
          name: "second",
          type: "oql",
          oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
          bindings: { ids: "{{first._id}}" },
        },
      ],
      parameters: [{ name: "ids", description: "Supplied by the binding", dataType: "string" }],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors.join("\n")).toContain(
      "Parameters declared but not referenced in any step: ['ids']",
    );
  });

  it("a $param in a search text must be declared even when a binding shares its name", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    // Bindings on a semantic_search step are ignored at run time, so the
    // $q in the search text is caller-supplied and must be declared.
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        { name: "first", type: "oql", oql: "MATCH (p:person) RETURN p" },
        {
          name: "second",
          type: "semantic_search",
          entityTypeKey: "person",
          query: "$q",
          bindings: { q: "{{first.name}}" },
        },
      ],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors.join("\n")).toContain(
      "Parameters referenced in steps but not declared: ['q']",
    );
  });
});

describe("pipeline validation", () => {
  it("an empty steps array is a request-shape failure", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
  });

  it("an invalid step type is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [{ name: "main", type: "invalid_type", oql: "MATCH (n:person) RETURN n" }],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
  });

  it("duplicate step names are rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        { name: "main", type: "oql", oql: "MATCH (n:person) RETURN n" },
        { name: "main", type: "oql", oql: "MATCH (m:person) RETURN m" },
      ],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors.join("\n")).toContain("'main' already used by steps[0]");
  });

  it("a binding referencing a nonexistent step is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        {
          name: "main",
          type: "oql",
          oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
          bindings: { ids: "{{nonexistent._id}}" },
        },
      ],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
  });

  it("a forward reference is rejected — the step must be strictly earlier", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        {
          name: "first",
          type: "oql",
          oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
          bindings: { ids: "{{second._id}}" },
        },
        { name: "second", type: "oql", oql: "MATCH (n:person) RETURN n" },
      ],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
  });

  it("a self reference is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        {
          name: "main",
          type: "oql",
          oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
          bindings: { ids: "{{main._id}}" },
        },
      ],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors.join("\n")).toContain("References step 'main'");
  });

  it("a malformed binding expression is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        {
          name: "main",
          type: "oql",
          oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
          bindings: { ids: "just-not-a-binding" },
        },
      ],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors.join("\n")).toContain("Must be {{stepName.fieldName}}");
  });

  it("an oql step without a query is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [{ name: "main", type: "oql" }],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
  });

  it("a semantic_search step missing its fields collects BOTH failures", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [{ name: "search", type: "semantic_search" }],
      parameters: [],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    expect(details.errors).toEqual([
      "steps[0].entityTypeKey: Required for semantic_search steps",
      "steps[0].query: Required for semantic_search steps",
    ]);
  });

  it("ALL structural and cross-check failures are collected in one response", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await put("test-query", {
      name: "Test",
      description: "test",
      steps: [
        { name: "main", type: "oql" },
        { name: "main", type: "oql", oql: "MATCH (p:person) WHERE p.age > $age RETURN p" },
      ],
      parameters: [{ name: "unused", description: "Not used", dataType: "string" }],
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details as { errors: string[] };
    const joined = details.errors.join("\n");
    expect(details.errors).toHaveLength(4);
    expect(joined).toContain("steps[1].name: 'main' already used by steps[0]");
    expect(joined).toContain("steps[0].oql: Required for oql steps");
    expect(joined).toContain("Parameters referenced in steps but not declared: ['age']");
    expect(joined).toContain("Parameters declared but not referenced in any step: ['unused']");
  });

  it("a multi-step pipeline with valid bindings succeeds", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertSavedQuery.mockResolvedValue([MOCK_QUERY, true]);
    const res = await put("find-skilled-persons", {
      name: "Find Skilled Persons",
      description: "Search for a skill, then find persons with that skill",
      steps: [
        {
          name: "skills",
          type: "semantic_search",
          entityTypeKey: "skill",
          query: "$skill_query",
          limit: 5,
        },
        {
          name: "results",
          type: "oql",
          oql: "MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id IN $skill_ids RETURN p",
          bindings: { skill_ids: "{{skills._id}}" },
        },
      ],
      parameters: [
        { name: "skill_query", description: "Skill to search for", dataType: "string" },
      ],
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("definition-time OQL lens check", () => {
  it("an oql step naming a type the lens does not expose is rejected", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.runtimeStore.getFullSchema.mockResolvedValue(
      makeUnscopedSchema(),
    );
    const res = await app.inject({
      method: "PUT",
      url: "/api/model/lenses/full_lens/saved-queries/bad-query",
      payload: {
        name: "Bad",
        description: "references an unknown label",
        steps: [{ name: "main", type: "oql", oql: "MATCH (x:spaceship) RETURN x" }],
        parameters: [],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(holder.store.upsertSavedQuery).not.toHaveBeenCalled();
  });

  it("the check is skipped when the lens's schema cannot be loaded", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertSavedQuery.mockResolvedValue([MOCK_QUERY, true]);
    // Default runtime store: getFullSchema -> null -> NotFoundError.
    const res = await put("stored-anyway", {
      name: "Stored Anyway",
      description: "the run-time check still applies",
      steps: [{ name: "main", type: "oql", oql: "MATCH (x:spaceship) RETURN x" }],
      parameters: [],
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("cascading delete", () => {
  it("deleting the lens deletes its saved queries (handled by the store)", async () => {
    holder.store.deleteLens.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/model/lenses/lens-1" });
    expect(res.statusCode).toBe(204);
  });
});
