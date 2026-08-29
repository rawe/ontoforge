/**
 * Document-aware semantic search (searchIn, RRF fusion, matchedVia) —
 * ported from `backend/tests/test_document_search_service.py`. Real
 * `Neo4jRuntimeStore` over a mocked query module, as in
 * `semantic-search.test.ts`.
 */

import type { Driver } from "neo4j-driver";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { Neo4jRuntimeStore } from "../../src/adapters/neo4j/runtimeStore.js";
import { setEmbeddingProvider, type EmbeddingProvider } from "../../src/core/embedding.js";
import type { RuntimeStore } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { semanticSearch } from "../../src/runtime/service.js";

vi.mock("../../src/adapters/neo4j/runtimeQueries.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getFullSchema: vi.fn(async () => null),
    getAiAgentConfigs: vi.fn(async () => []),
    getSavedQueries: vi.fn(async () => []),
    semanticSearch: vi.fn(async () => []),
    searchDocumentChunks: vi.fn(async () => []),
    getEntitiesByIds: vi.fn(async () => ({})),
  };
});

import * as queries from "../../src/adapters/neo4j/runtimeQueries.js";

type Row = Record<string, unknown>;

const mockedGetFullSchema = queries.getFullSchema as unknown as Mock;
const mockedSemanticSearch = queries.semanticSearch as unknown as Mock;
const mockedSearchChunks = queries.searchDocumentChunks as unknown as Mock;
const mockedGetByIds = queries.getEntitiesByIds as unknown as Mock;

function propRow(key: string, dataType = "string", required = false): Row {
  return { key, displayName: key, dataType, required, defaultValue: null };
}

/** person: name/age/bio(document)/notes(document); optional company with
 * profile(document). `personProps` overrides person's property rows;
 * `scopedPersonProps` narrows the lens's allowlist for person. */
function rawSchema(options?: {
  personProps?: Row[];
  includeCompany?: boolean;
  scopedPersonProps?: string[];
}): Row {
  const entityTypes: Row[] = [
    {
      entityTypeId: "et-1",
      key: "person",
      displayName: "Person",
      description: null,
      properties: options?.personProps ?? [
        propRow("name", "string", true),
        propRow("age", "integer"),
        propRow("bio", "document"),
        propRow("notes", "document"),
      ],
    },
  ];
  if (options?.includeCompany) {
    entityTypes.push({
      entityTypeId: "et-2",
      key: "company",
      displayName: "Company",
      description: null,
      properties: [propRow("name", "string", true), propRow("profile", "document")],
    });
  }
  return {
    lens: { lensId: "lens-1", key: "test", name: "Test", description: null },
    entityTypes,
    relationTypes: [],
    entityInclusions: options?.scopedPersonProps
      ? [{ key: "person", properties: options.scopedPersonProps }]
      : [],
    relationInclusions: [],
  };
}

function chunkHit(
  entityId: string,
  score: number,
  options?: {
    propertyKey?: string;
    start?: number;
    length?: number;
    text?: string;
    index?: number;
  },
): Row {
  const propertyKey = options?.propertyKey ?? "bio";
  const index = options?.index ?? 0;
  return {
    chunk: {
      _id: `chunk-${entityId}-${propertyKey}-${index}`,
      _entityId: entityId,
      _entityTypeKey: "person",
      _propertyKey: propertyKey,
      _index: index,
      startChar: options?.start ?? 0,
      charLength: options?.length ?? 500,
      text: options?.text ?? "chunk text ".repeat(40), // > 200 chars
    },
    score,
  };
}

function person(entityId: string, name: string, props: Row = {}): Row {
  return { _id: entityId, _entityTypeKey: "person", name, ...props };
}

function fakeDriver(): Driver {
  return {
    session: () => ({ run: async () => ({ records: [] }), close: async () => {} }),
  } as unknown as Driver;
}

function provider(): EmbeddingProvider {
  return { dimensions: 8, embed: vi.fn(async () => Array(8).fill(0.1)) };
}

/** The virtual index name of the mocked `searchDocumentChunks` call. */
function queriedIndexNames(): Set<string> {
  return new Set(mockedSearchChunks.mock.calls.map((c) => c[2] as string));
}

let store: RuntimeStore;

beforeEach(() => {
  vi.clearAllMocks();
  invalidateLoadedSchemaCache();
  store = new Neo4jRuntimeStore(fakeDriver()) as unknown as RuntimeStore;
  mockedGetFullSchema.mockResolvedValue(rawSchema());
  setEmbeddingProvider(provider());
});

afterEach(() => {
  setEmbeddingProvider(null);
});

describe("searchIn validation", () => {
  it("invalid searchIn raises", async () => {
    await expect(
      semanticSearch("test", "q", null, 10, null, store, { searchIn: "bogus" }),
    ).rejects.toThrow(/searchIn/);
  });
});

