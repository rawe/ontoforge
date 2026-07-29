/**
 * Semantic search service layer — ported from
 * `backend/tests/test_semantic_search_service.py`. Uses the real
 * `Neo4jRuntimeStore` over a mocked query module (the Python suite's
 * `runtime_queries` patching), so filter-to-WHERE-clause conversion and
 * the over-fetch arithmetic are exercised for real.
 */

import type { Driver } from "neo4j-driver";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { Neo4jRuntimeStore } from "../../src/adapters/neo4j/runtimeStore.js";
import { setEmbeddingProvider, type EmbeddingProvider } from "../../src/core/embedding.js";
import { NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import type { RuntimeStore } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { semanticSearch } from "../../src/runtime/service.js";

vi.mock("../../src/adapters/neo4j/runtimeQueries.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getFullSchema: vi.fn(async () => null),
    getAiAgentConfigs: vi.fn(async () => []),
    getSavedQueries: vi.fn(async () => []),
    semanticSearch: vi.fn(async () => []),
    searchDocumentChunks: vi.fn(async () => []),
    getEntitiesByIds: vi.fn(async () => ({})),
  };
});

import * as queries from "../../src/adapters/neo4j/runtimeQueries.js";

type Row = Record<string, unknown>;

const mockedGetFullSchema = queries.getFullSchema as unknown as Mock;
const mockedSemanticSearch = queries.semanticSearch as unknown as Mock;
const mockedSearchChunks = queries.searchDocumentChunks as unknown as Mock;

/** Raw full-schema payload matching the Python `_make_cache` fixture:
 * `person` gets name (string, required), age (integer), location (string);
 * every other key gets name only. */
