/**
 * Partial document writes: str_replace, replace_range, chunk re-sync and
 * embedding reuse, including the code-point (emoji) scenarios.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { settings } from "../../src/config.js";
import { setEmbeddingProvider, type EmbeddingProvider } from "../../src/core/embedding.js";
import { chunkDocument } from "../../src/runtime/chunking.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { syncDocumentChunks } from "../../src/runtime/service.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  type MockRuntimeStore,
} from "./helpers.js";

const BIO = Array.from(
  { length: 10 },
  (_, i) => `Paragraph ${i}: ` + "lorem ipsum dolor sit amet. ".repeat(10),
).join("\n\n"); // ~2900 chars, every paragraph marker unique

type Row = Record<string, unknown>;

/** Schema with a person type that has a document property. */
function makeDocSchema(entityInclusions?: Row[]): Row {
  return {
    lens: {
      lensId: "lens-1",
      key: "docs_view",
      name: "Docs View",
      description: null,
    },
    entityTypes: [
      {
        entityTypeId: "et-1",
        key: "person",
        displayName: "Person",
        description: null,
        properties: [
          { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
          { key: "bio", displayName: "Bio", dataType: "document", required: false, defaultValue: null },
        ],
      },
    ],
    relationTypes: [],
    entityInclusions: entityInclusions ?? [],
    relationInclusions: [],
  };
}

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getLegacyModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
  getLegacyRuntimeStore: async () => holder.store,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
});

afterEach(() => {
  setEmbeddingProvider(null);
});

function mockProvider(dims = 8): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
  return {
    dimensions: dims,
    embed: vi.fn(async () => Array.from({ length: dims }, () => 0.1)),
  };
}

/** Wire the whole repo surface an edit touches. */
function mockEdit(entity: Row, updated?: Row): void {
  holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
  holder.store.getEntity.mockResolvedValue(entity);
  holder.store.updateEntity.mockResolvedValue(updated ?? entity);
}

const URL = "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio";

async function patchDoc(payload: Row, url = URL) {
  return app.inject({ method: "PATCH", url, payload });
}

describe("str_replace", () => {
  it("updates the value and length, answers the full edit report", async () => {
    setEmbeddingProvider(mockProvider());
    mockEdit(makeEntity({ name: "Ada", bio: "Hello brave world" }));

    const res = await patchDoc({ op: "str_replace", oldString: "brave", newString: "beautiful" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.propertyKey).toBe("bio");
    expect(body.totalLength).toBe("Hello beautiful world".length);
    expect(body.editedRange).toEqual({ offset: 6, length: "beautiful".length });
    expect(body.replacements).toBe(1);
    expect(body.context).toBe("Hello beautiful world");
    expect(body.contextOffset).toBe(0);

    const setProps = holder.store.updateEntity.mock.calls[0]![2] as Row;
    expect(setProps.bio).toBe("Hello beautiful world");
    expect(setProps._doc_bio_length).toBe("Hello beautiful world".length);
  });

  it("422 when oldString is not found", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello world" }));
    const res = await patchDoc({ op: "str_replace", oldString: "missing", newString: "x" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("not found");
  });

  it("422 when oldString is ambiguous", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "one two one two" }));
    const res = await patchDoc({ op: "str_replace", oldString: "two", newString: "three" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("2 times");
  });

  it("replaceAll replaces every occurrence", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "one two one two" }));
    const res = await patchDoc({
      op: "str_replace",
      oldString: "two",
      newString: "three",
      replaceAll: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().replacements).toBe(2);
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("one three one three");
  });

  it("replaceAll reports the FIRST occurrence as the edited region", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "aaa two bbb two ccc" }));
    const res = await patchDoc({
      op: "str_replace",
      oldString: "two",
      newString: "2",
      replaceAll: true,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.editedRange).toEqual({ offset: 4, length: 1 });
    expect(body.replacements).toBe(2);
  });

  it("422 when the strings are identical", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello world" }));
    const res = await patchDoc({ op: "str_replace", oldString: "world", newString: "world" });
    expect(res.statusCode).toBe(422);
  });

  it("422 when oldString is empty", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello world" }));
    const res = await patchDoc({ op: "str_replace", oldString: "", newString: "x" });
    expect(res.statusCode).toBe(422);
  });

  it("reports code-point offsets when the document carries emoji", async () => {
    // "🌍🌍 " before the target: 3 code points but 5 UTF-16 units.
    mockEdit(makeEntity({ name: "Ada", bio: "🌍🌍 brave world" }));
    const res = await patchDoc({ op: "str_replace", oldString: "brave", newString: "big" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.editedRange).toEqual({ offset: 3, length: 3 });
    expect(body.totalLength).toBe(Array.from("🌍🌍 big world").length);
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("🌍🌍 big world");
  });
});

