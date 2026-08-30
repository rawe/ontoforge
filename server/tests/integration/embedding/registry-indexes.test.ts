/**
 * Ontology provisioning under a live embedding provider — with a
 * configured provider, creating an ontology carries the two fixed vector
 * indexes into the fresh namespace at the provider's width, in the same
 * transaction as the ten tables. PostgreSQL-physical (catalog reads), so
 * gated to that backend; SKIPPED when Ollama or the model is unavailable.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { getEmbeddingProvider } from "../../../src/core/embedding.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

/** The width an index in one namespace is built for, or null if absent. */
async function indexWidthIn(namespace: string, indexName: string): Promise<number | null> {
  const result = await runQuery(
    `SELECT format_type(att.atttypid, att.atttypmod) AS coltype
     FROM pg_attribute att
     JOIN pg_class idx ON idx.oid = att.attrelid
     JOIN pg_namespace nsp ON nsp.oid = idx.relnamespace
     WHERE nsp.nspname = $1 AND idx.relkind = 'i'
       AND idx.relname = $2 AND att.attnum = 1`,
    [namespace, indexName],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  const match = /^vector\((\d+)\)$/.exec(row["coltype"] as string);
  return match === null ? null : Number(match[1]);
}

describe.skipIf(!ollamaUp || settings.DB_BACKEND !== "postgres")(
  "ontology provisioning with a live provider (Ollama)",
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
    });

    it("create provisions both fixed vector indexes at the provider's width", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies",
        payload: { key: "crm" },
      });
      expect(res.statusCode, res.body).toBe(201);

      const width = getEmbeddingProvider()?.dimensions;
      expect(width).toBeDefined();
      expect(await indexWidthIn("ont_crm", "entity_embedding_all_idx")).toBe(width);
      expect(await indexWidthIn("ont_crm", "saved_query_embedding_idx")).toBe(width);
    });
  },
);
