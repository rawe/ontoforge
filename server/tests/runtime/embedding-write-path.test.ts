/**
 * Write-path embedding decisions: no write embeds anything — the search
 * worker builds the entries later.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider, type EmbeddingProvider } from "../../src/core/embedding.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import * as service from "../../src/runtime/service.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";


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
  holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(makeUnscopedSchema());
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
});

afterEach(() => {
  setEmbeddingProvider(null);
  invalidateSearchContext();
});

function mockProvider(
  embedResult: number[] | null = [0.1, 0.2],
): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
  return { dimensions: 2, embed: vi.fn(async () => embedResult) };
}

describe("writes", () => {
  it("no write embeds anything", async () => {
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.createEntity.mockResolvedValue(makeEntity({ name: "Alice" }));
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }));
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Bob" }));
    const store = asRuntimeStore(holder.store);

    await service.createEntity("full_lens", "person", { name: "Alice" }, store);
    await service.updateEntity("full_lens", "person", "ent-1", { name: "Bob" }, store);

    expect(provider.embed).not.toHaveBeenCalled();
  });
});
