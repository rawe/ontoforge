/**
 * Query paths on the entity list — conformance over REST, on whichever
 * adapter `DB_BACKEND` selects. A filter key crosses one relation type
 * to a property of the related entity; the direction is derived from the
 * relation type's endpoints; an entity matches when at least one related
 * entity satisfies the condition; faults are collected under their keys.
 *
 * Instance data: Alice (30) and Carol (40) work for Acme, Bob (25) and
 * Carol for Globex; Dave (35) works nowhere; Initech employs nobody.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture, modelPrefix, runtimePrefix, type FixtureIds } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

let app: FastifyInstance;
let fixture: FixtureIds;

type Row = Record<string, unknown>;

const LENS = runtimePrefix("test_ont", "test_lens");

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

async function create(url: string, payload: Row): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  fixture = await buildFixture(app);

  const acme = await create(`${LENS}/entities/company`, {
    name: "Acme",
    founded: "2000-01-01",
    employee_count: 100,
  });
  const globex = await create(`${LENS}/entities/company`, {
    name: "Globex",
    founded: "2010-06-15",
    employee_count: 50,
  });
  await create(`${LENS}/entities/company`, {
    name: "Initech",
    founded: "2020-03-03",
    employee_count: 10,
  });
  const alice = await create(`${LENS}/entities/person`, { name: "Alice", age: 30 });
  const bob = await create(`${LENS}/entities/person`, { name: "Bob", age: 25 });
  const carol = await create(`${LENS}/entities/person`, { name: "Carol", age: 40 });
  await create(`${LENS}/entities/person`, { name: "Dave", age: 35 });
  for (const [from, to] of [
    [alice, acme],
    [bob, globex],
    [carol, acme],
    [carol, globex],
  ]) {
    await create(`${LENS}/relations/works_for`, { fromEntityId: from!._id, toEntityId: to!._id });
  }
});

/** The sorted names of the entities a listing returns, with its total. */
async function names(url: string): Promise<{ names: string[]; total: number }> {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, `GET ${url}: ${res.body}`).toBe(200);
  const body = res.json() as { items: Row[]; total: number };
  return { names: body.items.map((e) => e.name as string).sort(), total: body.total };
}

async function rejected(url: string): Promise<{ message: string; fields: Record<string, string> }> {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, `GET ${url}: ${res.body}`).toBe(422);
  const error = res.json().error as { message: string; details: { fields: Record<string, string> } };
  return { message: error.message, fields: error.details.fields };
}

describe("derived direction", () => {
  it("outgoing — persons by their company's name", async () => {
    expect(await names(`${LENS}/entities/person?filter.works_for.name=Acme`)).toEqual({
      names: ["Alice", "Carol"],
      total: 2,
    });
  });

  it("incoming — companies by an employee's age", async () => {
    expect(await names(`${LENS}/entities/company?filter.works_for.age__lt=30`)).toEqual({
      names: ["Globex"],
      total: 1,
    });
    expect(await names(`${LENS}/entities/company?filter.works_for.age__gt=30`)).toEqual({
      names: ["Acme", "Globex"],
      total: 2,
    });
  });
});

describe("the six operators, coerced by the final property's data type", () => {
  it.each([
    ["filter.works_for.employee_count=100", ["Alice", "Carol"]],
    ["filter.works_for.employee_count__gt=50", ["Alice", "Carol"]],
    ["filter.works_for.employee_count__gte=50", ["Alice", "Bob", "Carol"]],
    ["filter.works_for.employee_count__lt=100", ["Bob", "Carol"]],
    ["filter.works_for.employee_count__lte=50", ["Bob", "Carol"]],
    ["filter.works_for.name__contains=LOB", ["Bob", "Carol"]],
    ["filter.works_for.founded__lt=2005-01-01", ["Alice", "Carol"]],
  ])("%s", async (query, expected) => {
    const result = await names(`${LENS}/entities/person?${query}`);
    expect(result.names).toEqual(expected);
    expect(result.total).toBe(expected.length);
  });

  it("a value the final property cannot coerce is rejected under the path key", async () => {
    const { message, fields } = await rejected(
      `${LENS}/entities/person?filter.works_for.founded__lt=soon`,
    );
    expect(message).toBe("Invalid filter value for 'works_for.founded'");
    expect(Object.keys(fields)).toEqual(["works_for.founded__lt"]);
  });
});

