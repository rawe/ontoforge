/**
 * Managed search indices and the query engine on PostgreSQL: managed rows
 * follow schema changes (and new ones join the scoped lenses that show
 * their type), switched-off managed indices, relation entries that pair
 * one relation with its own target, query-time skipping of relation
 * entries a lens hides (no rebuild), exact filters inside the ranking,
 * and a semantic ranking with a deterministic fake provider. The worker
 * is drained explicitly. Requires the docker-compose PostgreSQL.
 */

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { setEmbeddingProvider } from "../../../src/core/embedding.js";
import {
  closeStores,
  getRuntimeStore,
  getSearchIndexStore,
  initStores,
  type SearchIndexStore,
} from "../../../src/core/ports.js";
import { SearchIndexDefinition } from "../../../src/core/searchIndex.js";
import { reconcileSearchGenerations } from "../../../src/runtime/indexing/generations.js";
import { getSearchIndexStatus } from "../../../src/runtime/indexing/status.js";
import { drainSearchWork } from "../../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache, loadSchema } from "../../../src/runtime/schemaCache.js";
import { rankThroughIndices, searchByIndices } from "../../../src/runtime/search/indexSearch.js";
import { fakeEmbeddingProvider } from "../../fakeEmbedding.js";
import { wipeDatabase } from "../reset.js";

type Row = Record<string, any>;

const O = "search_query";
const NS = `ont_${O}`;
const MODEL = `/api/ontologies/${O}/model`;
const runtimeOf = (lens: string) => `/api/ontologies/${O}/runtime/lenses/${lens}`;

