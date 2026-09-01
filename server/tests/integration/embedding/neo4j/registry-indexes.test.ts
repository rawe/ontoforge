/**
 * Ontology lifecycle against Neo4j's physical vector indexes, under a
 * live embedding provider — asserted by physical index names, which is
 * what makes this file Neo4j-specific: creating the one ontology carries
 * the two fixed indexes at the provider's width, per-type indexes join
 * as the schema grows, and deleting the ontology drops every vector
 * index — the graph and the index imprints return to zero together, so
 * a recreate starts clean. SKIPPED when Ollama or the model is
 * unavailable.
 *
 * The PostgreSQL counterpart is `../registry-indexes.test.ts`; the
 * database-blind cap behaviour lives in
 * `tests/integration/neo4j/registry-cap.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDriver } from "../../../../src/adapters/neo4j/driver.js";
import { runSession } from "../../../../src/adapters/neo4j/errors.js";
import { createApp } from "../../../../src/app.js";
import { settings } from "../../../../src/config.js";
import { getEmbeddingProvider } from "../../../../src/core/embedding.js";
import {
  closeStores,
  ensureSemanticIndexes,
  initStores,
} from "../../../../src/core/ports.js";
import { wipeDatabase } from "../../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "../support.js";
import { indexDimensions } from "./support.js";

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

async function vectorIndexNames(): Promise<string[]> {
  return runSession(getDriver(), async (session) => {
    const result = await session.run("SHOW VECTOR INDEXES YIELD name RETURN name");
    return result.records.map((record) => record.get("name") as string).sort();
  });
}

async function dropAllVectorIndexes(): Promise<void> {
  await runSession(getDriver(), async (session) => {
    const result = await session.run("SHOW VECTOR INDEXES YIELD name RETURN name");
    for (const record of result.records) {
      await session.run(`DROP INDEX \`${record.get("name") as string}\` IF EXISTS`);
    }
  });
}

describe.skipIf(!ollamaUp || settings.DB_BACKEND !== "neo4j")(
  "ontology lifecycle and physical vector indexes (Neo4j, Ollama)",
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

    beforeEach(async () => {
      await wipeDatabase();
      // The per-file wipe deletes nodes only; start each test from zero
      // indexes as well, so what a create provisions is attributable.
      await dropAllVectorIndexes();
    });

    it("the startup ensure does nothing at zero ontologies", async () => {
      // Port contract: `ensureSemanticIndexes` covers every ontology the
      // registry lists — none registered, nothing touched.
      await ensureSemanticIndexes(getEmbeddingProvider()!.dimensions);
      expect(await vectorIndexNames()).toEqual([]);
    });

    it("create carries the two fixed indexes at the provider's width; delete returns to zero", async () => {
      const width = getEmbeddingProvider()!.dimensions;

      const created = await app.inject({
        method: "POST",
        url: "/api/ontologies",
        payload: { key: "crm" },
      });
      expect(created.statusCode, created.body).toBe(201);
      expect(await indexDimensions("entity_embedding")).toBe(width);
      expect(await indexDimensions("saved_query_embedding")).toBe(width);

      // A per-type index joins as the schema grows.
      const et = await app.inject({
        method: "POST",
        url: "/api/ontologies/crm/model/entity-types",
        payload: { key: "person", displayName: "Person" },
      });
      expect(et.statusCode, et.body).toBe(201);
      expect(await indexDimensions("person_embedding")).toBe(width);

      // Delete drops every vector index with the graph — no width or
      // filter-property imprint of the deleted schema survives.
      const del = await app.inject({ method: "DELETE", url: "/api/ontologies/crm" });
      expect(del.statusCode).toBe(204);
      expect(await vectorIndexNames()).toEqual([]);

      // The freed slot provisions cleanly again: fixed indexes return,
      // the dead ontology's per-type index does not.
      const again = await app.inject({
        method: "POST",
        url: "/api/ontologies",
        payload: { key: "hr" },
      });
      expect(again.statusCode, again.body).toBe(201);
      expect((await vectorIndexNames()).sort()).toEqual([
        "entity_embedding",
        "saved_query_embedding",
      ]);
    });
  },
);