describe("existential matching", () => {
  it("an entity with several relations matches when any related entity satisfies the condition", async () => {
    expect((await names(`${LENS}/entities/person?filter.works_for.name=Globex`)).names).toEqual([
      "Bob",
      "Carol",
    ]);
  });

  it("two conditions through the same relation type may be satisfied by two different related entities", async () => {
    // Acme by employee count, Globex by name — only Carol works for both.
    expect(
      await names(
        `${LENS}/entities/person?filter.works_for.employee_count=100&filter.works_for.name=Globex`,
      ),
    ).toEqual({ names: ["Carol"], total: 1 });
  });

  it("an entity with no relation of the type never matches, in either direction", async () => {
    expect(
      (await names(`${LENS}/entities/person?filter.works_for.employee_count__gte=0`)).names,
    ).toEqual(["Alice", "Bob", "Carol"]);
    expect((await names(`${LENS}/entities/company?filter.works_for.age__gte=0`)).names).toEqual([
      "Acme",
      "Globex",
    ]);
  });
});

describe("combination by AND", () => {
  it("with plain conditions and the free-text term", async () => {
    expect(
      (await names(`${LENS}/entities/person?filter.works_for.name=Acme&filter.age__gt=30`)).names,
    ).toEqual(["Carol"]);
    expect((await names(`${LENS}/entities/person?q=al&filter.works_for.name=Acme`)).names).toEqual(
      ["Alice"],
    );
  });

  it("with another path condition", async () => {
    expect(
      (
        await names(
          `${LENS}/entities/person?filter.works_for.name=Acme&filter.works_for.employee_count__lt=100`,
        )
      ).names,
    ).toEqual(["Carol"]);
  });
});

describe("rejections, collected under their filter keys", () => {
  /** Widen the schema with what the six fault kinds need: a relation type
   * not touching persons, a document property on companies, and a
   * self-relation on persons. */
  async function widenSchema(): Promise<void> {
    const model = modelPrefix(fixture.ontologyKey);
    const product = await create(`${model}/entity-types`, { key: "product", displayName: "Product" });
    await create(`${model}/entity-types/${product.entityTypeId as string}/properties`, {
      key: "name",
      displayName: "Name",
      dataType: "string",
      required: true,
    });
    await create(`${model}/relation-types`, {
      key: "supplies",
      displayName: "Supplies",
      sourceEntityTypeKey: "company",
      targetEntityTypeKey: "product",
    });
    await create(`${model}/entity-types/${fixture.companyId}/properties`, {
      key: "profile",
      displayName: "Profile",
      dataType: "document",
      required: false,
    });
    await create(`${model}/relation-types`, {
      key: "manages",
      displayName: "Manages",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "person",
    });
  }

  it("every fault kind in one answer, each under its own key", async () => {
    await widenSchema();
    const { message, fields } = await rejected(
      `${LENS}/entities/person` +
        "?filter.ghost.name=x" +
        "&filter.supplies.name=x" +
        "&filter.works_for.ghost=x" +
        "&filter.works_for.name.x=1" +
        "&filter.works_for.profile=x" +
        "&filter.manages.name=x" +
        "&filter.works_for.name=Acme",
    );
    expect(message).toBe(
      "Unknown filter property or relation type: 'ghost'; " +
        "Relation type 'supplies' does not touch entity type 'person'; " +
        "Unknown filter property: 'ghost' on related entity type 'company'; " +
        "Query path 'works_for.name.x' crosses more than one relation; " +
        "Query path 'works_for.profile' ends in a document property; " +
        "Query path 'manages.name' is ambiguous",
    );
    expect(fields).toEqual({
      "ghost.name":
        "Not defined in type 'person'. Property keys: active, age, email, hired_at, name. " +
        "Relation types touching 'person': manages, works_for",
      "supplies.name":
        "'supplies' connects 'company' to 'product'. " +
        "Relation types touching 'person': manages, works_for",
      "works_for.ghost":
        "Not defined in type 'company'. Property keys: employee_count, founded, name, profile",
      "works_for.name.x":
        "A filter key may cross exactly one relation type: <relationTypeKey>.<propertyKey>",
      "works_for.profile":
        "'profile' on 'company' is a document property; a query path cannot end in one",
      "manages.name": "'manages' connects 'person' to 'person', so the direction cannot be derived",
    });
  });

  it("a sort key that is a query path", async () => {
    const { message } = await rejected(`${LENS}/entities/person?sort=works_for.name`);
    expect(message).toBe("Sorting by query paths is not supported");
  });

  it("a path key on the relation list", async () => {
    const { message, fields } = await rejected(
      `${LENS}/relations/works_for?filter.works_for.name=Acme`,
    );
    expect(message).toBe("Query paths apply to entity lists only: 'works_for.name'");
    expect(Object.keys(fields)).toEqual(["works_for.name"]);
  });
});

describe("responses never carry path values", () => {
  it("a path named in the fields projection matches nothing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${LENS}/entities/person?filter.works_for.name=Acme&fields=works_for.name&fields=name`,
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Row[];
    expect(items.map((e) => e.name).sort()).toEqual(["Alice", "Carol"]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["_id", "name"]);
    }
  });
});
