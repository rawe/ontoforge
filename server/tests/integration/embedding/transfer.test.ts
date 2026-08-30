/**
 * Import side effects with a real embedding provider (Ollama): every
 * saved-query description embedded as written — searchable immediately,
 * without a rebuild.
 * SKIPPED when Ollama or the model is unavailable.
 *
 * The physical vector-index assertions over the same import live in
 * `neo4j/transfer.test.ts`.
 */

import { readFileSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

const EXPORT_FIXTURE = JSON.parse(
  readFileSync(new URL("../../fixtures/export.json", import.meta.url), "utf8"),
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
    const created = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "test_ont" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/model/import",
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
