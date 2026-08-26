/**
 * Rebuild streaming and vector-index width drift — ported from
 * `backend/tests/integration/test_vector_index_drift.py` and
 * `test_store_errors.py`, plus the NDJSON stream-shape assertions.
 *
 * Drift is induced past the port (rebuilding real indexes at a wrong
 * width); what is asserted is port-level behaviour: startup REPORTS and
 * changes nothing, the rebuild operation REPAIRS. Altered indexes are
 * restored even on failure — the Neo4j instance is shared.
 * SKIPPED when Ollama or the model is unavailable, and on any other
 * DB_BACKEND (the drift staging is Neo4j-specific).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ENTITY_VECTOR_INDEX_NAME } from "../../../../src/adapters/neo4j/ddl.js";
import { createApp } from "../../../../src/app.js";
import { settings } from "../../../../src/config.js";
import { getEmbeddingProvider } from "../../../../src/core/embedding.js";
import {
  closeStores,
  ensureSemanticIndexes,
  initStores,
} from "../../../../src/core/ports.js";
import { wipeDatabase } from "../../reset.js";
import { invalidateLoadedSchemaCache } from "../../../../src/runtime/schemaCache.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "../support.js";
import { indexDimensions, rebuildIndexAt, waitForIndexOnline } from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

/** Any width the embedding model does not produce. */
const MISMATCHED_DIMENSIONS = 1024;

/** The two index-creation paths the reconcile has to be wired into: the
 * cross-type index and the per-entity-type one. */
const DRIFTING_INDEXES = [ENTITY_VECTOR_INDEX_NAME, "person_embedding"];

let app: FastifyInstance;

