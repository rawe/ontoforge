/**
 * Rebuilding search data: the saved-query descriptions' vectors and their
 * index — search indices maintain themselves.
 *
 * The unit suite runs with no provider configured: the run must still
 * answer, and must report the vector work it did not do.
 */

import { describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";

import * as service from "../../src/modeling/service.js";
import { asModelingStore, createMockModelingStore } from "./helpers.js";

/** Drain the NDJSON generator into parsed records. */
async function run(store: ReturnType<typeof createMockModelingStore>): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  for await (const line of service.rebuildSearchData(asModelingStore(store))) {
    events.push(JSON.parse(line) as Record<string, unknown>);
  }
  return events;
}

describe("rebuildSearchData with no embedding provider", () => {
  it("runs instead of refusing, and says the embeddings were skipped", async () => {
    const store = createMockModelingStore();

    const events = await run(store);

    expect(events).toEqual([
      {
        type: "summary",
        entityTypes: [],
        savedQueriesProcessed: 0,
        savedQueriesFailed: 0,
        totalProcessed: 0,
        totalFailed: 0,
        embeddingsSkipped: true,
      },
    ]);
  });

  it("touches no vector index and embeds no saved-query description", async () => {
    const store = createMockModelingStore();

    await run(store);

    expect(store.dropMismatchedVectorIndexes).not.toHaveBeenCalled();
    expect(store.ensureVectorIndexes).not.toHaveBeenCalled();
    expect(store.listSavedQueryRefs).not.toHaveBeenCalled();
    expect(store.setSavedQueryEmbedding).not.toHaveBeenCalled();
  });
});

describe("rebuildSearchData with a provider", () => {
  it("rebuilds the saved-query descriptions and their index", async () => {
    const provider = { dimensions: 2, modelId: "fake:2", embed: vi.fn(async () => [0.1, 0.2]), embedBatch: vi.fn() };
    setEmbeddingProvider(provider);
    try {
      const store = createMockModelingStore();
      store.listSavedQueryRefs.mockResolvedValue([{ savedQueryId: "sq-1", description: "Find people" }]);

      const events = await run(store);

      expect(provider.embed.mock.calls).toEqual([["Find people"]]);
      expect(provider.embedBatch).not.toHaveBeenCalled();
      expect(store.dropMismatchedVectorIndexes).toHaveBeenCalledWith(2);
      expect(store.setSavedQueryEmbedding.mock.calls).toEqual([["sq-1", [0.1, 0.2]]]);
      expect(store.ensureVectorIndexes).toHaveBeenCalledWith(2);
      expect(events).toEqual([
        { type: "progress", entityTypeKey: "saved_queries", processed: 1, total: 1 },
        {
          type: "summary",
          entityTypes: [],
          savedQueriesProcessed: 1,
          savedQueriesFailed: 0,
          totalProcessed: 1,
          totalFailed: 0,
          embeddingsSkipped: false,
        },
      ]);
    } finally {
      setEmbeddingProvider(null);
    }
  });
});
