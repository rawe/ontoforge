/** The same HTTP search contract runs with and without local embeddings, on either adapter. */
import type { FastifyInstance } from "fastify";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
import { initStores, closeStores } from "../../src/core/ports.js";
import { getEmbeddingProvider, setEmbeddingProvider } from "../../src/core/embedding.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { wipeDatabase } from "./reset.js";
import { enableOllamaProvider, disableProvider } from "./embedding/support.js";

export function searchContract(embedding: boolean, enabled = true) {
  const keyword = settings.DB_BACKEND === "postgres";
  const strategies = embedding
    ? keyword
      ? ["semantic", "keyword", "hybrid"]
      : ["semantic"]
    : keyword
      ? ["keyword"]
      : [];
  const defaults = embedding
    ? keyword
      ? ["hybrid", "keyword", "semantic"]
      : ["semantic"]
    : keyword
      ? ["keyword"]
      : [];
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
  async function find(query: string, params: Record<string, string> = {}, lens = "all") {
    return app.inject({
      method: "GET",
      url: `${base}/runtime/lenses/${lens}/search?${new URLSearchParams({ q: query, ...params })}`,
    });
  }
  describe.skipIf(!enabled)(`search contract (${embedding ? "Ollama" : "no provider"})`, () => {
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
    it("reports available strategies and removes the old route", async () => {
      expect((await app.inject({ url: "/api/server/features" })).json()).toEqual({
        semanticSearch: embedding,
        ai: false,
        searchStrategies: defaults,
      });
      expect((await app.inject({ url: `${runtime}/search/semantic?q=graph` })).statusCode).toBe(
        404,
      );
      const result = await find("graph");
      if (strategies.length) expect(result.json().strategy).toBe(defaults[0]);
      else {
        expect(result.statusCode).toBe(422);
        expect(result.json().error.details.code).toBe("FEATURE_DISABLED");
      }
    });
    for (const strategy of strategies) {
      for (const kind of ["properties", "document"] as const)
        it(`${strategy} ${kind} returns ranked entities, bounded scores and matching places`, async () => {
          const result = await find("graph database", { strategy, in: kind, limit: "2" });
          expect(result.statusCode, result.body).toBe(200);
          const body = result.json();
          expect(Object.keys(body).sort()).toEqual(
            ["query", "type", "in", "strategy", "filter", "hits"].sort(),
          );
          expect(body.hits).toHaveLength(2);
          expect(body.hits[0].relativeScore).toBe(1);
          for (const hit of body.hits) {
            expect(Object.keys(hit).sort()).toEqual(["entity", "matches", "relativeScore"]);
            expect(hit.relativeScore).toBeGreaterThanOrEqual(0);
            expect(hit.relativeScore).toBeLessThanOrEqual(1);
            expect(hit.entity._entityTypeKey).toBeDefined();
            expect(hit.matches.length).toBeGreaterThan(0);
            expect(hit.matches.every((m: any) => m.kind === kind)).toBe(true);
          }
          expect(new Set(body.hits.map((h: any) => h.entity._id)).size).toBe(2);
          if (kind === "document") {
            const hit = body.hits.find((h: any) => h.entity._id === best._id);
            expect(hit).toBeDefined();
            expect(new Set(hit.matches.map((m: any) => m.propertyKey))).toEqual(
              new Set(["body", "appendix"]),
            );
            expect(hit.entity.body).toEqual({ document: true, length: best.body.length });
            for (const match of hit.matches) {
              expect(Object.keys(match).sort()).toEqual([
                "charLength",
                "charOffset",
                "kind",
                "propertyKey",
              ]);
              const read = await app.inject({
                url: `${runtime}/entities/paper/${best._id}/documents/${match.propertyKey}?offset=${match.charOffset}&limit=${match.charLength}`,
              });
              expect(read.statusCode, read.body).toBe(200);
              expect(Array.from(read.json().content).length).toBe(match.charLength);
            }
          }
        });
      it(`${strategy} filters narrow types and apply within both rankings; projection leaves matches`, async () => {
        const result = await find("graph database", {
          strategy,
          "filter.year__gte": "2020",
          limit: "2",
          fields: "title",
        });
        expect(result.statusCode, result.body).toBe(200);
        const hits = result.json().hits;
        expect(new Set(hits.map((h: any) => h.entity._id))).toEqual(
          new Set([best._id, second._id]),
        );
        for (const hit of hits) {
          expect(Object.keys(hit.entity).sort()).toEqual(["_entityTypeKey", "_id", "title"]);
          expect(hit.matches[0]).toEqual({ kind: "properties" });
          expect(hit.matches.some((m: any) => m.kind === "document")).toBe(true);
        }
      });
      it(`${strategy} document.property restricts documents and preserves property search`, async () => {
        const result = await find("graph database", {
          strategy,
          "document.property": "appendix",
          limit: "10",
        });
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json().hits.some((h: any) => h.entity._entityTypeKey === "company")).toBe(
          true,
        );
        const matches = result
          .json()
          .hits.flatMap((h: any) => h.matches)
          .filter((m: any) => m.kind === "document");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches.every((m: any) => m.propertyKey === "appendix")).toBe(true);
      });
      it(`${strategy} fills a cross-type page from a narrow lens`, async () => {
        const lens = await post(`${model}/lenses`, { key: "narrow", name: "Narrow" });
        for (const key of ["paper", "report"])
          await post(`${model}/lenses/${lens.lensId}/includes/entity-types`, { key });
        await post(`${runtime}/entities/paper`, {
          title: "Graph databases in practice",
          year: 2025,
        });
        for (let i = 0; i < 12; i++)
          await post(`${runtime}/entities/company`, { title: `Graph database ${i}` });
        const result = await find(
          "graph database",
          { strategy, in: "properties", limit: "3" },
          "narrow",
        );
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json().hits).toHaveLength(3);
        expect(result.json().hits.every((h: any) => h.entity._entityTypeKey !== "company")).toBe(
          true,
        );
      });
    }
    it.skipIf(!strategies.length)(
      "query-path filters run inside property and document rankings where supported",
      async () => {
        await post(`${model}/relation-types`, {
          key: "published_by",
          displayName: "Published by",
          sourceEntityTypeKey: "paper",
          targetEntityTypeKey: "company",
        });
        const publisher = await post(`${runtime}/entities/company`, { title: "Acme" });
        await post(`${runtime}/relations/published_by`, {
          fromEntityId: best._id,
          toEntityId: publisher._id,
        });
        for (const strategy of strategies)
          for (const kind of ["properties", "document"]) {
            const res = await find("graph database", {
              strategy,
              in: kind,
              "filter.year__gte": "2020",
              "filter.published_by.title": "Acme",
              limit: "1",
            });
            if (keyword) {
              expect(res.statusCode, res.body).toBe(200);
              expect(res.json().hits.map((h: any) => h.entity._id)).toEqual([best._id]);
            } else {
              expect(res.statusCode, res.body).toBe(422);
              expect(res.json().error.message).toContain("use the entity list");
            }
          }
      },
    );
    it.skipIf(!embedding)(
      "rebuild makes providerless property text and document chunks searchable semantically",
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
        const before = await find("astronomy", { type: "paper", strategy: "semantic" });
        expect(before.json().hits.map((h: any) => h.entity._id)).not.toContain(entity!._id);
        const rebuild = await app.inject({ method: "POST", url: `${model}/rebuild-embeddings` });
        expect(rebuild.statusCode, rebuild.body).toBe(200);
        expect(JSON.parse(rebuild.body.trim().split("\n").at(-1)!)).toMatchObject({
          type: "summary",
          totalFailed: 0,
        });
        const after = await find("astronomy", { type: "paper", strategy: "semantic" });
        const hit = after.json().hits.find((h: any) => h.entity._id === entity!._id);
        expect(hit.matches).toEqual(
          expect.arrayContaining([
            { kind: "properties" },
            expect.objectContaining({ kind: "document", propertyKey: "body" }),
            expect.objectContaining({ kind: "document", propertyKey: "appendix" }),
          ]),
        );
        if (keyword)
          expect(
            (await find("astronomy", { type: "paper", strategy: "keyword", in: "properties" }))
              .json()
              .hits.map((h: any) => h.entity._id),
          ).toContain(entity!._id);
      },
    );
    it.skipIf(!strategies.length)(
      "a final saved-query search step returns the direct search envelope",
      async () => {
        const definition = await app.inject({
          method: "PUT",
          url: `${model}/lenses/all/saved-queries/find_papers`,
          payload: {
            name: "Find papers",
            description: "Search papers",
            parameters: [],
            steps: [
              {
                name: "papers",
                type: "search",
                entityTypeKey: "paper",
                query: "graph database",
                limit: 2,
              },
            ],
          },
        });
        expect(definition.statusCode, definition.body).toBe(201);
        const run = await app.inject({
          method: "POST",
          url: `${runtime}/saved-queries/find_papers/run`,
          payload: { params: {} },
        });
        expect(run.statusCode, run.body).toBe(200);
        expect(run.json()).toEqual(
          (await find("graph database", { type: "paper", limit: "2" })).json(),
        );
        expect(run.json().hits[0].entity).not.toHaveProperty("_score");
        expect(run.json().hits[0].entity).not.toHaveProperty("_entityTypeKey");
      },
    );
    it("collects invalid request dimensions and filters before ranking", async () => {
      const result = await find("graph", {
        strategy: "bogus",
        in: "invalid",
        limit: "0",
        "document.property": "missing",
        "filter.ghost": "1",
        "filter.year": "bad",
        "filter.title__contains": "graph",
      });
      expect(result.statusCode).toBe(422);
      expect(Object.keys(result.json().error.details.fields)).toEqual(
        expect.arrayContaining([
          "strategy",
          "in",
          "limit",
          "document.property",
          "ghost",
          "year",
          "title__contains",
        ]),
      );
      for (const params of [
        { in: "document", type: "company" },
        { in: "properties", "document.property": "body" },
        { type: "paper", "document.property": "title" },
      ])
        expect((await find("graph", params)).statusCode).toBe(422);
      expect(
        (
          await app.inject({
            url: `${runtime}/search?q=graph&document.property=body&document.property=appendix`,
          })
        ).statusCode,
      ).toBe(422);
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
      const res = await find("graph", { "filter.status": "1" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.fields.status).toContain("Conflicting data types");
    });
    it("names available strategies when a built strategy cannot run", async () => {
      if (!embedding) {
        const result = await find("graph", { strategy: "semantic" });
        expect(result.statusCode).toBe(422);
        expect(result.json().error.details.code).toBe("FEATURE_DISABLED");
        expect(result.json().error.message).toContain(keyword ? "keyword" : "none");
      }
      if (!keyword)
        for (const strategy of ["keyword", "hybrid"]) {
          const result = await find("graph", { strategy });
          expect(result.statusCode).toBe(422);
          expect(result.json().error.message).toContain(embedding ? "semantic" : "none");
        }
    });
    it("keeps literal terms on entity lists, including document exclusion", async () => {
      const res = await app.inject({ url: `${runtime}/entities/paper?q=datab` });
      expect(res.json().items.map((e: any) => e._id)).toEqual([best._id]);
      expect(
        (await app.inject({ url: `${runtime}/entities/paper?q=relationships` })).json().items,
      ).toHaveLength(0);
    });
    it.skipIf(!keyword)(
      "stems in the ontology language and maintains text/chunks without a provider",
      async () => {
        const provider = getEmbeddingProvider();
        setEmbeddingProvider(null);
        try {
          const entity = await post(`${runtime}/entities/paper`, {
            title: "Astronomers observe planets",
            body: "Telescopes discover planets.",
          });
          expect(
            (await find("planet", { in: "properties" })).json().hits.map((h: any) => h.entity._id),
          ).toContain(entity._id);
          expect(
            (await find("telescope", { in: "document" })).json().hits.map((h: any) => h.entity._id),
          ).toContain(entity._id);
          const update = await app.inject({
            method: "PATCH",
            url: `${runtime}/entities/paper/${entity._id}`,
            payload: { title: "Marine biologists", body: "Corals grow in oceans." },
          });
          expect(update.statusCode, update.body).toBe(200);
          expect((await find("planet", { in: "properties" })).json().hits).toHaveLength(0);
          expect(
            (await find("coral", { in: "document" })).json().hits.map((h: any) => h.entity._id),
          ).toContain(entity._id);
        } finally {
          setEmbeddingProvider(provider);
        }
      },
    );
  });
}
