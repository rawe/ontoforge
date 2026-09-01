/**
 * Neo4j-physical chunk-row shape — deliberately reads raw rows via the
 * driver: the `_Chunk` and virtual `ArticleDocumentBody` labels, the raw
 * `_index`/`startChar`/`charLength` coordinates, and the absence of
 * `_embedding` when the provider yields no vector. Requires the
 * docker-compose Neo4j.
 *
 * The database-blind chunk lifecycle lives in
 * `tests/integration/documents.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDriver } from "../../../src/adapters/neo4j/driver.js";
import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { setEmbeddingProvider } from "../../../src/core/embedding.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";

type Row = Record<string, unknown>;

const BODY = Array.from(
  { length: 12 },
  (_, i) => `Paragraph ${i}: ` + "lorem ipsum dolor sit amet consectetur. ".repeat(8),
).join("\n\n"); // ~4000 chars => multiple chunks at the default size 1500

/** Raw chunk rows for one (entity, property), straight from the store. */
async function chunkRows(entityId: string, propertyKey: string): Promise<Row[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `
      MATCH (c:_Chunk {_entityId: $entityId, _propertyKey: $propertyKey})
      RETURN c {.*} AS chunk, labels(c) AS labels
      ORDER BY c._index
      `,
      { entityId, propertyKey },
    );
    return result.records.map((record) => ({
      ...(record.get("chunk") as Row),
      labels: record.get("labels") as string[],
    }));
  } finally {
    await session.close();
  }
}

describe.skipIf(settings.DB_BACKEND !== "neo4j")("Neo4j physical chunk rows", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    app = await createApp();
    await app.ready();

    const ontology = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "test_ont" },
    });
    expect(ontology.statusCode).toBe(201);
    const article = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/model/entity-types",
      payload: { key: "article", displayName: "Article" },
    });
    expect(article.statusCode).toBe(201);
    const articleId = (article.json() as Row).entityTypeId as string;
    const bodyProp = await app.inject({
      method: "POST",
      url: `/api/ontologies/test_ont/model/entity-types/${articleId}/properties`,
      payload: { key: "body", displayName: "Body", dataType: "document" },
    });
    expect(bodyProp.statusCode).toBe(201);
    const lens = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/model/lenses",
      payload: { key: "docs_view", name: "Docs View" },
    });
    expect(lens.statusCode).toBe(201);
  });

  afterAll(async () => {
    setEmbeddingProvider(null);
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  it("chunk rows carry virtual label and raw coordinates; no vector when embed yields none", async () => {
    // Activates chunk sync; `embed` yields no vector, so rows store none.
    setEmbeddingProvider({ dimensions: 8, embed: async () => null });

    const created = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/entities/article",
      payload: { body: BODY },
    });
    expect(created.statusCode, created.body).toBe(201);
    const entityId = (created.json() as Row)._id as string;

    const rows = await chunkRows(entityId, "body");
    expect(rows.length).toBeGreaterThan(1);
    rows.forEach((row, index) => {
      expect(row._index).toBe(index);
      expect(row._entityTypeKey).toBe("article");
      expect(row._propertyKey).toBe("body");
      expect(row.labels).toContain("_Chunk");
      expect(row.labels).toContain("ArticleDocumentBody"); // virtual label
      expect(row).not.toHaveProperty("_embedding"); // vectors absent
      const start = row.startChar as number;
      const length = row.charLength as number;
      expect(BODY.slice(start, start + length)).toBe(row.text);
    });
  });
});
