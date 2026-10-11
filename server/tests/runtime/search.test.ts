import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { search } from "../../src/runtime/search/entry.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeUnscopedSchema } from "./helpers.js";

let store: ReturnType<typeof createMockRuntimeStore>;
const entity = (id: string) => ({ _id: id, _entityTypeKey: "person", name: id });
beforeEach(() => {
  invalidateLoadedSchemaCache();
  setEmbeddingProvider({ dimensions: 2, embed: async () => [1, 0] });
  store = createMockRuntimeStore();
  const schema = makeUnscopedSchema();
  (schema.entityTypes as any[])[0].properties.push(
    ...["body", "appendix"].map((key) => ({ key, displayName: key, dataType: "document" })),
  );
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
  store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, entity(id)])),
  );
});
afterEach(() => setEmbeddingProvider(null));
describe("caller-supplied similarity floor", () => {
  it("rejects the floor under keyword ranking, explicit or resolved by default", async () => {
    store.supportsKeywordRanking.mockReturnValue(true);
    const explicit = search("full_lens", { query: "x", strategy: "keyword", minSimilarity: 0.5 }, store);
    await expect(explicit).rejects.toMatchObject({
      message: "min_similarity requires a strategy that ranks semantically",
      details: { fields: { min_similarity: "min_similarity requires a strategy that ranks semantically" } },
    });
    setEmbeddingProvider(null);
    const resolved = search("full_lens", { query: "x", minSimilarity: 0.5 }, store);
    await expect(resolved).rejects.toMatchObject({ details: { fields: { min_similarity: expect.any(String) } } });
  });

  it.each([-0.1, 1.1])("rejects a floor outside 0..1: %s", async (minSimilarity) => {
    await expect(
      search("full_lens", { query: "x", strategy: "semantic", minSimilarity }, store),
    ).rejects.toMatchObject({ details: { fields: { min_similarity: "Expected number from 0 to 1" } } });
  });
});
