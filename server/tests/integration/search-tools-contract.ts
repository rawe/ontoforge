/**
 * The MCP search tools against the database, with and without local
 * embeddings: `search` answers exactly as the entity search and
 * `search_documents` as the passage search, run with the tools' method
 * blocks (both, semantic under the fixed floor, with a provider; none
 * without one); items and their places, filters, the lens's scope,
 * refusals, keyword matching and the indices following the schema and
 * the data. Search answers from search indices, whose entries the worker
 * builds asynchronously: every search first drains the queued work. An
 * in-memory client calls the tools.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { initStores, closeStores } from "../../src/core/ports.js";
import { getEmbeddingProvider, setEmbeddingProvider } from "../../src/core/embedding.js";
import { runQuery } from "../../src/adapters/postgres/errors.js";
import { createRuntimeMcpServer } from "../../src/mcp/runtime.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { TOOL_MIN_SIMILARITY } from "../../src/runtime/search/tools.js";
import { wipeDatabase } from "./reset.js";
import { enableOllamaProvider, disableProvider } from "./embedding/support.js";

/** An item's entity and match on PostgreSQL: the best entry of one of the
 * searched default or passage indices. */
function expectMatch(item: Record<string, any>) {
  expect(Object.keys(item).sort()).toEqual(["entity", "match", "rank"]);
  expect(Object.keys(item.entity).sort()).toEqual(["_entityTypeKey", "_id", "name"]);
  const { match } = item;
  const type = item.entity._entityTypeKey;
  expect(match.snippet.length).toBeGreaterThan(0);
  expect(Array.from(match.snippet as string).length).toBeLessThanOrEqual(200);
  if (match.part === "self") {
    expect(Object.keys(match).sort()).toEqual(["index", "part", "snippet"]);
    expect(match.index).toBe(`${type}~default`);
  } else {
    expect(Object.keys(match).sort()).toEqual(["charLength", "charOffset", "index", "part", "property", "snippet"]);
    expect(match.part).toBe("passage");
    expect(match.index).toBe(`${type}~${match.property}`);
  }
}

