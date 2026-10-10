/**
 * Retriever agents through the modeling and runtime REST surface on
 * PostgreSQL: CRUD, copy and move, single export and import (version 2,
 * and a 5.x version-1 export converted with warnings), refusal of an
 * invalid configuration on save, agents that become invalid later (index
 * deleted, managed index switched off) and are refused at execution, the
 * design transfer — 6.0 round trip and 5.0 conversion — and retrieval of
 * a two-relation question on the real search engine (keyword mode, no
 * provider): fusion of two sub-queries, and one sub-query plus a filter.
 * On an adapter without search indices every route answers
 * FEATURE_DISABLED. Requires the docker-compose database.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { setAiModel } from "../../src/core/ai.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { closeStores, getRuntimeStore, initStores } from "../../src/core/ports.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { loadRunnableAgent } from "../../src/runtime/retrieverAgents/runtime.js";
import { retrieve, retrievedResults } from "../../src/runtime/retrieverAgents/retrieve.js";
import type { Plan } from "../../src/runtime/retrieverAgents/plan.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { fakeEmbeddingProvider } from "../fakeEmbedding.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const postgres = settings.DB_BACKEND === "postgres";
const O = "agents";
const MODEL = `/api/ontologies/${O}/model`;
const RUNTIME = `/api/ontologies/${O}/runtime/lenses/all`;
const AGENTS = `${MODEL}/lenses/all/assistants/retrievers`;

const EMPLOYMENT = {
  key: "person_employment",
  name: "People by employment",
  description: "People with their roles at companies.",
  entityType: "person",
  fields: ["name"],
  relations: [
    { relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name"] }, label: "Employment" },
  ],
};
const HOME = {
  key: "person_home",
  name: "People by home",
  description: "People with the city they live in.",
  entityType: "person",
  fields: ["name"],
  relations: [{ relationType: "lives_in", direction: "outgoing", fields: [], target: { city: ["name"] }, label: "Home" }],
};
const CONFIG = {
  indices: [{ index: "person~default" }, { index: "person_employment", relations: ["works_for"] }, { index: "person_home" }],
  filters: [{ id: "city", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], field: "name" }],
  answerFields: { person: ["name", "email"] },
  threshold: 0.35,
  answerFieldCharacters: 800,
};
const BODY = { name: "People", description: "Finds people by job and home.", configVersion: 2, config: CONFIG };

let app: FastifyInstance;

async function request(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) {
  return app.inject({ method, url, ...(payload ? { payload } : {}) });
}
async function ok(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object): Promise<Row> {
  const res = await request(method, url, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res.statusCode === 204 ? {} : res.json();
}
const post = (url: string, payload: object) => ok("POST", url, payload);

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
  setEmbeddingProvider(null);
});

it.skipIf(postgres)("an adapter without search indices answers FEATURE_DISABLED for every retriever-agent route", async () => {
  await post("/api/ontologies", { key: O });
  await post(`${MODEL}/lenses`, { key: "all", name: "All" });
  for (const res of [
    await request("GET", AGENTS),
    await request("PUT", `${AGENTS}/people`, BODY),
    await request("POST", `${AGENTS}/import`, { key: "people", ...BODY }),
    await request("GET", `${RUNTIME}/ai/assistants/retrievers`),
    await request("POST", `${RUNTIME}/ai/assistants/retrievers/people/chat`, { message: "Who?" }),
    await request("POST", `${RUNTIME}/ai/assistants/retrievers/_default/retrieve`, { query: "Who?" }),
  ]) {
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error.details.code).toBe("FEATURE_DISABLED");
  }
});

describe.skipIf(!postgres)("retriever agents", () => {
  /** person (name, email, bio) —works_for (role)→ company; —lives_in→ city; lenses all and people (person only). */
  async function schema(o = O): Promise<{ peopleLensId: string }> {
    const model = `/api/ontologies/${o}/model`;
    await post("/api/ontologies", { key: o });
    await post(`${model}/lenses`, { key: "all", name: "All" });
    const people = await post(`${model}/lenses`, { key: "people", name: "People" });
    const person = await post(`${model}/entity-types`, { key: "person", displayName: "Person" });
    await post(`${model}/entity-types/${person.entityTypeId}/properties`, { key: "email", displayName: "Email", dataType: "string" });
    await post(`${model}/entity-types/${person.entityTypeId}/properties`, { key: "bio", displayName: "Bio", dataType: "document" });
    await post(`${model}/entity-types`, { key: "company", displayName: "Company" });
    await post(`${model}/entity-types`, { key: "city", displayName: "City" });
    const worksFor = await post(`${model}/relation-types`, {
      key: "works_for", displayName: "Works for", sourceEntityTypeKey: "person", targetEntityTypeKey: "company",
    });
    await post(`${model}/relation-types/${worksFor.relationTypeId}/properties`, { key: "role", displayName: "Role", dataType: "string" });
    await post(`${model}/relation-types`, {
      key: "lives_in", displayName: "Lives in", sourceEntityTypeKey: "person", targetEntityTypeKey: "city",
    });
    for (const key of ["person", "company", "city"]) {
      await post(`${model}/lenses/${people.lensId}/includes/entity-types`, { key });
    }
    for (const key of ["works_for", "lives_in"]) {
      await post(`${model}/lenses/${people.lensId}/includes/relation-types`, { key });
    }
    await post(`${model}/search-indices`, EMPLOYMENT);
    await post(`${model}/search-indices`, HOME);
    return { peopleLensId: people.lensId };
  }

  /** Ada: CTO at ACME, Berlin. Bob: CTO at Foo, Hamburg. Eve: Engineer at ACME, Berlin. */
  async function data(): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};
    for (const [key, type, props] of [
      ["ada", "person", { name: "Ada", email: "ada@acme.test" }],
      ["bob", "person", { name: "Bob", email: "bob@foo.test" }],
      ["eve", "person", { name: "Eve", email: "eve@acme.test" }],
      ["acme", "company", { name: "ACME" }],
      ["foo", "company", { name: "Foo" }],
      ["berlin", "city", { name: "Berlin" }],
      ["hamburg", "city", { name: "Hamburg" }],
    ] as const) {
      ids[key] = (await post(`${RUNTIME}/entities/${type}`, props))._id;
    }
    const relate = (type: string, from: string, to: string, props = {}) =>
      post(`${RUNTIME}/relations/${type}`, { fromEntityId: ids[from], toEntityId: ids[to], ...props });
    await relate("works_for", "ada", "acme", { role: "CTO" });
    await relate("works_for", "bob", "foo", { role: "CTO" });
    await relate("works_for", "eve", "acme", { role: "Engineer" });
    await relate("lives_in", "ada", "berlin");
    await relate("lives_in", "bob", "hamburg");
    await relate("lives_in", "eve", "berlin");
    await drainSearchWork({ ontologyKey: O });
    return ids;
  }

  it("creates, lists, reads, replaces and deletes an agent; a save is checked against the lens", async () => {
    await schema();
    const created = await request("PUT", `${AGENTS}/people`, BODY);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      key: "people",
      lensKey: "all",
      name: "People",
      description: "Finds people by job and home.",
      configVersion: 2,
      config: CONFIG,
      validation: { valid: true, errors: [], warnings: [] },
    });
    expect(Object.keys(created.json()).sort()).toEqual(
      ["config", "configVersion", "createdAt", "description", "key", "lensKey", "name", "updatedAt", "validation"],
    );
    const replaced = await request("PUT", `${AGENTS}/people`, { ...BODY, name: "People v2", description: null });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ name: "People v2", description: null });
    expect((await ok("GET", AGENTS)).map((agent: Row) => agent.key)).toEqual(["people"]);
    expect((await ok("GET", `${AGENTS}/people`)).name).toBe("People v2");

    // Invalid on save: 422, nothing stored.
    for (const config of [
      { ...CONFIG, indices: [{ index: "ghost" }] },
      { ...CONFIG, indices: [{ index: "person_employment", relations: ["lives_in"] }] },
      { ...CONFIG, answerFields: {} },
      { ...CONFIG, filters: [{ ...CONFIG.filters[0], field: "zip" }] },
    ]) {
      const refused = await request("PUT", `${AGENTS}/broken`, { ...BODY, config });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe("VALIDATION_ERROR");
    }
    expect((await request("PUT", `${AGENTS}/Bad-Key`, BODY)).statusCode).toBe(422);
    // Lens-resource keys allow '-', unlike schema keys.
    expect((await request("PUT", `${AGENTS}/support-bot`, BODY)).statusCode).toBe(201);
    expect((await request("DELETE", `${AGENTS}/support-bot`)).statusCode).toBe(204);
    expect((await request("PUT", `${AGENTS}/v1`, { ...BODY, configVersion: 1 })).statusCode).toBe(422);
    expect((await request("GET", `${AGENTS}/broken`)).statusCode).toBe(404);
    expect((await request("GET", `${MODEL}/lenses/nope/assistants/retrievers`)).statusCode).toBe(404);
    expect((await request("GET", `${MODEL}/lenses/all/retriever-agents`)).statusCode).toBe(404);

    expect((await request("DELETE", `${AGENTS}/people`)).statusCode).toBe(204);
    expect((await request("DELETE", `${AGENTS}/people`)).statusCode).toBe(404);
  });

  it("copies and moves within the ontology, never over a taken key or into a lens that cannot run it", async () => {
    const { peopleLensId } = await schema();
    await ok("PUT", `${AGENTS}/people`, BODY);
    const copy = await request("POST", `${AGENTS}/people/copy`, { targetLensKey: "all", targetKey: "people_copy" });
    expect(copy.statusCode, copy.body).toBe(201);
    expect((await request("POST", `${AGENTS}/people/copy`, { targetLensKey: "all", targetKey: "people_copy" })).statusCode).toBe(409);
    // The scoped lens does not include the custom indices.
    const refused = await request("POST", `${AGENTS}/people/move`, { targetLensKey: "people", targetKey: "people" });
    expect(refused.statusCode, refused.body).toBe(422);
    const included = (await ok("GET", `${MODEL}/lenses/${peopleLensId}/includes/search-indices`)) as unknown as Row[];
    for (const key of ["person~default", "person_employment", "person_home"]) {
      if (!included.some((row) => row.key === key)) {
        await post(`${MODEL}/lenses/${peopleLensId}/includes/search-indices`, { key });
      }
    }
    const moved = await request("POST", `${AGENTS}/people/move`, { targetLensKey: "people", targetKey: "staff" });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ key: "staff", lensKey: "people", validation: { valid: true } });
    expect((await ok("GET", AGENTS)).map((agent: Row) => agent.key)).toEqual(["people_copy"]);
  });

  it("exports the portable form and imports it create-only; a version-1 export converts with warnings", async () => {
    await schema();
    await ok("PUT", `${AGENTS}/people`, BODY);
    const exported = await ok("GET", `${AGENTS}/people/export`);
    expect(exported).toEqual({ key: "people", name: "People", description: BODY.description, configVersion: 2, config: CONFIG });
    expect((await request("POST", `${AGENTS}/import`, exported)).statusCode).toBe(409);
    const imported = await request("POST", `${AGENTS}/import`, { ...exported, key: "people_2" });
    expect(imported.statusCode, imported.body).toBe(201);

    const legacy = {
      key: "legacy",
      name: "Legacy",
      description: null,
      configVersion: 1,
      config: {
        buckets: [
          {
            entityTypeKey: "person",
            searchFields: ["name", "bio"],
            answerFields: ["name"],
            conditions: [
              { id: "rule-1", mode: "hard", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], targetField: "name", textFields: [] },
              { id: "rule-2", mode: "soft", path: [{ relationTypeKey: "works_for", direction: "outgoing" }], targetField: "name", textFields: ["name"] },
            ],
          },
        ],
        threshold: 0.3,
        answerFieldCharacters: 500,
      },
    };
    const converted = await request("POST", `${AGENTS}/import`, legacy);
    expect(converted.statusCode, converted.body).toBe(201);
    expect(converted.json()).toMatchObject({
      configVersion: 2,
      config: {
        indices: [{ index: "person~default" }, { index: "person~bio" }],
        filters: [{ id: "rule-1", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], field: "name" }],
        answerFields: { person: ["name"] },
        threshold: 0.3,
        answerFieldCharacters: 500,
      },
      validation: {
        valid: true,
        errors: [],
        warnings: [
          "Soft condition 'rule-2' of person was dropped: it needs a custom index with relation group works_for (outgoing).",
        ],
      },
    });
    // A version-1 key with '-' is renamed, unique in the lens.
    const hyphenated = await request("POST", `${AGENTS}/import`, { ...legacy, key: "people-v1" });
    expect(hyphenated.statusCode, hyphenated.body).toBe(201);
    expect(hyphenated.json().key).toBe("people_v1");
    expect(hyphenated.json().validation.warnings.at(-1)).toBe("Key renamed from 'people-v1' to 'people_v1'.");
    expect((await request("POST", `${AGENTS}/import`, { ...legacy, key: "people-v1" })).json().key).toBe("people_v1_2");
    // A save is a new configuration: the conversion's notes go.
    const saved = await ok("PUT", `${AGENTS}/legacy`, { name: "Legacy", configVersion: 2, config: converted.json().config });
    expect(saved.validation.warnings).toEqual([]);
  });

  it("an agent that becomes invalid is reported on read and refused at execution", async () => {
    await schema();
    await ok("PUT", `${AGENTS}/people`, BODY);
    const chat = (key = "people") => request("POST", `${RUNTIME}/ai/assistants/retrievers/${key}/chat`, { message: "Who is CTO at ACME?" });
    // No language model in this suite: refused like the other AI routes,
    // before any stream opens.
    const unavailable = await chat();
    expect(unavailable.statusCode).toBe(422);
    expect(unavailable.json().error.details.code).toBe("FEATURE_DISABLED");
    // With a model (never called here), the agent itself is checked first.
    const withModel = async (key?: string) => {
      setAiModel({} as BaseChatModel);
      try {
        return await chat(key);
      } finally {
        setAiModel(null);
      }
    };
    expect((await withModel("nobody")).statusCode).toBe(404);

    await ok("DELETE", `${MODEL}/search-indices/person_home`);
    const read = await ok("GET", `${AGENTS}/people`);
    expect(read.validation).toEqual({
      valid: false,
      errors: ["Search index 'person_home' is not available in this lens"],
      warnings: [],
    });
    const refused = await withModel();
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.message).toContain("is invalid in this lens");
    // Still exportable as stored.
    expect((await ok("GET", `${AGENTS}/people/export`)).config).toEqual(CONFIG);
    // Still listed at runtime, without configuration or validation, after the default.
    expect(await ok("GET", `${RUNTIME}/ai/assistants/retrievers`)).toEqual([
      { key: "_default", name: "Default", description: null, builtIn: true },
      { key: "people", name: BODY.name, description: BODY.description, builtIn: false },
    ]);
    expect((await request("GET", `/api/ontologies/${O}/runtime/lenses/nope/ai/assistants/retrievers`)).statusCode).toBe(404);

    // A switched-off managed index is not in the catalog either.
    await ok("PUT", `${AGENTS}/bio`, { name: "Bio", configVersion: 2, config: { indices: [{ index: "person~bio" }], answerFields: { person: ["name"] } } });
    await ok("PUT", `${MODEL}/search-settings`, { disabledIndices: ["person~bio"] });
    expect((await ok("GET", `${AGENTS}/bio`)).validation.errors).toEqual([
      "Search index 'person~bio' is not available in this lens",
    ]);
  });

  it("design transfer 6.0 carries agents into a fresh ontology; 5.0 retrievers convert", async () => {
    await schema();
    await ok("PUT", `${AGENTS}/people`, BODY);
    const payload = await ok("GET", `${MODEL}/export`);
    expect(payload.lenses.find((lens: Row) => lens.key === "all").retrieverAgents).toEqual([
      { key: "people", name: "People", description: BODY.description, configVersion: 2, config: CONFIG },
    ]);

    await post("/api/ontologies", { key: "agents_copy" });
    await post("/api/ontologies/agents_copy/model/import", payload);
    const copied = await ok("GET", "/api/ontologies/agents_copy/model/lenses/all/assistants/retrievers");
    expect(copied.map((agent: Row) => [agent.key, agent.validation.valid])).toEqual([["people", true]]);


    const legacy = {
      formatVersion: "5.0",
      textSearchLanguage: "english",
      entityTypes: payload.entityTypes.map(({ nameProperty: _n, ...et }: Row) => et),
      relationTypes: payload.relationTypes,
      lenses: [
        {
          key: "all",
          name: "All",
          retrievers: [
            {
              key: "finder",
              name: "Finder",
              description: null,
              configVersion: 1,
              config: {
                buckets: [{ entityTypeKey: "person", searchFields: ["name"], answerFields: ["name"], conditions: [] }],
              },
            },
          ],
        },
      ],
    };
    await post("/api/ontologies", { key: "agents_legacy" });
    await post("/api/ontologies/agents_legacy/model/import", legacy);
    const converted = await ok("GET", "/api/ontologies/agents_legacy/model/lenses/all/assistants/retrievers/finder");
    expect(converted).toMatchObject({
      configVersion: 2,
      config: { indices: [{ index: "person~default" }], filters: [], answerFields: { person: ["name"] } },
      validation: { valid: true, errors: [], warnings: [] },
    });
  });

  it("a filtered sub-query keeps every entity the filter allows: the similarity threshold does not cut it", async () => {
    // Semantic, with fake vectors far below the threshold for any query.
    setEmbeddingProvider(fakeEmbeddingProvider());
    await schema();
    const ids = await data();
    await ok("PUT", `${AGENTS}/people`, BODY);
    const agent = await loadRunnableAgent("all", "people", await getRuntimeStore(O));
    const scope = { ...agent.scope, signal: new AbortController().signal };
    const sub = (overrides: Partial<Plan["subQueries"][number]>): Plan["subQueries"][number] => ({
      indices: ["person_employment"], relations: ["works_for"], query: "works at ACME", variants: [], mode: "semantic",
      filters: [], previous: null, ...overrides,
    });
    const unfiltered = await retrieve(scope, { subQueries: [sub({})], unsupportedReason: null });
    expect(unfiltered.items).toEqual([]);
    // "Who works at ACME and lives in Berlin?" as one sub-query plus the city filter.
    const berlin = [{ id: "city", value: "Berlin", quote: "lives in Berlin" }];
    const filtered = await retrieve(scope, { subQueries: [sub({ filters: berlin })], unsupportedReason: null });
    expect(filtered.items.map((item) => item.entityId).sort()).toEqual([ids.ada, ids.eve].sort());
    // A query that does not describe them still keeps them (person~default holds only names).
    const home = await retrieve(scope, {
      subQueries: [sub({ indices: ["person~default"], relations: [], query: "lives in Berlin", filters: berlin })],
      unsupportedReason: null,
    });
    expect(home.items.map((item) => item.entityId).sort()).toEqual([ids.ada, ids.eve].sort());
    expect(home.items.every((item) => item.matches[0]!.conditions.length === 1)).toBe(true);
  });

  it("retrieves a two-relation question by fusing two sub-queries, or one sub-query and a filter", async () => {
    await schema();
    const ids = await data();
    await ok("PUT", `${AGENTS}/people`, BODY);
    const agent = await loadRunnableAgent("all", "people", await getRuntimeStore(O));
    const scope = { ...agent.scope, signal: new AbortController().signal };
    const sub = (overrides: Partial<Plan["subQueries"][number]>): Plan["subQueries"][number] => ({
      indices: ["person_employment"], relations: ["works_for"], query: "CTO ACME", variants: [], mode: "keyword",
      filters: [], previous: null, ...overrides,
    });

    // "Who is CTO at ACME and lives in Berlin?" — two relations, two sub-queries.
    const fused = await retrieve(scope, {
      subQueries: [sub({}), sub({ indices: ["person_home"], relations: ["lives_in"], query: "Berlin" })],
      unsupportedReason: null,
    });
    expect(fused.searchCalls).toBe(2);
    expect(fused.items[0]).toMatchObject({
      entityId: ids.ada,
      label: "Ada",
      fields: { name: "Ada", email: "ada@acme.test" },
    });
    expect(fused.items[0]!.matches.map((m) => [m.subQuery, m.matched?.index, m.matched?.target?.label])).toEqual([
      [0, "person_employment", "ACME"],
      [1, "person_home", "Berlin"],
    ]);

    // The same question as one sub-query plus the exact city filter.
    const filtered = await retrieve(scope, {
      subQueries: [sub({ query: "CTO", filters: [{ id: "city", value: "berlin", quote: "Berlin" }] })],
      unsupportedReason: null,
    });
    // The filter decides who is in; the query orders: Ada (CTO) first, Eve
    // (also in Berlin, not found by "CTO") after her, unmatched.
    expect(filtered.items.map((item) => [item.entityId, item.matches[0]!.matched === null])).toEqual([
      [ids.ada, false],
      [ids.eve, true],
    ]);
    // The answer model learns the filter held.
    expect(filtered.items[0]!.matches[0]!.conditions).toEqual([
      { filter: "city", value: "berlin", text: "Lives in City Name: berlin" },
    ]);

    // An exact list: everyone living in Berlin, without a search.
    const listed = await retrieve(scope, {
      subQueries: [sub({ indices: ["person~default"], relations: [], query: "", filters: [{ id: "city", value: "Berlin", quote: "Berlin" }] })],
      unsupportedReason: null,
    });
    expect(listed.searchCalls).toBe(0);
    expect(listed.items.map((item) => item.label).sort()).toEqual(["Ada", "Eve"]);
  });

  it("the default agent derives its configuration from the lens and runs without being stored", async () => {
    await schema();
    const ids = await data();
    const store = await getRuntimeStore(O);
    const fallback = await loadRunnableAgent("all", "_default", store);
    expect(fallback.config.indices.map((reference) => reference.index)).toEqual([
      "city~default", "company~default", "person~bio", "person~default",
    ]);
    expect(fallback.config.filters.map((filter) => filter.id)).toEqual([
      "city", "city.lives_in.incoming",
      "company", "company.works_for.incoming",
      "person", "person.lives_in.outgoing", "person.works_for.outgoing",
    ]);
    expect(fallback.config.answerFields.person).toEqual(["name", "email"]);
    // Not stored, never listed.
    expect(await ok("GET", AGENTS)).toEqual([]);

    // A derived filter restricts like a configured one, and retrieve names it.
    const scope = { ...fallback.scope, signal: new AbortController().signal };
    const listed = await retrieve(scope, {
      subQueries: [{
        indices: ["person~default"], relations: [], query: "", variants: [], mode: "keyword",
        filters: [{ id: "person.lives_in.outgoing", value: "Berlin", quote: "Berlin" }], previous: null,
      }],
      unsupportedReason: null,
    });
    const results = retrievedResults(listed);
    expect(results.map((result) => result.entityId).sort()).toEqual([ids.ada, ids.eve].sort());
    expect(results[0]!.conditions).toEqual([
      { filter: "person.lives_in.outgoing", value: "Berlin", text: "Lives in City Name: Berlin" },
    ]);

    // It follows switch-off and the lens scope.
    await ok("PUT", `${MODEL}/search-settings`, { disabledIndices: ["person~bio"] });
    invalidateLoadedSchemaCache();
    expect((await loadRunnableAgent("all", "_default", store)).config.indices.map((r) => r.index)).not.toContain("person~bio");
    const solo = await post(`${MODEL}/lenses`, { key: "solo", name: "Solo" });
    await post(`${MODEL}/lenses/${solo.lensId}/includes/entity-types`, { key: "person" });
    // A scoped lens searches the indices it includes.
    for (const key of ["person~default", "person~bio"]) {
      await post(`${MODEL}/lenses/${solo.lensId}/includes/search-indices`, { key });
    }
    invalidateLoadedSchemaCache();
    const scoped = await loadRunnableAgent("solo", "_default", store);
    expect(scoped.config.indices.map((r) => r.index)).toEqual(["person~default"]);
    expect(scoped.config.filters.map((filter) => filter.id)).toEqual(["person"]);
  });

  it("the default agent with nothing to search refuses a question before any model call", async () => {
    await schema();
    // A lens that shows only cities, whose one managed index is switched off.
    const bare = await post(`${MODEL}/lenses`, { key: "bare", name: "Bare" });
    await post(`${MODEL}/lenses/${bare.lensId}/includes/entity-types`, { key: "city" });
    await ok("PUT", `${MODEL}/search-settings`, { disabledIndices: ["city~default"] });
    setAiModel({} as BaseChatModel);
    try {
      for (const [route, payload] of [["retrieve", { query: "Who?" }], ["chat", { message: "Who?" }]] as const) {
        const res = await request("POST", `/api/ontologies/${O}/runtime/lenses/bare/ai/assistants/retrievers/_default/${route}`, payload);
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
        expect(res.json().error.message).toContain("nothing to search");
      }
    } finally {
      setAiModel(null);
    }
  });
});
