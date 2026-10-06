/**
 * Search indices with real embeddings (bge-m3): semantic and hybrid search
 * over the managed default and passage indices, and relation entries that
 * pair one relation with its own target in the semantic representation —
 * "CTO ACME" finds the CTO of ACME through that very employment; "CTO Foo"
 * does not find her through it, semantic and hybrid alike — over a custom
 * index created through the modeling API. PostgreSQL only; SKIPPED when
 * Ollama or the model is unavailable.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { closeStores, getRuntimeStore, initStores } from "../../../src/core/ports.js";
import { drainSearchWork } from "../../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { searchByIndices } from "../../../src/runtime/search/indexSearch.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, any>;

const ollamaUp = await checkOllamaModel();
const O = "index_search";
const MODEL = `/api/ontologies/${O}/model`;
const RUNTIME = `/api/ontologies/${O}/runtime/lenses/all`;

describe.skipIf(!ollamaUp || settings.DB_BACKEND !== "postgres")("search indices (Ollama)", () => {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};

  async function post(url: string, payload: object): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
    return res.json();
  }

  async function find(params: Record<string, string>): Promise<Row> {
    const res = await app.inject({ url: `${RUNTIME}/search?${new URLSearchParams(params)}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();

    await post("/api/ontologies", { key: O });
    await post(`${MODEL}/lenses`, { key: "all", name: "All" });
    const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
    await post(`${MODEL}/entity-types/${person.entityTypeId}/properties`, {
      key: "bio",
      displayName: "Biography",
      dataType: "document",
    });
    await post(`${MODEL}/entity-types`, { key: "company", displayName: "Company" });
    const worksFor = await post(`${MODEL}/relation-types`, {
      key: "works_for",
      displayName: "Works for",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "company",
    });
    await post(`${MODEL}/relation-types/${worksFor.relationTypeId}/properties`, {
      key: "role",
      displayName: "Role",
      dataType: "string",
    });
    // The custom index is created through the modeling API.
    await post(`${MODEL}/search-indices`, {
      key: "employment",
      name: "People by employment",
      description: "People with their roles at companies",
      entityType: "person",
      fields: ["name"],
      relations: [
        {
          relationType: "works_for",
          direction: "outgoing",
          fields: ["role"],
          target: { company: ["name"] },
          label: "Employment",
        },
      ],
    });

    for (const [name, bio] of [
      ["Ada Lovelace", "Ada designs analytical engines and writes programs computing Bernoulli numbers."],
      ["Bob Miller", "Bob grows tomatoes in his garden and keeps honey bees."],
      ["Carol Jones", "Carol writes novels about sailing across the Atlantic ocean."],
    ]) {
      ids[name!] = (await post(`${RUNTIME}/entities/person`, { name, bio }))._id;
    }
    for (const name of ["ACME", "Foo"]) ids[name] = (await post(`${RUNTIME}/entities/company`, { name }))._id;
    for (const [person, company, role] of [
      ["Ada Lovelace", "ACME", "CTO"],
      ["Ada Lovelace", "Foo", "Advisor"],
      ["Bob Miller", "Foo", "CTO"],
      ["Carol Jones", "ACME", "Engineer"],
    ]) {
      const relation = await post(`${RUNTIME}/relations/works_for`, {
        fromEntityId: ids[person!],
        toEntityId: ids[company!],
        role,
      });
      ids[`${person}@${company}`] = relation._id;
    }
    await drainSearchWork({ ontologyKey: O });
  }, 300_000);

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  it("semantic search over passage indices returns the passage that matched", async () => {
    const body = await find({ q: "beekeeping and vegetable gardening", strategy: "semantic", in: "document" });
    const top = body.hits[0];
    expect(top.entity._id).toBe(ids["Bob Miller"]);
    expect(top.matched).toMatchObject({ index: "person~bio", partKind: "passage", charOffset: 0 });
    expect(top.matched.snippet).toContain("honey bees");
    expect(top.matches).toEqual([
      expect.objectContaining({ kind: "document", propertyKey: "bio", charOffset: 0 }),
    ]);
  });

  it("the semantic leg crosses languages: a German query finds the English passage", async () => {
    const body = await find({ q: "Bienenzucht im Garten", strategy: "semantic", in: "document" });
    expect(body.hits[0].entity._id).toBe(ids["Bob Miller"]);
  });

  it("hybrid search ranks across default and passage indices, one match per index", async () => {
    const body = await find({ q: "Ada analytical engines", strategy: "hybrid" });
    const top = body.hits[0];
    expect(top.entity._id).toBe(ids["Ada Lovelace"]);
    expect(new Set(top.matches.map((m: Row) => m.kind))).toEqual(new Set(["properties", "document"]));
    for (const match of top.matches) {
      expect(match.evidence.semanticSimilarity !== null || match.evidence.keywordMatch === true).toBe(true);
    }
  });

  it("a relation entry pairs one relation with its own target in the semantic representation", async () => {
    const runtime = await getRuntimeStore(O);
    const semantic = (query: string) =>
      searchByIndices("all", { query, indices: ["employment"], mode: "semantic" }, runtime);

    const acme = await semantic("CTO ACME");
    expect(acme.hits[0]!.entity._id).toBe(ids["Ada Lovelace"]);
    expect(acme.hits[0]!.matched).toMatchObject({
      partKind: "relation",
      relationId: ids["Ada Lovelace@ACME"],
      target: { id: ids["ACME"], type: "company", label: "ACME" },
    });

    const foo = await semantic("CTO Foo");
    expect(foo.hits[0]!.entity._id).toBe(ids["Bob Miller"]);
    expect(foo.hits[0]!.matched).toMatchObject({ relationId: ids["Bob Miller@Foo"] });
    // Ada is CTO of ACME and an advisor at Foo; no entry of hers says
    // "CTO at Foo", so she ranks below the one who is.
    const ada = foo.hits.find((hit) => hit.entity._id === ids["Ada Lovelace"]);
    if (ada !== undefined) {
      expect([ids["Ada Lovelace@ACME"], ids["Ada Lovelace@Foo"]]).toContain(ada.matched.relationId);
      expect(foo.hits.indexOf(ada)).toBeGreaterThan(0);
    }
  });

  it("the custom index built through the API is ready, and hybrid search pairs the same way", async () => {
    const status = await app.inject({ url: `${MODEL}/search-indices/employment/status` });
    expect(status.json()).toMatchObject({
      state: "ready",
      representations: [
        { representation: "keyword", state: "ready" },
        { representation: "semantic", state: "ready" },
      ],
    });

    const runtime = await getRuntimeStore(O);
    const hybrid = (query: string) =>
      searchByIndices("all", { query, indices: ["employment"], mode: "hybrid" }, runtime);
    const acme = await hybrid("CTO ACME");
    expect(acme.mode).toBe("hybrid");
    expect(acme.hits[0]!.entity._id).toBe(ids["Ada Lovelace"]);
    expect(acme.hits[0]!.matched).toMatchObject({ relationId: ids["Ada Lovelace@ACME"] });
    const foo = await hybrid("CTO Foo");
    expect(foo.hits[0]!.entity._id).toBe(ids["Bob Miller"]);
    expect(foo.hits[0]!.matched).toMatchObject({ relationId: ids["Bob Miller@Foo"] });
  });
});
