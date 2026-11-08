/**
 * A claim keeps its lease while it embeds: a heartbeat renews the lease of
 * every item not yet settled, only while the provider runs, and the claim's
 * writes go out under the renewed lease once no renewal runs any more.
 * Stores are stubs, as in `search-worker-stop.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  claimQueueItems: vi.fn(),
  renewQueueClaim: vi.fn(),
  listGenerations: vi.fn(),
  completeQueueItems: vi.fn(),
  failQueueItems: vi.fn(),
  releaseQueueItems: vi.fn(),
  recordGenerationProgress: vi.fn(),
  queueStats: vi.fn(),
  finishGeneration: vi.fn(),
  designRevision: vi.fn(),
  sweepGenerations: vi.fn(),
  readEntryHashes: vi.fn(),
  upsertEntries: vi.fn(),
  deleteEntityPartsExcept: vi.fn(),
  deleteEntries: vi.fn(),
};
const runtime = { getEntityById: vi.fn() };
const provider = { modelId: "m1", dimensions: 3, embed: vi.fn(), embedBatch: vi.fn() };

vi.mock("../../src/core/ports.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSearchIndexStore: async () => store,
  getRuntimeStore: async () => runtime,
}));
vi.mock("../../src/core/embedding.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEmbeddingProvider: () => provider,
}));
vi.mock("../../src/runtime/schemaCache.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadSearchContextUncached: async () => ({
    schema: {
      entityTypes: { person: { key: "person", properties: { name: { key: "name", dataType: "string" } } } },
      relationTypes: {},
    },
    indices: ["i1", "i2"].map((searchIndexId) => ({
      searchIndexId,
      definition: {
        entityType: "person",
        fields: ["name"],
        header: ["name"],
        relations: [],
        semantic: { template: null },
      },
    })),
  }),
}));

const { drainOnce } = await import("../../src/runtime/indexing/worker.js");

const HEARTBEAT_MS = 100_000;

function generation(generationId: string, searchIndexId: string) {
  return { generationId, searchIndexId, representation: "semantic", state: "ready", modelId: "m1" };
}

function item(generationId: string, entityId: string) {
  return { generationId, entityId, partKind: "entity", groupNo: 0, partId: "", attempts: 0, lease: "L0" };
}

/** An embedding that resolves only when the test says so. */
function pendingEmbedding(): { resolve: () => void } {
  let resolve!: () => void;
  provider.embedBatch.mockImplementationOnce(
    (texts: string[]) =>
      new Promise((done) => {
        resolve = () => done(texts.map(() => [1, 0, 0]));
      }),
  );
  return {
    resolve: () => resolve(),
  };
}

