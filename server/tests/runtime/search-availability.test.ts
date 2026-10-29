/**
 * Availability (`runtime/search/availability.ts`): which methods the
 * deployment can run, and per index × method whether a search node runs —
 * on which generation — or why not; the old routes' vocabularies derived
 * from it.
 */

import { afterEach, describe, expect, it } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import type { SearchGenerationRecord, SearchIndexRecord } from "../../src/core/ports.js";
import { SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { deploymentMethods, indexAvailability, offeredMethods } from "../../src/runtime/search/availability.js";
import { availableModes } from "../../src/runtime/search/indexSearch.js";
import { availableStrategies } from "../../src/runtime/search/strategies.js";

const MODEL = "fake:hash:2";
const install = (modelId = MODEL) =>
  setEmbeddingProvider({ dimensions: 2, modelId, embed: async () => [1, 0], embedBatch: async () => [] });
const store = (keyword: boolean) => ({ supportsKeywordRanking: () => keyword });

const record = (key: string, methods: { semantic?: boolean; keyword?: boolean } = {}): SearchIndexRecord => ({
  searchIndexId: `id-${key}`,
  key,
  kind: "custom",
  definition: SearchIndexDefinition.parse({
    key,
    name: key,
    description: key,
    entityType: "person",
    fields: ["name"],
    semantic: { enabled: methods.semantic ?? true },
    keyword: { enabled: methods.keyword ?? true },
  }),
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const generation = (
  index: SearchIndexRecord,
  representation: "semantic" | "keyword",
  overrides: Partial<SearchGenerationRecord> = {},
): SearchGenerationRecord => ({
  generationId: `${index.key}/${representation}/${overrides.state ?? "ready"}`,
  searchIndexId: index.searchIndexId,
  representation,
  definitionHash: "h",
  modelId: representation === "semantic" ? MODEL : null,
  dimensions: null,
  languages: representation === "keyword" ? ["english"] : null,
  state: "ready",
  total: 0,
  done: 0,
  failed: 0,
  createdAt: new Date(0),
  readyAt: new Date(0),
  ...overrides,
});

afterEach(() => setEmbeddingProvider(null));

describe("the deployment", () => {
  it("runs keyword when the store ranks by keyword, semantic when an embedding provider is installed", () => {
    expect(deploymentMethods(store(true))).toEqual(["keyword"]);
    expect(deploymentMethods(store(false))).toEqual([]);
    install();
    expect(deploymentMethods(store(true))).toEqual(["keyword", "semantic"]);
    expect(deploymentMethods(store(false))).toEqual(["semantic"]);
  });

  it("derives the old routes' strategies and modes, in their preference order", () => {
    expect(availableStrategies(store(true))).toEqual(["keyword", "keyword-any", "keyword-all"]);
    expect(availableModes(store(true))).toEqual(["keyword"]);
    install();
    expect(availableStrategies(store(true))).toEqual(["hybrid", "keyword", "keyword-any", "keyword-all", "semantic"]);
    expect(availableModes(store(true))).toEqual(["hybrid", "keyword", "semantic"]);
    expect(availableStrategies(store(false))).toEqual(["semantic"]);
    expect(availableModes(store(false))).toEqual(["semantic"]);
  });
});

describe("an index × method", () => {
  const index = record("people");

  it("offers the methods its definition enables, semantic only with an embedding provider", () => {
    expect(offeredMethods(index)).toEqual(["keyword"]);
    install();
    expect(offeredMethods(index)).toEqual(["semantic", "keyword"]);
    expect(offeredMethods(record("words", { semantic: false }))).toEqual(["keyword"]);
    expect(offeredMethods(record("meaning", { keyword: false }))).toEqual(["semantic"]);
  });

  it("a method the definition switches off does not run, whatever is built", () => {
    install();
    const off = record("words", { semantic: false });
    expect(indexAvailability(off, "semantic", [generation(off, "semantic")])).toEqual({
      runs: false,
      reason: "switched-off",
    });
  });

  it("semantic does not run without an embedding provider", () => {
    expect(indexAvailability(index, "semantic", [generation(index, "semantic")])).toEqual({
      runs: false,
      reason: "no-provider",
    });
  });

  it("runs on the index's ready generation of the method — semantic of the installed model only", () => {
    install();
    const other = record("other");
    const semantic = generation(index, "semantic");
    const generations = [
      generation(other, "semantic"),
      generation(index, "semantic", { generationId: "old-model", modelId: "fake:other:2" }),
      generation(index, "keyword", { languages: ["german"] }),
      semantic,
    ];
    expect(indexAvailability(index, "semantic", generations)).toEqual({ runs: true, generation: semantic });
    // Keyword in its own language set, which its queries are parsed in.
    expect(indexAvailability(index, "keyword", generations)).toEqual({
      runs: true,
      generation: generations[2],
    });
  });

  it("without a ready generation does not run: building while one fills, else stale", () => {
    install();
    const building = generation(index, "semantic", { state: "building" });
    const otherModel = generation(index, "semantic", { modelId: "fake:other:2" });
    expect(indexAvailability(index, "semantic", [otherModel, building])).toEqual({
      runs: false,
      reason: "not-ready",
      status: "building",
    });
    // A building generation of another model does not count either.
    expect(indexAvailability(index, "semantic", [otherModel, { ...building, modelId: "fake:other:2" }])).toEqual({
      runs: false,
      reason: "not-ready",
      status: "stale",
    });
    const retired = generation(index, "keyword", { state: "retired" });
    expect(indexAvailability(index, "keyword", [retired, generation(index, "keyword", { state: "failed" })])).toEqual({
      runs: false,
      reason: "not-ready",
      status: "stale",
    });
    expect(indexAvailability(index, "keyword", [])).toEqual({ runs: false, reason: "not-ready", status: "stale" });
  });
});
