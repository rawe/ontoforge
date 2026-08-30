/**
 * Semantic search end-to-end against the docker-compose database and a
 * local Ollama — ported from
 * `backend/tests/integration/test_semantic_search.py`, plus `/features`
 * truthfulness. SKIPPED when Ollama or the model is unavailable.
 *
 * The oversized-indexed-string tests (a Neo4j write constraint) live in
 * `neo4j/semantic-search.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import {
  getEmbeddingProvider,
  setEmbeddingProvider,
} from "../../../src/core/embedding.js";
import {
  closeStores,
  ensureSemanticIndexes,
  initStores,
} from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

describe.skipIf(!ollamaUp)("semantic search (Ollama)", () => {
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

  /** Lens `search_test`, entity type `person` with
   * name/role/bio (strings) and age (integer). */
  async function buildSearchFixture(): Promise<{ etId: string }> {
    await post("/api/ontologies", { key: "test_ont" });
    await post("/api/ontologies/test_ont/model/lenses", {
      key: "search_test",
      name: "Search Test",
      description: "Integration test lens for semantic search",
    });
    const et = await post("/api/ontologies/test_ont/model/entity-types", { key: "person", displayName: "Person" });
    const etId = et.entityTypeId as string;
    for (const prop of [
      { key: "name", displayName: "Name", dataType: "string", required: true },
      { key: "role", displayName: "Role", dataType: "string", required: false },
      { key: "bio", displayName: "Bio", dataType: "string", required: false },
      { key: "age", displayName: "Age", dataType: "integer", required: false },
    ]) {
      await post(`/api/ontologies/test_ont/model/entity-types/${etId}/properties`, prop);
    }
    return { etId };
  }

  beforeEach(async () => {
    await wipeDatabase();
    invalidateLoadedSchemaCache();
  });

  it("reports semanticSearch: true on /features", async () => {
    const res = await app.inject({ method: "GET", url: "/api/runtime/features" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ semanticSearch: true, ai: false });
  });

  it("creating an entity generates an embedding and never returns it", async () => {
    await buildSearchFixture();
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/search_test/entities/person",
      payload: {
        name: "Alice Chen",
        role: "Senior Engineer",
        bio: "Builds distributed systems and mentors junior developers",
      },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json() as Row;
    expect(data).not.toHaveProperty("_embedding");
    expect(data.name).toBe("Alice Chen");
  });

  it("finds entities by meaning", async () => {
    await buildSearchFixture();
    await post("/api/runtime/search_test/entities/person", {
      name: "Alice Chen",
      role: "Backend Engineer",
      bio: "Expert in distributed systems and microservices",
    });
    await post("/api/runtime/search_test/entities/person", {
      name: "Bob Smith",
      role: "Marketing Manager",
      bio: "Leads brand strategy and market research",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/search_test/search/semantic?q=distributed%20systems%20engineer&type=person",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { total: number; results: Row[] };
    expect(data.total).toBeGreaterThan(0);
    expect((data.results[0]!.entity as Row).name).toBe("Alice Chen");
    expect(data.results[0]!.score as number).toBeGreaterThan(0);
  });

  it("type-scoped search only returns entities of that type", async () => {
    await buildSearchFixture();
    await post("/api/runtime/search_test/entities/person", {
      name: "Charlie",
      role: "Developer",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/search_test/search/semantic?q=developer&type=person",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { total: number; results: Row[] };
    expect(data.total).toBeGreaterThan(0);
    for (const item of data.results) {
      expect((item.entity as Row)._entityTypeKey).toBe("person");
    }
  });

  it("cross-type search spans multiple entity types", async () => {
    await buildSearchFixture();
    // The shared cross-type index is ensured at real startup; the test app
    // boots without the startup sequence, so ensure it explicitly.
    await ensureSemanticIndexes(getEmbeddingProvider()!.dimensions);

    const company = await post("/api/ontologies/test_ont/model/entity-types", {
      key: "company",
      displayName: "Company",
    });
    await post(`/api/ontologies/test_ont/model/entity-types/${company.entityTypeId as string}/properties`, {
      key: "name",
      displayName: "Name",
      dataType: "string",
      required: true,
    });

    await post("/api/runtime/search_test/entities/person", {
      name: "Alice Chen",
      role: "Backend Engineer",
      bio: "Expert in distributed systems and microservices",
    });
    await post("/api/runtime/search_test/entities/company", {
      name: "Distributed Systems Consulting",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/search_test/search/semantic?q=distributed%20systems&limit=10",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { total: number; results: Row[] };
    expect(data.total).toBeGreaterThan(0);
    const typeKeys = new Set(data.results.map((r) => (r.entity as Row)._entityTypeKey));
    expect(typeKeys.has("person")).toBe(true);
    expect(typeKeys.has("company")).toBe(true);
  });

  it("cross-type search rejects property filters", async () => {
    await buildSearchFixture();
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/search_test/search/semantic?q=anything&filter.name=Alice",
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { message: string } }).error.message).toContain(
      "require 'type'",
    );
  });

  it("answers FEATURE_DISABLED when the provider is cleared", async () => {
    await buildSearchFixture();
    const original = getEmbeddingProvider();
    setEmbeddingProvider(null);
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/runtime/search_test/search/semantic?q=test%20query&type=person",
      });
      expect(res.statusCode).toBe(422);
      const body = res.json() as { error: { message: string; details: Row } };
      expect(body.error.message).toContain("EMBEDDING_PROVIDER");
      expect(body.error.details).toEqual({ code: "FEATURE_DISABLED" });
    } finally {
      setEmbeddingProvider(original);
    }
  });

});