function rawSchema(entityTypeKeys: string[] = ["person"], scopedKeys?: string[]): Row {
  const entityTypes = entityTypeKeys.map((key, i) => ({
    entityTypeId: `et-${i}`,
    key,
    displayName: key,
    description: null,
    properties:
      key === "person"
        ? [
            { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
            { key: "age", displayName: "Age", dataType: "integer", required: false, defaultValue: null },
            { key: "location", displayName: "Location", dataType: "string", required: false, defaultValue: null },
          ]
        : [
            { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
          ],
  }));
  return {
    ontology: { ontologyId: "ont-1", key: "test", name: "Test", description: null },
    entityTypes,
    relationTypes: [],
    entityInclusions: (scopedKeys ?? []).map((key) => ({ key, properties: null })),
    relationInclusions: [],
  };
}

function fakeDriver(): Driver {
  return {
    session: () => ({
      run: async () => ({ records: [] }),
      close: async () => {},
    }),
  } as unknown as Driver;
}

function provider(embedResult: number[] | null = Array(8).fill(0.1)): EmbeddingProvider {
  return { dimensions: 8, embed: vi.fn(async () => embedResult) };
}

let store: RuntimeStore;

beforeEach(() => {
  vi.clearAllMocks();
  invalidateLoadedSchemaCache();
  store = new Neo4jRuntimeStore(fakeDriver()) as unknown as RuntimeStore;
  mockedGetFullSchema.mockResolvedValue(rawSchema());
});

afterEach(() => {
  setEmbeddingProvider(null);
});

describe("basic behaviour", () => {
  it("raises FEATURE_DISABLED when no provider is configured", async () => {
    setEmbeddingProvider(null);
    const error = await semanticSearch("test", "engineers", "person", 10, null, store).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain("EMBEDDING_PROVIDER");
    expect((error as ValidationError).details).toEqual({ code: "FEATURE_DISABLED" });
  });

  it("raises NotFound for an unknown entity type", async () => {
    setEmbeddingProvider(provider());
    await expect(
      semanticSearch("test", "query", "nonexistent", 10, null, store),
    ).rejects.toThrow(NotFoundError);
  });

  it("type-scoped search fuses via RRF by default; raw similarity in matchedVia", async () => {
    setEmbeddingProvider(provider());
    mockedSemanticSearch.mockResolvedValue([
      { entity: { _id: "e1", name: "Alice" }, score: 0.95 },
    ]);

    const result = await semanticSearch("test", "find Alice", "person", 10, null, store);

    expect(result.query).toBe("find Alice");
    expect(result.total).toBe(1);
    const results = result.results as Row[];
    expect((results[0]!.entity as Row).name).toBe("Alice");
    expect(results[0]!.score).toBeCloseTo(1 / 61, 10);
    expect(results[0]!.matchedVia).toEqual({ source: "entity", similarity: 0.95 });
  });

  it("raises if the query embedding fails", async () => {
    setEmbeddingProvider(provider(null));
    await expect(semanticSearch("test", "query", "person", 10, null, store)).rejects.toThrow(
      /Failed to generate embedding/,
    );
  });
});

describe("filters (in-index WHERE, no over-fetch)", () => {
  it("without filters, the limit passes through and no clauses are built", async () => {
    setEmbeddingProvider(provider());
    await semanticSearch("test", "query", "person", 10, null, store);

    const call = mockedSemanticSearch.mock.calls[0]!;
    expect(call[1]).toBe("Person"); // pascal label
    expect(call[2]).toBe("person"); // entity type key
    expect(call[4]).toBe(10); // limit (no over-fetch)
    expect(call[6]).toBeNull(); // whereClauses
    expect(call[7]).toBeNull(); // filterParams
  });

  it("equality filter generates a WHERE clause without over-fetching", async () => {
    setEmbeddingProvider(provider());
    await semanticSearch("test", "engineers", "person", 10, null, store, {
      filters: { location: "Berlin" },
    });

    const call = mockedSemanticSearch.mock.calls[0]!;
    const whereClauses = call[6] as string[];
    const filterParams = call[7] as Row;
    expect(whereClauses).toHaveLength(1);
    expect(whereClauses[0]).toContain("n.location");
    expect(filterParams.flt_0).toBe("Berlin");
    expect(call[4]).toBe(10);
  });

  it("operator filter (age__gt) coerces the value and compares", async () => {
    setEmbeddingProvider(provider());
    await semanticSearch("test", "engineers", "person", 10, null, store, {
      filters: { age__gt: "25" },
    });

    const call = mockedSemanticSearch.mock.calls[0]!;
    const whereClauses = call[6] as string[];
    const filterParams = call[7] as Row;
    expect(whereClauses).toHaveLength(1);
    expect(whereClauses[0]).toContain("n.age >");
    expect(Number(filterParams.flt_0)).toBe(25); // coerced to int (driver integer)
  });

  it("unknown filter property raises ValidationError", async () => {
    setEmbeddingProvider(provider());
    await expect(
      semanticSearch("test", "query", "person", 10, null, store, {
        filters: { nonexistent: "value" },
      }),
    ).rejects.toThrow(/Unknown filter property/);
  });

  it("__contains is rejected on semantic search", async () => {
    setEmbeddingProvider(provider());
    await expect(
      semanticSearch("test", "query", "person", 10, null, store, {
        filters: { name__contains: "Ali" },
      }),
    ).rejects.toThrow(/__contains.*not supported/);
  });

  it("multiple filters generate multiple WHERE clauses", async () => {
    setEmbeddingProvider(provider());
    await semanticSearch("test", "query", "person", 10, null, store, {
      filters: { location: "Berlin", age__gte: "25" },
    });

    const call = mockedSemanticSearch.mock.calls[0]!;
    expect(call[6] as string[]).toHaveLength(2);
  });
});

describe("field projection", () => {
  it("projects entity properties, keeping _id", async () => {
    setEmbeddingProvider(provider());
    mockedSemanticSearch.mockResolvedValue([
      {
        entity: { _id: "e1", _entityTypeKey: "person", name: "Alice", age: 30, location: "Berlin" },
        score: 0.95,
      },
    ]);

    const result = await semanticSearch("test", "find Alice", "person", 10, null, store, {
      fields: ["name"],
    });

    const entity = (result.results as Row[])[0]!.entity as Row;
    expect(entity._id).toBe("e1");
    expect(entity.name).toBe("Alice");
    expect(entity).not.toHaveProperty("age");
    expect(entity).not.toHaveProperty("location");
    expect(entity).not.toHaveProperty("_entityTypeKey");
    expect(((result.results as Row[])[0]!.matchedVia as Row).similarity).toBe(0.95);
  });

  it("returns all fields without a projection", async () => {
    setEmbeddingProvider(provider());
    mockedSemanticSearch.mockResolvedValue([
      { entity: { _id: "e1", _entityTypeKey: "person", name: "Alice", age: 30 }, score: 0.9 },
    ]);

    const result = await semanticSearch("test", "find Alice", "person", 10, null, store);

    const entity = (result.results as Row[])[0]!.entity as Row;
    expect(entity._id).toBe("e1");
    expect(entity.name).toBe("Alice");
    expect(entity.age).toBe(30);
    expect(entity._entityTypeKey).toBe("person");
  });
});

describe("cross-type search (no entity type)", () => {
  it("hits the shared _Entity index with the plain limit when unscoped", async () => {
    setEmbeddingProvider(provider());
    mockedGetFullSchema.mockResolvedValue(rawSchema(["person", "company"]));
    mockedSemanticSearch.mockResolvedValue([
      { entity: { _id: "e1", _entityTypeKey: "person", name: "Alice" }, score: 0.95 },
      { entity: { _id: "e2", _entityTypeKey: "company", name: "Acme" }, score: 0.9 },
    ]);

    const result = await semanticSearch("test", "query", null, 10, null, store);

    const call = mockedSemanticSearch.mock.calls[0]!;
    expect(call[1]).toBe("_Entity");
    expect(call[4]).toBe(10); // unscoped: no over-fetch
    expect(call[8]).toBe("entity_embedding"); // index name
    expect(result.total).toBe(2);
    const results = result.results as Row[];
    expect((results[0]!.entity as Row)._entityTypeKey).toBe("person");
    expect((results[1]!.entity as Row)._entityTypeKey).toBe("company");
  });

  it("a scoped ontology over-fetches and drops out-of-scope types", async () => {
    setEmbeddingProvider(provider());
    mockedGetFullSchema.mockResolvedValue(rawSchema(["person", "company"], ["person"]));
    mockedSemanticSearch.mockResolvedValue([
      { entity: { _id: "e1", _entityTypeKey: "company", name: "Acme" }, score: 0.95 },
      { entity: { _id: "e2", _entityTypeKey: "person", name: "Alice" }, score: 0.9 },
    ]);

    const result = await semanticSearch("test", "query", null, 10, null, store);

    const call = mockedSemanticSearch.mock.calls[0]!;
    expect(call[4]).toBe(50); // limit * 5 over-fetch
    expect(result.total).toBe(1);
    expect(((result.results as Row[])[0]!.entity as Row)._entityTypeKey).toBe("person");
  });

  it("truncates over-fetched results to the requested limit", async () => {
    setEmbeddingProvider(provider());
    mockedGetFullSchema.mockResolvedValue(rawSchema(["person", "company"], ["person"]));
    mockedSemanticSearch.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        entity: { _id: `e${i}`, _entityTypeKey: "person", name: `P${i}` },
        score: 0.9,
      })),
    );

    const result = await semanticSearch("test", "query", null, 2, null, store);
    expect(result.total).toBe(2);
  });

  it("rejects property filters without a type", async () => {
    setEmbeddingProvider(provider());
    await expect(
      semanticSearch("test", "query", null, 10, null, store, {
        filters: { location: "Berlin" },
      }),
    ).rejects.toThrow(/require 'type'/);
  });

  it("field projection always keeps _id and _entityTypeKey", async () => {
    setEmbeddingProvider(provider());
    mockedSemanticSearch.mockResolvedValue([
      { entity: { _id: "e1", _entityTypeKey: "person", name: "Alice", age: 30 }, score: 0.95 },
    ]);

    const result = await semanticSearch("test", "query", null, 10, null, store, {
      fields: ["name"],
    });

    const entity = (result.results as Row[])[0]!.entity as Row;
    expect(entity._id).toBe("e1");
    expect(entity._entityTypeKey).toBe("person");
    expect(entity.name).toBe("Alice");
    expect(entity).not.toHaveProperty("age");
  });

  it("an empty scope returns no results without touching the index", async () => {
    setEmbeddingProvider(provider());
    // Scope to a key that no longer resolves: the lens ends up empty.
    mockedGetFullSchema.mockResolvedValue(rawSchema(["person"], ["ghost"]));

    const result = await semanticSearch("test", "query", null, 10, null, store);

    expect(result.total).toBe(0);
    expect(mockedSemanticSearch).not.toHaveBeenCalled();
    expect(mockedSearchChunks).not.toHaveBeenCalled();
  });
});
