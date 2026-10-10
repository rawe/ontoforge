/**
 * The keyword language set: an ontology setting edited through the search
 * settings (PostgreSQL — an adapter without search indices answers
 * FEATURE_DISABLED), never part of the registry; carried by transfer 6.0
 * and mapped from a 5.0 payload's text-search language. A change of the
 * set rebuilds the keyword entries of every index in new generations; the
 * old ones serve until the worker finishes them.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/app.js";
import { initStores, closeStores, getSearchIndexStore } from "../../src/core/ports.js";
import { settings } from "../../src/config.js";
import { wipeDatabase } from "./reset.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";

const postgres = settings.DB_BACKEND === "postgres";
const base = "/api/ontologies/language_test";
const model = `${base}/model`;
const runtime = `${base}/runtime/lenses/all`;

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
const putSettings = (payload: object) =>
  app.inject({ method: "PUT", url: `${model}/search-settings`, payload });
const getSettings = async () => (await app.inject({ url: `${model}/search-settings` })).json();

it("the registry takes no language and answers none; export carries the keyword language set", async () => {
  // A language a client still sends is ignored, like any unknown field.
  const created = await post("/api/ontologies", { key: "language_test", textSearchLanguage: "german" });
  expect(created).not.toHaveProperty("textSearchLanguage");
  expect((await app.inject({ url: base })).json()).not.toHaveProperty("textSearchLanguage");
  expect((await app.inject({ url: "/api/ontologies" })).json()[0]).not.toHaveProperty(
    "textSearchLanguage",
  );
  const exported = (await app.inject({ url: `${model}/export` })).json();
  expect(exported).toMatchObject({ formatVersion: "7.0", keywordLanguages: ["german", "english"] });
  expect(exported).not.toHaveProperty("textSearchLanguage");
});

it.skipIf(postgres)("an adapter without search indices answers FEATURE_DISABLED for search settings and indices", async () => {
  await post("/api/ontologies", { key: "language_test" });
  const index = { key: "people", name: "People", description: "d", entityType: "person", fields: ["name"] };
  for (const res of [
    await app.inject({ url: `${model}/search-settings` }),
    await putSettings({ keywordLanguages: ["german"] }),
    await app.inject({ url: `${model}/search-indices` }),
    await app.inject({ method: "POST", url: `${model}/search-indices`, payload: index }),
    await app.inject({ method: "POST", url: `${model}/search-indices/preview`, payload: index }),
    await app.inject({ url: `${model}/search-indices/people` }),
    await app.inject({ method: "PUT", url: `${model}/search-indices/people`, payload: index }),
    await app.inject({ method: "DELETE", url: `${model}/search-indices/people` }),
    await app.inject({ url: `${model}/search-indices/people/status` }),
    await app.inject({ method: "POST", url: `${model}/search-indices/people/rebuild` }),
  ]) {
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.code).toBe("FEATURE_DISABLED");
  }
});

describe.skipIf(!postgres)("search settings on PostgreSQL", () => {
  it("a new ontology stems in German and English; a change is stored in canonical order", async () => {
    await post("/api/ontologies", { key: "language_test" });
    expect(await getSettings()).toEqual({ keywordLanguages: ["german", "english"], disabledIndices: [] });
    const changed = await putSettings({ keywordLanguages: ["english"] });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toEqual({ keywordLanguages: ["english"], disabledIndices: [] });
    expect((await putSettings({ keywordLanguages: ["english", "german"] })).json().keywordLanguages).toEqual([
      "german",
      "english",
    ]);
    for (const keywordLanguages of [[], ["unknown"], ["german", "german"]]) {
      expect((await putSettings({ keywordLanguages })).statusCode).toBe(422);
    }
    expect((await getSettings()).keywordLanguages).toEqual(["german", "english"]);
  });

  it("transfer 6.0 carries the set into the target; 5.0 maps its text-search language", async () => {
    await post("/api/ontologies", { key: "language_test" });
    const design = { entityTypes: [], relationTypes: [], lenses: [] };
    await post(`${model}/import`, { ...design, keywordLanguages: ["english"] });
    expect((await getSettings()).keywordLanguages).toEqual(["english"]);
    const exported = (await app.inject({ url: `${model}/export` })).json();
    expect(exported.keywordLanguages).toEqual(["english"]);

    await post(`${model}/import`, { ...design, formatVersion: "5.0", textSearchLanguage: "german" });
    expect((await getSettings()).keywordLanguages).toEqual(["german"]);

    // Each version requires its own field, checked before anything is written.
    for (const payload of [
      { ...design, textSearchLanguage: "english" },
      { ...design, formatVersion: "5.0", keywordLanguages: ["english"] },
    ]) {
      const res = await app.inject({ method: "POST", url: `${model}/import`, payload });
      expect(res.statusCode, res.body).toBe(422);
    }
    expect((await getSettings()).keywordLanguages).toEqual(["german"]);
  });

  it("a language change builds new keyword generations; the old ones serve until they are ready", async () => {
    await post("/api/ontologies", { key: "language_test" });
    await post(`${model}/lenses`, { key: "all", name: "All" });
    await post(`${model}/entity-types`, { key: "listing", displayName: "Listing" });
    // German "Häuser" stems to `haus` in German only; English "studies" to
    // `studi` in English only — so each query below finds its text only
    // while the set holds that text's language.
    const german = await post(`${runtime}/entities/listing`, { name: "Die Häuser am See" });
    const english = await post(`${runtime}/entities/listing`, { name: "Many studies of lakes" });
    await drainSearchWork();
    const ids = async (q: string) => {
      const res = await app.inject({
        url: `${runtime}/search?${new URLSearchParams({ q, in: "properties", strategy: "keyword" })}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().hits.map((h: any) => h.entity._id);
    };
    const keywordLanguagesOfGenerations = async () =>
      (await (await getSearchIndexStore("language_test")).listGenerations())
        .filter((g) => g.representation === "keyword" && g.state !== "retired")
        .map((g) => [g.state, g.languages]);
    expect(await ids("Haus")).toEqual([german._id]);
    expect(await ids("study")).toEqual([english._id]);

    expect((await putSettings({ keywordLanguages: ["german"] })).statusCode).toBe(200);
    expect(await keywordLanguagesOfGenerations()).toEqual(
      expect.arrayContaining([
        ["ready", ["german", "english"]],
        ["building", ["german"]],
      ]),
    );
    // Until the worker has built the new generation, the old one serves.
    expect(await ids("study")).toEqual([english._id]);
    await drainSearchWork();
    expect(await keywordLanguagesOfGenerations()).toEqual([["ready", ["german"]]]);
    expect(await ids("Haus")).toEqual([german._id]);
    expect(await ids("study")).toEqual([]);

    expect((await putSettings({ keywordLanguages: ["english"] })).statusCode).toBe(200);
    await drainSearchWork();
    expect(await ids("Haus")).toEqual([]);
    expect(await ids("study")).toEqual([english._id]);
  });

  it("German stemming is shared by properties and documents", async () => {
    await post("/api/ontologies", { key: "language_test" });
    expect((await putSettings({ keywordLanguages: ["german"] })).statusCode).toBe(200);
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
    await drainSearchWork();
    for (const kind of ["properties", "document"]) {
      const res = await app.inject({ url: `${runtime}/search?q=Haus&in=${kind}` });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().hits[0].entity._id).toBe(entity._id);
    }
  });

  it("keyword search stems in German and English alike on a bilingual ontology", async () => {
    // A new ontology's keyword language set is {german, english}: each entry
    // is stemmed in both, each query parsed in both and OR-ed.
    await post("/api/ontologies", { key: "language_test" });
    await post(`${model}/lenses`, { key: "all", name: "All" });
    const type = await post(`${model}/entity-types`, { key: "listing", displayName: "Listing" });
    await post(`${model}/entity-types/${type.entityTypeId}/properties`, {
      key: "body",
      displayName: "Body",
      dataType: "document",
    });
    const german = await post(`${runtime}/entities/listing`, {
      name: "Die Häuser am See",
      body: "Wir kaufen alte Häuser.",
    });
    const english = await post(`${runtime}/entities/listing`, {
      name: "The houses by the lake",
      body: "We are buying old houses.",
    });
    await drainSearchWork();
    const ids = async (q: string, kind: string, strategy = "keyword") => {
      const res = await app.inject({
        url: `${runtime}/search?${new URLSearchParams({ q, in: kind, strategy })}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().hits.map((h: any) => h.entity._id);
    };
    for (const kind of ["properties", "document"]) {
      // German inflections find the German text, English ones the English text.
      expect(await ids("Haus", kind)).toEqual([german._id]);
      expect(await ids("Häusern", kind)).toEqual([german._id]);
      expect(await ids("house", kind)).toEqual([english._id]);
    }
    expect(await ids("kaufen", "document")).toEqual([german._id]);
    expect(await ids("buy", "document")).toEqual([english._id]);
    // Every term must match in one language: German and English terms mixed
    // match nothing under all-term matching, either under any-term.
    expect(await ids("Haus lake", "properties", "keyword-all")).toEqual([]);
    expect((await ids("Haus lake", "properties", "keyword-any")).sort()).toEqual(
      [german._id, english._id].sort(),
    );
  });

  it("a stop word of any language of the set is no query word in the other", async () => {
    await post("/api/ontologies", { key: "language_test" });
    await post(`${model}/lenses`, { key: "all", name: "All" });
    await post(`${model}/entity-types`, { key: "service", displayName: "Service" });
    const research = await post(`${runtime}/entities/service`, { name: "Marktforschung für Einzelhändler" });
    await post(`${runtime}/entities/service`, { name: "Software für Banken" });
    await post(`${runtime}/entities/service`, { name: "Analyse eines Marktes" });
    await post(`${runtime}/entities/service`, { name: "The retail toolbox" });
    await drainSearchWork();
    const ids = async (q: string) => {
      const res = await app.inject({
        url: `${runtime}/search?${new URLSearchParams({ q, in: "properties", strategy: "keyword-any" })}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().hits.map((h: any) => h.entity._id);
    };
    // English would stem "für" and "eines" ("ein", a prefix of
    // "Einzelhändler"), German "the": each is a stop word of the set.
    expect(await ids("Marktforschung für Einzelhändler")).toEqual([research._id]);
    expect(await ids("für")).toEqual([]);
    expect(await ids("eines")).toEqual([]);
    expect(await ids("the")).toEqual([]);
  });
});

it("rejects the old tool and step names, and strips minScore from a search step", async () => {
  await post("/api/ontologies", { key: "language_test" });
  await post(`${model}/lenses`, { key: "all", name: "All" });
  await post(`${model}/entity-types`, { key: "paper", displayName: "Paper" });
  const put = (path: string, payload: object) =>
    app.inject({ method: "PUT", url: `${model}/lenses/all/${path}`, payload });
  const agent = await put("assistants/agents/old", { name: "Old", tools: ["semantic_search"] });
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
    keywordLanguages: ["english"],
    entityTypes: [],
    relationTypes: [],
    lenses: [{ key: "stale", name: "Stale", savedQueries: [{ ...query, key: "old" }] }],
  };
  expect((await app.inject({ method: "POST", url: `${model}/import`, payload })).statusCode).toBe(
    422,
  );
});
