/**
 * Rebuild-embeddings is per-ontology: `POST
 * /api/ontologies/:key/model/rebuild-embeddings` regenerates vectors for
 * the addressed ontology alone — a sibling ontology's rows stay
 * untouched (unembedded rows are invisible to semantic search, which is
 * what makes the difference observable through the port).
 *
 * Two ontologies at once, so gated to PostgreSQL like the registry
 * conformance suite — the capped Neo4j registry (ticket 18) widens the
 * multi-ontology tier when it lands. SKIPPED when Ollama or the model is
 * unavailable.
 */

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { getEmbeddingProvider } from "../../../src/core/embedding.js";
import {
  closeStores,
  getRuntimeStore,
  initStores,
} from "../../../src/core/ports.js";
import type { PropertyDef } from "../../../src/core/schemas.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

const DEFS: Record<string, PropertyDef> = {
  name: {
    key: "name",
    displayName: "Name",
    description: null,
    dataType: "string",
    required: true,
    defaultValue: null,
  },
};

let app: FastifyInstance;

async function post(url: string, payload: Row): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

/** One ontology holding a `person` type with a required `name`, plus one
 * UNEMBEDDED person row written straight through the bound store. */
async function buildOntology(ontologyKey: string, personName: string): Promise<string> {
  await post("/api/ontologies", { key: ontologyKey });
  const model = `/api/ontologies/${ontologyKey}/model`;
  const person = await post(`${model}/entity-types`, { key: "person", displayName: "Person" });
  await post(`${model}/entity-types/${person.entityTypeId as string}/properties`, {
    key: "name",
    displayName: "Name",
    dataType: "string",
    required: true,
  });
  const entityId = randomUUID();
  const store = await getRuntimeStore(ontologyKey);
  await store.createEntity("person", entityId, { name: personName }, DEFS, null);
  return entityId;
}

/** Semantic hits for `person` in one ontology — empty while its rows
 * carry no vectors. */
async function personHits(ontologyKey: string, query: string): Promise<Row[]> {
  const embedding = await getEmbeddingProvider()!.embed(query);
  const store = await getRuntimeStore(ontologyKey);
  return store.semanticSearch("person", DEFS, embedding!, 10, null);
}

describe.skipIf(!ollamaUp || settings.DB_BACKEND !== "postgres")(
  "per-ontology rebuild-embeddings (Ollama)",
  () => {
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

    it("rebuilds only the addressed ontology", async () => {
      await buildOntology("alpha", "Alice the archivist");
      await buildOntology("beta", "Bob the builder");

      // Unembedded rows are invisible to semantic search in both.
      expect(await personHits("alpha", "archivist")).toHaveLength(0);
      expect(await personHits("beta", "builder")).toHaveLength(0);

      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies/alpha/model/rebuild-embeddings",
      });
      expect(res.statusCode, res.body).toBe(200);
      const lines = res.body
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Row);
      const summary = lines[lines.length - 1]!;
      expect(summary.type).toBe("summary");
      // One ontology, one person: the rebuild never crossed into beta.
      expect(summary.totalProcessed).toBe(1);
      expect(summary.totalFailed).toBe(0);

      expect((await personHits("alpha", "archivist")).length).toBeGreaterThan(0);
      expect(await personHits("beta", "builder")).toHaveLength(0);
    });

    it("rebuild for an unknown ontology answers 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies/no_such_ont/model/rebuild-embeddings",
      });
      expect(res.statusCode).toBe(404);
    });
  },
);
