/**
 * Write-path embedding decisions (`docs/capabilities/search.md#keeping-embeddings-current`):
 * create always embeds, update embeds only when a string property is
 * touched (from the merged post-update state), a failed embedding never
 * fails the write, and the indexed-string size validation runs only with a
 * provider. Plus the route-level FEATURE_DISABLED refusal.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider, type EmbeddingProvider } from "../../src/core/embedding.js";
import { ValidationError } from "../../src/core/exceptions.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import * as service from "../../src/runtime/service.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, unknown>;

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: () => ({}),
  getRuntimeStore: () => holder.store,
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
  holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
  invalidateLoadedSchemaCache();
});

afterEach(() => {
  setEmbeddingProvider(null);
});

function mockProvider(
  embedResult: number[] | null = [0.1, 0.2],
): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
  return { dimensions: 2, embed: vi.fn(async () => embedResult) };
}

describe("entity create", () => {
  it("always embeds, from the composed text, and passes the vector to the store", async () => {
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.createEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    await service.createEntity(
      "full_ontology",
      "person",
      { name: "Alice", email: "a@b.c", age: 30 },
      asRuntimeStore(holder.store),
    );

    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(provider.embed).toHaveBeenCalledWith("person: name=Alice, email=a@b.c");
    const call = holder.store.createEntity.mock.calls[0]!;
    expect(call[4]).toEqual([0.1, 0.2]); // embedding argument
    expect(holder.store.validateVectorIndexedProperties).toHaveBeenCalledTimes(1);
  });

  it("a failed embedding does not fail the write", async () => {
    setEmbeddingProvider(mockProvider(null));
    holder.store.createEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    const result = await service.createEntity(
      "full_ontology",
      "person",
      { name: "Alice" },
      asRuntimeStore(holder.store),
    );

    expect(result.name).toBe("Alice");
    expect(holder.store.createEntity.mock.calls[0]![4]).toBeNull();
  });

  it("without a provider, neither embed nor size validation runs", async () => {
    holder.store.createEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    await service.createEntity(
      "full_ontology",
      "person",
      { name: "Alice" },
      asRuntimeStore(holder.store),
    );

    expect(holder.store.validateVectorIndexedProperties).not.toHaveBeenCalled();
    expect(holder.store.createEntity.mock.calls[0]![4]).toBeNull();
  });

  it("an oversized indexed string is rejected before the write", async () => {
    setEmbeddingProvider(mockProvider());
    holder.store.validateVectorIndexedProperties.mockImplementation(() => {
      throw new ValidationError("Property 'name' is too large for semantic indexing");
    });

    await expect(
      service.createEntity(
        "full_ontology",
        "person",
        { name: "x" },
        asRuntimeStore(holder.store),
      ),
    ).rejects.toThrow(/too large for semantic indexing/);
    expect(holder.store.createEntity).not.toHaveBeenCalled();
  });
});

describe("entity update", () => {
  it("re-embeds from the merged post-update state when a string property changes", async () => {
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", email: "old@b.c", age: 30 }),
    );
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Alice", email: "new@b.c" }));

    await service.updateEntity(
      "full_ontology",
      "person",
      "ent-1",
      { email: "new@b.c" },
      asRuntimeStore(holder.store),
    );

    // Merged state: stored name + updated email (submitted fragment alone
    // would lose the name).
    expect(provider.embed).toHaveBeenCalledWith("person: name=Alice, email=new@b.c");
    const call = holder.store.updateEntity.mock.calls[0]!;
    expect(call[5]).toEqual([0.1, 0.2]); // embedding
    expect(call[6]).toBe(true); // hasEmbeddingUpdate
  });

  it("removing a string property (null) re-embeds without it", async () => {
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", email: "old@b.c" }));
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    await service.updateEntity(
      "full_ontology",
      "person",
      "ent-1",
      { email: null },
      asRuntimeStore(holder.store),
    );

    expect(provider.embed).toHaveBeenCalledWith("person: name=Alice");
  });

  it("does not re-embed when only a non-string property changes", async () => {
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Alice", age: 31 }));

    await service.updateEntity(
      "full_ontology",
      "person",
      "ent-1",
      { age: 31 },
      asRuntimeStore(holder.store),
    );

    expect(provider.embed).not.toHaveBeenCalled();
    const call = holder.store.updateEntity.mock.calls[0]!;
    expect(call[5]).toBeNull(); // no embedding
    expect(call[6]).toBe(false); // no embedding update
  });

  it("without a provider, updates never consult the current entity for embedding", async () => {
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Bob" }));

    await service.updateEntity(
      "full_ontology",
      "person",
      "ent-1",
      { name: "Bob" },
      asRuntimeStore(holder.store),
    );

    expect(holder.store.getEntity).not.toHaveBeenCalled();
    expect(holder.store.updateEntity.mock.calls[0]![6]).toBe(false);
  });
});

describe("semantic search route", () => {
  it("answers 422 VALIDATION_ERROR with details.code FEATURE_DISABLED without a provider", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/search/semantic?q=anything",
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string; details: Row } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("EMBEDDING_PROVIDER");
    expect(body.error.details).toEqual({ code: "FEATURE_DISABLED" });
  });

  it("passes min_score through to the entity ranking (pre-fusion floor)", async () => {
    setEmbeddingProvider(mockProvider());
    holder.store.semanticSearch.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/search/semantic?q=alice&type=person&min_score=0.75",
    });

    expect(res.statusCode).toBe(200);
    // store.semanticSearch(entityTypeKey, propertyDefs, embedding, limit, minScore, filters)
    expect(holder.store.semanticSearch.mock.calls[0]![4]).toBe(0.75);
  });

  it("rejects a missing q as a request-shape error", async () => {
    setEmbeddingProvider(mockProvider());
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/search/semantic",
    });
    expect(res.statusCode).toBe(422);
  });

  it("rejects an out-of-range limit", async () => {
    setEmbeddingProvider(mockProvider());
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/search/semantic?q=x&limit=101",
    });
    expect(res.statusCode).toBe(422);
  });
});
