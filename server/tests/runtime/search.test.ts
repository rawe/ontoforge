import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { search } from "../../src/runtime/search/entry.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeUnscopedSchema, makeFullSchema } from "./helpers.js";

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
      { kind: "document", propertyKey: "body", charOffset: 80, charLength: 50, evidence: { semanticSimilarity: 0.8, keywordMatch: true } },
      { kind: "document", propertyKey: "appendix", charOffset: 20, charLength: 50, evidence: { semanticSimilarity: 0.7, keywordMatch: true } },
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
      { query: "x", type: "person", strategy: "semantic", limit: 2 },
      store,
    );
    expect(response.hits.map((h) => h.entity._id)).toEqual(["b", "a"]);
    expect(response.hits[0]!.matches).toEqual([
      { kind: "properties", evidence: { semanticSimilarity: 0.5, keywordMatch: null, keywordPropertyKeys: null } },
      { kind: "document", propertyKey: "appendix", charOffset: 70, charLength: 50, evidence: { semanticSimilarity: 0.9, keywordMatch: null } },
      { kind: "document", propertyKey: "body", charOffset: 0, charLength: 50, evidence: { semanticSimilarity: 0.8, keywordMatch: null } },
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
        { kind: "properties", evidence: { semanticSimilarity: 1, keywordMatch: null, keywordPropertyKeys: null } },
        { kind: "document", propertyKey: "body", charOffset: 50, charLength: 50, evidence: { semanticSimilarity: 0.8, keywordMatch: null } },
      ]);
    }
  });
});


describe("search evidence and scoped fusion", () => {
  it("preserves source similarity across both fusions and keeps limited absence unknown", async () => {
    store.propertySearchSemantic.mockResolvedValue([
      { entity: entity("a"), score: 0.9123456789 },
      { entity: entity("b"), score: 0.6 },
    ]);
    store.propertySearchKeyword.mockResolvedValue([
      { entity: entity("b"), score: 42, keywordPropertyKeys: ["name"] },
      { entity: entity("c"), score: 12 },
    ]);
    store.documentSearchSemantic.mockResolvedValue([passage("b-body", "b", "body", 0, 0.7)]);
    const result = await search("full_lens", { query: "x" }, store);
    const matches = Object.fromEntries(result.hits.map((h) => [h.entity._id, h.matches[0]!.evidence]));
    expect(matches.a).toEqual({ semanticSimilarity: 0.9123456789, keywordMatch: null, keywordPropertyKeys: null });
    expect(matches.b).toEqual({ semanticSimilarity: 0.6, keywordMatch: true, keywordPropertyKeys: ["name"] });
    expect(matches.c).toEqual({ semanticSimilarity: null, keywordMatch: true, keywordPropertyKeys: null });
  });

  it("never borrows evidence from another passage of the same document", async () => {
    store.documentSearchSemantic.mockResolvedValue([passage("semantic", "a", "body", 0, 0.83)]);
    store.documentSearchKeyword.mockResolvedValue([passage("keyword", "a", "body", 90, 12)]);
    const result = await search("full_lens", { query: "x", in: ["document"] }, store);
    expect(result.hits[0]!.matches).toEqual([{
      kind: "document", propertyKey: "body", charOffset: 0, charLength: 50,
      evidence: { semanticSimilarity: 0.83, keywordMatch: null },
    }]);
  });

  it("keyword-only retrieval needs no embedding and never substitutes keyword rank for similarity", async () => {
    setEmbeddingProvider(null);
    store.propertySearchKeyword.mockResolvedValue([{ entity: entity("a"), score: 42, keywordPropertyKeys: ["name"] }]);
    const result = await search("full_lens", { query: "a", strategy: "keyword", in: ["properties"] }, store);
    expect(result.hits[0]!.matches[0]!.evidence).toEqual({ semanticSimilarity: null, keywordMatch: true, keywordPropertyKeys: ["name"] });
    expect(store.propertySearchSemantic).not.toHaveBeenCalled();
    expect(result.hits[0]!.relativeScore).toBe(1);
  });

  it("unsupported keyword retrieval remains unknown", async () => {
    store.supportsKeywordRanking.mockReturnValue(false);
    store.propertySearchSemantic.mockResolvedValue(entities(["a"]));
    const result = await search("full_lens", { query: "x", in: ["properties"] }, store);
    expect(result.strategy).toBe("semantic");
    expect(result.hits[0]!.matches[0]!.evidence.keywordMatch).toBeNull();
    expect(store.propertySearchKeyword).not.toHaveBeenCalled();
  });

  it.each([["name", "email"], ["name", "missing"], ["name", "age"]])(
    "redacts complete attribution when a supporting key is hidden or not string: %j", async (...keys) => {
      store.getFullSchema.mockResolvedValue(makeFullSchema({ entityInclusions: [{ key: "person", properties: ["name", "age"] }] }));
      store.propertySearchKeyword.mockResolvedValue([{ entity: entity("a"), score: 1, keywordPropertyKeys: keys }]);
      const result = await search("full_lens", { query: "x", strategy: "keyword", in: ["properties"] }, store);
      expect(result.hits[0]!.matches[0]!.evidence).toEqual({ semanticSimilarity: null, keywordMatch: true, keywordPropertyKeys: null });
    },
  );

  it("keeps exposed property attribution even when request fields omit those values", async () => {
    store.propertySearchKeyword.mockResolvedValue([{ entity: entity("a"), score: 1, keywordPropertyKeys: ["name", "email"] }]);
    const result = await search("full_lens", { query: "x", fields: [], strategy: "keyword", in: ["properties"] }, store);
    expect(result.hits[0]!.entity).toEqual({ _id: "a", _entityTypeKey: "person" });
    expect(result.hits[0]!.matches[0]!.evidence).toEqual({ semanticSimilarity: null, keywordMatch: true, keywordPropertyKeys: ["name", "email"] });
  });

  it("uses best-kind rank across multiple types with stable property-first ties and all matches", async () => {
    store.propertySearchSemantic.mockResolvedValue([
      { entity: { _id: "a", _entityTypeKey: "company", name: "a" }, score: 0.9 },
      { entity: entity("b"), score: 0.8 },
    ]);
    store.documentSearchSemantic.mockResolvedValue([passage("b", "b", "body", 90, 0.9)]);
    for (const kinds of [["properties", "document"], ["document", "properties"]] as const) {
      const result = await search("full_lens", { query: "x", in: [...kinds], strategy: "semantic" }, store);
      expect(result.hits.map((h) => h.entity._id)).toEqual(["a", "b"]);
      expect(result.hits.map((h) => h.relativeScore)).toEqual([1, 1]);
      expect(result.hits[1]!.matches.map((m) => m.kind)).toEqual(["properties", "document"]);
    }
  });

  it.each(["named", "filtered", "lens"])("retains sum for %s one-type scope", async (scope) => {
    if (scope === "lens") {
      const schema = makeUnscopedSchema();
      (schema.entityTypes as any[])[0].properties.push({ key: "body", displayName: "body", dataType: "document" });
      schema.entityInclusions = [{ key: "person", properties: null }];
      store.getFullSchema.mockResolvedValue(schema);
    }
    store.propertySearchSemantic.mockResolvedValue(entities(["a", "b"]));
    store.documentSearchSemantic.mockResolvedValue([passage("b", "b", "body", 90, 0.99)]);
    const result = await search("full_lens", {
      query: "x", strategy: "semantic",
      ...(scope === "named" ? { type: "person" } : scope === "filtered" ? { filter: { age__gte: "20" } } : {}),
    }, store);
    expect(result.hits.map((h) => h.entity._id)).toEqual(["b", "a"]);
    expect(result.hits[1]!.relativeScore).toBeCloseTo((1 / 61) / (1 / 62 + 1 / 61));
  });
});


