/**
 * Query paths on semantic search, end-to-end against the docker-compose
 * database and a local Ollama. A path filter narrows both rankings —
 * entities and document passages — to entities that satisfy it, and the
 * requested limit counts only matching hits. What to expect is decided by
 * the adapter's own declaration, read through the port, never by the
 * backend's name: an adapter declaring support runs the path cases; one
 * declaring none runs the rejection cases. The plain-filter passage case
 * and the type-required fault run everywhere. SKIPPED when Ollama or the
 * model is unavailable.
 *
 * Instance data: Alice (34), Carol (45) and Erin (39) work for Acme —
 * Alice as CTO, the others as Engineer; Bob (28) works for Globex as
 * Engineer; Dave (51) works nowhere. Bob's and Dave's bios repeat the
 * query almost verbatim, so their passages outrank everyone else's — the
 * passages that must be excluded when the filter names Acme.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, getRuntimeStore, initStores } from "../../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

const LENS = "/api/ontologies/test_ont/runtime/lenses/path_search";
const SEARCH = `${LENS}/search/semantic?q=punched%20cards%20and%20polynomial%20tables`;

/** Near the query: the passages that rank first. */
const NEAR_BIO = "The analytical engine reads punched cards and computes polynomial tables.";
/** Related, further from the query: the passages that rank behind. */
const FAR_BIO = "A mechanical calculating machine that tabulates functions from cards.";

let app: FastifyInstance;
/** The adapter's declaration, read through the port once the ontology exists. */
let pathsSupported: boolean;