/** Lets the pass run up to its next timer or pending promise. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  store.listGenerations.mockResolvedValue([generation("g1", "i1"), generation("g2", "i2")]);
  store.designRevision.mockResolvedValue({ ontologyId: "o", revision: 1 });
  store.readEntryHashes.mockResolvedValue([]);
  store.upsertEntries.mockImplementation(async (_g: string, writes: unknown[]) => writes.length);
  store.completeQueueItems.mockImplementation(async (items: unknown[]) => ({ completed: items.length, lost: 0 }));
  store.queueStats.mockResolvedValue([]);
  store.renewQueueClaim.mockImplementation(async (items: unknown[]) => items.map(() => "L1"));
  runtime.getEntityById.mockResolvedValue({ _entityTypeKey: "person", name: "Ada" });
  provider.embedBatch.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a claim's lease while it embeds", () => {
  it("is renewed for every unsettled item, and the claim settles under the new lease", async () => {
    const a = item("g1", "e1");
    const b = item("g2", "e2");
    store.claimQueueItems.mockResolvedValue([a, b]);
    const embedding = pendingEmbedding();
    const pass = drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    await settle();
    expect(provider.embedBatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.renewQueueClaim).toHaveBeenCalledTimes(1);
    expect(store.renewQueueClaim).toHaveBeenCalledWith([a, b], 300);

    embedding.resolve();
    await pass;
    expect(store.upsertEntries.mock.calls[0]![2]).toEqual([expect.objectContaining({ lease: "L1" })]);
    expect(store.completeQueueItems).toHaveBeenNthCalledWith(1, [expect.objectContaining({ entityId: "e1", lease: "L1" })]);
    expect(store.completeQueueItems).toHaveBeenNthCalledWith(2, [expect.objectContaining({ entityId: "e2", lease: "L1" })]);
  });

  it("keeps the lease of an item no longer held", async () => {
    const a = item("g1", "e1");
    store.claimQueueItems.mockResolvedValue([a]);
    store.renewQueueClaim.mockResolvedValue([null]);
    const embedding = pendingEmbedding();
    const pass = drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    await settle();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    embedding.resolve();
    await pass;
    expect(store.completeQueueItems).toHaveBeenCalledWith([expect.objectContaining({ lease: "L0" })]);
  });

  it("no longer covers a generation already settled", async () => {
    const a = item("g1", "e1");
    const b = item("g2", "e2");
    store.claimQueueItems.mockResolvedValue([a, b]);
    provider.embedBatch.mockImplementationOnce(async (texts: string[]) => texts.map(() => [1, 0, 0]));
    const second = pendingEmbedding();
    const pass = drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    await settle();
    expect(provider.embedBatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.renewQueueClaim).toHaveBeenCalledWith([b], 300);
    second.resolve();
    await pass;
  });

  it("counts from the claim, not from each embedding", async () => {
    store.claimQueueItems.mockResolvedValue([item("g1", "e1"), item("g2", "e2")]);
    const first = pendingEmbedding();
    const second = pendingEmbedding();
    const pass = drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    await settle();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 10_000);
    first.resolve();
    await settle();
    expect(store.renewQueueClaim).not.toHaveBeenCalled();
    // 10 s into the second embedding a heartbeat has passed since the claim.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.renewQueueClaim).toHaveBeenCalledTimes(1);
    second.resolve();
    await pass;
  });

  it("is not renewed while the claim writes: a renewal in flight finishes first", async () => {
    const a = item("g1", "e1");
    store.claimQueueItems.mockResolvedValue([a]);
    store.listGenerations.mockResolvedValue([generation("g1", "i1")]);
    let renewed!: () => void;
    store.renewQueueClaim.mockImplementationOnce(
      () => new Promise((done) => (renewed = () => done(["L1"]))),
    );
    const embedding = pendingEmbedding();
    const pass = drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    await settle();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    embedding.resolve();
    await settle();
    expect(store.upsertEntries).not.toHaveBeenCalled();
    renewed();
    await pass;
    expect(store.upsertEntries.mock.calls[0]![2]).toEqual([expect.objectContaining({ lease: "L1" })]);
    // No heartbeat after the embedding.
    await vi.advanceTimersByTimeAsync(3 * HEARTBEAT_MS);
    expect(store.renewQueueClaim).toHaveBeenCalledTimes(1);
  });

  it("is tried again a heartbeat after a failed renewal, without failing the batch", async () => {
    store.claimQueueItems.mockResolvedValue([item("g1", "e1")]);
    store.listGenerations.mockResolvedValue([generation("g1", "i1")]);
    store.renewQueueClaim.mockRejectedValueOnce(new Error("connection reset"));
    const embedding = pendingEmbedding();
    const pass = drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    await settle();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.renewQueueClaim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(store.renewQueueClaim).toHaveBeenCalledTimes(2);
    embedding.resolve();
    await pass;
    expect(store.failQueueItems).not.toHaveBeenCalled();
    expect(store.completeQueueItems).toHaveBeenCalledWith([expect.objectContaining({ lease: "L1" })]);
  });

  it("stops renewing when the embedding fails, before the claim is failed", async () => {
    store.claimQueueItems.mockResolvedValue([item("g1", "e1")]);
    store.listGenerations.mockResolvedValue([generation("g1", "i1")]);
    store.failQueueItems.mockResolvedValue({ attempts: [1], lost: 0 });
    provider.embedBatch.mockRejectedValueOnce(new Error("HTTP 500"));
    await drainOnce({ ontologyKey: "o", signal: new AbortController().signal });
    expect(store.failQueueItems).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * HEARTBEAT_MS);
    expect(store.renewQueueClaim).not.toHaveBeenCalled();
  });
});
