/**
 * Import side effects on Neo4j's physical vector indexes: per imported
 * entity type a vector index at the provider's width, one chunk index per
 * document property, and the shared saved-query index — asserted by their
 * physical names, which is what makes this test Neo4j-specific.
 * SKIPPED when Ollama or the model is unavailable, and on any other
 * DB_BACKEND.
 *
 * The database-blind import behaviour lives in `../transfer.test.ts`.
 */

import { readFileSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../../src/app.js";
import { settings } from "../../../../src/config.js";
import { closeStores, initStores } from "../../../../src/core/ports.js";
import { wipeDatabase } from "../../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "../support.js";
import { indexDimensions } from "./support.js";

type Row = Record<string, unknown>;

const EXPORT_FIXTURE = JSON.parse(
  readFileSync(new URL("../../../fixtures/export.json", import.meta.url), "utf8"),
) as Row;

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

describe.skipIf(!ollamaUp || settings.DB_BACKEND !== "neo4j")("schema import (Neo4j, Ollama)", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/model/import",
      payload: EXPORT_FIXTURE,
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  it("creates the per-type vector indexes and the document chunk index", async () => {
    // One index per imported entity type, at the provider's width.
    expect(await indexDimensions("person_embedding")).toBe(768);
    expect(await indexDimensions("company_embedding")).toBe(768);
    // One index per document property (person.bio).
    expect(await indexDimensions("person_document_bio_embedding")).toBe(768);
    // The shared saved-query index, ensured once at the end.
    expect(await indexDimensions("saved_query_embedding")).toBe(768);
  });
});
