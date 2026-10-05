/**
 * Rebuilding search data: on an adapter that stores search indices, the
 * saved-query descriptions alone; on one with its own search storage, run
 * without an embedding provider.
 *
 * The unit suite runs with no provider configured, which is exactly the
 * condition under test: the run must still rewrite what search reads
 * without inference — the passages — and must report the vector work it
 * did not do.
 */

import { describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import type { SearchIndexStore } from "../../src/core/ports.js";

import * as service from "../../src/modeling/service.js";
import { asModelingStore, createMockModelingStore } from "./helpers.js";
import { asRuntimeStore, createMockRuntimeStore } from "../runtime/helpers.js";

/** Drain the NDJSON generator into parsed records. */
async function run(
  store: ReturnType<typeof createMockModelingStore>,
  runtimeStore: ReturnType<typeof createMockRuntimeStore>,
): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  for await (const line of service.rebuildSearchData(
    asModelingStore(store),
    asRuntimeStore(runtimeStore),
  )) {
    events.push(JSON.parse(line) as Record<string, unknown>);
  }
  return events;
}

function storesWithOnePerson() {
  const store = createMockModelingStore();
  store.getEntityTypesWithProperties.mockResolvedValue([
    {
      key: "person",
      properties: [
        { key: "name", dataType: "string" },
        { key: "age", dataType: "integer" },
      ],
    },
  ]);
  const runtimeStore = createMockRuntimeStore();
  runtimeStore.listEntities.mockResolvedValue([
    [{ _id: "e1", name: "Alice Chen", age: 30 }],
    1,
  ]);
  return { store, runtimeStore };
}

describe("rebuildSearchData with no embedding provider", () => {
  it("runs instead of refusing, and says the embeddings were skipped", async () => {
    const { store, runtimeStore } = storesWithOnePerson();

    const events = await run(store, runtimeStore);

    const summary = events.at(-1)!;
    expect(summary.type).toBe("summary");
    expect(summary.embeddingsSkipped).toBe(true);
  });

  it("stores a null vector for every entity", async () => {
    const { store, runtimeStore } = storesWithOnePerson();

    await run(store, runtimeStore);

    expect(store.setEntityEmbedding.mock.calls).toEqual([["e1", null]]);
  });

  it("counts an entity as processed, not failed, when no vector was due", async () => {
    const { store, runtimeStore } = storesWithOnePerson();

    const events = await run(store, runtimeStore);

    const summary = events.at(-1)!;
    expect(summary.totalProcessed).toBe(1);
    expect(summary.totalFailed).toBe(0);
    expect(summary.entityTypes).toEqual([
      { entityTypeKey: "person", processed: 1, failed: 0 },
    ]);
  });

  it("touches no vector index and embeds no saved-query description", async () => {
    const { store, runtimeStore } = storesWithOnePerson();

    await run(store, runtimeStore);

    expect(store.dropMismatchedVectorIndexes).not.toHaveBeenCalled();
    expect(store.ensureVectorIndexes).not.toHaveBeenCalled();
    expect(store.listSavedQueryRefs).not.toHaveBeenCalled();
    expect(store.setSavedQueryEmbedding).not.toHaveBeenCalled();
  });

  it("re-chunks document properties", async () => {
    const store = createMockModelingStore();
    store.getEntityTypesWithProperties.mockResolvedValue([
      {
        key: "note",
        properties: [{ key: "body", dataType: "document" }],
      },
    ]);
    const runtimeStore = createMockRuntimeStore();
    runtimeStore.listEntities.mockResolvedValue([
      [{ _id: "n1", body: "A passage of text worth ranking." }],
      1,
    ]);

    await run(store, runtimeStore);

    expect(runtimeStore.deleteChunksForEntityProperty).toHaveBeenCalledWith(
      "n1",
      "body",
    );
    expect(runtimeStore.createDocumentChunks).toHaveBeenCalledTimes(1);
    const [chunkEntityId, chunkTypeKey, chunkPropertyKey, rows] =
      runtimeStore.createDocumentChunks.mock.calls[0]!;
    expect([chunkEntityId, chunkTypeKey, chunkPropertyKey]).toEqual([
      "n1",
      "note",
      "body",
    ]);
    // The passage text is stored while no vector accompanies it.
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("A passage of text worth ranking.");
    expect(rows[0]).not.toHaveProperty("_embedding");
  });
});

describe("rebuildSearchData on an adapter that stores search indices", () => {
  it("rebuilds the saved-query descriptions alone: no entity or document work", async () => {
    const provider = { dimensions: 2, modelId: "fake:2", embed: vi.fn(async () => [0.1, 0.2]), embedBatch: vi.fn() };
    setEmbeddingProvider(provider);
    try {
      const { store, runtimeStore } = storesWithOnePerson();
      const indexStore = {} as SearchIndexStore;
      const indexed = Object.assign(store, { searchIndices: () => indexStore });
      const indexedRuntime = Object.assign(runtimeStore, { searchIndices: () => indexStore });
      store.listSavedQueryRefs.mockResolvedValue([{ savedQueryId: "sq-1", description: "Find people" }]);

      const events = await run(indexed, indexedRuntime);

      expect(store.getEntityTypesWithProperties).not.toHaveBeenCalled();
      expect(store.setEntityEmbedding).not.toHaveBeenCalled();
      expect(runtimeStore.listEntities).not.toHaveBeenCalled();
      expect(runtimeStore.createDocumentChunks).not.toHaveBeenCalled();
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
