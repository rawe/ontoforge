/**
 * The default search as the MCP tools run it — `search` over properties
 * and documents, `search_documents` over documents only — with and without
 * local embeddings: the default strategy, the tools' fixed similarity
 * floor, the envelope, filters, projection and the lens's scope. Search
 * answers from search indices, whose entries the worker builds
 * asynchronously: every search first drains the queued work. An in-memory
 * client calls the tools.
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
import { TOOL_MIN_SIMILARITY } from "../../src/runtime/search/strategies.js";
import { wipeDatabase } from "./reset.js";
import { enableOllamaProvider, disableProvider } from "./embedding/support.js";

function expectEvidence(match: Record<string, any>, strategy: string) {
  expect(Object.keys(match).sort()).toEqual(
    match.kind === "properties"
      ? ["evidence", "kind"]
      : ["charLength", "charOffset", "evidence", "kind", "propertyKey"],
  );
  const evidence = match.evidence;
  // No property attribution: a match carries measurements only.
  expect(Object.keys(evidence).sort()).toEqual(["keywordMatch", "keywordScore", "semanticSimilarity"]);
  if (evidence.semanticSimilarity !== null) {
    expect(Number.isFinite(evidence.semanticSimilarity)).toBe(true);
    expect(evidence.semanticSimilarity).toBeGreaterThanOrEqual(0);
    expect(evidence.semanticSimilarity).toBeLessThanOrEqual(1);
  }
  expect([true, null]).toContain(evidence.keywordMatch);
  // The keyword score is present exactly when the unit matched; it has no fixed upper
  // bound, so only finiteness and positivity are contractual.
  if (evidence.keywordMatch === true) {
    expect(Number.isFinite(evidence.keywordScore)).toBe(true);
    expect(evidence.keywordScore).toBeGreaterThan(0);
  } else expect(evidence.keywordScore).toBeNull();
  if (strategy === "keyword") {
    expect(evidence.semanticSimilarity).toBeNull();
    expect(evidence.keywordMatch).toBe(true);
  } else {
    // A hybrid unit can be absent from either limited source ranking, but not both.
    expect(evidence.semanticSimilarity !== null || evidence.keywordMatch === true).toBe(true);
  }
}

/** What matched a hit on PostgreSQL: the best entry of one of the searched
 * default or passage indices. */
function expectMatched(hit: Record<string, any>) {
  const matched = hit.matched;
  expect(Object.keys(matched).sort()).toEqual(
    ["charLength", "charOffset", "index", "partKind", "relationId", "relationType", "snippet", "target"].sort(),
  );
  const type = hit.entity._entityTypeKey;
  expect(matched).toMatchObject({ relationType: null, relationId: null, target: null });
  expect(matched.snippet.length).toBeGreaterThan(0);
  expect(Array.from(matched.snippet as string).length).toBeLessThanOrEqual(200);
  if (matched.partKind === "self") {
    expect(matched.index).toBe(`${type}~default`);
    expect(matched).toMatchObject({ charOffset: null, charLength: null });
    expect(hit.matches.some((m: any) => m.kind === "properties")).toBe(true);
  } else {
    expect(matched.partKind).toBe("passage");
    const property = matched.index.slice(`${type}~`.length);
    expect(
      hit.matches.some(
        (m: any) => m.kind === "document" && m.propertyKey === property && m.charOffset === matched.charOffset,
      ),
    ).toBe(true);
  }
}