describe("replace_range", () => {
  it("overwrites the slice", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello brave world" }));
    const res = await patchDoc({ op: "replace_range", offset: 6, length: 5, content: "big" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalLength).toBe("Hello big world".length);
    expect(body.editedRange).toEqual({ offset: 6, length: 3 });
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("Hello big world");
  });

  it("inserts with zero length", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello world" }));
    const res = await patchDoc({ op: "replace_range", offset: 5, length: 0, content: " brave" });
    expect(res.statusCode).toBe(200);
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("Hello brave world");
  });

  it("appends at the end", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello" }));
    const res = await patchDoc({ op: "replace_range", offset: 5, length: 0, content: " world" });
    expect(res.statusCode).toBe(200);
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("Hello world");
  });

  it("an unset document starts empty", async () => {
    mockEdit(makeEntity({ name: "Ada" })); // bio never written
    const res = await patchDoc({ op: "replace_range", offset: 0, length: 0, content: "# New doc" });
    expect(res.statusCode).toBe(200);
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("# New doc");
  });

  it("422 when the range reaches past the end", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "short" }));
    const res = await patchDoc({ op: "replace_range", offset: 3, length: 10, content: "x" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("exceeds");
  });

  it("422 when the offset is beyond the end", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "short" }));
    const res = await patchDoc({ op: "replace_range", offset: 99, length: 0, content: "x" });
    expect(res.statusCode).toBe(422);
  });

  it("422 when offset or length is negative", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "short" }));
    const negOffset = await patchDoc({ op: "replace_range", offset: -1, length: 0, content: "x" });
    expect(negOffset.statusCode).toBe(422);
    const negLength = await patchDoc({ op: "replace_range", offset: 0, length: -1, content: "x" });
    expect(negLength.statusCode).toBe(422);
  });

  it("422 when a required field is missing", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "short" }));
    const res = await patchDoc({ op: "replace_range", offset: 0, length: 0 });
    expect(res.statusCode).toBe(422);
  });

  it("409 RESOURCE_CONFLICT on expect mismatch", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello brave world" }));
    const res = await patchDoc({
      op: "replace_range",
      offset: 6,
      length: 5,
      content: "big",
      expect: "bold",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
  });

  it("succeeds when expect matches", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello brave world" }));
    const res = await patchDoc({
      op: "replace_range",
      offset: 6,
      length: 5,
      content: "big",
      expect: "brave",
    });
    expect(res.statusCode).toBe(200);
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("Hello big world");
  });

  it("offsets and the expect guard are code-point based", async () => {
    const bio = "🚀🚀 launch site"; // "launch" starts at code point 3, unit 5
    mockEdit(makeEntity({ name: "Ada", bio }));

    // Unit-based offsets would find " laun" here instead of "launch".
    const res = await patchDoc({
      op: "replace_range",
      offset: 3,
      length: 6,
      content: "landing",
      expect: "launch",
    });
    expect(res.statusCode).toBe(200);
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("🚀🚀 landing site");
    const body = res.json();
    expect(body.editedRange).toEqual({ offset: 3, length: 7 });
    expect(body.totalLength).toBe(Array.from("🚀🚀 landing site").length);
  });
});

describe("request shape", () => {
  it("422 for an unknown op", async () => {
    const res = await patchDoc({ op: "delete_lines" });
    expect(res.statusCode).toBe(422);
  });

  it("404 for a non-document property", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    const res = await patchDoc(
      { op: "str_replace", oldString: "a", newString: "b" },
      "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/name",
    );
    expect(res.statusCode).toBe(404);
  });

  it("404 for a property the lens hides", async () => {
    holder.store.getFullSchema.mockResolvedValue(
      makeDocSchema([{ key: "person", properties: ["name"] }]),
    );
    const res = await patchDoc({ op: "str_replace", oldString: "a", newString: "b" });
    expect(res.statusCode).toBe(404);
  });

  it("404 for a missing entity", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(null);
    const res = await patchDoc({ op: "str_replace", oldString: "a", newString: "b" });
    expect(res.statusCode).toBe(404);
  });
});

