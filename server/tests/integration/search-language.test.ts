import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/app.js";
import { initStores, closeStores } from "../../src/core/ports.js";
import { settings } from "../../src/config.js";
import { wipeDatabase } from "./reset.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
let app: FastifyInstance;
beforeAll(async () => {
  await initStores();
  app = await createApp();
  await app.ready();
});
afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});
beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
});
async function post(url: string, payload: object) {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}
it("defaults to English, returns it in reads and exports, and never changes it on rename", async () => {
  const created = await post("/api/ontologies", { key: "language_test" });
  expect(created.textSearchLanguage).toBe("english");
  const base = "/api/ontologies/language_test";
  const renamed = await app.inject({
    method: "PATCH",
    url: base,
    payload: { displayName: "Language", textSearchLanguage: "german" },
  });
  expect(renamed.json().textSearchLanguage).toBe("english");
  expect((await app.inject({ url: base })).json().textSearchLanguage).toBe("english");
  const exported = (await app.inject({ url: `${base}/model/export` })).json();
  expect(exported).toMatchObject({ formatVersion: "5.0", textSearchLanguage: "english" });
});
it("imports only designs carrying the target language, before writing anything", async () => {
  await post("/api/ontologies", { key: "language_test", textSearchLanguage: "german" });
  const url = "/api/ontologies/language_test/model/import";
  const payload = {
    formatVersion: "5.0",
    textSearchLanguage: "english",
    entityTypes: [{ key: "paper", displayName: "Paper", properties: [] }],
    relationTypes: [],
    lenses: [],
  };
  const mismatch = await app.inject({ method: "POST", url, payload });
  expect(mismatch.statusCode, mismatch.body).toBe(422);
  expect(mismatch.json().error.details.fields.textSearchLanguage).toContain("german");
  const { textSearchLanguage: _, ...missing } = payload;
  expect((await app.inject({ method: "POST", url, payload: missing })).statusCode).toBe(422);
  expect(
    (await app.inject({ url: "/api/ontologies/language_test/model/entity-types" })).json(),
  ).toEqual([]);
  expect(
    (
      await app.inject({
        method: "POST",
        url,
        payload: { ...payload, textSearchLanguage: "german" },
      })
    ).statusCode,
  ).toBe(201);
});
it("rejects unsupported languages", async () => {
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/ontologies",
        payload: { key: "language_test", textSearchLanguage: "unknown" },
      })
    ).statusCode,
  ).toBe(422);
});
it.skipIf(settings.DB_BACKEND !== "postgres")(
  "German stemming is shared by properties and documents",
  async () => {
    await post("/api/ontologies", { key: "language_test", textSearchLanguage: "german" });
    const model = "/api/ontologies/language_test/model";
    const runtime = "/api/ontologies/language_test/runtime/lenses/all";
    await post(`${model}/lenses`, { key: "all", name: "All" });
    const type = await post(`${model}/entity-types`, { key: "paper", displayName: "Paper" });
    for (const [key, dataType] of [
      ["title", "string"],
      ["body", "document"],
    ])
      await post(`${model}/entity-types/${type.entityTypeId}/properties`, {
        key,
        displayName: key,
        dataType,
      });
    const entity = await post(`${runtime}/entities/paper`, {
      title: "Häuser",
      body: "Häuser werden gebaut.",
    });
    for (const kind of ["properties", "document"]) {
      const res = await app.inject({ url: `${runtime}/search?q=Haus&in=${kind}` });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().hits[0].entity._id).toBe(entity._id);
    }
  },
);
it("rejects the old tool and step names, and strips minScore from a search step", async () => {
  await post("/api/ontologies", { key: "language_test" });
  const model = "/api/ontologies/language_test/model";
  await post(`${model}/lenses`, { key: "all", name: "All" });
  await post(`${model}/entity-types`, { key: "paper", displayName: "Paper" });
  const put = (path: string, payload: object) =>
    app.inject({ method: "PUT", url: `${model}/lenses/all/${path}`, payload });
  const agent = await put("ai-agents/old", { name: "Old", tools: ["semantic_search"] });
  expect(agent.statusCode, agent.body).toBe(422);
  expect(agent.body).toContain("search_documents");
  const query = {
    name: "Find",
    description: "Find paper",
    steps: [{ name: "find", type: "semantic_search", entityTypeKey: "paper", query: "graph" }],
    parameters: [],
  };
  expect((await put("saved-queries/old", query)).statusCode).toBe(422);
  const created = await put("saved-queries/current", {
    ...query,
    steps: [{ ...query.steps[0], type: "search", minScore: 0.9 }],
  });
  expect(created.statusCode, created.body).toBe(201);
  expect(created.json().steps[0]).not.toHaveProperty("minScore");
  const payload = {
    textSearchLanguage: "english",
    entityTypes: [],
    relationTypes: [],
    lenses: [{ key: "stale", name: "Stale", savedQueries: [{ ...query, key: "old" }] }],
  };
  expect((await app.inject({ method: "POST", url: `${model}/import`, payload })).statusCode).toBe(
    422,
  );
});
