/**
 * Import side effects with a real embedding provider (Ollama): per
 * imported entity type a vector index with the non-document properties as
 * filterables plus one chunk index per document property, the shared
 * saved-query index ensured, and every saved-query description embedded as
 * written — searchable immediately, without a rebuild.
 * SKIPPED when Ollama or the model is unavailable.
 */

import { readFileSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, initStores, wipeDatabase } from "../../../src/core/ports.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider, indexDimensions } from "./support.js";

type Row = Record<string, unknown>;

const LEGACY_EXPORT = JSON.parse(
  readFileSync(new URL("../../fixtures/legacy-export.json", import.meta.url), "utf8"),
) as Row;

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

describe.skipIf(!ollamaUp)("schema import (Ollama)", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/model/import",
      payload: LEGACY_EXPORT,
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

  it("embeds saved-query descriptions on import — searchable immediately", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/saved-queries/search?q=find%20persons%20by%20their%20names",
    });
    expect(res.statusCode).toBe(200);
    const results = res.json() as Row[];
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.key).toBe("people-by-name");
  });
});