export function defaultSearchContract(embedding: boolean, enabled = true) {
  // The default strategy: hybrid with an embedding provider, keyword without.
  const strategy = embedding ? "hybrid" : "keyword";
  const floor = embedding ? TOOL_MIN_SIMILARITY : null;
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
    const client = new Client({ name: "default-search-contract", version: "0.0.1" });
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
  /** A tool's refusal; the call must fail. */
  async function refusal(args: Record<string, unknown>, tool = "search") {
    const result = await call(tool, args);
    expect(result.isError, result.text).toBe(true);
    return result.text;
  }
  describe.skipIf(!enabled)(`default search contract (${embedding ? "Ollama" : "no provider"})`, () => {
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
    it("runs the default strategy under the fixed floor", async () => {
      expect((await app.inject({ url: "/api/server/features" })).json()).toEqual({
        semanticSearch: embedding,
        ai: false,
        decisions: false,
        searchStrategies: embedding
          ? ["hybrid", "keyword", "keyword-any", "keyword-all", "semantic"]
          : ["keyword", "keyword-any", "keyword-all"],
      });
      const result = await find({ query: "graph" });
      expect(result.strategy).toBe(strategy);
      expect(result.minSimilarity).toBe(floor);
    });
    for (const tool of ["search", "search_documents"])
      it(`${tool} returns ranked entities, bounded scores and matching places`, async () => {
        const body = await find({ query: "graph database", limit: 2 }, tool);
        expect(Object.keys(body).sort()).toEqual(
          ["query", "type", "in", "strategy", "minSimilarity", "filter", "hits"].sort(),
        );
        expect(body.in).toEqual(tool === "search" ? ["properties", "document"] : ["document"]);
        expect(body.hits).toHaveLength(2);
        expect(body.hits[0].relativeScore).toBe(1);
        for (const hit of body.hits) {
          expect(Object.keys(hit).sort()).toEqual(["entity", "matched", "matches", "relativeScore"]);
          expectMatched(hit);
          expect(hit.relativeScore).toBeGreaterThanOrEqual(0);
          expect(hit.relativeScore).toBeLessThanOrEqual(1);
          expect(hit.entity._entityTypeKey).toBeDefined();
          expect(hit.matches.length).toBeGreaterThan(0);
          if (tool === "search_documents") expect(hit.matches.every((m: any) => m.kind === "document")).toBe(true);
          for (const match of hit.matches) expectEvidence(match, strategy);
        }
        expect(new Set(body.hits.map((h: any) => h.entity._id)).size).toBe(2);
        if (tool === "search_documents") {
          const hit = body.hits.find((h: any) => h.entity._id === best._id);
          expect(hit).toBeDefined();
          expect(new Set(hit.matches.map((m: any) => m.propertyKey))).toEqual(new Set(["body", "appendix"]));
          expect(hit.entity.body).toEqual({ document: true, length: best.body.length });
          for (const match of hit.matches) {
            const read = await app.inject({
              url: `${runtime}/entities/paper/${best._id}/documents/${match.propertyKey}?offset=${match.charOffset}&limit=${match.charLength}`,
            });
            expect(read.statusCode, read.body).toBe(200);
            expect(Array.from(read.json().content).length).toBe(match.charLength);
          }
        }
      });
    it("filters narrow types and apply within both rankings; projection leaves matches", async () => {
      const hits = (await find({ query: "graph database", filters: { year__gte: "2020" }, limit: 2, fields: ["title"] }))
        .hits;
      expect(new Set(hits.map((h: any) => h.entity._id))).toEqual(new Set([best._id, second._id]));
      for (const hit of hits) {
        expect(Object.keys(hit.entity).sort()).toEqual(["_entityTypeKey", "_id", "title"]);
        expect(hit.matches[0].kind).toBe("properties");
        for (const match of hit.matches) expectEvidence(match, strategy);
        expect(hit.matches.some((m: any) => m.kind === "document")).toBe(true);
      }
    });
    it("search_documents' property restricts the documents", async () => {
      const result = await find({ query: "graph database", property: "appendix", limit: 10 }, "search_documents");
      const matches = result.hits.flatMap((h: any) => h.matches);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((m: any) => m.kind === "document" && m.propertyKey === "appendix")).toBe(true);
    });
    it("fills a cross-type page from a narrow lens", async () => {
      const lens = await post(`${model}/lenses`, { key: "narrow", name: "Narrow" });
      for (const key of ["paper", "report"])
        await post(`${model}/lenses/${lens.lensId}/includes/entity-types`, { key });
      await post(`${runtime}/entities/paper`, { title: "Graph databases in practice", year: 2025 });
      for (let i = 0; i < 12; i++) await post(`${runtime}/entities/company`, { title: `Graph database ${i}` });
      // A scoped lens searches the indices it includes; including a type
      // afterwards does not include its indices.
      expect((await find({ query: "graph database" }, "search", "narrow")).hits).toEqual([]);
      await runQuery(
        `INSERT INTO ont_search_test.lens_includes (lens_id, search_index_id)
         SELECT $1, search_index_id FROM ont_search_test.search_index
         WHERE key IN ('paper~default', 'report~default')`,
        [lens.lensId],
      );
      invalidateLoadedSchemaCache();
      const hits = (await find({ query: "graph database", limit: 3 }, "search", "narrow")).hits;
      expect(hits).toHaveLength(3);
      expect(hits.every((h: any) => h.entity._entityTypeKey !== "company")).toBe(true);
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
      for (const tool of ["search", "search_documents"]) {
        const result = await find(
          { query: "graph database", filters: { year__gte: "2020", "published_by.title": "Acme" }, limit: 1 },
          tool,
        );
        expect(result.hits.map((h: any) => h.entity._id)).toEqual([best._id]);
      }
      // Relation existence: the papers and companies (the types
      // published_by touches) with no such relation.
      const ids = (await find({ query: "graph database", filters: { published_by__missing: "true" } })).hits.map(
        (h: any) => h.entity._id,
      );
      expect(ids).not.toContain(best._id);
      expect(ids).not.toContain(second._id);
      expect(ids.length).toBeGreaterThan(0);
    });
    it("existence and negation filters narrow the searched types", async () => {
      // `year` is declared on papers and reports, both of which carry it.
      const present = (await find({ query: "graph database", filters: { year__exists: "true" } })).hits;
      const ids = present.map((h: any) => h.entity._id);
      expect(ids).toContain(best._id);
      expect(ids).toContain(second._id);
      for (const hit of present) expect(["paper", "report"]).toContain(hit.entity._entityTypeKey);
      expect((await find({ query: "graph database", filters: { year__missing: "true" } })).hits).toEqual([]);
      const rest = (await find({ query: "graph database", filters: { year__ne: "2024" } })).hits.map(
        (h: any) => h.entity._id,
      );
      expect(rest).not.toContain(best._id);
      expect(rest).toContain(second._id);
      const bad = await refusal({ query: "graph", filters: { year__exists: "maybe", title__ne: "x" } });
      expect(bad).toContain("year__exists");
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
      // The hits the keyword ranking found (the semantic one may find others).
      const keywordHits = async (query: string) =>
        (await find({ query, entity_type_key: "paper" })).hits.filter((h: any) =>
          h.matches.some((m: any) => m.evidence.keywordMatch === true),
        );

      const indexed = await keywordHits("reticulated");
      expect(indexed.map((h: any) => h.entity._id)).toEqual([entity._id]);
      expect(indexed[0].matched).toMatchObject({ index: "paper~default", partKind: "self" });

      const deleted = await app.inject({
        method: "DELETE",
        url: `${model}/entity-types/${paperId}/properties/${property.propertyId}?cascade=true`,
      });
      expect(deleted.statusCode, deleted.body).toBe(204);

      expect(await keywordHits("reticulated")).toEqual([]);
      expect((await keywordHits("field")).map((h: any) => h.entity._id)).toContain(entity._id);
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
        const hits = (await find({ query: "astronomy", entity_type_key: "paper" })).hits;
        const hit = hits.find((h: any) => h.entity._id === entity!._id);
        expect(hit.matches).toEqual(
          expect.arrayContaining([
            {
              kind: "properties",
              evidence: expect.objectContaining({ semanticSimilarity: expect.any(Number) }),
            },
            expect.objectContaining({ kind: "document", propertyKey: "body" }),
            expect.objectContaining({ kind: "document", propertyKey: "appendix" }),
          ]),
        );
        for (const match of hit.matches) expectEvidence(match, strategy);
      },
    );
    it.skipIf(!embedding)("the fixed floor removes semantic candidates only", async () => {
      const result = await find({ query: "graph database" });
      expect(result.hits.length).toBeGreaterThan(0);
      for (const hit of result.hits)
        for (const match of hit.matches) {
          expectEvidence(match, strategy);
          if (match.evidence.semanticSimilarity !== null)
            expect(match.evidence.semanticSimilarity).toBeGreaterThanOrEqual(TOOL_MIN_SIMILARITY);
        }
    });
    it("collects invalid request dimensions and filters before ranking", async () => {
      const refused = await refusal(
        { query: "graph", property: "missing", filters: { ghost: "1", year: "bad", title__contains: "graph" } },
        "search_documents",
      );
      for (const field of ["document.property", "ghost", "year", "title__contains"]) expect(refused).toContain(`${field}:`);
      // A type with no document to search; a property that is no document.
      await refusal({ query: "graph", entity_type_key: "company" }, "search_documents");
      await refusal({ query: "graph", entity_type_key: "paper", property: "title" }, "search_documents");
    });
    it("names the type's keys for a filter key it does not declare", async () => {
      const refused = await refusal({ query: "graph", entity_type_key: "paper", filters: { "ghost.title": "x" } });
      expect(refused).toContain(
        "ghost.title: Not defined in type 'paper'. Property keys: appendix, body, name, title, year. " +
          "Relation types touching 'paper': none",
      );
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
      // "database" alone. Any-term keyword matching keeps them as hits.
      const company = (await find({ query: "consulting", entity_type_key: "company" })).hits[0].entity._id;
      expect((await find({ query: "database consulting" })).hits.map((h: any) => h.entity._id)).toEqual(
        expect.arrayContaining([best._id, company, second._id]),
      );
      expect((await find({ query: "graph cakes" })).hits.length).toBeGreaterThan(0);
      // "surv" continues into "survey".
      const prefixed = (await find({ query: "surv" })).hits.find((h: any) => h.entity._id === second._id);
      expect(prefixed.matches.some((m: any) => m.kind === "properties" && m.evidence.keywordMatch === true)).toBe(true);
    });
    it("keyword matching never exposes query syntax", async () => {
      await find({ query: `graph & database | ! ' words` });
      const quoted = await find({ query: `"graph" & (database)` });
      expect(quoted.hits.map((h: any) => h.entity._id)).toContain(best._id);
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
        const ids = async (query: string, tool = "search") =>
          (await find({ query }, tool)).hits.map((h: any) => h.entity._id);
        expect(await ids("planet")).toContain(entity._id);
        expect(await ids("telescope", "search_documents")).toContain(entity._id);
        const update = await app.inject({
          method: "PATCH",
          url: `${runtime}/entities/paper/${entity._id}`,
          payload: { title: "Marine biologists", body: "Corals grow in oceans." },
        });
        expect(update.statusCode, update.body).toBe(200);
        expect(await ids("planet")).toHaveLength(0);
        expect(await ids("coral", "search_documents")).toContain(entity._id);
      } finally {
        setEmbeddingProvider(provider);
      }
    });
  });
}
