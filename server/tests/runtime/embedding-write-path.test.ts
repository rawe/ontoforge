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
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
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
      "full_lens",
      "person",
      { name: "Alice", email: "a@b.c", age: 30 },
      asRuntimeStore(holder.store),
    );

    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(provider.embed).toHaveBeenCalledWith("person: name=Alice, email=a@b.c");
    const call = holder.store.createEntity.mock.calls[0]!;
    expect(call[4]).toEqual([0.1, 0.2]); // embedding argument
    expect(call[6]).toEqual([{ propertyKey: "name", text: "Alice" }, { propertyKey: "email", text: "a@b.c" }]);
    expect(holder.store.validateVectorIndexedProperties).toHaveBeenCalledTimes(1);
  });

  it("a failed embedding does not fail the write", async () => {
    setEmbeddingProvider(mockProvider(null));
    holder.store.createEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    const result = await service.createEntity(
      "full_lens",
      "person",
      { name: "Alice" },
      asRuntimeStore(holder.store),
    );

    expect(result.name).toBe("Alice");
    expect(holder.store.createEntity.mock.calls[0]![4]).toBeNull();
    expect(holder.store.createEntity.mock.calls[0]![5]).toContain("name=Alice");
  });

  it("without a provider, neither embed nor size validation runs", async () => {
    holder.store.createEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    await service.createEntity(
      "full_lens",
      "person",
      { name: "Alice" },
      asRuntimeStore(holder.store),
    );

    expect(holder.store.validateVectorIndexedProperties).not.toHaveBeenCalled();
    expect(holder.store.createEntity.mock.calls[0]![4]).toBeNull();
    expect(holder.store.createEntity.mock.calls[0]![5]).toContain("name=Alice");
  });

  it("an oversized indexed string is rejected before the write", async () => {
    setEmbeddingProvider(mockProvider());
    holder.store.validateVectorIndexedProperties.mockImplementation(() => {
      throw new ValidationError("Property 'name' is too large for semantic indexing");
    });

    await expect(
      service.createEntity(
        "full_lens",
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
      "full_lens",
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
    expect(call[8]).toEqual([{ propertyKey: "name", text: "Alice" }, { propertyKey: "email", text: "new@b.c" }]);
  });

  it("removing a string property (null) re-embeds without it", async () => {
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", email: "old@b.c" }));
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    await service.updateEntity(
      "full_lens",
      "person",
      "ent-1",
      { email: null },
      asRuntimeStore(holder.store),
    );

    expect(provider.embed).toHaveBeenCalledWith("person: name=Alice");
    expect(holder.store.updateEntity.mock.calls[0]![8]).toEqual([{ propertyKey: "name", text: "Alice" }]);
  });

  it("does not re-embed when only a non-string property changes", async () => {
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Alice", age: 31 }));

    await service.updateEntity(
      "full_lens",
      "person",
      "ent-1",
      { age: 31 },
      asRuntimeStore(holder.store),
    );

    expect(provider.embed).not.toHaveBeenCalled();
    const call = holder.store.updateEntity.mock.calls[0]!;
    expect(call[5]).toBeNull(); // no embedding
    expect(call[6]).toBe(false); // no embedding update
    expect(call[8]).toBeUndefined(); // preserve stored keyword data
  });

  it("without a provider, updates recompose the stored property text", async () => {
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }));
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Bob" }));

    await service.updateEntity(
      "full_lens",
      "person",
      "ent-1",
      { name: "Bob" },
      asRuntimeStore(holder.store),
    );

    expect(holder.store.getEntity).toHaveBeenCalled();
    expect(holder.store.updateEntity.mock.calls[0]![6]).toBe(true);
    expect(holder.store.updateEntity.mock.calls[0]![7]).toContain("name=Bob");
    expect(holder.store.updateEntity.mock.calls[0]![8]).toEqual([{ propertyKey: "name", text: "Bob" }]);
  });
});
