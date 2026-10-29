/**
 * The HTTP contract of the entity search (`POST search/entities`), run with
 * and without local embeddings: the method blocks, the scope rules and
 * their errors, filters as hard facts, `ran` and every limitation, and the
 * item for each part of an entry. Search answers from search indices,
 * whose entries the worker builds asynchronously: a search first drains
 * the queued work, unless it asks for what is not built yet.
 *
 * person (status, bio) —works_for (role)→ company (city); Ada is CTO at
 * ACME, Bob CTO at Foo; the custom index `person_employment` reads the
 * employments. Neither type declares an identity, unless a test does.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { disableProvider, enableOllamaProvider } from "./embedding/support.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const O = "entity_search";
const MODEL = `/api/ontologies/${O}/model`;
const runtimeOf = (lens: string) => `/api/ontologies/${O}/runtime/lenses/${lens}`;
const RUNTIME = runtimeOf("all");
const MANAGED = ["company~default", "person~bio", "person~default"];

const EMPLOYMENT = {
  key: "person_employment",
  name: "People by employment",
  description: "People with their roles at companies.",
  entityType: "person",
  fields: ["name"],
  relations: [
    { relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name"] } },
  ],
};

export function entitySearchContract(embedding: boolean, enabled = true) {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  let personTypeId: string;

  async function post(url: string, payload: object): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBeLessThan(300);
    return res.json();
  }

  /** The search, after the worker built what is queued (`built`). */
  async function search(body: object, lens = "all", built = true) {
    if (built) await drainSearchWork({ ontologyKey: O });
    return app.inject({ method: "POST", url: `${runtimeOf(lens)}/search/entities`, payload: body });
  }

  async function found(body: object, lens = "all"): Promise<Row> {
    const res = await search(body, lens);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  async function fields(body: object, lens = "all"): Promise<Record<string, string>> {
    const res = await search(body, lens);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    return res.json().error.details.fields;
  }

  const idsOf = (body: Row) => body.items.map((item: Row) => item.entity._id);

  /** A lens showing person by `name` only, with `indices` included. */
  async function nameLens(indices: string[]): Promise<void> {
    const lens = await post(`${MODEL}/lenses`, { key: "names", name: "Names" });
    await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "person", properties: ["name"] });
    for (const key of indices) await post(`${MODEL}/lenses/${lens.lensId}/includes/search-indices`, { key });
    invalidateLoadedSchemaCache();
  }

  describe.skipIf(!enabled)(`entity search contract (${embedding ? "Ollama" : "no provider"})`, () => {
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
      await post("/api/ontologies", { key: O });
      await post(`${MODEL}/lenses`, { key: "all", name: "All" });
      const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
      personTypeId = person.entityTypeId;
      for (const [key, dataType] of [["status", "string"], ["bio", "document"]] as const) {
        await post(`${MODEL}/entity-types/${person.entityTypeId}/properties`, { key, displayName: key, dataType });
      }
      const company = await post(`${MODEL}/entity-types`, { key: "company", displayName: "Company" });
      await post(`${MODEL}/entity-types/${company.entityTypeId}/properties`, {
        key: "city",
        displayName: "City",
        dataType: "string",
      });
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
      ids.ada = (
        await post(`${RUNTIME}/entities/person`, {
          name: "Ada",
          status: "active",
          bio: "Ada wrote notes on the analytical engine, a mechanical computer.",
        })
      )._id;
      ids.bob = (
        await post(`${RUNTIME}/entities/person`, {
          name: "Bob",
          status: "retired",
          bio: "Bob grows tomatoes in his garden.",
        })
      )._id;
      ids.acme = (await post(`${RUNTIME}/entities/company`, { name: "ACME", city: "Berlin" }))._id;
      ids.foo = (await post(`${RUNTIME}/entities/company`, { name: "Foo", city: "Hamburg" }))._id;
      for (const [person, company] of [["ada", "acme"], ["bob", "foo"]] as const) {
        await post(`${RUNTIME}/relations/works_for`, { fromEntityId: ids[person], toEntityId: ids[company], role: "CTO" });
      }
      await post(`${MODEL}/search-indices`, EMPLOYMENT);
    });

    it("the blocks sent choose the methods; neither runs both where semantic can", async () => {
      const keyword = await found({ query: "Bob", keyword: {} });
      expect(keyword.ran).toEqual(["keyword"]);
      expect(keyword.limitations).toEqual([]);
      expect(idsOf(keyword)[0]).toBe(ids.bob);

      const neither = await found({ query: "Bob" });
      expect(idsOf(neither)).toContain(ids.bob);
      if (embedding) {
        expect(neither.ran).toEqual(["semantic", "keyword"]);
        expect(neither.limitations).toEqual([]);
        expect((await found({ query: "Bob", semantic: {} })).ran).toEqual(["semantic"]);
        const both = await found({ query: "Bob", semantic: {}, keyword: { match: "all" } });
        expect(both.ran).toEqual(["semantic", "keyword"]);
        expect(idsOf(both)).toContain(ids.bob);
        // The floor drops semantic entries only: at 1, keyword still finds.
        const floored = await found({ query: "Bob", semantic: { minSimilarity: 1 }, keyword: {} });
        expect(floored.ran).toEqual(["semantic", "keyword"]);
        expect(idsOf(floored)).toEqual([ids.bob]);
        expect((await found({ query: "Bob", semantic: { minSimilarity: 1 } })).items).toEqual([]);
      } else {
        // Without a provider neither is keyword only: nothing asked for failed.
        expect(neither.ran).toEqual(["keyword"]);
        expect(neither.limitations).toEqual([]);
        for (const body of [{ semantic: {} }, { semantic: { minSimilarity: 0.5 }, keyword: {} }]) {
          const refused = await search({ query: "Bob", ...body });
          expect(refused.statusCode).toBe(422);
          expect(refused.json().error.details.code).toBe("FEATURE_DISABLED");
        }
      }
    });

    it("keyword match: any needs one query word in an entry, all every one", async () => {
      const any = await found({ query: "CTO ACME", indices: [EMPLOYMENT.key], keyword: { match: "any" } });
      expect(idsOf(any)).toEqual([ids.ada, ids.bob]);
      const all = await found({ query: "CTO ACME", indices: [EMPLOYMENT.key], keyword: { match: "all" } });
      expect(idsOf(all)).toEqual([ids.ada]);
      expect(idsOf(await found({ query: "CTO ACME", indices: [EMPLOYMENT.key], keyword: {} }))).toEqual(idsOf(any));
    });

    it("managed indices by default; a custom one only when named", async () => {
      // "CTO" is in the employments only, which the custom index reads.
      expect((await found({ query: "CTO", keyword: {} })).items).toEqual([]);
      expect((await found({ query: "CTO", types: ["person"], keyword: {} })).items).toEqual([]);
      const named = await found({ query: "CTO", indices: [EMPLOYMENT.key], keyword: {} });
      expect(new Set(idsOf(named))).toEqual(new Set([ids.ada, ids.bob]));
      expect(named.items.every((item: Row) => item.match.index === EMPLOYMENT.key)).toBe(true);
      // types reads the named types' managed indices: the default and the passage index.
      const people = await found({ query: "Bob tomatoes", types: ["person"], keyword: {} });
      expect(idsOf(people)).toEqual([ids.bob]);
      const companies = await found({ query: "ACME Bob", types: ["company"], keyword: {} });
      expect(idsOf(companies)).toEqual([ids.acme]);
      const both = await found({ query: "ACME Bob", types: ["company", "person"], keyword: {} });
      expect(new Set(idsOf(both))).toEqual(new Set([ids.acme, ids.bob]));
    });

    it("a scope the lens cannot serve is an error at its path; a type without an index a limitation", async () => {
      expect(await fields({ query: "x", types: ["ghost", "person"] })).toEqual({
        "types.0": "Entity type 'ghost' not found",
      });
      expect(await fields({ query: "x", indices: ["person~default", "ghost"] })).toEqual({
        "indices.1": "Search index 'ghost' is not available in this lens",
      });
      expect(await fields({ query: "x", types: ["person"], indices: ["person~default"] })).toEqual({
        indices: "Name types or indices, not both",
      });
      expect(await fields({ query: "x", types: [] })).toEqual({ types: "Name at least one entity type, or omit types" });
      expect(await fields({ query: "x", indices: [] })).toEqual({ indices: "Name at least one index, or omit indices" });

      // A lens hiding company: the type is unknown there, its index not searchable.
      await nameLens(["person~default"]);
      expect(await fields({ query: "x", types: ["company"] }, "names")).toEqual({
        "types.0": "Entity type 'company' not found",
      });
      expect(await fields({ query: "x", indices: ["company~default"] }, "names")).toEqual({
        "indices.0": "Search index 'company~default' is not available in this lens",
      });

      // A switched-off managed index: company is visible but has none to search.
      const switched = await app.inject({
        method: "PUT",
        url: `${MODEL}/search-settings`,
        payload: { disabledIndices: ["company~default"] },
      });
      expect(switched.statusCode, switched.body).toBe(200);
      const partly = await found({ query: "ACME Bob", types: ["person", "company"], keyword: {} });
      expect(idsOf(partly)).toEqual([ids.bob]);
      expect(partly.limitations).toEqual([
        {
          code: "not-searchable",
          message: "These entity types have no search index this lens can search",
          types: ["company"],
        },
      ]);
      const none = await found({ query: "ACME", types: ["company"], keyword: {} });
      expect(none).toEqual({ ran: [], items: [], limitations: partly.limitations });
      expect(await fields({ query: "x", indices: ["company~default"] })).toEqual({
        "indices.0": "Search index 'company~default' is not available in this lens",
      });
    });

    it("filters are hard facts: pushed down per type, types that do not declare a key drop out", async () => {
      const retired = await found({ query: "CTO", indices: [EMPLOYMENT.key], keyword: {}, filter: { status: "retired" } });
      expect(idsOf(retired)).toEqual([ids.bob]);
      const byPath = await found({
        query: "CTO",
        indices: [EMPLOYMENT.key],
        keyword: {},
        filter: { "works_for:out.name": "ACME" },
      });
      expect(idsOf(byPath)).toEqual([ids.ada]);
      // company declares no status: it drops out, and no limitation is due.
      const people = await found({ query: "ACME Ada Bob", keyword: {}, filter: { status__ne: "retired" } });
      expect(idsOf(people)).toEqual([ids.ada]);
      expect(people.limitations).toEqual([]);
      const berlin = await found({ query: "ACME Foo Ada", keyword: {}, filter: { city: "Berlin" } });
      expect(idsOf(berlin)).toEqual([ids.acme]);
      // No type declares both keys.
      const nobody = await found({ query: "ACME Ada", keyword: {}, filter: { status: "active", city: "Berlin" } });
      expect(nobody).toEqual({
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
      // Keys are checked against the scope's types, at filter.<key>.
      expect(Object.keys(await fields({ query: "x", types: ["company"], filter: { status: "active" } }))).toEqual([
        "filter.status",
      ]);
      expect(Object.keys(await fields({ query: "x", filter: { ghost: "1", name__contains: "A" } })).sort()).toEqual([
        "filter.ghost",
        "filter.name__contains",
      ]);
    });

    it("a query path drops out the types it does not resolve from; one no type resolves is an error", async () => {
      // No scope: person and company. works_for:out leaves person only.
      const atAcme = await found({ query: "ACME Foo Ada Bob", keyword: {}, filter: { "works_for:out.name": "ACME" } });
      expect(idsOf(atAcme)).toEqual([ids.ada]);
      expect(atAcme.limitations).toEqual([]);
      // From company it is works_for:in: Foo employs Bob.
      expect(idsOf(await found({ query: "ACME Foo", keyword: {}, filter: { "works_for:in.name": "Bob" } }))).toEqual([
        ids.foo,
      ]);
      // The path drops company, city drops person.
      const nobody = await found({
        query: "ACME Ada",
        keyword: {},
        filter: { "works_for:out.name": "ACME", city: "Berlin" },
      });
      expect(nobody).toEqual({
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
      expect(Object.keys(await fields({ query: "x", filter: { "works_for:out.ghost": "1" } }))).toEqual([
        "filter.works_for:out.ghost",
      ]);
    });

    it("collects every broken rule at the request's own path; the body is strict", async () => {
      expect(
        await fields({
          query: " ",
          keyword: { match: "most" },
          semantic: { minSimilarity: 1.5 },
          limit: 101,
          filter: { ghost: "1" },
        }),
      ).toEqual({
        query: "Required non-empty query",
        limit: "Expected integer from 1 to 100",
        "keyword.match": "Expected any or all",
        "semantic.minSimilarity": "Expected number from 0 to 1",
        "filter.ghost": "Unknown filter property or relation type: 'ghost'",
      });
      expect(Object.keys(await fields({ query: "x", limit: 0 }))).toEqual(["limit"]);
      expect(Object.keys(await fields({ query: "x", limit: 2.5 }))).toEqual(["limit"]);
      for (const body of [
        { query: "x", mode: "keyword" },
        { query: "x", keyword: { match: "any", fuzzy: true } },
        { query: "x", semantic: { floor: 0.5 } },
        { types: ["person"] },
      ]) {
        const res = await search(body);
        expect(res.statusCode, JSON.stringify(body)).toBe(422);
        expect(res.json().error.details.errors.length).toBeGreaterThan(0);
      }
      const limited = await found({ query: "ACME Foo Ada Bob", keyword: {}, limit: 2 });
      expect(limited.items.map((item: Row) => item.rank)).toEqual([1, 2]);
    });

    it("an item names the entity and the best entry that found it: self, relation, passage", async () => {
      const self = await found({ query: "retired", types: ["person"], keyword: {} });
      expect(self.items).toEqual([
        {
          rank: 1,
          entity: { _id: ids.bob, _entityTypeKey: "person", name: "Bob" },
          match: { index: "person~default", part: "self", snippet: expect.stringContaining("retired") },
        },
      ]);

      const relation = await found({ query: "CTO ACME", indices: [EMPLOYMENT.key], keyword: { match: "all" } });
      expect(relation.items).toEqual([
        {
          rank: 1,
          entity: { _id: ids.ada, _entityTypeKey: "person", name: "Ada" },
          match: {
            index: EMPLOYMENT.key,
            part: "relation",
            snippet: expect.stringContaining("CTO"),
            relationType: "works_for",
            target: { _id: ids.acme, _entityTypeKey: "company", name: "ACME" },
          },
        },
      ]);

      const passage = await found({ query: "tomatoes", types: ["person"], keyword: {} });
      expect(passage.items).toEqual([
        {
          rank: 1,
          entity: { _id: ids.bob, _entityTypeKey: "person", name: "Bob" },
          match: {
            index: "person~bio",
            part: "passage",
            snippet: expect.stringContaining("Bob grows tomatoes in his garden."),
            property: "bio",
            charOffset: 0,
            charLength: "Bob grows tomatoes in his garden.".length,
          },
        },
      ]);
    });

    it("an entity whose type declares an identity carries it, in its order; one whose lens hides part of it none", async () => {
      await nameLens(["person~default"]);
      // The cascade adds status to the lens that lists person's properties.
      const declared = await app.inject({
        method: "PUT",
        url: `${MODEL}/entity-types/${personTypeId}?cascade=true`,
        payload: { identityProperties: ["status", "name"] },
      });
      expect(declared.statusCode, declared.body).toBe(200);
      invalidateLoadedSchemaCache();
      const person = await found({ query: "retired", types: ["person"], keyword: {} });
      expect(person.items[0].entity).toEqual({
        _id: ids.bob,
        _entityTypeKey: "person",
        name: "Bob",
        identity: { status: "retired", name: "Bob" },
      });
      expect(Object.keys(person.items[0].entity.identity)).toEqual(["status", "name"]);
      // company declares none; a relation target is named without one.
      const company = await found({ query: "ACME", types: ["company"], keyword: {} });
      expect(company.items[0].entity).toEqual({ _id: ids.acme, _entityTypeKey: "company", name: "ACME" });
      const relation = await found({ query: "CTO ACME", indices: [EMPLOYMENT.key], keyword: { match: "all" } });
      expect(relation.items[0].entity.identity).toEqual({ status: "active", name: "Ada" });
      expect(relation.items[0].match.target).toEqual({ _id: ids.acme, _entityTypeKey: "company", name: "ACME" });

      // Only a design import writes a lens that hides an identity property.
      const design = (await app.inject({ method: "GET", url: `${MODEL}/export` })).json();
      const names = design.lenses.find((lens: Row) => lens.key === "names");
      names.includes.entityTypes = [{ ...names.includes.entityTypes[0], properties: ["name"] }];
      const copy = "entity_search_copy";
      await post("/api/ontologies", { key: copy });
      await post(`/api/ontologies/${copy}/model/import`, design);
      await post(`/api/ontologies/${copy}/runtime/lenses/all/entities/person`, { name: "Cy", status: "active" });
      invalidateLoadedSchemaCache();
      await drainSearchWork({ ontologyKey: copy });
      const cy = async (lens: string) => {
        const res = await app.inject({
          method: "POST",
          url: `/api/ontologies/${copy}/runtime/lenses/${lens}/search/entities`,
          payload: { query: "Cy", keyword: {} },
        });
        expect(res.statusCode, res.body).toBe(200);
        return res.json().items.map((item: Row) => item.entity);
      };
      const whole = { _id: expect.any(String), _entityTypeKey: "person", name: "Cy" };
      expect(await cy("all")).toEqual([{ ...whole, identity: { status: "active", name: "Cy" } }]);
      expect(await cy("names")).toEqual([whole]);
    });

    it("withholds the snippet of an index that reads a property the lens hides", async () => {
      // person~default reads name and status; the lens shows name only.
      await nameLens(["person~default", EMPLOYMENT.key]);
      const hidden = await found({ query: "Ada", keyword: {} }, "names");
      expect(hidden.items).toEqual([
        {
          rank: 1,
          entity: { _id: ids.ada, _entityTypeKey: "person", name: "Ada" },
          match: { index: "person~default", part: "self", snippet: null },
        },
      ]);
      // company is hidden: the employments are skipped, the self entries still serve.
      expect((await found({ query: "CTO", indices: [EMPLOYMENT.key], keyword: {} }, "names")).items).toEqual([]);
      const own = await found({ query: "Ada", indices: [EMPLOYMENT.key], keyword: {} }, "names");
      expect(own.items[0].match).toEqual({ index: EMPLOYMENT.key, part: "self", snippet: "Ada" });
    });

    it("a method that cannot run on an index is a limitation: switched off, not built yet", async () => {
      await post(`${MODEL}/search-indices`, {
        ...EMPLOYMENT,
        key: "employment_meaning",
        name: "Employment by meaning",
        keyword: { enabled: false },
      });
      const off = await found({ query: "CTO", indices: ["employment_meaning", EMPLOYMENT.key], keyword: {} });
      expect(off.ran).toEqual(["keyword"]);
      expect(new Set(idsOf(off))).toEqual(new Set([ids.ada, ids.bob]));
      expect(off.limitations).toEqual([
        {
          code: "switched-off",
          message: "Keyword search is switched off on these indices",
          method: "keyword",
          indices: ["employment_meaning"],
        },
      ]);
      const alone = await found({ query: "CTO", indices: ["employment_meaning"], keyword: {} });
      expect(alone).toMatchObject({ ran: [], items: [] });

      // A new index answers once the worker built it.
      await post(`${MODEL}/search-indices`, { ...EMPLOYMENT, key: "employment_new", name: "New employment" });
      const pending = await search({ query: "CTO", indices: ["employment_new", EMPLOYMENT.key] }, "all", false);
      expect(pending.statusCode, pending.body).toBe(200);
      const body = pending.json();
      expect(body.ran).toEqual(embedding ? ["semantic", "keyword"] : ["keyword"]);
      expect(new Set(idsOf(body))).toEqual(new Set([ids.ada, ids.bob]));
      const notReady = (method: string) => ({
        code: "not-ready",
        message: `${method === "semantic" ? "Semantic" : "Keyword"} search entries of these indices are not built yet`,
        method,
        indices: ["employment_new"],
      });
      expect(body.limitations).toEqual(embedding ? [notReady("semantic"), notReady("keyword")] : [notReady("keyword")]);
      expect((await found({ query: "CTO", indices: ["employment_new"], keyword: {} })).limitations).toEqual([]);
    });

    it.skipIf(!embedding)("hybrid over two types fuses both methods into one ranking", async () => {
      const body = await found({ query: "a company in Berlin", types: ["company", "person"] });
      expect(body.ran).toEqual(["semantic", "keyword"]);
      expect(body.limitations).toEqual([]);
      expect(body.items.map((item: Row) => item.rank)).toEqual(body.items.map((_: Row, i: number) => i + 1));
      expect(new Set(body.items.map((item: Row) => item.entity._entityTypeKey))).toEqual(new Set(["company", "person"]));
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(["entity", "match", "rank"]);
        expect(Object.keys(item.entity).sort()).toEqual(["_entityTypeKey", "_id", "name"]);
        expect(MANAGED).toContain(item.match.index);
      }
    });
  });
}
