/**
 * The runtime HTTP contract of named searches (`GET named-searches`,
 * `POST named-searches/{key}/run`), run with and without local
 * embeddings: the listing; a run answering exactly as the entity and the
 * passage search with the same tree; the run's `filter`; the refusals —
 * an unknown key, an unknown body field, a lens narrowed after the save;
 * a tree of several texts naming the text of each match; a semantic node
 * without a provider as a limitation; the same through MCP.
 *
 * person (status, bio) —works_for→ company (city). Ada's bio names the
 * engine, Bob's the garden and the engine; Ada is active, Bob retired.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { disableProvider, enableOllamaProvider } from "./embedding/support.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const O = "named_run";
const MODEL = `/api/ontologies/${O}/model`;
const runtimeOf = (lens: string) => `/api/ontologies/${O}/runtime/lenses/${lens}`;
const RUNTIME = runtimeOf("all");

const kw = (index: string, text: string, parts?: string[]) => ({
  kind: "keywordSearch",
  index,
  text,
  ...(parts === undefined ? {} : { parts }),
});
const sem = (index: string, text: string) => ({ kind: "semanticSearch", index, text });
const group = (input: object, key = "entity") => ({ kind: "group", key, input });
const fuse = (...inputs: object[]) => ({ kind: "fuse", inputs });
const cut = (input: object, limit = 10) => ({ kind: "cut", input, limit });

export function namedSearchRunContract(embedding: boolean, enabled = true) {
  let app: FastifyInstance;
  let baseUrl: string;
  const ids: Record<string, string> = {};

  async function inject(method: "GET" | "POST" | "PUT", url: string, payload?: object) {
    const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    return { status: res.statusCode, body: res.body === "" ? null : (res.json() as Row) };
  }

  async function post(url: string, payload: object): Promise<Row> {
    const res = await inject("POST", url, payload);
    expect(res.status, `POST ${url}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    return res.body!;
  }

  async function save(key: string, tree: object, lens = "all"): Promise<void> {
    const res = await inject("PUT", `${MODEL}/lenses/${lens}/named-searches/${key}`, {
      name: key,
      description: `About ${key}`,
      tree,
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  }

  async function run(key: string, body: object, lens = "all") {
    await drainSearchWork({ ontologyKey: O });
    return inject("POST", `${runtimeOf(lens)}/named-searches/${key}/run`, body);
  }

  async function ran(key: string, body: object, lens = "all"): Promise<Row> {
    const res = await run(key, body, lens);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body!;
  }

  describe.skipIf(!enabled)(`named search run contract (${embedding ? "Ollama" : "no provider"})`, () => {
    beforeAll(async () => {
      await initStores();
      await wipeDatabase();
      if (embedding) enableOllamaProvider();
      app = await createApp();
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      if (address === null || typeof address === "string") throw new Error("Expected a bound TCP port");
      baseUrl = `http://127.0.0.1:${address.port}`;

      await post("/api/ontologies", { key: O });
      await post(`${MODEL}/lenses`, { key: "all", name: "All" });
      const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
      ids.person = person.entityTypeId;
      for (const [key, dataType] of [["status", "string"], ["bio", "document"]] as const) {
        await post(`${MODEL}/entity-types/${person.entityTypeId}/properties`, { key, displayName: key, dataType });
      }
      const company = await post(`${MODEL}/entity-types`, { key: "company", displayName: "Company" });
      await post(`${MODEL}/entity-types/${company.entityTypeId}/properties`, {
        key: "city",
        displayName: "City",
        dataType: "string",
      });
      ids.ada = (
        await post(`${RUNTIME}/entities/person`, {
          name: "Ada",
          status: "active",
          bio: "Ada wrote the first program for the analytical engine.",
        })
      )._id;
      ids.bob = (
        await post(`${RUNTIME}/entities/person`, {
          name: "Bob",
          status: "retired",
          bio: "Bob grows tomatoes in his garden and repairs an old engine.",
        })
      )._id;
      ids.acme = (await post(`${RUNTIME}/entities/company`, { name: "Engine Works", city: "Berlin" }))._id;

      // A lens showing person only — saved first, then narrowed below.
      const lens = await post(`${MODEL}/lenses`, { key: "narrow", name: "Narrow" });
      ids.narrow = lens.lensId;
      await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "person", properties: null });
      await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "company", properties: null });
      for (const key of ["person~default", "company~default"]) {
        await post(`${MODEL}/lenses/${lens.lensId}/includes/search-indices`, { key });
      }
      await save("both", cut(fuse(group(kw("person~default", "$query")), group(kw("company~default", "$query")))), "narrow");

      await save("people", cut(group(kw("person~default", "$query"))));
      // No parts: below a passage group, passage entries only.
      await save("bios", cut(group(kw("person~bio", "$query"), "passage")));
      await save("own-fields", cut(group(kw("person~default", "$query"), "passage")));
      await save(
        "everyone",
        cut(fuse(group(kw("person~default", "$query")), group(kw("company~default", "$query")))),
      );
      await save(
        "two-texts",
        cut(fuse(group(kw("person~bio", "$query")), group(kw("person~bio", "$query tomatoes"))), 10),
      );
      await save(
        "passage-texts",
        cut(
          fuse(
            group(kw("person~bio", "$query", ["passage"]), "passage"),
            group(kw("person~bio", "tomatoes", ["passage"]), "passage"),
          ),
        ),
      );
      await save("hybrid", cut(fuse(group(sem("person~default", "$query")), group(kw("person~default", "$query")))));
      invalidateLoadedSchemaCache();
    });

    afterAll(async () => {
      if (embedding) disableProvider();
      await wipeDatabase();
      await app.close();
      await closeStores();
    });

    it("lists by key: name, description, result and the types searched; no tree", async () => {
      const listed = await inject("GET", `${RUNTIME}/named-searches`);
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual([
        { key: "bios", name: "bios", description: "About bios", result: "passages", types: ["person"] },
        { key: "everyone", name: "everyone", description: "About everyone", result: "entities", types: ["company", "person"] },
        { key: "hybrid", name: "hybrid", description: "About hybrid", result: "entities", types: ["person"] },
        { key: "own-fields", name: "own-fields", description: "About own-fields", result: "passages", types: ["person"] },
        { key: "passage-texts", name: "passage-texts", description: "About passage-texts", result: "passages", types: ["person"] },
        { key: "people", name: "people", description: "About people", result: "entities", types: ["person"] },
        { key: "two-texts", name: "two-texts", description: "About two-texts", result: "entities", types: ["person"] },
      ]);
    });

    it("a run answers exactly as the entity search, and the passage search, with the same tree", async () => {
      await drainSearchWork({ ontologyKey: O });
      const entities = await inject("POST", `${RUNTIME}/search/entities`, {
        query: "ada",
        indices: ["person~default"],
        keyword: {},
      });
      expect(entities.status).toBe(200);
      const named = await ran("people", { query: "ada" });
      expect(named.items.map((item: Row) => item.entity._id)).toEqual([ids.ada]);
      expect(named).toEqual(entities.body);

      const passages = await inject("POST", `${RUNTIME}/search/passages`, {
        query: "engine",
        indices: ["person~bio"],
        keyword: {},
      });
      const namedPassages = await ran("bios", { query: "engine" });
      expect(namedPassages.items).toHaveLength(2);
      expect(namedPassages.items[0].passage.text).toContain("engine");
      expect(namedPassages).toEqual(passages.body);
      // Over an index of own fields, a passage search counts no entry.
      expect((await ran("own-fields", { query: "ada" })).items).toEqual([]);
    });

    it("filter restricts the types that resolve every key; others drop out; a key none resolves is refused", async () => {
      const all = await ran("everyone", { query: "engine" });
      expect(all.items.map((item: Row) => item.entity._id)).toEqual([ids.acme]);
      expect((await ran("everyone", { query: "ada" })).items.map((item: Row) => item.entity._id)).toEqual([ids.ada]);

      // status is person's only: company drops out, Bob does not hold it.
      expect((await ran("everyone", { query: "engine", filter: { status: "active" } })).items).toEqual([]);
      const active = await ran("everyone", { query: "ada", filter: { status: "active" } });
      expect(active.items.map((item: Row) => item.entity._id)).toEqual([ids.ada]);
      expect((await ran("everyone", { query: "ada", filter: { status: "retired" } })).items).toEqual([]);

      const refused = await run("everyone", { query: "ada", filter: { nope: "1" } });
      expect(refused.status).toBe(422);
      expect(refused.body!.error.details.fields).toEqual({ "filter.nope": expect.stringContaining("nope") });

      const none = await ran("everyone", { query: "ada", filter: { status: "active", city: "Berlin" } });
      expect(none).toEqual({
        ran: [],
        items: [],
        limitations: [
          {
            code: "filter-excludes-all-types",
            message: "No searched entity type declares every filter key",
            types: ["company", "person"],
          },
        ],
      });
    });

    it("refuses an unknown key, an empty query and an unknown body field", async () => {
      const unknown = await run("ghost", { query: "x" });
      expect(unknown.status).toBe(404);
      expect(unknown.body!.error.message).toBe("Named search 'ghost' not found");
      const empty = await run("people", { query: " " });
      expect(empty.status).toBe(422);
      expect(empty.body!.error.details.fields).toEqual({ query: "Required non-empty query" });
      expect((await run("people", { query: "x", limit: 3 })).status).toBe(422);
      expect((await run("people", {})).status).toBe(422);
    });

    it("a lens narrowed after the save refuses the run, naming the search and the path", async () => {
      expect((await ran("both", { query: "engine" }, "narrow")).items).toHaveLength(1);
      const removed = await app.inject({
        method: "DELETE",
        url: `${MODEL}/lenses/${ids.narrow}/includes/search-indices/company~default`,
      });
      expect(removed.statusCode, removed.body).toBeLessThan(300);
      const res = await run("both", { query: "engine" }, "narrow");
      expect(res.status).toBe(422);
      expect(res.body!.error.message).toBe("Named search 'both' validation failed");
      expect(res.body!.error.details.errors).toEqual([
        "tree.input.inputs.1.input.index: Search index 'company~default' is not searchable in this lens",
      ]);
      // Listed still, with the types it can search.
      const listed = (await inject("GET", `${runtimeOf("narrow")}/named-searches`)).body as Row[];
      expect(listed).toEqual([
        { key: "both", name: "both", description: "About both", result: "entities", types: ["person"] },
      ]);
    });

    it("a lens that hides the document of a passage search's index, the index still included, refuses the run and the save", async () => {
      const lens = await post(`${MODEL}/lenses`, { key: "nobio", name: "No bio" });
      await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "person", properties: null });
      await post(`${MODEL}/lenses/${lens.lensId}/includes/search-indices`, { key: "person~bio" });
      const tree = cut(group(kw("person~bio", "$query"), "passage"));
      await save("bios", tree, "nobio");
      expect((await ran("bios", { query: "engine" }, "nobio")).items).toHaveLength(2);

      // Hiding the document keeps the index inclusion: a lens warning, not an error.
      const narrowed = await app.inject({
        method: "PUT",
        url: `${MODEL}/lenses/${lens.lensId}/includes/entity-types/${ids.person}`,
        payload: { properties: ["name", "status"] },
      });
      expect(narrowed.statusCode, narrowed.body).toBe(200);
      invalidateLoadedSchemaCache();
      const error = "tree.input.input.index: Search index 'person~bio' reads no document this lens shows";
      const res = await run("bios", { query: "engine" }, "nobio");
      expect(res.status).toBe(422);
      expect(res.body!.error.message).toBe("Named search 'bios' validation failed");
      expect(res.body!.error.details.errors).toEqual([error]);
      const saved = await inject("PUT", `${MODEL}/lenses/nobio/named-searches/bios`, {
        name: "bios",
        description: "About bios",
        tree,
      });
      expect(saved.status).toBe(422);
      expect(saved.body!.error.details.errors).toEqual([error]);
    });

    it("a tree of several texts names the text each match came from", async () => {
      const entities = await ran("two-texts", { query: "analytical" });
      const texts = Object.fromEntries(entities.items.map((item: Row) => [item.entity._id, item.match.queryText]));
      // Only Ada's bio holds "analytical"; Bob is found by "tomatoes" alone.
      expect(texts).toEqual({ [ids.ada]: "analytical", [ids.bob]: "analytical tomatoes" });

      const passages = await ran("passage-texts", { query: "analytical" });
      expect(passages.items.map((item: Row) => [item.entity._id, item.passage.queryText])).toEqual([
        [ids.ada, "analytical"],
        [ids.bob, "tomatoes"],
      ]);
      // One text: no queryText.
      const single = await ran("people", { query: "bob" });
      expect(Object.keys(single.items[0].match)).not.toContain("queryText");
    });

    it("a semantic node runs where a provider is, and is a limitation where none is", async () => {
      const hybrid = await ran("hybrid", { query: "ada" });
      expect(hybrid.items.map((item: Row) => item.entity._id)).toContain(ids.ada);
      if (embedding) {
        expect(hybrid.ran).toEqual(["semantic", "keyword"]);
        expect(hybrid.limitations).toEqual([]);
      } else {
        expect(hybrid.ran).toEqual(["keyword"]);
        expect(hybrid.limitations).toEqual([
          {
            code: "no-provider",
            message: "Semantic search needs an embedding provider; none is installed",
            method: "semantic",
            indices: ["person~default"],
          },
        ]);
      }
    });

    it("MCP lists and runs them, read-only", async () => {
      const client = new Client({ name: "named-search-run-tests", version: "0.0.1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ontologies/${O}/runtime/lenses/all`)),
      );
      type Result = { content: { text: string }[]; isError?: boolean };
      const call = async (name: string, args: Row) =>
        (await client.callTool({ name, arguments: args })) as unknown as Result;
      try {
        const listed = await call("list_named_searches", {});
        expect(listed.isError).toBeFalsy();
        expect((JSON.parse(listed.content[0]!.text) as Row[]).map((ns) => ns.key)).toContain("people");

        await drainSearchWork({ ontologyKey: O });
        const result = await call("run_named_search", { key: "everyone", query: "ada", filters: { status: "active" } });
        expect(result.isError, result.content[0]!.text).toBeFalsy();
        expect(JSON.parse(result.content[0]!.text)).toEqual(
          (await ran("everyone", { query: "ada", filter: { status: "active" } })),
        );
        const unknown = await call("run_named_search", { key: "ghost", query: "x" });
        expect(unknown.isError).toBe(true);
        expect(unknown.content[0]!.text).toContain("Named search 'ghost' not found");
      } finally {
        await client.close();
      }
    });
  });
}
