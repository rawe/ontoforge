/**
 * Session-06 integration suite — document properties, database-blind:
 * slice paging, partial writes with read-back, the compare-and-swap
 * guard, code-point offsets, and the chunk lifecycle verified through the
 * persistence port (a fake embedding provider activates the sync and
 * returns a fixed vector, so every chunk row carries one and the port's
 * text→vector map sees it).
 *
 * The physical chunk-row assertions (virtual label, raw coordinates) live
 * in `tests/integration/neo4j/documents.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import {
  closeStores,
  getRuntimeStore,
  initStores,
} from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";

type Row = Record<string, unknown>;

let app: FastifyInstance;

const BODY = Array.from(
  { length: 12 },
  (_, i) => `Paragraph ${i}: ` + "lorem ipsum dolor sit amet consectetur. ".repeat(8),
).join("\n\n"); // ~4000 chars => multiple chunks at the default size 1500

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

const ids: { articleId: string; bodyPropId: string; notesPropId: string } = {
  articleId: "",
  bodyPropId: "",
  notesPropId: "",
};

async function post(url: string, payload: Row): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();

  await post("/api/ontologies", { key: "test_ont" });
  const article = await post("/api/ontologies/test_ont/model/entity-types", {
    key: "article",
    displayName: "Article",
  });
  ids.articleId = article.entityTypeId as string;
  await post(`/api/ontologies/test_ont/model/entity-types/${ids.articleId}/properties`, {
    key: "title",
    displayName: "Title",
    dataType: "string",
    required: true,
  });
  const bodyProp = await post(`/api/ontologies/test_ont/model/entity-types/${ids.articleId}/properties`, {
    key: "body",
    displayName: "Body",
    dataType: "document",
  });
  ids.bodyPropId = bodyProp.propertyId as string;
  const notesProp = await post(`/api/ontologies/test_ont/model/entity-types/${ids.articleId}/properties`, {
    key: "notes",
    displayName: "Notes",
    dataType: "document",
  });
  ids.notesPropId = notesProp.propertyId as string;

  await post("/api/ontologies/test_ont/model/lenses", { key: "docs_view", name: "Docs View" });
  const titleOnly = await post("/api/ontologies/test_ont/model/lenses", { key: "title_only", name: "Title Only" });
  await post(`/api/ontologies/test_ont/model/lenses/${titleOnly.lensId}/includes/entity-types`, {
    key: "article",
    properties: ["title"],
  });
});

afterEach(() => {
  setEmbeddingProvider(null);
});

async function createArticle(props: Row): Promise<Row> {
  return post("/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article", props);
}

async function readDocument(entityId: string, propertyKey: string, query = ""): Promise<Row> {
  const res = await app.inject({
    method: "GET",
    url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}/documents/${propertyKey}${query}`,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Row;
}

/** Chunk texts for one (entity, property), read through the port. The
 * provider stores a vector on every chunk, so the text→vector map lists
 * exactly the stored chunks (fixtures keep chunk texts distinct). */
async function chunkTexts(entityId: string, propertyKey: string): Promise<string[]> {
  const store = await getRuntimeStore("test_ont");
  const map = await store.getChunkEmbeddingsForEntityProperty(entityId, propertyKey);
  return Object.keys(map);
}