describe.skipIf(!ollamaUp || settings.DB_BACKEND !== "neo4j")("rebuild and width drift (Neo4j, Ollama)", () => {
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

  async function post(url: string, payload: Row): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
    return res.json() as Row;
  }

  /** Ontology `index_drift_test` with one person type and one entity;
   * indexes exist at the provider width (768). */
  async function buildDriftFixture(): Promise<void> {
    await post("/api/model/ontologies", { key: "index_drift_test", name: "Index Drift Test" });
    const et = await post("/api/model/entity-types", { key: "person", displayName: "Person" });
    await post(`/api/model/entity-types/${et.entityTypeId as string}/properties`, {
      key: "name",
      displayName: "Name",
      dataType: "string",
      required: true,
    });
    await ensureSemanticIndexes(getEmbeddingProvider()!.dimensions);
    await post("/api/runtime/index_drift_test/entities/person", { name: "Alice Chen" });
  }

  /** Run `work` with both indexes drifted; restore even on failure. */
  async function withDriftedIndexes(work: () => Promise<void>): Promise<void> {
    for (const indexName of DRIFTING_INDEXES) {
      await rebuildIndexAt(indexName, MISMATCHED_DIMENSIONS);
    }
    try {
      await work();
    } finally {
      const width = getEmbeddingProvider()!.dimensions;
      for (const indexName of DRIFTING_INDEXES) {
        if ((await indexDimensions(indexName)) !== width) {
          await rebuildIndexAt(indexName, width);
        }
      }
    }
  }

  beforeEach(async () => {
    await wipeDatabase();
    invalidateLoadedSchemaCache();
  });

  it("startup reports the drift and changes nothing", async () => {
    await buildDriftFixture();
    await withDriftedIndexes(async () => {
      const warnings: string[] = [];
      const spy = vi
        .spyOn(console, "warn")
        .mockImplementation((...args: unknown[]) => warnings.push(args.map(String).join(" ")));
      try {
        await ensureSemanticIndexes(getEmbeddingProvider()!.dimensions);
      } finally {
        spy.mockRestore();
      }

      const driftWarnings = warnings.filter((w) => w.includes("semantic index"));
      expect(driftWarnings, warnings.join("\n")).toHaveLength(DRIFTING_INDEXES.length);
      const reported = driftWarnings.join("\n");
      expect(reported).toContain("entity type 'person'");
      expect(reported).toContain("search across all entity types");
      expect(reported).toContain(String(MISMATCHED_DIMENSIONS));
      expect(reported).toContain(String(getEmbeddingProvider()!.dimensions));
      expect(reported).toContain("/api/model/rebuild-embeddings");

      // Operator-facing text stays in API vocabulary: no vendor, no
      // physical index name.
      for (const leak of ["eo4j", "Cypher", "VECTOR INDEX", "Person", ...DRIFTING_INDEXES]) {
        expect(reported, `'${leak}' leaked into the warning`).not.toContain(leak);
      }

      for (const indexName of DRIFTING_INDEXES) {
        expect(await indexDimensions(indexName)).toBe(MISMATCHED_DIMENSIONS);
      }
    });
  });

  it("a drifted index surfaces as a structured storage error, leaking nothing", async () => {
    await buildDriftFixture();
    await withDriftedIndexes(async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/runtime/index_drift_test/search/semantic?q=Alice&searchIn=entities&type=person",
      });

      expect(res.statusCode, "expected the drift to break search").toBe(500);
      const body = res.json() as { error: { code: string; message: string; details: Row } };
      expect(body.error.code).toBe("STORAGE_ERROR");
      expect(body.error.message).toBe("A storage operation failed");
      expect(body.error.details.errorId).toBeTruthy();

      for (const leak of [
        "eo4j",
        "Cypher",
        "person_embedding",
        "dimensionality",
        "Vector index",
        "Internal Server Error",
        String(MISMATCHED_DIMENSIONS),
      ]) {
        expect(res.body, `driver detail '${leak}' reached the client`).not.toContain(leak);
      }
    });
  });

  it("rebuild repairs the drift and semantic search works again", async () => {
    await buildDriftFixture();
    await withDriftedIndexes(async () => {
      const before = await app.inject({
        method: "GET",
        url: "/api/runtime/index_drift_test/search/semantic?q=Alice&searchIn=entities&type=person",
      });
      expect(before.statusCode, "expected the drift to break search first").toBe(500);

      const rebuild = await app.inject({ method: "POST", url: "/api/model/rebuild-embeddings" });
      expect(rebuild.statusCode, rebuild.body).toBe(200);

      const width = getEmbeddingProvider()!.dimensions;
      for (const indexName of DRIFTING_INDEXES) {
        await waitForIndexOnline(indexName);
        expect(await indexDimensions(indexName)).toBe(width);
      }

      const after = await app.inject({
        method: "GET",
        url: "/api/runtime/index_drift_test/search/semantic?q=Alice&searchIn=entities&type=person",
      });
      expect(after.statusCode, after.body).toBe(200);
      expect((after.json() as { total: number }).total).toBeGreaterThan(0);
    });
  });

  it("streams NDJSON progress records and a final summary, saved queries included", async () => {
    await buildDriftFixture();
    await post("/api/runtime/index_drift_test/entities/person", { name: "Bob Smith" });
    const defined = await app.inject({
      method: "PUT",
      url: "/api/model/ontologies/index_drift_test/saved-queries/everyone",
      payload: {
        name: "Everyone",
        description: "List every person by name",
        steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
        parameters: [],
      },
    });
    expect(defined.statusCode, defined.body).toBe(201);

    const res = await app.inject({ method: "POST", url: "/api/model/rebuild-embeddings" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");

    const lines = res.body.trim().split("\n").map((line) => JSON.parse(line) as Row);
    expect(lines.length).toBeGreaterThanOrEqual(4); // 2 entities + 1 saved query + summary

    const progress = lines.filter((l) => l.type === "progress");
    for (const record of progress) {
      expect(Object.keys(record).sort()).toEqual(["entityTypeKey", "processed", "total", "type"]);
      expect(typeof record.processed).toBe("number");
    }
    const personProgress = progress.filter((p) => p.entityTypeKey === "person");
    // Counts advance to the group total.
    expect(personProgress.map((p) => p.processed)).toEqual([1, 2]);
    expect(personProgress.every((p) => p.total === 2)).toBe(true);

    // The saved-query re-embed pass reports under its own group key.
    const sqProgress = progress.filter((p) => p.entityTypeKey === "saved_queries");
    expect(sqProgress.map((p) => p.processed)).toEqual([1]);
    expect(sqProgress[0]!.total).toBe(1);

    const summary = lines[lines.length - 1]!;
    expect(summary.type).toBe("summary");
    expect(Object.keys(summary).sort()).toEqual([
      "entityTypes",
      "savedQueriesFailed",
      "savedQueriesProcessed",
      "totalFailed",
      "totalProcessed",
      "type",
    ]);
    expect(summary.entityTypes).toEqual([{ entityTypeKey: "person", processed: 2, failed: 0 }]);
    expect(summary.savedQueriesProcessed).toBe(1);
    expect(summary.savedQueriesFailed).toBe(0);
    expect(summary.totalProcessed).toBe(3);
    expect(summary.totalFailed).toBe(0);
  });

  it("rebuild re-embeds saved-query descriptions stored while no provider was configured", async () => {
    await buildDriftFixture();

    // Define a saved query with the provider absent: its description is
    // stored without a vector and semantic discovery cannot see it.
    disableProvider();
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/model/ontologies/index_drift_test/saved-queries/find-people",
        payload: {
          name: "Find People",
          description: "Find people and employees working at the company by their name",
          steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
          parameters: [],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    } finally {
      enableOllamaProvider();
    }

    const before = await app.inject({
      method: "GET",
      url:
        "/api/runtime/index_drift_test/saved-queries/search?q=" +
        encodeURIComponent("which people work here") +
        "&min_score=0.1",
    });
    expect(before.statusCode).toBe(200);
    expect((before.json() as Row[]).map((h) => h.key)).not.toContain("find-people");

    const rebuild = await app.inject({ method: "POST", url: "/api/model/rebuild-embeddings" });
    expect(rebuild.statusCode, rebuild.body).toBe(200);

    const after = await app.inject({
      method: "GET",
      url:
        "/api/runtime/index_drift_test/saved-queries/search?q=" +
        encodeURIComponent("which people work here") +
        "&min_score=0.1",
    });
    expect(after.statusCode).toBe(200);
    expect((after.json() as Row[]).map((h) => h.key)).toContain("find-people");
  });

  it("rebuild embeds entities created while no provider was configured", async () => {
    await buildDriftFixture();

    // Create an entity with the provider absent: it stays vector-less and
    // invisible to semantic search.
    disableProvider();
    try {
      await post("/api/runtime/index_drift_test/entities/person", { name: "Grace Hopper" });
    } finally {
      enableOllamaProvider();
    }

    const rebuild = await app.inject({ method: "POST", url: "/api/model/rebuild-embeddings" });
    expect(rebuild.statusCode, rebuild.body).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/index_drift_test/search/semantic?q=Grace%20Hopper&type=person&searchIn=entities",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { results: Row[] };
    expect(data.results.some((r) => (r.entity as Row).name === "Grace Hopper")).toBe(true);
  });

  it("rebuild is refused without a provider", async () => {
    disableProvider();
    try {
      const res = await app.inject({ method: "POST", url: "/api/model/rebuild-embeddings" });
      expect(res.statusCode).toBe(422);
      const body = res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("EMBEDDING_PROVIDER");
    } finally {
      enableOllamaProvider();
    }
  });
});
