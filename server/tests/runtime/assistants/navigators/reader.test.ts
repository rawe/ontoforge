/**
 * The navigator's lens reader: ranked search runs the entity search over
 * the managed indices — own fields, with documents their passages too —
 * of one type or of every type, and hands back the full rows with the
 * engine's scores. What cannot run finds nothing; it is no error.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setEmbeddingProvider } from "../../../../src/core/embedding.js";
import type { RuntimeStore } from "../../../../src/core/ports.js";
import { lensReader } from "../../../../src/runtime/assistants/navigators/reader.js";
import { invalidateLoadedSchemaCache } from "../../../../src/runtime/schemaCache.js";
import {
  createMockRuntimeStore,
  makeUnscopedSchema,
  rankedEntry,
  withManagedIndices,
  type MockRuntimeStore,
} from "../../helpers.js";

const MODEL = "fake:hash:2";

const INDEX_SCHEMA = {
  entityTypes: {
    person: {
      key: "person",
      displayName: "Person",
      nameProperty: "name",
      properties: {
        name: { key: "name", displayName: "Name", dataType: "string" },
        bio: { key: "bio", displayName: "Bio", dataType: "document" },
      },
    },
    company: {
      key: "company",
      displayName: "Company",
      nameProperty: "name",
      properties: { name: { key: "name", displayName: "Name", dataType: "string" } },
    },
  },
  relationTypes: {},
};

let store: MockRuntimeStore;

beforeEach(() => {
  invalidateLoadedSchemaCache();
  setEmbeddingProvider({ dimensions: 2, modelId: MODEL, embed: async () => [1, 0], embedBatch: async () => [] });
  store = createMockRuntimeStore();
  store.supportsKeywordRanking.mockReturnValue(true);
  const schema = makeUnscopedSchema();
  (schema.entityTypes as { properties: unknown[] }[])[0]!.properties.push({
    key: "bio",
    displayName: "Bio",
    dataType: "document",
  });
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
  store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { _id: id, name: `N-${id}`, age: 30 }])),
  );
});

afterEach(() => setEmbeddingProvider(null));

const searched = () => [...new Set(store.indices.rankEntries.mock.calls.map(([query]) => query.generationId.split("/")[0]))].sort();

describe("lensReader.search", () => {
  it("searches own fields, of one type or of all; with documents their passages too", async () => {
    withManagedIndices(store, INDEX_SCHEMA, MODEL, () => []);
    const reader = lensReader("full_lens", store as unknown as RuntimeStore);
    await reader.search("ada", "person", false, 10);
    expect(searched()).toEqual(["person~default"]);
    store.indices.rankEntries.mockClear();
    await reader.search("ada", null, false, 10);
    expect(searched()).toEqual(["company~default", "person~default"]);
    store.indices.rankEntries.mockClear();
    await reader.search("ada", null, true, 20);
    expect(searched()).toEqual(["company~default", "person~bio", "person~default"]);
  });

  it("answers the full rows, best first, with the engine's scores", async () => {
    withManagedIndices(store, INDEX_SCHEMA, MODEL, (query) =>
      query.generationId === "person~default/semantic" ? [rankedEntry("a", 0.9), rankedEntry("b", 0.6)] : [],
    );
    const hits = await lensReader("full_lens", store as unknown as RuntimeStore).search("ada", "person", false, 10);
    expect(hits.map((hit) => hit.entity)).toEqual([
      expect.objectContaining({ _id: "a", _entityTypeKey: "person", name: "N-a", age: 30 }),
      expect.objectContaining({ _id: "b", _entityTypeKey: "person", name: "N-b", age: 30 }),
    ]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("finds nothing, without an error, where nothing can run", async () => {
    setEmbeddingProvider(null);
    store.supportsKeywordRanking.mockReturnValue(false);
    // No generation is built: every search node is a limitation.
    withManagedIndices(store, INDEX_SCHEMA, MODEL, () => [rankedEntry("a", 1)]);
    store.indices.listGenerations.mockResolvedValue([]);
    expect(await lensReader("full_lens", store as unknown as RuntimeStore).search("ada", null, true, 20)).toEqual([]);
  });
});
