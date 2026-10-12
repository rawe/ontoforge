/**
 * Navigators through the modeling and runtime REST surface on PostgreSQL:
 * CRUD with validation on save, validation reported on every read once the
 * schema or the lens scope changes underneath (and the chat refusing it
 * before the stream), the cascade with the lens, the runtime list, and the
 * design transfer — export, round trip, refusals, payloads without
 * navigators. Requires the docker-compose database.
 */

import type { FastifyInstance } from "fastify";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { setAiModel } from "../../src/core/ai.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const O = "nav";
const MODEL = `/api/ontologies/${O}/model`;
const navigators = (lens: string, o = O) => `/api/ontologies/${o}/model/lenses/${lens}/assistants/navigators`;
const runtime = (lens: string, o = O) => `/api/ontologies/${o}/runtime/lenses/${lens}/ai/assistants/navigators`;
const DEFAULTS = { hops: 2, relationTypes: null, anchorTypes: null, maxEntities: 40, instructions: null };
const BODY = {
  name: "Reports",
  description: "Who works on what.",
  configVersion: 1,
  config: { hops: 3, relationTypes: ["manages", "works_on"], anchorTypes: ["person"], instructions: "Be brief." },
};

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

/** person —manages→ person, —works_on→ project, —member_of→ team; lenses
 * `all` (unscoped) and `people` (person, project; manages, works_on). */
async function schema(o = O): Promise<Row> {
  const model = `/api/ontologies/${o}/model`;
  await post("/api/ontologies", { key: o });
  const all = await post(`${model}/lenses`, { key: "all", name: "All" });
  const people = await post(`${model}/lenses`, { key: "people", name: "People" });
  const person = await post(`${model}/entity-types`, { key: "person", displayName: "Person" });
  await post(`${model}/entity-types/${person.entityTypeId}/properties`, { key: "email", displayName: "Email", dataType: "string" });
  await post(`${model}/entity-types`, { key: "project", displayName: "Project" });
  await post(`${model}/entity-types`, { key: "team", displayName: "Team" });
  const relation = async (key: string, from: string, to: string) =>
    post(`${model}/relation-types`, { key, displayName: key.replace("_", " "), sourceEntityTypeKey: from, targetEntityTypeKey: to });
  const manages = await relation("manages", "person", "person");
  const worksOn = await relation("works_on", "person", "project");
  const memberOf = await relation("member_of", "person", "team");
  for (const key of ["person", "project"]) await post(`${model}/lenses/${people.lensId}/includes/entity-types`, { key });
  for (const key of ["manages", "works_on"]) await post(`${model}/lenses/${people.lensId}/includes/relation-types`, { key });
  return { all, people, person, manages, worksOn, memberOf };
}

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
  setAiModel(null);
});