export function searchToolsContract(embedding: boolean, enabled = true) {
  // The methods the tools run: both with an embedding provider, keyword without.
  const ran = embedding ? ["semantic", "keyword"] : ["keyword"];
  const base = "/api/ontologies/search_test";
  const model = `${base}/model`;
  const runtime = `${base}/runtime/lenses/all`;
  let app: FastifyInstance;
  let paperId: string;
  let reportId: string;
  let best: Record<string, any>;
  let second: Record<string, any>;
  async function post(url: string, payload: object) {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }
  /** One tool call through the lens, after the worker built what is queued. */
  async function call(name: string, args: Record<string, unknown>, lens = "all") {
    await drainSearchWork();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createRuntimeMcpServer("search_test", lens).connect(serverTransport);
    const client = new Client({ name: "search-tools-contract", version: "0.0.1" });
    await client.connect(clientTransport);
    try {
      const result = (await client.callTool({ name, arguments: args })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      return { isError: result.isError === true, text: result.content[0]!.text };
    } finally {
      await client.close();
    }
  }
  /** A tool's answer; the call must succeed. */
  async function find(args: Record<string, unknown>, tool = "search", lens = "all") {
    const result = await call(tool, args, lens);
    expect(result.isError, result.text).toBe(false);
    return JSON.parse(result.text);
  }
  /** The ids of a tool's items, in rank order. */
  async function ids(args: Record<string, unknown>, tool = "search", lens = "all"): Promise<string[]> {
    return (await find(args, tool, lens)).items.map((item: any) => item.entity._id);
  }
  /** A search route's answer. */
  async function route(path: "entities" | "passages", body: object) {
    await drainSearchWork();
    const res = await app.inject({ method: "POST", url: `${runtime}/search/${path}`, payload: body });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }
  /** A tool's refusal; the call must fail. */
  async function refusal(args: Record<string, unknown>, tool = "search") {
    const result = await call(tool, args);
    expect(result.isError, result.text).toBe(true);
    return result.text;
  }
  describe.skipIf(!enabled)(`search tools contract (${embedding ? "Ollama" : "no provider"})`, () => {
    beforeAll(async () => {
      await initStores();
      if (embedding) enableOllamaProvider();
      app = await createApp();
      await app.ready();
    });
    afterAll(async () => {
      if (embedding) disableProvider();
      await wipeDatabase();
      await app.close();
      await closeStores();
    });
    beforeEach(async () => {
      await wipeDatabase();
      invalidateLoadedSchemaCache();
      await post("/api/ontologies", { key: "search_test" });
      await post(`${model}/lenses`, { key: "all", name: "All" });
      for (const [key, props] of Object.entries({
        paper: { title: "string", year: "integer", body: "document", appendix: "document" },
        report: { title: "string", year: "integer", body: "document" },
        company: { title: "string" },
      })) {
        const type = await post(`${model}/entity-types`, { key, displayName: key });
        if (key === "paper") paperId = type.entityTypeId;
        if (key === "report") reportId = type.entityTypeId;
        for (const [key, dataType] of Object.entries(props))
          await post(`${model}/entity-types/${type.entityTypeId}/properties`, {
            key,
            displayName: key,
            dataType,
          });
      }
      best = await post(`${runtime}/entities/paper`, {
        title: "Graph database database",
        year: 2024,
        body: "Graph databases store relationships and support graph queries.",
        appendix: "A graph database indexes relationships and graph nodes.",
      });
      second = await post(`${runtime}/entities/report`, {
        title: "Graph database survey",
        year: 2020,
        body: "A database stores graphs of connected data.",
      });
      await post(`${runtime}/entities/company`, { title: "Graph database consulting" });
      await post(`${runtime}/entities/paper`, {
        title: "Cooking cakes",
        year: 1990,
        body: "Butter and flour for baking cakes.",
      });
    });
    it("runs what can run: both methods with an embedding provider, keyword alone without", async () => {
      expect((await app.inject({ url: "/api/server/features" })).json()).toEqual({
        semanticSearch: embedding,
        rankedSearch: true,
        ai: false,
        decisions: false,
      });
      expect((await find({ query: "graph" })).ran).toEqual(ran);
      expect((await find({ query: "graph" }, "search_documents")).ran).toEqual(ran);
    });
    it("each tool answers exactly as its route with the tools' method blocks", async () => {
      // With a provider both blocks, semantic under the fixed floor; without one none.
      const blocks = embedding ? { semantic: { minSimilarity: TOOL_MIN_SIMILARITY }, keyword: {} } : {};
      const body = { query: "graph database", filter: { year__gte: "2020" }, limit: 3 };
      const args = { query: body.query, filters: body.filter, limit: body.limit };
      expect(await find(args)).toEqual(await route("entities", { ...body, ...blocks }));
      expect(await find({ ...args, per_entity: 1 }, "search_documents")).toEqual(
        await route("passages", { ...body, perEntity: 1, ...blocks }),
      );
    });
    it("search returns ranked entities with the entry that found each", async () => {
      const body = await find({ query: "graph database", limit: 2 });
      expect(Object.keys(body).sort()).toEqual(["items", "limitations", "ran"]);
      expect(body.items.map((item: any) => item.rank)).toEqual([1, 2]);
      for (const item of body.items) expectMatch(item);
      expect(new Set(body.items.map((item: any) => item.entity._id)).size).toBe(2);
    });
    it("search_documents returns passages whose place reads the passage text", async () => {
      const body = await find({ query: "graph database", limit: 10 }, "search_documents");
      const passages = body.items.filter((item: any) => item.entity._id === best._id);
      expect(new Set(passages.map((item: any) => item.passage.property))).toEqual(new Set(["body", "appendix"]));
      for (const { passage } of passages) {
        const read = await app.inject({
          url: `${runtime}/entities/paper/${best._id}/documents/${passage.property}?offset=${passage.charOffset}&limit=${passage.charLength}`,
        });
        expect(read.statusCode, read.body).toBe(200);
        expect(Array.from(read.json().content).length).toBe(passage.charLength);
        expect(read.json().content).toBe(passage.text);
      }
      // text false: the places only.
      const places = await find({ query: "graph database", text: false }, "search_documents");
      expect(places.items.length).toBeGreaterThan(0);
      for (const item of places.items) expect(Object.keys(item.passage).sort()).toEqual(["charLength", "charOffset", "ordinal", "property"]);
    });
    it("filters narrow types and apply within both rankings", async () => {
      const found = await ids({ query: "graph database", filters: { year__gte: "2020" }, limit: 2 });
      expect(new Set(found)).toEqual(new Set([best._id, second._id]));
    });
    it("search_documents' documents restrict the documents", async () => {
      const result = await find({ query: "graph database", documents: ["paper.appendix"], limit: 10 }, "search_documents");
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item: any) => item.entity._entityTypeKey === "paper" && item.passage.property === "appendix")).toBe(true);
    });
    it("fills a cross-type page from a narrow lens", async () => {
      const lens = await post(`${model}/lenses`, { key: "narrow", name: "Narrow" });
      for (const key of ["paper", "report"])
        await post(`${model}/lenses/${lens.lensId}/includes/entity-types`, { key });
      await post(`${runtime}/entities/paper`, { title: "Graph databases in practice", year: 2025 });
      for (let i = 0; i < 12; i++) await post(`${runtime}/entities/company`, { title: `Graph database ${i}` });
      // A scoped lens searches the indices it includes; including a type
      // afterwards does not include its indices.
      expect((await find({ query: "graph database" }, "search", "narrow")).items).toEqual([]);
      await runQuery(
        `INSERT INTO ont_search_test.lens_includes (lens_id, search_index_id)
         SELECT $1, search_index_id FROM ont_search_test.search_index
         WHERE key IN ('paper~default', 'report~default')`,
        [lens.lensId],
      );
      invalidateLoadedSchemaCache();
      const items = (await find({ query: "graph database", limit: 3 }, "search", "narrow")).items;
      expect(items).toHaveLength(3);
      expect(items.every((item: any) => item.entity._entityTypeKey !== "company")).toBe(true);
    });
    it("query-path filters run inside property and document rankings", async () => {
      await post(`${model}/relation-types`, {
        key: "published_by",
        displayName: "Published by",
        sourceEntityTypeKey: "paper",
        targetEntityTypeKey: "company",
      });
      const publisher = await post(`${runtime}/entities/company`, { title: "Acme" });
      await post(`${runtime}/relations/published_by`, { fromEntityId: best._id, toEntityId: publisher._id });
      const filters = { year__gte: "2020", "published_by.title": "Acme" };
      expect(await ids({ query: "graph database", filters, limit: 1 })).toEqual([best._id]);
      expect(new Set(await ids({ query: "graph database", filters }, "search_documents"))).toEqual(new Set([best._id]));
      // Relation existence: the papers and companies (the types
      // published_by touches) with no such relation.
      const missing = await ids({ query: "graph database", filters: { published_by__missing: "true" } });
      expect(missing).not.toContain(best._id);
      expect(missing).not.toContain(second._id);
      expect(missing.length).toBeGreaterThan(0);
    });
    it("existence and negation filters narrow the searched types", async () => {
      // `year` is declared on papers and reports, both of which carry it.
      const present = (await find({ query: "graph database", filters: { year__exists: "true" } })).items;
      const found = present.map((item: any) => item.entity._id);
      expect(found).toContain(best._id);
      expect(found).toContain(second._id);
      for (const item of present) expect(["paper", "report"]).toContain(item.entity._entityTypeKey);
      expect((await find({ query: "graph database", filters: { year__missing: "true" } })).items).toEqual([]);
      const rest = await ids({ query: "graph database", filters: { year__ne: "2024" } });
      expect(rest).not.toContain(best._id);
      expect(rest).toContain(second._id);
      const bad = await refusal({ query: "graph", filters: { year__exists: "maybe", title__ne: "x" } });
      expect(bad).toContain("filter.year__exists");
      expect(bad).not.toContain("title__ne");
    });
    it("a deleted string property stops matching once the default index is rebuilt", async () => {
      // The default index follows the schema: deleting a string property
      // changes its definition, and the new generation, built in the
      // background, no longer holds the value. The entity itself keeps it.
      const property = await post(`${model}/entity-types/${paperId}/properties`, {
        key: "notes",
        displayName: "notes",
        dataType: "string",
      });
      const entity = await post(`${runtime}/entities/paper`, {
        title: "Field notes",
        notes: "Reticulated splines",
        year: 2021,
      });
      // The items whose indexed text carries the word.
      const carrying = async (word: string) =>
        (await find({ query: word, types: ["paper"] })).items.filter((item: any) =>
          String(item.match.snippet).toLowerCase().includes(word),
        );

      const indexed = await carrying("reticulated");
      expect(indexed.map((item: any) => item.entity._id)).toEqual([entity._id]);
      expect(indexed[0].match).toMatchObject({ index: "paper~default", part: "self" });

      const deleted = await app.inject({
        method: "DELETE",
        url: `${model}/entity-types/${paperId}/properties/${property.propertyId}?cascade=true`,
      });
      expect(deleted.statusCode, deleted.body).toBe(204);

      expect(await carrying("reticulated")).toEqual([]);
      expect((await carrying("field")).map((item: any) => item.entity._id)).toContain(entity._id);
    });
    it.skipIf(!embedding)(
      "property text and documents written without a provider become searchable semantically",
      async () => {
        const provider = getEmbeddingProvider();
        setEmbeddingProvider(null);
        let entity: Record<string, any>;
        try {
          entity = await post(`${runtime}/entities/paper`, {
            title: "Astronomy archives",
            body: "Telescopes discover distant planets.",
            appendix: "Astronomers measure planetary orbits.",
          });
        } finally {
          setEmbeddingProvider(provider);
        }
        // Entries are built by the worker, not by the write: an entity written
        // while no provider answered is embedded once one does.
        const own = await route("entities", { query: "astronomy", indices: ["paper~default"], semantic: {} });
        expect(own.items.map((item: any) => item.entity._id)).toContain(entity!._id);
        const passages = await route("passages", { query: "astronomy", types: ["paper"], semantic: {} });
        expect(
          new Set(passages.items.filter((item: any) => item.entity._id === entity!._id).map((item: any) => item.passage.property)),
        ).toEqual(new Set(["body", "appendix"]));
      },
    );
    it("collects invalid request dimensions and filters before ranking", async () => {
      const refused = await refusal(
        { query: "graph", documents: ["paper.missing"], filters: { ghost: "1", year: "bad", title__contains: "graph" } },
        "search_documents",
      );
      for (const field of ["documents.0", "filter.ghost", "filter.year", "filter.title__contains"]) {
        expect(refused).toContain(`${field}:`);
      }
      // A property that is no document.
      expect(await refusal({ query: "graph", documents: ["paper.title"] }, "search_documents")).toContain("is not a document");
      // A type with no document to search is a limitation.
      expect((await find({ query: "graph", types: ["company"] }, "search_documents")).limitations).toEqual([
        expect.objectContaining({ code: "not-searchable", types: ["company"] }),
      ]);
    });
    it("rejects conflicting cross-type filter data types", async () => {
      await post(`${model}/entity-types/${reportId}/properties`, {
        key: "status",
        displayName: "Status",
        dataType: "integer",
      });
      await post(`${model}/entity-types/${paperId}/properties`, {
        key: "status",
        displayName: "Status",
        dataType: "string",
      });
      expect(await refusal({ query: "graph", filters: { status: "1" } })).toContain("Conflicting data types");
    });
    it("keyword matching takes any query term, each also as a prefix", async () => {
      // Only the company title carries both terms; the paper and report titles carry
      // "database" alone. Any-term keyword matching keeps them.
      const [company] = await ids({ query: "consulting", types: ["company"] });
      expect(await ids({ query: "database consulting" })).toEqual(expect.arrayContaining([best._id, company, second._id]));
      expect((await find({ query: "graph cakes" })).items.length).toBeGreaterThan(0);
      // "surv" continues into "survey".
      expect(await ids({ query: "surv" })).toContain(second._id);
    });
    it("keyword matching never exposes query syntax", async () => {
      await find({ query: `graph & database | ! ' words` });
      expect(await ids({ query: `"graph" & (database)` })).toContain(best._id);
    });
    it("keeps literal terms on entity lists, including document exclusion", async () => {
      const res = await app.inject({ url: `${runtime}/entities/paper?q=datab` });
      expect(res.json().items.map((e: any) => e._id)).toEqual([best._id]);
      expect((await app.inject({ url: `${runtime}/entities/paper?q=relationships` })).json().items).toHaveLength(0);
    });
    it("stems in the ontology language and maintains text/chunks without a provider", async () => {
      const provider = getEmbeddingProvider();
      setEmbeddingProvider(null);
      try {
        const entity = await post(`${runtime}/entities/paper`, {
          title: "Astronomers observe planets",
          body: "Telescopes discover planets.",
        });
        expect(await ids({ query: "planet" })).toContain(entity._id);
        expect(await ids({ query: "telescope" }, "search_documents")).toContain(entity._id);
        const update = await app.inject({
          method: "PATCH",
          url: `${runtime}/entities/paper/${entity._id}`,
          payload: { title: "Marine biologists", body: "Corals grow in oceans." },
        });
        expect(update.statusCode, update.body).toBe(200);
        expect(await ids({ query: "planet" })).toHaveLength(0);
        expect(await ids({ query: "coral" }, "search_documents")).toContain(entity._id);
      } finally {
        setEmbeddingProvider(provider);
      }
    });
  });
}