describe("context window", () => {
  it("clips ~200 chars around the edit and reports where it starts", async () => {
    const bio = "x".repeat(500) + "TARGET" + "y".repeat(500);
    mockEdit(makeEntity({ name: "Ada", bio }));
    const res = await patchDoc({ op: "str_replace", oldString: "TARGET", newString: "HIT" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Edit at offset 500, length 3: context spans [300, 803).
    expect(body.contextOffset).toBe(300);
    expect(body.context).toBe("x".repeat(200) + "HIT" + "y".repeat(200));
    expect(body.context.length).toBe(403);
  });
});

describe("chunk re-sync + embedding reuse", () => {
  it("an edit re-syncs the property's chunks", async () => {
    setEmbeddingProvider(mockProvider());
    mockEdit(makeEntity({ name: "Ada", bio: BIO }));

    const res = await patchDoc({
      op: "str_replace",
      oldString: "Paragraph 3:",
      newString: "Chapter 3 —",
    });

    expect(res.statusCode).toBe(200);
    expect(holder.store.deleteChunksForEntityProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createDocumentChunks).toHaveBeenCalledTimes(1);
    const rows = holder.store.createDocumentChunks.mock.calls[0]![3] as Row[];
    const newValue = BIO.replace("Paragraph 3:", "Chapter 3 —");
    const expected = chunkDocument(
      newValue,
      settings.DOCUMENT_CHUNK_SIZE,
      settings.DOCUMENT_CHUNK_OVERLAP,
    );
    expect(rows.map((r) => r.text)).toEqual(expected.map((c) => c.text));
  });

  it("an edit without a provider skips chunk sync", async () => {
    mockEdit(makeEntity({ name: "Ada", bio: "Hello world" }));

    const res = await patchDoc({ op: "str_replace", oldString: "world", newString: "docs" });

    expect(res.statusCode).toBe(200);
    // Value + length still written; chunks untouched without a provider.
    expect((holder.store.updateEntity.mock.calls[0]![2] as Row).bio).toBe("Hello docs");
    expect(holder.store.deleteChunksForEntityProperty).not.toHaveBeenCalled();
    expect(holder.store.createDocumentChunks).not.toHaveBeenCalled();
  });

  it("sync reuses embeddings for unchanged chunk texts", async () => {
    // Only chunks whose text changed are re-embedded; the rest reuse
    // stored vectors.
    const chunks = chunkDocument(BIO, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Pretend every chunk except the first already has a stored embedding.
    const reuseMap: Record<string, number[]> = {};
    for (const chunk of chunks.slice(1)) {
      reuseMap[chunk.text] = Array.from({ length: 8 }, () => 0.5);
    }
    const provider = mockProvider();
    setEmbeddingProvider(provider);
    holder.store.getChunkEmbeddingsForEntityProperty.mockResolvedValue(reuseMap);

    await syncDocumentChunks(asRuntimeStore(holder.store), "person", "ent-1", { bio: BIO });

    // Exactly one embedding call — for the one chunk not in the reuse map.
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(provider.embed).toHaveBeenCalledWith(chunks[0]!.text);
    const rows = holder.store.createDocumentChunks.mock.calls[0]![3] as Row[];
    expect(rows[0]!._embedding).toEqual(Array.from({ length: 8 }, () => 0.1));
    for (const row of rows.slice(1)) {
      expect(row._embedding).toEqual(Array.from({ length: 8 }, () => 0.5));
    }
  });

  it("a nulled value deletes chunks and creates none", async () => {
    setEmbeddingProvider(mockProvider());
    await syncDocumentChunks(asRuntimeStore(holder.store), "person", "ent-1", { bio: null });
    expect(holder.store.deleteChunksForEntityProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createDocumentChunks).not.toHaveBeenCalled();
  });

  it("an emptied value deletes chunks and creates none", async () => {
    setEmbeddingProvider(mockProvider());
    await syncDocumentChunks(asRuntimeStore(holder.store), "person", "ent-1", { bio: "" });
    expect(holder.store.deleteChunksForEntityProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createDocumentChunks).not.toHaveBeenCalled();
  });
});