describe("navigator modeling", () => {
  it("creates (201), reads, lists by name, replaces (200) and deletes (204)", async () => {
    await schema();
    const created = await request("PUT", `${navigators("people")}/reports`, BODY);
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json() as Row;
    expect(body).toMatchObject({
      key: "reports",
      lensKey: "people",
      name: "Reports",
      description: "Who works on what.",
      configVersion: 1,
      config: { ...DEFAULTS, ...BODY.config },
      validation: { valid: true, errors: [], warnings: [] },
    });
    expect(Date.parse(body.createdAt)).not.toBeNaN();

    await ok("PUT", `${navigators("people")}/alpha`, { ...BODY, name: "Alpha", description: null });
    expect((await ok("GET", navigators("people")) as unknown as Row[]).map((n) => n.key)).toEqual(["alpha", "reports"]);
    expect(await ok("GET", `${navigators("people")}/reports`)).toEqual(body);
    // Another lens has its own.
    expect(await ok("GET", navigators("all"))).toEqual([]);

    const replaced = await request("PUT", `${navigators("people")}/reports`, { ...BODY, name: "Reports v2", config: {} });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ name: "Reports v2", config: DEFAULTS, createdAt: body.createdAt });

    expect((await request("DELETE", `${navigators("people")}/reports`)).statusCode).toBe(204);
    expect((await request("GET", `${navigators("people")}/reports`)).statusCode).toBe(404);
    expect((await request("DELETE", `${navigators("people")}/reports`)).statusCode).toBe(404);
  });

  it("refuses a configuration the lens cannot run, with every error, and stores nothing", async () => {
    await schema();
    // The people lens hides member_of and team.
    const res = await request("PUT", `${navigators("people")}/reports`, {
      ...BODY,
      config: { relationTypes: ["member_of", "ghost"], anchorTypes: ["team"] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.errors).toEqual([
      "relationTypes: the lens shows no relation type 'member_of'",
      "relationTypes: the lens shows no relation type 'ghost'",
      "anchorTypes: the lens shows no entity type 'team'",
    ]);
    // The unscoped lens shows them.
    expect((await request("PUT", `${navigators("all")}/reports`, { ...BODY, config: { relationTypes: ["member_of"], anchorTypes: ["team"] } })).statusCode).toBe(201);
    for (const config of [{ hops: 0 }, { maxEntities: 81 }, { instructions: "x".repeat(4001) }, { depth: 1 }]) {
      expect((await request("PUT", `${navigators("people")}/reports`, { ...BODY, config })).statusCode, JSON.stringify(config)).toBe(422);
    }
    expect((await request("PUT", `${navigators("people")}/reports`, { ...BODY, configVersion: 2 })).statusCode).toBe(422);
    expect(await ok("GET", navigators("people"))).toEqual([]);
  });

  it("refuses the built-in key and malformed keys; an unknown lens is not found", async () => {
    await schema();
    for (const key of ["_default", "_x", "Reports", "9x"]) {
      const res = await request("PUT", `${navigators("people")}/${key}`, BODY);
      expect(res.statusCode, key).toBe(422);
    }
    expect((await request("GET", `${navigators("people")}/_default`)).statusCode).toBe(404);
    expect((await request("PUT", `${navigators("nope")}/reports`, BODY)).statusCode).toBe(404);
    expect((await request("GET", navigators("nope"))).statusCode).toBe(404);
  });

  it("a navigator invalidated by a schema change stays readable, reports why, and its chat is refused", async () => {
    const { manages } = await schema();
    await ok("PUT", `${navigators("all")}/reports`, BODY);
    await ok("DELETE", `${MODEL}/relation-types/${manages.relationTypeId}?cascade=true`);

    const read = await ok("GET", `${navigators("all")}/reports`);
    expect(read.validation).toEqual({ valid: false, errors: ["relationTypes: the lens shows no relation type 'manages'"], warnings: [] });
    // Kept as stored.
    expect(read.config.relationTypes).toEqual(["manages", "works_on"]);
    expect((await ok("GET", navigators("all")) as unknown as Row[])[0]!.validation.valid).toBe(false);

    // Without a model every chat is refused as a disabled feature first.
    const disabled = await request("POST", `${runtime("all")}/reports/chat`, { message: "Who?" });
    expect(disabled.statusCode).toBe(422);
    expect(disabled.json().error.details.code).toBe("FEATURE_DISABLED");
    setAiModel({} as BaseChatModel);
    try {
      const refused = await request("POST", `${runtime("all")}/reports/chat`, { message: "Who?" });
      expect(refused.statusCode).toBe(422);
      expect(refused.headers["content-type"]).toContain("application/json");
      expect(refused.json().error.message).toContain("Navigator 'reports' is invalid in this lens");
      expect(refused.json().error.details.errors).toEqual(["relationTypes: the lens shows no relation type 'manages'"]);
      expect((await request("POST", `${runtime("all")}/ghost/chat`, { message: "Who?" })).statusCode).toBe(404);
    } finally {
      setAiModel(null);
    }
    // Still listed at runtime: the list does not validate.
    expect((await ok("GET", runtime("all")) as unknown as Row[]).map((n) => n.key)).toEqual(["_default", "reports"]);
  });

  it("a navigator invalidated by a scope change is reported on read", async () => {
    const { people, worksOn } = await schema();
    await ok("PUT", `${navigators("people")}/reports`, BODY);
    await ok("DELETE", `${MODEL}/lenses/${people.lensId}/includes/relation-types/${worksOn.relationTypeId}`);
    const read = await ok("GET", `${navigators("people")}/reports`);
    expect(read.validation.errors).toEqual(["relationTypes: the lens shows no relation type 'works_on'"]);
  });

  it("deleting the lens deletes its navigators", async () => {
    const { people } = await schema();
    await ok("PUT", `${navigators("people")}/reports`, BODY);
    await ok("PUT", `${navigators("all")}/reports`, BODY);
    await ok("DELETE", `${MODEL}/lenses/${people.lensId}`);
    // A lens of the same key starts with none.
    await post(`${MODEL}/lenses`, { key: "people", name: "People again" });
    expect(await ok("GET", navigators("people"))).toEqual([]);
    expect((await ok("GET", navigators("all")) as unknown as Row[]).map((n) => n.key)).toEqual(["reports"]);
  });

  it("navigators of one ontology are not another's", async () => {
    await schema();
    await schema("other");
    await ok("PUT", `${navigators("all")}/reports`, BODY);
    expect(await ok("GET", navigators("all", "other"))).toEqual([]);
  });
});