describe("searchIn=documents", () => {
  it("ranks, dedupes to parents, and shapes matchedVia", async () => {
    mockedSearchChunks.mockImplementation(
      async (_session: unknown, _label: string, indexName: string) =>
        indexName === "person_document_bio_embedding"
          ? [
              chunkHit("e1", 0.9, { start: 1500, length: 1400, index: 1 }),
              chunkHit("e2", 0.8),
              chunkHit("e1", 0.7, { index: 0 }),
            ]
          : [],
    );
    mockedGetByIds.mockResolvedValue({
      e1: person("e1", "Ada", { bio: "x".repeat(4000), _doc_bio_length: 4000 }),
      e2: person("e2", "Grace", { bio: "y".repeat(3000) }),
    });

    const result = await semanticSearch("test", "analytical engines", null, 10, null, store, {
      searchIn: "documents",
    });

    expect(result.total).toBe(2);
    const [first, second] = result.results as Row[];

    // Best chunk per entity wins; ranking by raw chunk score.
    expect((first!.entity as Row)._id).toBe("e1");
    expect(first!.score).toBe(0.9);
    expect((second!.entity as Row)._id).toBe("e2");
    expect(second!.score).toBe(0.8);

    // matchedVia shape (no chunk internals in the API).
    const mv = first!.matchedVia as Row;
    expect(mv.source).toBe("document");
    expect(mv.propertyKey).toBe("bio");
    expect(mv.charOffset).toBe(1500);
    expect(mv.charLength).toBe(1400);
    expect(mv.similarity).toBe(0.9);
    expect((mv.snippet as string).length).toBeLessThanOrEqual(200);
    expect(mv).not.toHaveProperty("chunkIndex");
    expect(mv).not.toHaveProperty("_index");

    // Entity payloads carry document stubs, never content.
    expect((first!.entity as Row).bio).toEqual({ document: true, length: 4000 });
    expect(first!.entity as Row).not.toHaveProperty("_doc_bio_length");
  });

  it("snippets=false omits the snippet but keeps the coordinates", async () => {
    mockedSearchChunks.mockImplementation(
      async (_s: unknown, _l: string, indexName: string) =>
        indexName === "person_document_bio_embedding" ? [chunkHit("e1", 0.9)] : [],
    );
    mockedGetByIds.mockResolvedValue({ e1: person("e1", "Ada") });

    const result = await semanticSearch("test", "q", null, 10, null, store, {
      searchIn: "documents",
      snippets: false,
    });

    const mv = (result.results as Row[])[0]!.matchedVia as Row;
    expect(mv).not.toHaveProperty("snippet");
    expect(mv.charOffset).toBe(0);
  });

  it("min_score filters chunks before ranking", async () => {
    mockedSearchChunks.mockImplementation(
      async (_s: unknown, _l: string, indexName: string) =>
        indexName === "person_document_bio_embedding"
          ? [chunkHit("e1", 0.9), chunkHit("e2", 0.5)]
          : [],
    );
    mockedGetByIds.mockResolvedValue({ e1: person("e1", "Ada") });

    const result = await semanticSearch("test", "q", null, 10, 0.8, store, {
      searchIn: "documents",
    });

    expect(result.total).toBe(1);
    expect(((result.results as Row[])[0]!.entity as Row)._id).toBe("e1");
  });

  it("queries only in-scope virtual indexes", async () => {
    // The lens hides `notes` from person: PersonDocumentNotes is never touched.
    mockedGetFullSchema.mockResolvedValue(rawSchema({ scopedPersonProps: ["name", "bio"] }));

    await semanticSearch("test", "q", null, 10, null, store, { searchIn: "documents" });

    const queried = new Set(
      mockedSearchChunks.mock.calls.map((c) => [c[1], c[2]].join("|")),
    );
    expect(queried).toEqual(
      new Set(["PersonDocumentBio|person_document_bio_embedding"]),
    );
  });

  it("a type filter narrows to that type's document indexes", async () => {
    mockedGetFullSchema.mockResolvedValue(rawSchema({ includeCompany: true }));

    await semanticSearch("test", "q", "person", 10, null, store, { searchIn: "documents" });

    expect(queriedIndexNames()).toEqual(
      new Set(["person_document_bio_embedding", "person_document_notes_embedding"]),
    );
  });

  it("returns empty without querying when no document properties are in scope", async () => {
    mockedGetFullSchema.mockResolvedValue(
      rawSchema({ personProps: [propRow("name", "string", true)] }),
    );

    const result = await semanticSearch("test", "q", null, 10, null, store, {
      searchIn: "documents",
    });

    expect(result.total).toBe(0);
    expect(mockedSearchChunks).not.toHaveBeenCalled();
  });

  it("applies property filters to resolved parents", async () => {
    mockedSearchChunks.mockImplementation(
      async (_s: unknown, _l: string, indexName: string) =>
        indexName === "person_document_bio_embedding"
          ? [chunkHit("e1", 0.9), chunkHit("e2", 0.8)]
          : [],
    );
    mockedGetByIds.mockResolvedValue({
      e1: person("e1", "Ada", { age: 30 }),
      e2: person("e2", "Grace", { age: 20 }),
    });

    const result = await semanticSearch("test", "q", "person", 10, null, store, {
      filters: { age__gt: "25" },
      searchIn: "documents",
    });

    expect(result.total).toBe(1);
    expect(((result.results as Row[])[0]!.entity as Row)._id).toBe("e1");
  });
});

