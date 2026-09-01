/**
 * Document properties: coercion, stubs, chunk sync, and the document read
 * endpoint, including the code-point scenarios. Entity embedding is
 * covered in the embedding suites.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { settings } from "../../src/config.js";
import { coerceValue } from "../../src/core/dataTypes.js";
import { setEmbeddingProvider, type EmbeddingProvider } from "../../src/core/embedding.js";
import { chunkDocument } from "../../src/runtime/chunking.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  type MockRuntimeStore,
} from "./helpers.js";

const BIO = "# Biography\n\nAda Lovelace wrote about the analytical engine. ".repeat(30); // ~1800 chars

type Row = Record<string, unknown>;

/** Schema with a person type that has two document properties. */
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
          { key: "notes", displayName: "Notes", dataType: "document", required: false, defaultValue: null },
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
  getRuntimeStore: async () => holder.store,
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

describe("coercion + config", () => {
  it("coerce document returns a string", () => {
    expect(coerceValue("# Hello", "document", "bio")).toBe("# Hello");
    expect(coerceValue(42, "document", "bio")).toBe("42");
    expect(coerceValue(null, "document", "bio")).toBeNull();
  });

  it("chunk config defaults", () => {
    expect(settings.DOCUMENT_CHUNK_SIZE).toBe(1500);
    expect(settings.DOCUMENT_CHUNK_OVERLAP).toBe(200);
  });
});

describe("read-model stubs", () => {
  it("get entity stubs a document with the stored length", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Ada", bio: BIO, _doc_bio_length: 40213 }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Ada");
    expect(body.bio).toEqual({ document: true, length: 40213 });
    expect(body).not.toHaveProperty("_doc_bio_length");
    // Unset document property stays absent (no stub for missing values).
    expect(body).not.toHaveProperty("notes");
  });

  it("stub length falls back to the value's length", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ada", bio: BIO }));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1",
    });

    expect(res.json().bio).toEqual({ document: true, length: BIO.length });
  });

  it("fallback length counts code points, not UTF-16 units", async () => {
    const emojiBio = "Rocket 🚀 to Mars 🌍!"; // 2 astral code points
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ada", bio: emojiBio }));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1",
    });

    expect(res.json().bio).toEqual({ document: true, length: Array.from(emojiBio).length });
    expect(Array.from(emojiBio).length).not.toBe(emojiBio.length);
  });

  it("list entities stubs documents", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.listEntities.mockResolvedValue([
      [makeEntity({ name: "Ada", bio: BIO, _doc_bio_length: BIO.length })],
      1,
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person",
    });

    const item = res.json().items[0];
    expect(item.bio).toEqual({ document: true, length: BIO.length });
    expect(item).not.toHaveProperty("_doc_bio_length");
  });

  it("fields projection returns the raw document value", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Ada", bio: BIO, _doc_bio_length: BIO.length }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1?fields=bio",
    });

    const body = res.json();
    expect(body.bio).toBe(BIO); // raw value explicitly requested
    expect(body).not.toHaveProperty("_doc_bio_length");
  });
});