describe("slice reads", () => {
  it("pages a long document and reassembles it", async () => {
    const entity = await createArticle({ title: "T", body: BODY });
    const entityId = entity._id as string;

    const full = await readDocument(entityId, "body");
    expect(full.content).toBe(BODY);
    expect(full.totalLength).toBe(BODY.length);

    const pageSize = 333;
    let assembled = "";
    for (let offset = 0; offset < BODY.length; offset += pageSize) {
      const page = await readDocument(entityId, "body", `?offset=${offset}&limit=${pageSize}`);
      expect(page.offset).toBe(offset);
      expect(page.totalLength).toBe(BODY.length);
      assembled += page.content as string;
    }
    expect(assembled).toBe(BODY);
  });

  it("is forgiving: past-end offset, over-long limit, unset value", async () => {
    const entity = await createArticle({ title: "T", body: "short" });
    const entityId = entity._id as string;

    const pastEnd = await readDocument(entityId, "body", "?offset=100");
    expect(pastEnd.content).toBe("");
    expect(pastEnd.length).toBe(0);
    expect(pastEnd.totalLength).toBe(5);

    const overLong = await readDocument(entityId, "body", "?offset=3&limit=100");
    expect(overLong.content).toBe("rt");
    expect(overLong.length).toBe(2);

    const unset = await readDocument(entityId, "notes");
    expect(unset.content).toBe("");
    expect(unset.totalLength).toBe(0);
  });

  it("stubs the value on entity reads; fields projection returns it raw", async () => {
    const entity = await createArticle({ title: "T", body: BODY });
    expect(entity.body).toEqual({ document: true, length: BODY.length });
    expect(entity).not.toHaveProperty("notes"); // unset => absent, no stub

    const entityId = entity._id as string;
    const read = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}`,
    });
    expect(read.json().body).toEqual({ document: true, length: BODY.length });

    const projected = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}?fields=body`,
    });
    expect(projected.json().body).toBe(BODY);
  });

  it("not-found conditions: hidden by lens, non-document, missing entity/type", async () => {
    const entity = await createArticle({ title: "T", body: BODY });
    const entityId = entity._id as string;

    const hidden = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/title_only/entities/article/${entityId}/documents/body`,
    });
    expect(hidden.statusCode).toBe(404);

    const nonDoc = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}/documents/title`,
    });
    expect(nonDoc.statusCode).toBe(404);

    const missingEntity = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/nope/documents/body",
    });
    expect(missingEntity.statusCode).toBe(404);

    const missingType = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/nope/${entityId}/documents/body`,
    });
    expect(missingType.statusCode).toBe(404);
  });
});

describe("partial writes", () => {
  it("str_replace persists and reads back", async () => {
    const entity = await createArticle({ title: "T", body: "Hello brave world" });
    const entityId = entity._id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}/documents/body`,
      payload: { op: "str_replace", oldString: "brave", newString: "beautiful" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      propertyKey: "body",
      totalLength: "Hello beautiful world".length,
      editedRange: { offset: 6, length: 9 },
      replacements: 1,
      context: "Hello beautiful world",
      contextOffset: 0,
    });

    const readBack = await readDocument(entityId, "body");
    expect(readBack.content).toBe("Hello beautiful world");

    // Length bookkeeping followed the edit.
    const entityRead = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}`,
    });
    expect(entityRead.json().body).toEqual({
      document: true,
      length: "Hello beautiful world".length,
    });
  });

  it("replace_range inserts, appends, and honours the expect guard", async () => {
    const entity = await createArticle({ title: "T", body: "Hello world" });
    const entityId = entity._id as string;
    const url = `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}/documents/body`;

    const insert = await app.inject({
      method: "PATCH",
      url,
      payload: { op: "replace_range", offset: 5, length: 0, content: " brave" },
    });
    expect(insert.statusCode).toBe(200);
    expect((await readDocument(entityId, "body")).content).toBe("Hello brave world");

    const append = await app.inject({
      method: "PATCH",
      url,
      payload: { op: "replace_range", offset: 17, length: 0, content: "!" },
    });
    expect(append.statusCode).toBe(200);
    expect((await readDocument(entityId, "body")).content).toBe("Hello brave world!");

    // Stale expectation: refused as a conflict, nothing changes.
    const conflict = await app.inject({
      method: "PATCH",
      url,
      payload: { op: "replace_range", offset: 6, length: 5, content: "big", expect: "bold" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("RESOURCE_CONFLICT");
    expect((await readDocument(entityId, "body")).content).toBe("Hello brave world!");

    const guarded = await app.inject({
      method: "PATCH",
      url,
      payload: { op: "replace_range", offset: 6, length: 5, content: "big", expect: "brave" },
    });
    expect(guarded.statusCode).toBe(200);
    expect((await readDocument(entityId, "body")).content).toBe("Hello big world!");
  });

  it("replaceAll replaces every occurrence and reports the first region", async () => {
    const entity = await createArticle({ title: "T", body: "one two one two" });
    const entityId = entity._id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}/documents/body`,
      payload: { op: "str_replace", oldString: "two", newString: "three", replaceAll: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().replacements).toBe(2);
    expect(res.json().editedRange).toEqual({ offset: 4, length: 5 });
    expect((await readDocument(entityId, "body")).content).toBe("one three one three");
  });

  it("offsets, lengths, and slices are code-point based (emoji)", async () => {
    const body = "Intro 🚀🚀 launch";
    const cps = Array.from(body);
    const entity = await createArticle({ title: "T", body });
    const entityId = entity._id as string;

    // Stub length is the code-point count.
    expect(entity.body).toEqual({ document: true, length: cps.length });

    // Slice across the astral pair.
    const slice = await readDocument(entityId, "body", "?offset=6&limit=3");
    expect(slice.content).toBe("🚀🚀 ");
    expect(slice.length).toBe(3);
    expect(slice.totalLength).toBe(cps.length);

    // Range overwrite addressed in code points, with the guard.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}/documents/body`,
      payload: { op: "replace_range", offset: 9, length: 6, content: "landing", expect: "launch" },
    });
    expect(res.statusCode).toBe(200);
    expect((await readDocument(entityId, "body")).content).toBe("Intro 🚀🚀 landing");
    expect(res.json().totalLength).toBe(Array.from("Intro 🚀🚀 landing").length);
  });

  it("whole-value writes through entity update stay valid and re-sync bookkeeping", async () => {
    const entity = await createArticle({ title: "T", body: BODY });
    const entityId = entity._id as string;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}`,
      payload: { body: "replaced whole" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().body).toEqual({ document: true, length: "replaced whole".length });
    expect((await readDocument(entityId, "body")).content).toBe("replaced whole");

    // Nulling removes the value entirely — the stub disappears.
    const nulled = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}`,
      payload: { body: null },
    });
    expect(nulled.statusCode).toBe(200);
    expect(nulled.json()).not.toHaveProperty("body");
    expect((await readDocument(entityId, "body")).totalLength).toBe(0);
  });
});