const EMPLOYMENT = SearchIndexDefinition.parse({
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

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL search query", () => {
  let app: FastifyInstance;
  let store: SearchIndexStore;
  let personTypeId: string;

  async function request(method: "POST" | "PUT" | "DELETE", url: string, payload?: object): Promise<Row> {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    return res.statusCode === 204 ? {} : res.json();
  }
  const post = (url: string, payload: object) => request("POST", url, payload);

  async function rows(): Promise<Row[]> {
    return (await store.listIndices()).map((i) => ({ key: i.key, kind: i.kind, fields: i.definition.fields }));
  }

  async function liveGenerations(key: string) {
    const index = (await store.getIndex(key))!;
    return (await store.listGenerations(index.searchIndexId)).filter(
      (g) => g.state === "building" || g.state === "ready",
    );
  }

  async function lensIndexKeys(lensKey: string): Promise<string[]> {
    const result = await runQuery(
      `SELECT si.key FROM ${NS}.lens_includes li
       JOIN ${NS}.lens l ON l.lens_id = li.lens_id
       JOIN ${NS}.search_index si ON si.search_index_id = li.search_index_id
       WHERE l.key = $1 ORDER BY si.key`,
      [lensKey],
    );
    return result.rows.map((r) => r["key"] as string);
  }

  async function search(lens: string, body: Parameters<typeof searchByIndices>[1]) {
    await drainSearchWork({ ontologyKey: O });
    return searchByIndices(lens, body, await getRuntimeStore(O));
  }

  beforeAll(async () => {
    await initStores();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    setEmbeddingProvider(null);
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  beforeEach(async () => {
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    setEmbeddingProvider(fakeEmbeddingProvider());
    await post("/api/ontologies", { key: O });
    store = await getSearchIndexStore(O);
    await post(`${MODEL}/lenses`, { key: "all", name: "All" });
    const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
    personTypeId = person.entityTypeId;
    await post(`${MODEL}/entity-types/${personTypeId}/properties`, {
      key: "age",
      displayName: "Age",
      dataType: "integer",
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
  });

  // -------------------------------------------------------------------
  // Managed indices
  // -------------------------------------------------------------------

  it("managed rows follow every schema change", async () => {
    expect(await rows()).toEqual([
      { key: "company~default", kind: "default", fields: ["name"] },
      { key: "person~default", kind: "default", fields: ["name"] },
    ]);
    const before = await liveGenerations("person~default");
    expect(before.map((g) => g.representation).sort()).toEqual(["keyword", "semantic"]);

    const email = await post(`${MODEL}/entity-types/${personTypeId}/properties`, {
      key: "email",
      displayName: "E-mail",
      dataType: "string",
    });
    const bio = await post(`${MODEL}/entity-types/${personTypeId}/properties`, {
      key: "bio",
      displayName: "Biography",
      dataType: "document",
    });
    expect(await rows()).toEqual([
      { key: "company~default", kind: "default", fields: ["name"] },
      { key: "person~bio", kind: "passage", fields: ["bio"] },
      { key: "person~default", kind: "default", fields: ["email", "name"] },
    ]);
    // A changed definition starts new generations beside the active ones.
    const after = await liveGenerations("person~default");
    expect(after.filter((g) => g.state === "building")).toHaveLength(2);

    await request("DELETE", `${MODEL}/entity-types/${personTypeId}/properties/${bio.propertyId}`);
    await request("DELETE", `${MODEL}/entity-types/${personTypeId}/properties/${email.propertyId}`);
    expect((await rows()).map((r) => r.key)).toEqual(["company~default", "person~default"]);

    const city = await post(`${MODEL}/entity-types`, { key: "city", displayName: "City" });
    expect((await rows()).map((r) => r.key)).toContain("city~default");
    await request("DELETE", `${MODEL}/entity-types/${city.entityTypeId}`);
    expect((await rows()).map((r) => r.key)).not.toContain("city~default");
    // No entry table outlives its generation.
    await drainSearchWork({ ontologyKey: O });
    const tables = await runQuery(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = $1 AND tablename LIKE 'se\\_%'`,
      [NS],
    );
    const live = (await store.listGenerations()).filter((g) => g.state === "ready" || g.state === "building");
    expect(tables.rows[0]!["n"]).toBe(live.length);
  });

  it("a display-name change re-queues the entries, keeping the generations", async () => {
    await post(`${runtimeOf("all")}/entities/person`, { name: "Ada" });
    await drainSearchWork({ ontologyKey: O });
    const before = (await liveGenerations("person~default")).map((g) => g.generationId).sort();

    await request("PUT", `${MODEL}/entity-types/${personTypeId}`, { displayName: "Human" });
    expect((await store.getIndex("person~default"))!.definition.name).toBe("Human — default");
    expect((await liveGenerations("person~default")).map((g) => g.generationId).sort()).toEqual(before);
    const queued = await runQuery(`SELECT count(*)::int AS n FROM ${NS}.search_queue`);
    expect(queued.rows[0]!["n"]).toBeGreaterThan(0);

    await drainSearchWork({ ontologyKey: O });
    const semantic = (await liveGenerations("person~default")).find((g) => g.representation === "semantic")!;
    const texts = await runQuery(`SELECT text FROM ${NS}.se_${semantic.generationId.replaceAll("-", "")}`);
    expect(texts.rows.map((r) => r["text"])).toEqual([expect.stringContaining("Human: Ada")]);
  });

  it("a new managed index joins the scoped lenses that show its type", async () => {
    const people = await post(`${MODEL}/lenses`, { key: "people", name: "People" });
    await post(`${MODEL}/lenses/${people.lensId}/includes/entity-types`, { key: "person" });
    const companies = await post(`${MODEL}/lenses`, { key: "companies", name: "Companies" });
    await post(`${MODEL}/lenses/${companies.lensId}/includes/entity-types`, { key: "company" });

    await post(`${MODEL}/entity-types/${personTypeId}/properties`, {
      key: "bio",
      displayName: "Biography",
      dataType: "document",
    });
    expect(await lensIndexKeys("people")).toEqual(["person~bio"]);
    expect(await lensIndexKeys("companies")).toEqual([]);
    expect(await lensIndexKeys("all")).toEqual([]);
  });

  it("a switched-off managed index keeps its row, builds nothing and is searched nowhere", async () => {
    const ada = await post(`${runtimeOf("all")}/entities/person`, { name: "Ada" });
    const keyword = (q: string) => search("all", { query: q, mode: "keyword" });
    expect((await keyword("Ada")).hits.map((h) => h.entity._id)).toEqual([ada._id]);
    // Switched through the modeling route (search settings).
    const switchOff = (disabledIndices: string[]) =>
      app.inject({ method: "PUT", url: `${MODEL}/search-settings`, payload: { disabledIndices } });

    const off = await switchOff(["person~default"]);
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().disabledIndices).toEqual(["person~default"]);
    expect((await app.inject({ url: `${MODEL}/search-settings` })).json().disabledIndices).toEqual([
      "person~default",
    ]);
    expect(await getSearchIndexStatus(O, "person~default")).toMatchObject({
      state: "disabled",
      representations: [],
    });
    expect(await liveGenerations("person~default")).toEqual([]);
    expect((await keyword("Ada")).hits).toEqual([]);
    await expect(search("all", { query: "Ada", indices: ["person~default"] })).rejects.toMatchObject({
      details: { fields: { "indices.0": expect.any(String) } },
    });

    expect((await switchOff([])).statusCode).toBe(200);
    expect((await keyword("Ada")).hits.map((h) => h.entity._id)).toEqual([ada._id]);

    const unknown = await switchOff(["employment"]);
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error.details.fields).toEqual({
      "disabledIndices.0": "'employment' is not a managed search index",
    });
  });

  // -------------------------------------------------------------------
  // The engine
  // -------------------------------------------------------------------

  async function employmentFixture() {
    await store.createIndex(randomUUID(), "custom", EMPLOYMENT);
    await reconcileSearchGenerations(O);
    const rt = runtimeOf("all");
    const ada = await post(`${rt}/entities/person`, { name: "Ada", age: 40 });
    const bob = await post(`${rt}/entities/person`, { name: "Bob", age: 30 });
    const acme = await post(`${rt}/entities/company`, { name: "ACME" });
    const foo = await post(`${rt}/entities/company`, { name: "Foo" });
    const relation = async (from: Row, to: Row, role: string) =>
      post(`${rt}/relations/works_for`, { fromEntityId: from._id, toEntityId: to._id, role });
    const adaAcme = await relation(ada, acme, "CTO");
    await relation(ada, foo, "Advisor");
    await relation(bob, foo, "CTO");
    return { ada, bob, acme, foo, adaAcme };
  }

  it("a relation entry pairs one relation with its own target, never another's", async () => {
    const { ada, bob, acme, adaAcme } = await employmentFixture();
    await drainSearchWork({ ontologyKey: O });
    const runtime = await getRuntimeStore(O);
    const loaded = await loadSchema("all", runtime);
    const index = (await store.getIndex("employment"))!;
    const allTerms = async (query: string) =>
      (
        await rankThroughIndices(loaded, store, {
          targets: [{ index, conditions: [] }],
          query,
          mode: "keyword",
          matching: "all",
          relations: null,
          minScore: null,
          limit: 10,
        })
      ).map((hit) => hit.entityId);
    expect(await allTerms("CTO ACME")).toEqual([ada._id]);
    expect(await allTerms("CTO Foo")).toEqual([bob._id]);
    expect(await allTerms("Advisor ACME")).toEqual([]);

    const response = await search("all", { query: "CTO ACME", indices: ["employment"], mode: "keyword" });
    expect(response.hits[0]!.entity._id).toBe(ada._id);
    expect(response.hits[0]!.matched).toEqual({
      index: "employment",
      partKind: "relation",
      relationType: "works_for",
      relationId: adaAcme._id,
      target: { id: acme._id, type: "company", label: "ACME" },
      snippet: "Ada CTO ACME",
      charOffset: null,
      charLength: null,
    });
  });

  it("a lens that hides a relation's target skips its entries without a rebuild", async () => {
    const { ada } = await employmentFixture();
    const people = await post(`${MODEL}/lenses`, { key: "people", name: "People" });
    await post(`${MODEL}/lenses/${people.lensId}/includes/entity-types`, { key: "person" });
    await runQuery(
      `INSERT INTO ${NS}.lens_includes (lens_id, search_index_id)
       SELECT $1, search_index_id FROM ${NS}.search_index WHERE key = 'employment'`,
      [people.lensId],
    );
    invalidateLoadedSchemaCache();
    const generations = (await liveGenerations("employment")).map((g) => g.generationId).sort();

    const acme = (lens: string) => search(lens, { query: "ACME", indices: ["employment"], mode: "keyword" });
    expect((await acme("all")).hits.map((h) => h.entity._id)).toEqual([ada._id]);
    expect((await acme("people")).hits).toEqual([]);

    // Showing companies infers works_for: the same entries rank again.
    await post(`${MODEL}/lenses/${people.lensId}/includes/entity-types`, { key: "company" });
    expect((await acme("people")).hits.map((h) => h.entity._id)).toEqual([ada._id]);
    expect((await liveGenerations("employment")).map((g) => g.generationId).sort()).toEqual(generations);

    // A relations choice narrows the same way.
    const none = await search("all", { query: "ACME", indices: ["employment"], mode: "keyword", relations: [] });
    expect(none.hits).toEqual([]);
  });

  it("exact filters restrict the candidates inside the ranking", async () => {
    const { ada, bob } = await employmentFixture();
    const cto = (filters: Record<string, string>) =>
      search("all", { query: "CTO", indices: ["employment"], mode: "keyword", filters });
    expect((await cto({})).hits.map((h) => h.entity._id).sort()).toEqual([ada._id, bob._id].sort());
    expect((await cto({ age__gte: "35" })).hits.map((h) => h.entity._id)).toEqual([ada._id]);
    expect((await cto({ "works_for.name": "Foo" })).hits.map((h) => h.entity._id).sort()).toEqual(
      [ada._id, bob._id].sort(),
    );
    expect((await cto({ "works_for.name": "ACME" })).hits.map((h) => h.entity._id)).toEqual([ada._id]);
  });

  it("one mode ranks across types by raw score, and an entity found by two indices counts once", async () => {
    await post(`${MODEL}/entity-types/${personTypeId}/properties`, {
      key: "bio",
      displayName: "Biography",
      dataType: "document",
    });
    const rt = runtimeOf("all");
    const ada = await post(`${rt}/entities/person`, { name: "Graph Graph Graph", bio: "Graph theory." });
    const acme = await post(`${rt}/entities/company`, { name: "Graph" });
    const bob = await post(`${rt}/entities/person`, { name: "Bob", bio: "Graph graph graph graph." });
    await drainSearchWork({ ontologyKey: O });
    const res = await app.inject({ url: `${rt}/search?q=graph&strategy=keyword` });
    expect(res.statusCode, res.body).toBe(200);
    const hits = res.json().hits as Row[];
    // The tops of the three indices do not tie: their keyword scores order them.
    expect(new Set(hits.map((h) => h.entity._id))).toEqual(new Set([ada._id, acme._id, bob._id]));
    expect(hits.map((h) => h.relativeScore)).toEqual([...hits.map((h) => h.relativeScore)].sort((a, b) => b - a));
    expect(hits.at(-1)!.relativeScore).toBeLessThan(1);
    // Ada matches through her name and her biography; the score is her best entry's.
    const adaHit = hits.find((h) => h.entity._id === ada._id)!;
    expect(adaHit.matches.map((m: Row) => m.kind)).toEqual(["properties", "document"]);
    const best = Math.max(...adaHit.matches.map((m: Row) => m.evidence.keywordScore as number));
    expect(adaHit.relativeScore).toBeCloseTo(best / Math.max(...hits.flatMap((h) => h.matches.map((m: Row) => m.evidence.keywordScore as number))));
  });

  it("ranks semantically over the active generation, floored on (1 + cosine) / 2", async () => {
    const ada = await post(`${runtimeOf("all")}/entities/person`, { name: "Ada" });
    await post(`${runtimeOf("all")}/entities/person`, { name: "Bob" });
    await drainSearchWork({ ontologyKey: O });
    const semantic = (await liveGenerations("person~default")).find((g) => g.representation === "semantic")!;
    const text = (
      await runQuery(
        `SELECT text FROM ${NS}.se_${semantic.generationId.replaceAll("-", "")} WHERE entity_id = $1`,
        [ada._id],
      )
    ).rows[0]!["text"] as string;

    // The fake provider maps equal texts to equal vectors: similarity 1.
    const exact = await search("all", { query: text, indices: ["person~default"], mode: "semantic", minScore: 0.99 });
    expect(exact.hits.map((h) => h.entity._id)).toEqual([ada._id]);
    expect(exact.hits[0]!.matched).toMatchObject({ index: "person~default", partKind: "self", snippet: "Person: Ada" });
    const all = await search("all", { query: text, indices: ["person~default"], mode: "semantic" });
    expect(all.hits.map((h) => h.entity._id)[0]).toBe(ada._id);
    expect(all.hits).toHaveLength(2);
    // Hybrid is the default with a provider.
    expect((await search("all", { query: "Ada" })).mode).toBe("hybrid");
  });
});