describe("navigator runtime", () => {
  it("lists the built-in default first, then the stored ones by name — no model needed", async () => {
    await schema();
    await ok("PUT", `${navigators("people")}/zeta`, { ...BODY, name: "Zeta" });
    await ok("PUT", `${navigators("people")}/reports`, BODY);
    const list = await ok("GET", runtime("people"));
    expect(list).toEqual([
      { key: "_default", name: "Default", description: expect.any(String), builtIn: true },
      { key: "reports", name: "Reports", description: "Who works on what.", builtIn: false },
      { key: "zeta", name: "Zeta", description: "Who works on what.", builtIn: false },
    ]);
    expect((await request("GET", runtime("nope"))).statusCode).toBe(404);
  });

  it("chat without a language model is refused before anything streams", async () => {
    await schema();
    const res = await request("POST", `${runtime("people")}/_default/chat`, { message: "Who?" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.code).toBe("FEATURE_DISABLED");
  });

  it("an unknown thread is not found", async () => {
    await schema();
    const res = await request("GET", `${runtime("people")}/_default/threads/nope`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.details).toEqual({ code: "THREAD_NOT_FOUND" });
  });
});

describe("navigator transfer", () => {
  const exported = async (o = O) => ok("GET", `/api/ontologies/${o}/model/export`);
  const lensOf = (payload: Row, key: string) => (payload.lenses as Row[]).find((l) => l.key === key)!;

  it("export nests each lens's navigators in their portable form", async () => {
    await schema();
    await ok("PUT", `${navigators("people")}/reports`, BODY);
    const payload = await exported();
    expect(lensOf(payload, "people").assistants.navigators).toEqual([
      { key: "reports", name: "Reports", description: "Who works on what.", configVersion: 1, config: { ...DEFAULTS, ...BODY.config } },
    ]);
    expect(lensOf(payload, "all").assistants).toEqual({ agents: [], retrievers: [], navigators: [] });
  });

  it("import round-trips them, an invalid one included, and they read as before", async () => {
    const { manages } = await schema();
    await ok("PUT", `${navigators("people")}/reports`, BODY);
    await ok("PUT", `${navigators("all")}/walker`, { ...BODY, name: "Walker", config: { relationTypes: ["manages"] } });
    await ok("DELETE", `${MODEL}/relation-types/${manages.relationTypeId}?cascade=true`);
    const payload = await exported();

    await post("/api/ontologies", { key: "copy" });
    const res = await request("POST", "/api/ontologies/copy/model/import", payload);
    expect(res.statusCode, res.body).toBe(201);
    expect(await exported("copy")).toEqual(payload);
    // Import checks shape, not references: the invalid one came along and says so.
    expect((await ok("GET", `${navigators("all", "copy")}/walker`)).validation.valid).toBe(false);
    expect((await ok("GET", `${navigators("people", "copy")}/reports`)).validation.valid).toBe(false);
  });

  it("import refuses bad keys, names and configurations with every message, writing nothing", async () => {
    await schema();
    const payload = await exported();
    lensOf(payload, "people").assistants.navigators = [
      { key: "reports", name: "Reports", description: null, configVersion: 1, config: {} },
      { key: "reports", name: "Again", description: null, configVersion: 1, config: {} },
      { key: "Bad", name: "Bad", description: null, configVersion: 1, config: {} },
      { key: "_default", name: "Default", description: null, configVersion: 1, config: {} },
      { key: "old", name: "Old", description: null, configVersion: 2, config: {} },
      { key: "far", name: "Far", description: null, configVersion: 1, config: { hops: 9 } },
      { key: "nameless", name: "", description: null, configVersion: 1, config: {} },
    ];
    await post("/api/ontologies", { key: "copy" });
    const res = await request("POST", "/api/ontologies/copy/model/import", payload);
    expect(res.statusCode).toBe(422);
    const errors = res.json().error.details.errors as string[];
    expect(errors).toEqual(expect.arrayContaining([
      "Import error: duplicate navigator 'reports' in lens 'people'",
      expect.stringMatching(/^Import error: invalid navigator key 'Bad'/),
      expect.stringMatching(/^Import error: invalid navigator key '_default'/),
      "Import error: navigator 'old' has no valid configuration of version 1",
      "Import error: navigator 'far' has no valid configuration of version 1",
      "Import error: navigator 'nameless' needs a name of 1 to 200 characters",
    ]));
    expect((await exported("copy")).lenses).toEqual([]);
  });

  it("a payload without navigators still imports", async () => {
    await schema();
    await ok("PUT", `${navigators("people")}/reports`, BODY);
    const payload = await exported();
    for (const lens of payload.lenses as Row[]) delete lens.assistants.navigators;
    delete lensOf(payload, "all").assistants;
    await post("/api/ontologies", { key: "copy" });
    const res = await request("POST", "/api/ontologies/copy/model/import", payload);
    expect(res.statusCode, res.body).toBe(201);
    expect(await ok("GET", navigators("people", "copy"))).toEqual([]);
    expect(lensOf(await exported("copy"), "all").assistants.navigators).toEqual([]);
  });
});