describe("searchIn=entities", () => {
  it("keeps the raw similarity as the score and adds matchedVia", async () => {
    mockedSemanticSearch.mockResolvedValue([{ entity: person("e1", "Ada"), score: 0.95 }]);

    const result = await semanticSearch("test", "q", "person", 10, null, store, {
      searchIn: "entities",
    });

    const hit = (result.results as Row[])[0]!;
    expect(hit.score).toBe(0.95);
    expect(hit.matchedVia).toEqual({ source: "entity", similarity: 0.95 });
  });

  it("never queries chunk indexes", async () => {
    await semanticSearch("test", "q", "person", 10, null, store, { searchIn: "entities" });
    expect(mockedSearchChunks).not.toHaveBeenCalled();
  });
});

describe("searchIn=all (RRF fusion)", () => {
  it("fuses rankings with reciprocal rank fusion", async () => {
    // e1 appears in both rankings (rank 1 + rank 2), e2/e3 in one each.
    mockedSemanticSearch.mockResolvedValue([
      { entity: person("e1", "Ada"), score: 0.95 },
      { entity: person("e2", "Grace"), score: 0.85 },
    ]);
    mockedSearchChunks.mockImplementation(
      async (_s: unknown, _l: string, indexName: string) =>
        indexName === "person_document_bio_embedding"
          ? [chunkHit("e3", 0.9), chunkHit("e1", 0.8, { start: 300 })]
          : [],
    );
    mockedGetByIds.mockResolvedValue({
      e3: person("e3", "Alan"),
      e1: person("e1", "Ada"),
    });

    const result = await semanticSearch("test", "q", "person", 10, null, store, {
      searchIn: "all",
    });

    expect(result.total).toBe(3);
    const byId = new Map((result.results as Row[]).map((r) => [(r.entity as Row)._id, r]));

    // RRF: score = sum over rankings of 1/(60 + rank).
    expect(byId.get("e1")!.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(byId.get("e2")!.score).toBeCloseTo(1 / 62, 10);
    expect(byId.get("e3")!.score).toBeCloseTo(1 / 61, 10);

    // Fused ordering: e1 (both rankings) first.
    expect(((result.results as Row[])[0]!.entity as Row)._id).toBe("e1");

    // Document matchedVia wins for e1 (carries retrieval coordinates).
    const e1mv = byId.get("e1")!.matchedVia as Row;
    expect(e1mv.source).toBe("document");
    expect(e1mv.charOffset).toBe(300);
    expect(e1mv.similarity).toBe(0.8);
    // Entity-only hit carries the minimal matchedVia.
    expect(byId.get("e2")!.matchedVia).toEqual({ source: "entity", similarity: 0.85 });
    // Document-only hit.
    expect((byId.get("e3")!.matchedVia as Row).source).toBe("document");
  });

  it("applies the limit after fusion", async () => {
    mockedSemanticSearch.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        entity: person(`e${i}`, `P${i}`),
        score: 0.9 - i * 0.01,
      })),
    );
    mockedSearchChunks.mockImplementation(
      async (_s: unknown, _l: string, indexName: string) =>
        indexName === "person_document_bio_embedding"
          ? Array.from({ length: 5 }, (_, i) => chunkHit(`d${i}`, 0.9 - i * 0.01))
          : [],
    );
    mockedGetByIds.mockResolvedValue(
      Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`d${i}`, person(`d${i}`, `D${i}`)])),
    );

    const result = await semanticSearch("test", "q", "person", 3, null, store, {
      searchIn: "all",
    });

    expect(result.total).toBe(3);
  });

  it("degrades to the entity ranking when no document properties exist", async () => {
    mockedGetFullSchema.mockResolvedValue(
      rawSchema({ personProps: [propRow("name", "string", true)] }),
    );
    mockedSemanticSearch.mockResolvedValue([
      { entity: person("e1", "Ada"), score: 0.95 },
      { entity: person("e2", "Grace"), score: 0.85 },
    ]);

    const result = await semanticSearch("test", "q", "person", 10, null, store);

    expect((result.results as Row[]).map((r) => (r.entity as Row)._id)).toEqual(["e1", "e2"]);
    expect((result.results as Row[])[0]!.matchedVia).toEqual({
      source: "entity",
      similarity: 0.95,
    });
  });
});
