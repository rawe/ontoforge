/**
 * The runtime index search through REST only, on PostgreSQL: an ontology,
 * its schema and data, a custom index created through the modeling API
 * and built by the worker, then `POST search` — a relation entry pairs one
 * employment with its own company, a scoped lens hiding companies skips
 * the relation entries, `relations` narrows them — and the lens's catalog
 * `GET search-indices` with its relation group label, without switched-off
 * managed indices. Plus the error cases, the filters object and the field
 * projection. Keyword mode throughout (no provider); the semantic and
 * hybrid legs run in the embedding suite. On an adapter without search
 * indices both routes answer FEATURE_DISABLED. Requires the
 * docker-compose database.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const postgres = settings.DB_BACKEND === "postgres";
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

const search = (body: object, lens = "all") =>
  app.inject({ method: "POST", url: `${runtimeOf(lens)}/search`, payload: body });

async function hits(body: object, lens = "all"): Promise<Row[]> {
  const res = await search(body, lens);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().hits;
}

it.skipIf(postgres)("an adapter without search indices answers FEATURE_DISABLED for the catalog and the index search", async () => {
  await post("/api/ontologies", { key: O });
  await post(`${MODEL}/lenses`, { key: "all", name: "All" });
  for (const res of [
    await app.inject({ url: `${RUNTIME}/search-indices` }),
    await search({ query: "x" }),
  ]) {
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error.details.code).toBe("FEATURE_DISABLED");
  }
});

describe.skipIf(!postgres)("runtime index search through REST", () => {
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
    const res = await search({ query: "CTO ACME", indices: [EMPLOYMENT.key] });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ query: "CTO ACME", mode: "keyword" });
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
    const foo = await hits({ query: "CTO Foo", indices: [EMPLOYMENT.key] });
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
    expect((await hits({ query: "CTO ACME", indices: [EMPLOYMENT.key], relations: ["works_for"] }))[0]!.entity._id).toBe(
      ids.ada,
    );
    // No relation type: only self entries count, and none says CTO.
    expect(await hits({ query: "CTO ACME", indices: [EMPLOYMENT.key], relations: [] })).toEqual([]);

    await peopleLens();
    expect(await hits({ query: "CTO ACME" }, "hr")).toEqual([]);
    // The self entries still serve.
    expect((await hits({ query: "Ada" }, "hr")).map((hit) => hit.entity._id)).toEqual([ids.ada]);
    // works_for is hidden in that lens: naming it is an unknown relation type.
    const hidden = await search({ query: "CTO", relations: ["works_for"] }, "hr");
    expect(hidden.statusCode).toBe(422);
    expect(Object.keys(hidden.json().error.details.fields)).toEqual(["relations.0"]);
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
    const refused = await search({ query: "ACME", indices: ["company~default"] });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details.fields).toEqual({
      "indices.0": "Search index 'company~default' is not available in this lens",
    });
  });

  it("answers 404 for an unknown index and 422 by field for invalid requests", async () => {
    const unknown = await search({ query: "x", indices: ["ghost"] });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("RESOURCE_NOT_FOUND");

    const invalid = await search({
      query: " ",
      indices: [],
      limit: 101,
      minScore: 0.5,
      mode: "keyword",
      filters: { ghost: "1" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(Object.keys(invalid.json().error.details.fields).sort()).toEqual(
      ["ghost", "indices", "limit", "minScore", "query"].sort(),
    );
    expect((await search({ query: "x", mode: "fuzzy" })).json().error.details.fields).toEqual({
      mode: "Expected semantic, keyword or hybrid",
    });
    const semantic = await search({ query: "x", mode: "semantic" });
    expect(semantic.statusCode).toBe(422);
    expect(semantic.json().error.details.code).toBe("FEATURE_DISABLED");
    // Shape errors come from the route.
    expect((await search({ indices: [EMPLOYMENT.key] })).statusCode).toBe(422);
  });

  it("the filters object takes property keys and query paths; fields projects", async () => {
    const byStatus = await hits({ query: "CTO", indices: [EMPLOYMENT.key], filters: { status: "retired" } });
    expect(byStatus.map((hit) => hit.entity._id)).toEqual([ids.bob]);
    const byPath = await hits({ query: "CTO", indices: [EMPLOYMENT.key], filters: { "works_for:out.name": "ACME" } });
    expect(byPath.map((hit) => hit.entity._id)).toEqual([ids.ada]);
    const byRelation = await hits({ query: "CTO", indices: [EMPLOYMENT.key], filters: { "works_for@since__gte": "2021" } });
    expect(byRelation.map((hit) => hit.entity._id)).toEqual([ids.bob]);

    const projected = await hits({ query: "Ada", fields: ["status"] });
    expect(projected[0]!.entity).toEqual({ _id: ids.ada, _entityTypeKey: "person", status: "active" });
  });
});
