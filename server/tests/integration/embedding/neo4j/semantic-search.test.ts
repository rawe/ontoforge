/**
 * The Neo4j indexed-string write constraint: values headed for vector-index
 * filter metadata are capped at `MAX_VECTOR_FILTER_VALUE_BYTES`; oversized
 * ones are rejected naming the property, and document values are exempt.
 * Neo4j-specific by nature — an adapter without such limits no-ops the
 * check, and "accepts a big string" guards nothing.
 * SKIPPED when Ollama or the model is unavailable.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_VECTOR_FILTER_VALUE_BYTES } from "../../../../src/adapters/neo4j/ddl.js";
import { createApp } from "../../../../src/app.js";
import { settings } from "../../../../src/config.js";
import { closeStores, initStores } from "../../../../src/core/ports.js";
import { wipeDatabase } from "../../reset.js";
import { invalidateLoadedSchemaCache } from "../../../../src/runtime/schemaCache.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "../support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

describe.skipIf(!ollamaUp || settings.DB_BACKEND !== "neo4j")(
  "indexed-string size limit (Neo4j, Ollama)",
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

    async function post(url: string, payload: Row): Promise<Row> {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
      return res.json() as Row;
    }

    /** Lens `search_test`, entity type `person` with name/bio. */
    async function buildSearchFixture(): Promise<{ etId: string }> {
      await post("/api/model/lenses", {
        key: "search_test",
        name: "Search Test",
        description: "Integration test lens for the write constraint",
      });
      const et = await post("/api/model/entity-types", { key: "person", displayName: "Person" });
      const etId = et.entityTypeId as string;
      for (const prop of [
        { key: "name", displayName: "Name", dataType: "string", required: true },
        { key: "bio", displayName: "Bio", dataType: "string", required: false },
      ]) {
        await post(`/api/model/entity-types/${etId}/properties`, prop);
      }
      return { etId };
    }

    beforeEach(async () => {
      await wipeDatabase();
      invalidateLoadedSchemaCache();
    });

    it("rejects an oversized indexed string value, naming the property", async () => {
      await buildSearchFixture();
      const oversized = "x".repeat(MAX_VECTOR_FILTER_VALUE_BYTES + 1);

      const res = await app.inject({
        method: "POST",
        url: "/api/runtime/search_test/entities/person",
        payload: { name: "Alice", bio: oversized },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json() as { error: { code: string; message: string; details: Row } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("'bio'");
      expect(body.error.message).not.toMatch(/eo4j/); // never the engine
      expect((body.error.details.fields as Row).bio).toBeDefined();
    });

    it("document values are exempt from the indexed-string size limit", async () => {
      const { etId } = await buildSearchFixture();
      await post(`/api/model/entity-types/${etId}/properties`, {
        key: "notes",
        displayName: "Notes",
        dataType: "document",
      });

      const oversized = "y".repeat(MAX_VECTOR_FILTER_VALUE_BYTES + 10);
      const res = await app.inject({
        method: "POST",
        url: "/api/runtime/search_test/entities/person",
        payload: { name: "Alice", notes: oversized },
      });

      expect(res.statusCode, res.body).toBe(201);
    });
  },
);