describe.skipIf(!ollamaUp)("query paths on semantic search (Ollama)", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();
    await buildFixture();
    pathsSupported = (await getRuntimeStore("test_ont")).supportsSemanticSearchPathConditions();
  });

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  async function post(url: string, payload: Row): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
    return res.json() as Row;
  }

  /** person (name, age, bio document) -works_for(role)-> company (name,
   * profile document), through the unscoped lens `path_search`. */
  async function buildFixture(): Promise<void> {
    await post("/api/ontologies", { key: "test_ont" });
    await post("/api/ontologies/test_ont/model/lenses", { key: "path_search", name: "Path Search" });
    const model = "/api/ontologies/test_ont/model";
    const person = await post(`${model}/entity-types`, { key: "person", displayName: "Person" });
    for (const prop of [
      { key: "name", displayName: "Name", dataType: "string", required: true },
      { key: "age", displayName: "Age", dataType: "integer" },
      { key: "bio", displayName: "Bio", dataType: "document" },
    ]) {
      await post(`${model}/entity-types/${person.entityTypeId as string}/properties`, prop);
    }
    const company = await post(`${model}/entity-types`, { key: "company", displayName: "Company" });
    for (const prop of [
      { key: "name", displayName: "Name", dataType: "string", required: true },
      { key: "profile", displayName: "Profile", dataType: "document" },
    ]) {
      await post(`${model}/entity-types/${company.entityTypeId as string}/properties`, prop);
    }
    const worksFor = await post(`${model}/relation-types`, {
      key: "works_for",
      displayName: "Works For",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "company",
    });
    await post(`${model}/relation-types/${worksFor.relationTypeId as string}/properties`, {
      key: "role",
      displayName: "Role",
      dataType: "string",
    });

    const acme = await post(`${LENS}/entities/company`, {
      name: "Acme",
      profile: "Acme builds engines that tabulate polynomial functions from punched cards.",
    });
    const globex = await post(`${LENS}/entities/company`, {
      name: "Globex",
      profile: "Globex sells garden tools, seeds and watering cans.",
    });
    const people: Record<string, Row> = {};
    for (const [name, age, bio] of [
      ["Alice", 34, FAR_BIO],
      ["Bob", 28, NEAR_BIO],
      ["Carol", 45, FAR_BIO],
      ["Dave", 51, NEAR_BIO],
      ["Erin", 39, FAR_BIO],
    ] as [string, number, string][]) {
      people[name] = await post(`${LENS}/entities/person`, { name, age, bio });
    }
    for (const [name, company, role] of [
      ["Alice", acme, "CTO"],
      ["Bob", globex, "Engineer"],
      ["Carol", acme, "Engineer"],
      ["Erin", acme, "Engineer"],
    ] as [string, Row, string][]) {
      await post(`${LENS}/relations/works_for`, {
        fromEntityId: people[name]!._id,
        toEntityId: company._id,
        role,
      });
    }
  }

  /** The hits of one search, as the entity names in rank order. */
  async function hits(query: string): Promise<{ names: string[]; results: Row[] }> {
    const res = await app.inject({ method: "GET", url: `${SEARCH}&${query}` });
    expect(res.statusCode, `GET ${query}: ${res.body}`).toBe(200);
    const results = (res.json() as { results: Row[] }).results;
    return { names: results.map((r) => (r.entity as Row).name as string), results };
  }

  async function rejected(query: string): Promise<{ message: string; fields: Record<string, string> }> {
    const res = await app.inject({ method: "GET", url: `${SEARCH}&${query}` });
    expect(res.statusCode, `GET ${query}: ${res.body}`).toBe(422);
    const error = res.json().error as { message: string; details: { fields: Record<string, string> } };
    return { message: error.message, fields: error.details.fields };
  }

  function whenSupported(ctx: TestContext): void {
    if (!pathsSupported) {
      ctx.skip("the adapter declares no path-condition support on semantic search");
    }
  }

  function whenUnsupported(ctx: TestContext): void {
    if (pathsSupported) {
      ctx.skip("the adapter declares path-condition support on semantic search");
    }
  }

  describe("on an adapter declaring support", () => {
    it("the entity ranking, outgoing, related-entity form: persons by their company's name", async (ctx) => {
      whenSupported(ctx);
      const { names } = await hits("type=person&searchIn=entities&filter.works_for.name=Acme");
      expect(names.sort()).toEqual(["Alice", "Carol", "Erin"]);
    });

    it("the passage ranking, outgoing, relation-property form: passages on entities whose employment fails the filter are excluded", async (ctx) => {
      whenSupported(ctx);
      const { names, results } = await hits("type=person&searchIn=documents&filter.works_for@role=CTO");
      expect(names).toEqual(["Alice"]);
      expect((results[0]!.matchedVia as Row).source).toBe("document");
    });

    it("the passage ranking, incoming, related-entity form: companies by an employee's name", async (ctx) => {
      whenSupported(ctx);
      const { names, results } = await hits("type=company&searchIn=documents&filter.works_for.name=Bob");
      expect(names).toEqual(["Globex"]);
      expect((results[0]!.matchedVia as Row).source).toBe("document");
    });

    it("both rankings fused, incoming, relation-property form: companies with a CTO", async (ctx) => {
      whenSupported(ctx);
      const { names } = await hits("type=company&filter.works_for@role=CTO");
      expect(names).toEqual(["Acme"]);
    });

    it("an explicit direction marker that agrees with the endpoints is accepted", async (ctx) => {
      whenSupported(ctx);
      const { names } = await hits("type=person&searchIn=entities&filter.works_for:out@role=Engineer");
      expect(names.sort()).toEqual(["Bob", "Carol", "Erin"]);
    });

    it("a path filter and a plain filter combine by AND", async (ctx) => {
      whenSupported(ctx);
      const { names } = await hits("type=person&filter.works_for.name=Acme&filter.age__gt=40");
      expect(names).toEqual(["Carol"]);
    });

    it("the limit counts filtered passage hits: the page is refilled past the excluded passages", async (ctx) => {
      whenSupported(ctx);
      // The premise: unfiltered, the two best passages belong to Bob and
      // Dave, neither of whom works for Acme.
      const unfiltered = await hits("type=person&searchIn=documents&limit=2");
      expect(unfiltered.names.sort()).toEqual(["Bob", "Dave"]);

      // Filtered to Acme's employees, a page of two is still full — with
      // passages that ranked behind the excluded ones.
      const two = await hits("type=person&searchIn=documents&limit=2&filter.works_for.name=Acme");
      expect(two.names).toHaveLength(2);
      for (const name of two.names) {
        expect(["Alice", "Carol", "Erin"]).toContain(name);
      }
      const three = await hits("type=person&searchIn=documents&limit=3&filter.works_for.name=Acme");
      expect(three.names.sort()).toEqual(["Alice", "Carol", "Erin"]);
    });

    it("an unknown path, a substring on a path and an uncoercible value are rejected together", async (ctx) => {
      whenSupported(ctx);
      const { message, fields } = await rejected(
        "type=person&filter.ghost.name=x&filter.works_for.name__contains=Ac&filter.age=abc",
      );
      expect(fields).toEqual({
        "ghost.name":
          "Not defined in type 'person'. Property keys: age, bio, name. " +
          "Relation types touching 'person': works_for",
        "works_for.name__contains": "Not supported on semantic search",
        age: expect.stringContaining("Expected integer"),
      });
      expect(message).toContain("Unknown filter property or relation type: 'ghost'");
      expect(message).toContain("'__contains' filter is not supported on semantic search");
      expect(message).toContain("Invalid filter value for 'age'");
    });
  });

  describe("on an adapter declaring none", () => {
    const REJECTION =
      "Not supported on semantic search by the active storage adapter; " +
      "filter by the query path on the entity list instead";

    it.for(["works_for.name", "works_for@role"])(
      "a path filter is rejected above the port, naming the entity list, together with the other faults: %s",
      async (key, ctx) => {
        whenUnsupported(ctx);
        const { message, fields } = await rejected(`type=person&filter.${key}=x&filter.age=abc`);
        expect(fields).toEqual({
          [key]: REJECTION,
          age: expect.stringContaining("Expected integer"),
        });
        expect(message).toContain(
          `Query path '${key}' is not supported on semantic search by the active storage adapter`,
        );
      },
    );

    it("the entity list takes the same path filter", async (ctx) => {
      whenUnsupported(ctx);
      const res = await app.inject({
        method: "GET",
        url: `${LENS}/entities/person?filter.works_for.name=Acme`,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { items: Row[] };
      expect(body.items.map((e) => e.name as string).sort()).toEqual(["Alice", "Carol", "Erin"]);
    });
  });

  describe("on every adapter", () => {
    it("a plain filter narrows the passage ranking", async () => {
      const { names, results } = await hits("type=person&searchIn=documents&filter.age__gt=40");
      expect(names.sort()).toEqual(["Carol", "Dave"]);
      for (const hit of results) {
        expect((hit.matchedVia as Row).source).toBe("document");
      }
    });

    it("a path filter without a type is rejected as every filter is", async () => {
      const { message, fields } = await rejected("filter.works_for.name=Acme");
      expect(message).toContain("require 'type'");
      expect(fields).toEqual({ "works_for.name": "Requires 'type'" });
    });
  });
});