describe("chunk lifecycle (fake provider, fixed vector)", () => {
  const VECTOR = [0.5, 0.25, 0.125, 0.0625];

  beforeEach(() => {
    // Activates chunk sync; the fixed vector puts every chunk row into the
    // port's text→vector map.
    setEmbeddingProvider({ dimensions: 4, embed: async () => VECTOR });
  });

  it("creating an entity writes one chunk per slice of the value", async () => {
    const entity = await createArticle({ title: "T", body: BODY });
    const texts = await chunkTexts(entity._id as string, "body");

    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) {
      expect(BODY).toContain(text); // every chunk is a verbatim slice
    }
    // The chunks jointly span the value: one starts it, one ends it.
    expect(texts.some((text) => BODY.startsWith(text))).toBe(true);
    expect(texts.some((text) => BODY.endsWith(text))).toBe(true);
  });

  it("an edit re-synchronizes the chunks to the new value", async () => {
    const entity = await createArticle({ title: "T", body: BODY });
    const entityId = entity._id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}/documents/body`,
      payload: { op: "str_replace", oldString: "Paragraph 3:", newString: "Chapter 3 —" },
    });
    expect(res.statusCode).toBe(200);

    const texts = await chunkTexts(entityId, "body");
    const newValue = BODY.replace("Paragraph 3:", "Chapter 3 —");
    expect(texts.some((text) => text.includes("Chapter 3 —"))).toBe(true);
    for (const text of texts) {
      expect(newValue).toContain(text); // no chunk of the old value survives
    }
  });

  it("nulling the value deletes its chunks; the sibling property keeps its own", async () => {
    const entity = await createArticle({ title: "T", body: BODY, notes: BODY });
    const entityId = entity._id as string;
    expect((await chunkTexts(entityId, "body")).length).toBeGreaterThan(0);
    expect((await chunkTexts(entityId, "notes")).length).toBeGreaterThan(0);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}`,
      payload: { body: null },
    });
    expect(res.statusCode).toBe(200);

    expect(await chunkTexts(entityId, "body")).toHaveLength(0);
    expect((await chunkTexts(entityId, "notes")).length).toBeGreaterThan(0); // isolation
  });

  it("deleting the entity removes all of its chunks", async () => {
    const entity = await createArticle({ title: "T", body: BODY, notes: BODY });
    const entityId = entity._id as string;
    expect((await chunkTexts(entityId, "body")).length).toBeGreaterThan(0);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}`,
    });
    expect(res.statusCode).toBe(204);

    expect(await chunkTexts(entityId, "body")).toHaveLength(0);
    expect(await chunkTexts(entityId, "notes")).toHaveLength(0);
  });

  it("deleting the property definition drops that property's chunks only", async () => {
    const entity = await createArticle({ title: "T", body: BODY, notes: BODY });
    const entityId = entity._id as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/ontologies/test_ont/model/entity-types/${ids.articleId}/properties/${ids.notesPropId}`,
    });
    expect(res.statusCode).toBe(204);

    expect(await chunkTexts(entityId, "notes")).toHaveLength(0);
    expect((await chunkTexts(entityId, "body")).length).toBeGreaterThan(0); // isolation
  });

  it("deleting the entity type drops the chunks of each document property", async () => {
    const entity = await createArticle({ title: "T", body: BODY, notes: BODY });
    const entityId = entity._id as string;

    // The `title_only` lens includes the type: consent to the cascade.
    const res = await app.inject({
      method: "DELETE",
      url: `/api/ontologies/test_ont/model/entity-types/${ids.articleId}?cascade=true`,
    });
    expect(res.statusCode, res.body).toBe(204);

    expect(await chunkTexts(entityId, "body")).toHaveLength(0);
    expect(await chunkTexts(entityId, "notes")).toHaveLength(0);
  });

  it("the chunk-embedding map reads back stored vectors for reuse", async () => {
    // The store keeps the provider's vectors and the text→vector map
    // returns them (the reuse path's storage half).
    const entity = await createArticle({ title: "T", body: BODY });
    const entityId = entity._id as string;

    const store = await getRuntimeStore("test_ont");
    const map = await store.getChunkEmbeddingsForEntityProperty(entityId, "body");
    expect(Object.keys(map).length).toBeGreaterThan(1);
    for (const vector of Object.values(map)) {
      expect(vector).toEqual(VECTOR);
    }
    // The rows carry the vector internally, but reads through the API
    // never expose it — spot-check the fields projection.
    const projected = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article/${entityId}?fields=body`,
    });
    expect(projected.json().body).toBe(BODY);
  });
});
