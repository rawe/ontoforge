/**
 * The runtime index search on PostgreSQL: an ontology, its schema and
 * data, a custom index created through the modeling API and built by the
 * worker, then the MCP tool `search_by_index` — a relation entry pairs one
 * employment with its own company, a scoped lens hiding companies skips
 * the relation entries, `relations` narrows them — and the lens's catalog
 * `GET search-indices` with its relation group label, without switched-off
 * managed indices. Plus the error cases, the filters object and the field
 * projection. Keyword mode throughout (no provider); the hybrid leg runs
 * in the embedding suite. Requires the docker-compose database.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { createRuntimeMcpServer } from "../../src/mcp/runtime.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const O = "runtime_search";
const MODEL = `/api/ontologies/${O}/model`;
const runtimeOf = (lens: string) => `/api/ontologies/${O}/runtime/lenses/${lens}`;
const RUNTIME = runtimeOf("all");

const EMPLOYMENT = {
  key: "person_employment",
  name: "People by employment",
  description: "People with their roles at companies and since when.",
  entityType: "person",
  fields: ["name"],
  relations: [
    {
      relationType: "works_for",
      direction: "outgoing",
      fields: ["role", "since"],
      target: { company: ["name"] },
      label: "Employment",
    },
  ],
};

let app: FastifyInstance;

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
  // Keyword only: no embedding provider.
  setEmbeddingProvider(null);
});

async function post(url: string, payload: object): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBeLessThan(300);
  return res.json();
}

async function get(url: string): Promise<any> {
  const res = await app.inject({ url });
  expect(res.statusCode, `GET ${url}: ${res.body}`).toBe(200);
  return res.json();
}

/** `search_by_index` through the lens: its answer, or its refusal's text. */
async function search(args: object, lens = "all"): Promise<{ isError: boolean; text: string; body?: Row }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createRuntimeMcpServer(O, lens).connect(serverTransport);
  const client = new Client({ name: "runtime-search-api", version: "0.0.1" });
  await client.connect(clientTransport);
  try {
    const result = (await client.callTool({ name: "search_by_index", arguments: { ...args } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = result.content[0]!.text;
    return result.isError ? { isError: true, text } : { isError: false, text, body: JSON.parse(text) };
  } finally {
    await client.close();
  }
}

async function hits(args: object, lens = "all"): Promise<Row[]> {
  const res = await search(args, lens);
  expect(res.isError, res.text).toBe(false);
  return res.body!.hits;
}

describe("runtime index search", () => {
  const ids: Record<string, string> = {};

  /** person —works_for (role, since)→ company; Ada (CTO at ACME, Advisor
   * at Foo), Bob (CTO at Foo); the custom index through the modeling API;
   * the worker drained. */
  async function setUp(): Promise<void> {
    await post("/api/ontologies", { key: O });
    await post(`${MODEL}/lenses`, { key: "all", name: "All" });
    const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
    await post(`${MODEL}/entity-types/${person.entityTypeId}/properties`, {
      key: "status",
      displayName: "Status",
      dataType: "string",
    });
    await post(`${MODEL}/entity-types`, { key: "company", displayName: "Company" });
    const worksFor = await post(`${MODEL}/relation-types`, {
      key: "works_for",
      displayName: "Works for",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "company",
    });
    for (const [key, dataType] of [["role", "string"], ["since", "integer"]] as const) {
      await post(`${MODEL}/relation-types/${worksFor.relationTypeId}/properties`, {
        key,
        displayName: key[0]!.toUpperCase() + key.slice(1),
        dataType,
      });
    }

    ids.ada = (await post(`${RUNTIME}/entities/person`, { name: "Ada", status: "active" }))._id;
    ids.bob = (await post(`${RUNTIME}/entities/person`, { name: "Bob", status: "retired" }))._id;
    ids.acme = (await post(`${RUNTIME}/entities/company`, { name: "ACME" }))._id;
    ids.foo = (await post(`${RUNTIME}/entities/company`, { name: "Foo" }))._id;
    for (const [person, company, role, since] of [
      ["ada", "acme", "CTO", 2020],
      ["ada", "foo", "Advisor", 2018],
      ["bob", "foo", "CTO", 2021],
    ] as const) {
      const relation = await post(`${RUNTIME}/relations/works_for`, {
        fromEntityId: ids[person],
        toEntityId: ids[company],
        role,
        since,
      });
      ids[`${person}@${company}`] = relation._id;
    }

    const created = await app.inject({ method: "POST", url: `${MODEL}/search-indices`, payload: EMPLOYMENT });
    expect(created.statusCode, created.body).toBe(201);
    await drainSearchWork({ ontologyKey: O });
  }

  /** A lens including `person` only, and the custom index. */
  async function peopleLens(): Promise<void> {
    const lens = await post(`${MODEL}/lenses`, { key: "hr", name: "HR" });
    await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "person" });
    await post(`${MODEL}/lenses/${lens.lensId}/includes/search-indices`, { key: EMPLOYMENT.key });
  }

  beforeEach(setUp);

  it("pairs each relation with its own target: CTO ACME finds Ada through that employment", async () => {
    const res = await search({ query: "CTO ACME", index: EMPLOYMENT.key });
    expect(res.isError, res.text).toBe(false);
    const body = res.body!;
    expect(body).toMatchObject({ query: "CTO ACME", mode: "keyword", minSimilarity: null });
    expect(body.hits[0]).toMatchObject({
      entity: { _id: ids.ada, _entityTypeKey: "person", name: "Ada" },
      relativeScore: 1,
      matched: {
        index: EMPLOYMENT.key,
        partKind: "relation",
        relationType: "works_for",
        relationId: ids["ada@acme"],
        target: { id: ids.acme, type: "company", label: "ACME" },
        charOffset: null,
        charLength: null,
      },
    });
    expect(body.hits[0].matched.snippet).toContain("CTO");

    // Bob is CTO of Foo: his entry pairs both terms, Ada has no such entry.
    const foo = await hits({ query: "CTO Foo", index: EMPLOYMENT.key });
    expect(foo[0]).toMatchObject({
      entity: { _id: ids.bob },
      matched: { relationId: ids["bob@foo"], target: { id: ids.foo, label: "Foo" } },
    });
    // Keyword matching takes any term, so Ada still matches one term —
    // "CTO" of her ACME entry or "Foo" of her advisor entry — but never
    // both in one entry: she ranks below Bob, through a partial match.
    const ada = foo.find((hit) => hit.entity._id === ids.ada)!;
    expect(foo.indexOf(ada)).toBeGreaterThan(0);
    expect(ada.relativeScore).toBeLessThan(1);
    expect([ids["ada@acme"], ids["ada@foo"]]).toContain(ada.matched.relationId);
    expect(/CTO/.test(ada.matched.snippet) && /Foo/.test(ada.matched.snippet)).toBe(false);
  });

  it("all indices of the lens when none is named; the default index finds names", async () => {
    const found = await hits({ query: "Bob" });
    expect(found[0]).toMatchObject({ entity: { _id: ids.bob }, matched: { partKind: "self" } });
  });

  it("relations narrows the relation entries; a scoped lens hiding companies skips them", async () => {
    expect((await hits({ query: "CTO ACME", index: EMPLOYMENT.key, relations: ["works_for"] }))[0]!.entity._id).toBe(
      ids.ada,
    );
    // No relation type: only self entries count, and none says CTO.
    expect(await hits({ query: "CTO ACME", index: EMPLOYMENT.key, relations: [] })).toEqual([]);

    await peopleLens();
    expect(await hits({ query: "CTO ACME" }, "hr")).toEqual([]);
    // The self entries still serve.
    expect((await hits({ query: "Ada" }, "hr")).map((hit) => hit.entity._id)).toEqual([ids.ada]);
    // works_for is hidden in that lens: naming it is an unknown relation type.
    const hidden = await search({ query: "CTO", relations: ["works_for"] }, "hr");
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toContain("relations.0: Relation type 'works_for' not found");
  });

  it("the catalog lists the indices with their relation group label, projected through the lens", async () => {
    const catalog = (await get(`${RUNTIME}/search-indices`)) as Row[];
    expect(catalog.map((index) => index.key).sort()).toEqual(
      ["company~default", "person_employment", "person~default"].sort(),
    );
    expect(catalog.find((index) => index.key === EMPLOYMENT.key)).toEqual({
      key: EMPLOYMENT.key,
      kind: "custom",
      name: EMPLOYMENT.name,
      description: EMPLOYMENT.description,
      entityType: "person",
      fields: ["name"],
      relations: [{ relationType: "works_for", direction: "outgoing", label: "Employment" }],
      documentProperty: null,
      modes: ["keyword"],
      status: "ready",
    });

    await peopleLens();
    expect(await get(`${runtimeOf("hr")}/search-indices`)).toEqual([
      expect.objectContaining({ key: EMPLOYMENT.key, relations: [] }),
    ]);
  });

  it("switched-off managed indices are neither listed nor searchable", async () => {
    const switched = await app.inject({
      method: "PUT",
      url: `${MODEL}/search-settings`,
      payload: { disabledIndices: ["company~default"] },
    });
    expect(switched.statusCode, switched.body).toBe(200);
    const catalog = (await get(`${RUNTIME}/search-indices`)) as Row[];
    expect(catalog.map((index) => index.key)).not.toContain("company~default");
    const refused = await search({ query: "ACME", index: "company~default" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("indices.0: Search index 'company~default' is not available in this lens");
  });

  it("answers an unknown index as one the lens cannot search, and collects invalid requests by field", async () => {
    const unknown = await search({ query: "x", index: ["ghost"] });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("indices.0: Search index 'ghost' is not available in this lens");

    const invalid = await search({ query: " ", index: [], filters: { ghost: "1" } });
    expect(invalid.isError).toBe(true);
    for (const field of ["query", "indices", "ghost"]) expect(invalid.text).toContain(`${field}:`);
  });

  it("the filters object takes property keys and query paths; fields projects", async () => {
    const byStatus = await hits({ query: "CTO", index: EMPLOYMENT.key, filters: { status: "retired" } });
    expect(byStatus.map((hit) => hit.entity._id)).toEqual([ids.bob]);
    const byPath = await hits({ query: "CTO", index: EMPLOYMENT.key, filters: { "works_for:out.name": "ACME" } });
    expect(byPath.map((hit) => hit.entity._id)).toEqual([ids.ada]);
    const byRelation = await hits({ query: "CTO", index: EMPLOYMENT.key, filters: { "works_for@since__gte": "2021" } });
    expect(byRelation.map((hit) => hit.entity._id)).toEqual([ids.bob]);

    const projected = await hits({ query: "Ada", fields: ["status"] });
    expect(projected[0]!.entity).toEqual({ _id: ids.ada, _entityTypeKey: "person", status: "active" });
  });
});
