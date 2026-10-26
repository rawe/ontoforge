/**
 * What a search pass reports as metrics: items by outcome, and the queue
 * summed over every ontology — only from a pass that saw them all. Stores
 * are stubs, as in `search-worker-stop.test.ts`.
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
  designRevision: vi.fn(),
  sweepGenerations: vi.fn(),
  readEntryHashes: vi.fn(),
  upsertEntries: vi.fn(),
  deleteEntityPartsExcept: vi.fn(),
  deleteEntries: vi.fn(),
};
const runtime = { getEntityById: vi.fn() };

vi.mock("../../src/core/ports.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSearchIndexStore: async () => store,
  getRuntimeStore: async () => runtime,
  getOntologyRegistry: () => ({ listOntologies: async () => [{ key: "a" }, { key: "b" }] }),
}));
vi.mock("../../src/runtime/schemaCache.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadSearchContextUncached: async () => ({
    schema: {
      entityTypes: { person: { key: "person", properties: { name: { key: "name", dataType: "string" } } } },
      relationTypes: {},
    },
    indices: [
      {
        searchIndexId: "i1",
        definition: {
          entityType: "person",
          fields: ["name"],
          header: ["name"],
          relations: [],
          semantic: { template: null },
        },
      },
    ],
  }),
}));

const { drainOnce } = await import("../../src/runtime/indexing/worker.js");
const { registry } = await import("../../src/metrics.js");

const generation = {
  generationId: "g1",
  searchIndexId: "i1",
  representation: "keyword",
  state: "active",
  languages: [],
};
const item = { generationId: "g1", entityId: "e1", partKind: "entity", groupNo: 0, partId: "", attempts: 0 };

async function value(name: string, labels: Record<string, string>): Promise<number> {
  const metric = await registry.getSingleMetric(name)!.get();
  const match = metric.values.find((v) => Object.entries(labels).every(([k, want]) => v.labels[k] === want));
  return match?.value ?? 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.claimQueueItems.mockResolvedValue([]);
  store.listGenerations.mockResolvedValue([generation]);
  store.failQueueItems.mockResolvedValue({ attempts: [1], lost: 0 });
  store.releaseQueueItems.mockResolvedValue(1);
  store.designRevision.mockResolvedValue({ ontologyId: "o", revision: 1 });
  store.readEntryHashes.mockResolvedValue([]);
  store.completeQueueItems.mockResolvedValue({ completed: 1, lost: 0 });
  runtime.getEntityById.mockResolvedValue({ _entityTypeKey: "person", name: "Ada" });
});

describe("search worker metrics", () => {
  it("report the queue summed over every ontology of a full pass", async () => {
    store.queueStats.mockResolvedValue([{ generationId: "g1", pending: 3, failed: 1, lastErrors: [] }]);
    await drainOnce({ signal: new AbortController().signal });
    expect(await value("ontoforge_search_queue_items", { state: "pending" })).toBe(6);
    expect(await value("ontoforge_search_queue_items", { state: "failed" })).toBe(2);
  });

  it("leave the queue as it was after a pass over one ontology only", async () => {
    store.queueStats.mockResolvedValue([{ generationId: "g1", pending: 3, failed: 1, lastErrors: [] }]);
    await drainOnce({ signal: new AbortController().signal });
    store.queueStats.mockResolvedValue([]);
    await drainOnce({ ontologyKey: "a", signal: new AbortController().signal });
    expect(await value("ontoforge_search_queue_items", { state: "pending" })).toBe(6);
  });

  it("count a batch that fails as failed items", async () => {
    store.queueStats.mockResolvedValue([]);
    store.claimQueueItems.mockResolvedValue([item]);
    runtime.getEntityById.mockRejectedValue(new Error("connection reset"));
    const before = await value("ontoforge_search_items_total", { outcome: "failed" });
    await drainOnce({ ontologyKey: "a", signal: new AbortController().signal });
    expect(await value("ontoforge_search_items_total", { outcome: "failed" })).toBe(before + 1);
  });

  it("count a batch stopped by shutdown as released items", async () => {
    store.queueStats.mockResolvedValue([]);
    const stop = new AbortController();
    store.claimQueueItems.mockImplementation(async () => {
      stop.abort();
      return [item];
    });
    const before = await value("ontoforge_search_items_total", { outcome: "released" });
    await drainOnce({ ontologyKey: "a", signal: stop.signal });
    expect(await value("ontoforge_search_items_total", { outcome: "released" })).toBe(before + 1);
  });

  it("count the entries a held claim wrote", async () => {
    store.queueStats.mockResolvedValue([]);
    store.claimQueueItems.mockResolvedValue([item]);
    store.upsertEntries.mockImplementation(async (_generation: string, writes: unknown[]) => writes.length);
    const before = await value("ontoforge_search_entries_total", { representation: "keyword" });
    await drainOnce({ ontologyKey: "a", signal: new AbortController().signal });
    expect(store.upsertEntries).toHaveBeenCalled();
    const writes = store.upsertEntries.mock.calls[0]![1] as unknown[];
    expect(writes.length).toBeGreaterThan(0);
    expect(await value("ontoforge_search_entries_total", { representation: "keyword" })).toBe(
      before + writes.length,
    );
  });

  it("count no entries for a claim taken over, whose writes the store dropped", async () => {
    store.queueStats.mockResolvedValue([]);
    store.claimQueueItems.mockResolvedValue([item]);
    store.upsertEntries.mockResolvedValue(0);
    store.completeQueueItems.mockResolvedValue({ completed: 0, lost: 1 });
    const before = await value("ontoforge_search_entries_total", { representation: "keyword" });
    await drainOnce({ ontologyKey: "a", signal: new AbortController().signal });
    expect(store.upsertEntries).toHaveBeenCalled();
    expect((store.upsertEntries.mock.calls[0]![1] as unknown[]).length).toBeGreaterThan(0);
    expect(await value("ontoforge_search_entries_total", { representation: "keyword" })).toBe(before);
  });
});
