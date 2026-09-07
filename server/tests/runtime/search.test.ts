import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { search } from "../../src/runtime/search/entry.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeUnscopedSchema } from "./helpers.js";

let store: ReturnType<typeof createMockRuntimeStore>;
const entity = (id: string) => ({ _id: id, _entityTypeKey: "person", name: id });
const entities = (ids: string[]) =>
  ids.map((id, i) => ({ entity: entity(id), score: 1 / (i + 1) }));
const passage = (id: string, parent: string, property: string, offset: number, score: number) => ({
  chunk: {
    _id: id,
    _entityId: parent,
    _entityTypeKey: "person",
    _propertyKey: property,
    startChar: offset,
    charLength: 50,
  },
  score,
});
beforeEach(() => {
  invalidateLoadedSchemaCache();
  setEmbeddingProvider({ dimensions: 2, embed: async () => [1, 0] });
  store = createMockRuntimeStore();
  store.supportsKeywordRanking.mockReturnValue(true);
  const schema = makeUnscopedSchema();
  (schema.entityTypes as any[])[0].properties.push(
    ...["body", "appendix"].map((key) => ({ key, displayName: key, dataType: "document" })),
  );
  store.getFullSchema.mockResolvedValue(schema);
  store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, entity(id)])),
  );
});
afterEach(() => setEmbeddingProvider(null));
describe("search entry ordering", () => {
  it("scales a single ranking to its best hit", async () => {
    store.propertySearchSemantic.mockResolvedValue(entities(["a", "b", "c"]));
    const response = await search(
      "full_lens",
      { query: "x", in: ["properties"], strategy: "semantic" },
      store,
    );
    expect(response.hits.map((h) => h.relativeScore)).toEqual([1, 0.5, 1 / 3]);
  });
  it("hybrid fuses identical entity units and scales rank-made scores", async () => {
    store.propertySearchSemantic.mockResolvedValue(entities(["a", "b"]));
    store.propertySearchKeyword.mockResolvedValue(entities(["b", "c"]));
    const response = await search("full_lens", { query: "x", in: ["properties"] }, store);
    expect(response.hits.map((h) => h.entity._id)).toEqual(["b", "a", "c"]);
    expect(response.hits[0]!.relativeScore).toBe(1);
    expect(response.hits[1]!.relativeScore).toBeCloseTo(1 / 61 / (1 / 61 + 1 / 62));
  });
  it("fuses passages before collapsing and keeps the best passage of every property", async () => {
    const a = passage("a", "one", "body", 0, 0.9),
      b = passage("b", "one", "body", 80, 0.8),
      c = passage("c", "one", "appendix", 20, 0.7);
    store.documentSearchSemantic.mockResolvedValue([a, b, c]);
    store.documentSearchKeyword.mockResolvedValue([b, c]);
    const response = await search("full_lens", { query: "x", in: ["document"] }, store);
    expect(response.hits).toHaveLength(1);
    expect(response.hits[0]!.matches).toEqual([
      { kind: "document", propertyKey: "body", charOffset: 80, charLength: 50 },
      { kind: "document", propertyKey: "appendix", charOffset: 20, charLength: 50 },
    ]);
  });
  it("fuses kinds by entity, preserving the entity match first and document order", async () => {
    store.propertySearchSemantic.mockResolvedValue(entities(["a", "b"]));
    store.documentSearchSemantic.mockResolvedValue([
      passage("c", "b", "appendix", 70, 0.9),
      passage("d", "b", "body", 0, 0.8),
    ]);
    const response = await search(
      "full_lens",
      { query: "x", strategy: "semantic", limit: 2 },
      store,
    );
    expect(response.hits.map((h) => h.entity._id)).toEqual(["b", "a"]);
    expect(response.hits[0]!.matches).toEqual([
      { kind: "properties" },
      { kind: "document", propertyKey: "appendix", charOffset: 70, charLength: 50 },
      { kind: "document", propertyKey: "body", charOffset: 0, charLength: 50 },
    ]);
  });
  it("computes one searched set with coerced filters for every ranking", async () => {
    await search("full_lens", { query: "x", filter: { age__gte: "20" } }, store);
    const types = store.propertySearchSemantic.mock.calls[0]![0];
    expect(types.map((t: any) => t.entityTypeKey)).toEqual(["person"]);
    expect(types[0].conditions).toEqual([
      { kind: "property", propertyKey: "age", dataType: "integer", op: "gte", value: 20 },
    ]);
    expect(store.propertySearchKeyword.mock.calls[0]![0]).toEqual(types);
    expect(store.documentSearchSemantic.mock.calls[0]![0].map((p: any) => p.conditions)).toEqual([
      types[0].conditions,
      types[0].conditions,
    ]);
  });
  it("grows the passage budget when one entity occupies the first page", async () => {
    store.documentSearchSemantic.mockImplementation(async (_types, _embedding, limit) =>
      Array.from({ length: Math.min(limit, 12) }, (_, i) =>
        passage(String(i), i < 10 ? "a" : "b", "body", i * 10, 1 / (i + 1)),
      ),
    );
    const result = await search(
      "full_lens",
      { query: "x", in: ["document"], strategy: "semantic", limit: 2 },
      store,
    );
    expect(result.hits.map((h) => h.entity._id)).toEqual(["a", "b"]);
  });
  it("keeps a second document property even beyond the initial passage budget", async () => {
    const passages = [
      ...Array.from({ length: 8 }, (_, i) => passage(String(i), "a", "body", i * 50, 1 / (i + 1))),
      passage("appendix", "a", "appendix", 0, 0.01),
    ];
    store.documentSearchSemantic.mockImplementation(async (_types, _embedding, limit) =>
      passages.slice(0, limit),
    );
    const result = await search(
      "full_lens",
      { query: "x", in: ["document"], strategy: "semantic", limit: 1 },
      store,
    );
    expect(result.hits[0]!.matches).toHaveLength(2);
  });
  it("preserves a property hit's document match below the document page cutoff", async () => {
    store.propertySearchSemantic.mockResolvedValue(entities(["a"]));
    store.documentSearchSemantic.mockResolvedValue([
      passage("b-body", "b", "body", 0, 0.9),
      passage("a-body", "a", "body", 50, 0.8),
    ]);
    for (const kinds of [
      ["properties", "document"],
      ["document", "properties"],
    ] as const) {
      const response = await search(
        "full_lens",
        { query: "x", in: [...kinds], strategy: "semantic", limit: 1 },
        store,
      );
      expect(response.hits[0]!.entity.name).toBe("a");
      expect(response.hits[0]!.matches).toEqual([
        { kind: "properties" },
        { kind: "document", propertyKey: "body", charOffset: 50, charLength: 50 },
      ]);
    }
  });
});