describe("measured cross-type rank ties", () => {
  it("prefers best returned similarity before the final limit while keeping equal relative scores", async () => {
    store.propertySearchSemantic.mockResolvedValue([
      { entity: entity("a"), score: 0.7 }, { entity: entity("b"), score: 0.6 },
    ]);
    store.documentSearchSemantic.mockResolvedValue([passage("b", "b", "body", 90, 0.9)]);
    const result = await search("full_lens", { query: "x", strategy: "semantic" }, store);
    expect(result.hits.map((hit) => hit.entity._id)).toEqual(["b", "a"]);
    expect(result.hits.map((hit) => hit.relativeScore)).toEqual([1, 1]);
    const limited = await search("full_lens", { query: "x", strategy: "semantic", limit: 1 }, store);
    expect(limited.hits[0]!.entity._id).toBe("b");
  });

  it("leaves a mixed measured/unknown tie stable", async () => {
    store.propertySearchSemantic.mockResolvedValue([{ entity: entity("a"), score: 0.7 }]);
    store.documentSearchKeyword.mockResolvedValue([passage("b", "b", "body", 90, 42)]);
    const result = await search("full_lens", { query: "x" }, store);
    expect(result.hits.map((hit) => hit.entity._id)).toEqual(["a", "b"]);
    expect(result.hits[1]!.matches[0]!.evidence.semanticSimilarity).toBeNull();
  });

  it("does not use a discarded passage's higher similarity to break an entity tie", async () => {
    store.propertySearchSemantic.mockResolvedValue([
      { entity: entity("a"), score: 0.8 }, { entity: entity("b"), score: 0.7 },
    ]);
    store.documentSearchSemantic.mockResolvedValue([
      passage("discarded", "b", "body", 0, 0.99),
      passage("selected", "b", "body", 90, 0.6),
    ]);
    store.documentSearchKeyword.mockResolvedValue([passage("selected", "b", "body", 90, 42)]);
    const result = await search("full_lens", { query: "x" }, store);
    expect(result.hits.map((hit) => hit.entity._id)).toEqual(["a", "b"]);
    expect(result.hits[1]!.matches[1]).toMatchObject({ charOffset: 90, evidence: { semanticSimilarity: 0.6, keywordMatch: true } });
  });

  it("leaves keyword-only cross-type rank ties in property-first order", async () => {
    setEmbeddingProvider(null);
    store.propertySearchKeyword.mockResolvedValue(entities(["a", "b"]));
    store.documentSearchKeyword.mockResolvedValue([passage("b", "b", "body", 90, 42)]);
    const result = await search("full_lens", { query: "x", strategy: "keyword" }, store);
    expect(result.hits.map((hit) => hit.entity._id)).toEqual(["a", "b"]);
  });
});


it("preserves single-type stable ties even when the later hit has higher similarity", async () => {
  store.propertySearchSemantic.mockResolvedValue([{ entity: entity("a"), score: 0.7 }]);
  store.documentSearchSemantic.mockResolvedValue([passage("b", "b", "body", 90, 0.9)]);
  const result = await search("full_lens", { query: "x", type: "person", strategy: "semantic" }, store);
  expect(result.hits.map((hit) => hit.entity._id)).toEqual(["a", "b"]);
  expect(result.hits.map((hit) => hit.relativeScore)).toEqual([1, 1]);
});
