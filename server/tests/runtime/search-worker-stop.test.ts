/**
 * A stopped search pass: it claims nothing more, and the batch it was in
 * when stopped is not failed but released — no attempt is charged, the
 * next claim takes it at once. Stores are stubs; the pipeline itself is
 * covered by `tests/integration/postgres/search-pipeline.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  claimQueueItems: vi.fn(),
  listGenerations: vi.fn(),
  completeQueueItems: vi.fn(),
  failQueueItems: vi.fn(),
  releaseQueueItems: vi.fn(),
  recordGenerationProgress: vi.fn(),
  queueStats: vi.fn(),
  finishGeneration: vi.fn(),
};
const runtime = { getEntityById: vi.fn() };

vi.mock("../../src/core/ports.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSearchIndexStore: async () => store,
  getRuntimeStore: async () => runtime,
}));
vi.mock("../../src/runtime/schemaCache.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadSearchContextUncached: async () => ({
    schema: { entityTypes: { person: { key: "person", properties: {} } }, relationTypes: {} },
    indices: [{ searchIndexId: "i1", definition: { entityType: "person", relations: [] } }],
  }),
}));

const { drainOnce } = await import("../../src/runtime/indexing/worker.js");

const generation = {
  generationId: "g1",
  searchIndexId: "i1",
  representation: "keyword",
  state: "building",
  languages: [],
};
const item = { generationId: "g1", entityId: "e1", partKind: "entity", groupNo: 0, partId: "", attempts: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  store.claimQueueItems.mockResolvedValue([item]);
  store.listGenerations.mockResolvedValue([generation]);
  store.failQueueItems.mockResolvedValue({ attempts: [1], lost: 0 });
  store.releaseQueueItems.mockResolvedValue(1);
  store.queueStats.mockResolvedValue([]);
});

describe("a stopped search pass", () => {
  it("releases the batch it was stopped in instead of failing it", async () => {
    const stop = new AbortController();
    runtime.getEntityById.mockImplementation(async () => {
      stop.abort();
      throw new Error("connection reset");
    });
    await drainOnce({ ontologyKey: "o", signal: stop.signal });
    expect(store.failQueueItems).not.toHaveBeenCalled();
    expect(store.completeQueueItems).not.toHaveBeenCalled();
    expect(store.releaseQueueItems).toHaveBeenCalledWith([item]);
  });

  it("releases a claimed generation it reaches after the stop", async () => {
    const stop = new AbortController();
    store.claimQueueItems.mockImplementation(async () => {
      stop.abort();
      return [item];
    });
    await drainOnce({ ontologyKey: "o", signal: stop.signal });
    expect(runtime.getEntityById).not.toHaveBeenCalled();
    expect(store.releaseQueueItems).toHaveBeenCalledWith([item]);
  });

  it("fails the same batch when it was not stopped", async () => {
    runtime.getEntityById.mockRejectedValue(new Error("connection reset"));
    await drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    expect(store.failQueueItems).toHaveBeenCalledTimes(1);
    expect(store.releaseQueueItems).not.toHaveBeenCalled();
  });

  it("claims nothing once stopped", async () => {
    expect(await drainOnce({ ontologyKey: "o", signal: AbortSignal.abort() })).toBe(0);
    expect(store.claimQueueItems).not.toHaveBeenCalled();
  });
});