describe("document read endpoint", () => {
  it("returns the full document", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ada", bio: BIO }));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      propertyKey: "bio",
      content: BIO,
      offset: 0,
      length: BIO.length,
      totalLength: BIO.length,
    });
  });

  it("returns a slice", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ada", bio: BIO }));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio?offset=100&limit=50",
    });

    const body = res.json();
    expect(body.content).toBe(BIO.slice(100, 150));
    expect(body.offset).toBe(100);
    expect(body.length).toBe(50);
    expect(body.totalLength).toBe(BIO.length);
  });

  it("slices by code points, never UTF-16 units", async () => {
    const emojiBio = "Intro 👩‍🚀🚀 then the body text 🌍 continues to the end.";
    const cps = Array.from(emojiBio);
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ada", bio: emojiBio }));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio?offset=6&limit=10",
    });

    const body = res.json();
    // Offset 6 lands on the astral emoji; unit-based slicing would split
    // surrogates and shift everything after them.
    expect(body.content).toBe(cps.slice(6, 16).join(""));
    expect(body.length).toBe(10);
    expect(body.totalLength).toBe(cps.length);
  });

  it("offset beyond the end returns empty content", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ada", bio: "short" }));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio?offset=100",
    });

    const body = res.json();
    expect(body.content).toBe("");
    expect(body.length).toBe(0);
    expect(body.totalLength).toBe(5);
  });

  it("unset value reads as an empty document", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ada" })); // bio never written

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("");
    expect(res.json().totalLength).toBe(0);
  });

  it("404 for a non-document property", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/name",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for an unknown property", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for a property the lens hides", async () => {
    // A lens excluding bio from person must 404 the document endpoint.
    holder.store.getFullSchema.mockResolvedValue(
      makeDocSchema([{ key: "person", properties: ["name"] }]),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for a missing entity", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.getEntity.mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1/documents/bio",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for a missing entity type", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/nonexistent/ent-1/documents/bio",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("chunk sync on create / update", () => {
  it("create stores the length and writes chunks", async () => {
    setEmbeddingProvider(mockProvider());
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.createEntity.mockResolvedValue(
      makeEntity({ name: "Ada", bio: BIO, _doc_bio_length: BIO.length }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person",
      payload: { name: "Ada", bio: BIO },
    });

    expect(res.statusCode).toBe(201);
    // Response carries the stub, never the content.
    expect(res.json().bio).toEqual({ document: true, length: BIO.length });

    // Stored properties include the raw value plus the internal length.
    const stored = holder.store.createEntity.mock.calls[0]![2] as Row;
    expect(stored.bio).toBe(BIO);
    expect(stored._doc_bio_length).toBe(BIO.length);

    // Chunks: old ones deleted, new ones created for the property.
    expect(holder.store.deleteChunksForEntityProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.deleteChunksForEntityProperty.mock.calls[0]![1]).toBe("bio");
    expect(holder.store.createDocumentChunks).toHaveBeenCalledTimes(1);
    const call = holder.store.createDocumentChunks.mock.calls[0]!;
    expect(call[1]).toBe("person");
    expect(call[2]).toBe("bio");
    const rows = call[3] as Row[];
    const expected = chunkDocument(BIO, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP);
    expect(rows).toHaveLength(expected.length);
    rows.forEach((row, index) => {
      const chunk = expected[index]!;
      expect(row._entityTypeKey).toBe("person");
      expect(row._propertyKey).toBe("bio");
      expect(row._index).toBe(index);
      expect(row.startChar).toBe(chunk.startChar);
      expect(row.charLength).toBe(chunk.charLength);
      expect(row.text).toBe(chunk.text);
      expect(row._embedding).toEqual(Array.from({ length: 8 }, () => 0.1));
      expect(row).toHaveProperty("_id");
      expect(row).toHaveProperty("_entityId");
    });
  });

  it("create without a provider writes no chunks", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.createEntity.mockResolvedValue(
      makeEntity({ name: "Ada", bio: BIO, _doc_bio_length: BIO.length }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person",
      payload: { name: "Ada", bio: BIO },
    });

    expect(res.statusCode).toBe(201);
    // Value + length still stored — the type works without embeddings.
    const stored = holder.store.createEntity.mock.calls[0]![2] as Row;
    expect(stored.bio).toBe(BIO);
    expect(stored._doc_bio_length).toBe(BIO.length);
    expect(holder.store.deleteChunksForEntityProperty).not.toHaveBeenCalled();
    expect(holder.store.createDocumentChunks).not.toHaveBeenCalled();
  });

  it("length bookkeeping counts code points on writes", async () => {
    const emojiBio = "Astronauts 👩‍🚀👨‍🚀 orbit 🌍."; // ZWJ sequences: units != code points
    const cpLen = Array.from(emojiBio).length;
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.createEntity.mockResolvedValue(
      makeEntity({ name: "Ada", bio: emojiBio, _doc_bio_length: cpLen }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person",
      payload: { name: "Ada", bio: emojiBio },
    });

    expect(res.statusCode).toBe(201);
    const stored = holder.store.createEntity.mock.calls[0]![2] as Row;
    expect(stored._doc_bio_length).toBe(cpLen);
    expect(cpLen).not.toBe(emojiBio.length);
  });

  it("updating a document property re-chunks and updates the length", async () => {
    setEmbeddingProvider(mockProvider());
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.updateEntity.mockResolvedValue(
      makeEntity({ name: "Ada", bio: "new text", _doc_bio_length: 8 }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1",
      payload: { bio: "new text" },
    });

    expect(res.statusCode).toBe(200);
    const setProps = holder.store.updateEntity.mock.calls[0]![2] as Row;
    expect(setProps.bio).toBe("new text");
    expect(setProps._doc_bio_length).toBe(8);
    expect(holder.store.deleteChunksForEntityProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createDocumentChunks).toHaveBeenCalledTimes(1);
  });

  it("removing a document property deletes its chunks", async () => {
    setEmbeddingProvider(mockProvider());
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Ada" }));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1",
      payload: { bio: null },
    });

    expect(res.statusCode).toBe(200);
    const removeProps = holder.store.updateEntity.mock.calls[0]![3] as string[];
    expect(removeProps).toContain("bio");
    expect(removeProps).toContain("_doc_bio_length");
    expect(holder.store.deleteChunksForEntityProperty).toHaveBeenCalledTimes(1);
    expect(holder.store.createDocumentChunks).not.toHaveBeenCalled();
  });

  it("updating another property leaves chunks untouched", async () => {
    setEmbeddingProvider(mockProvider());
    holder.store.getFullSchema.mockResolvedValue(makeDocSchema());
    const raw = makeEntity({ name: "Grace", bio: BIO, _doc_bio_length: BIO.length });
    holder.store.getEntity.mockResolvedValue(raw);
    holder.store.updateEntity.mockResolvedValue(raw);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/person/ent-1",
      payload: { name: "Grace" },
    });

    expect(res.statusCode).toBe(200);
    expect(holder.store.deleteChunksForEntityProperty).not.toHaveBeenCalled();
    expect(holder.store.createDocumentChunks).not.toHaveBeenCalled();
  });
});
