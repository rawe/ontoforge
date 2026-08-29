/**
 * Document-scope and fused semantic search end-to-end, plus chunk-vector
 * reuse verified by counting provider calls
 * (`docs/capabilities/documents.md#embedding-behaviour`). SKIPPED when
 * Ollama or the model is unavailable.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { getEmbeddingProvider } from "../../../src/core/embedding.js";
import {
  closeStores,
  getRuntimeStore,
  initStores,
} from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import {
  checkOllamaModel,
  countEmbedCalls,
  disableProvider,
  enableOllamaProvider,
} from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

// ~4000 chars => at least three chunks at the default size 1500.
const BODY = Array.from(
  { length: 10 },
  (_, i) =>
    `Paragraph ${i}: the analytical engine processes ` +
    "punched cards and computes polynomial tables with precision. ".repeat(6),
).join("\n\n");

describe.skipIf(!ollamaUp)("document semantic search (Ollama)", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  afterEach(() => {
    // Undo any counting wrapper a test installed.
    disableProvider();
    enableOllamaProvider();
  });

  async function post(url: string, payload: Row): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
    return res.json() as Row;
  }

  async function buildDocFixture(): Promise<void> {
    await post("/api/model/lenses", { key: "doc_search", name: "Doc Search" });
    const et = await post("/api/model/entity-types", { key: "article", displayName: "Article" });
    const etId = et.entityTypeId as string;
    await post(`/api/model/entity-types/${etId}/properties`, {
      key: "title",
      displayName: "Title",
      dataType: "string",
      required: true,
    });
    await post(`/api/model/entity-types/${etId}/properties`, {
      key: "body",
      displayName: "Body",
      dataType: "document",
    });
  }

  beforeEach(async () => {
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    await buildDocFixture();
  });

  it("finds a passage inside a document and resolves it to the parent entity", async () => {
    const article = await post("/api/runtime/doc_search/entities/article", {
      title: "Engines",
      body: BODY,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/doc_search/search/semantic?q=polynomial%20computation&type=article&searchIn=documents",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { total: number; results: Row[] };
    expect(data.total).toBeGreaterThan(0);

    const hit = data.results[0]!;
    expect((hit.entity as Row)._id).toBe(article._id);
    // Stub, never content.
    expect((hit.entity as Row).body).toEqual({ document: true, length: BODY.length });

    const mv = hit.matchedVia as Row;
    expect(mv.source).toBe("document");
    expect(mv.propertyKey).toBe("body");
    expect(typeof mv.charOffset).toBe("number");
    expect(typeof mv.charLength).toBe("number");
    expect(typeof mv.similarity).toBe("number");
    expect((mv.snippet as string).length).toBeLessThanOrEqual(200);

    // The coordinates slice the document exactly.
    const slice = await app.inject({
      method: "GET",
      url:
        `/api/runtime/doc_search/entities/article/${article._id as string}` +
        `/documents/body?offset=${mv.charOffset as number}&limit=${mv.charLength as number}`,
    });
    expect(slice.statusCode).toBe(200);
    const sliceBody = slice.json() as { content: string };
    expect((mv.snippet as string).startsWith(sliceBody.content.slice(0, 50))).toBe(true);
  });

  it("search hits return the chunk payload unchanged (ordinal, offsets)", async () => {
    const article = await post("/api/runtime/doc_search/entities/article", {
      title: "Engines",
      body: BODY,
    });

    const chunkCount = Object.keys(
      await getRuntimeStore().getChunkEmbeddingsForEntityProperty(article._id as string, "body"),
    ).length;
    expect(chunkCount).toBeGreaterThan(1);

    const embedding = await getEmbeddingProvider()!.embed("polynomial computation");
    const hits = await getRuntimeStore().searchDocumentChunks("article", "body", embedding!, 5);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const chunk = hit.chunk as Row;
      // The ordinal written at chunking time comes back on the hit.
      expect(Number.isInteger(chunk._index)).toBe(true);
      expect(chunk._index as number).toBeGreaterThanOrEqual(0);
      expect(chunk._index as number).toBeLessThan(chunkCount);
      // The offsets still slice the stored document to exactly this text.
      const start = chunk.startChar as number;
      const length = chunk.charLength as number;
      expect(Array.from(BODY).slice(start, start + length).join("")).toBe(chunk.text);
    }
  });

  it("suppressing snippets keeps the coordinates", async () => {
    await post("/api/runtime/doc_search/entities/article", { title: "Engines", body: BODY });

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/doc_search/search/semantic?q=punched%20cards&type=article&searchIn=documents&snippets=false",
    });
    expect(res.statusCode).toBe(200);
    const mv = ((res.json() as { results: Row[] }).results[0]!.matchedVia) as Row;
    expect(mv).not.toHaveProperty("snippet");
    expect(typeof mv.charOffset).toBe("number");
  });

  it("fused search ranks an entity found in both scopes first", async () => {
    // Matches in both scopes: title (entity vector) and body (passages).
    await post("/api/runtime/doc_search/entities/article", {
      title: "Analytical engine computation",
      body: BODY,
    });
    // Matches at most weakly in either.
    await post("/api/runtime/doc_search/entities/article", {
      title: "Gardening for beginners",
      body: "Water your plants regularly and prune them in spring.",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/doc_search/search/semantic?q=analytical%20engine&type=article&searchIn=all",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { results: Row[] };
    const first = data.results[0]!;
    expect((first.entity as Row).title).toBe("Analytical engine computation");
    // The fused score is a rank sum, not a similarity; the raw similarity
    // lives in matchedVia (document info wins when both rank).
    expect(first.score as number).toBeLessThan(0.1);
    expect((first.matchedVia as Row).source).toBe("document");
  });

  it("reuses chunk vectors for unchanged text on a partial edit", async () => {
    const article = await post("/api/runtime/doc_search/entities/article", {
      title: "Engines",
      body: BODY,
    });

    // Count provider calls across a small edit: only the chunks whose text
    // changed (plus nothing else) may be re-embedded. NB the edit also
    // leaves the entity vector untouched — `body` is a document property.
    const counter = countEmbedCalls();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/runtime/doc_search/entities/article/${article._id as string}/documents/body`,
      payload: {
        op: "str_replace",
        oldString: "Paragraph 9:",
        newString: "Paragraph nine:",
      },
    });
    expect(res.statusCode, res.body).toBe(200);

    // The document spans several chunks (~4000 chars at size 1500); an edit
    // in the last paragraph re-embeds only the chunk(s) covering it.
    expect(counter.calls).toBeGreaterThan(0);
    expect(counter.calls).toBeLessThan(3);
  });

  it("a full rewrite re-embeds every chunk (the reuse map finds nothing)", async () => {
    const article = await post("/api/runtime/doc_search/entities/article", {
      title: "Engines",
      body: BODY,
    });

    const counter = countEmbedCalls();
    const rewritten = BODY.replaceAll("Paragraph", "Chapter");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/runtime/doc_search/entities/article/${article._id as string}`,
      payload: { body: rewritten },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(counter.calls).toBeGreaterThanOrEqual(3); // every chunk afresh
  });

  it("min_score floors the raw similarity, not the fused score", async () => {
    await post("/api/runtime/doc_search/entities/article", {
      title: "Analytical engine computation",
      body: BODY,
    });

    // A floor of 0.99 removes everything from both rankings even though
    // fused scores (~1/61) would always pass a similarity threshold of 0.
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/doc_search/search/semantic?q=analytical%20engine&type=article&min_score=0.99",
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { total: number }).total).toBe(0);
  });
});
