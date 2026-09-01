/**
 * Query paths on the entity list — conformance over REST, on whichever
 * adapter `DB_BACKEND` selects. A filter key crosses one relation type
 * to a property of the related entity (`.`) or to a property stored on
 * the relation itself (`@`); the direction is derived from the relation
 * type's endpoints; an entity matches when at least one relation of the
 * type satisfies the condition; faults are collected under their keys.
 * A relation segment may carry a direction marker, `:out` or `:in` —
 * required on the self-relation `manages`, optional elsewhere.
 *
 * Instance data: Alice (30) and Carol (40) work for Acme, Bob (25) and
 * Carol for Globex; Dave (35) works nowhere; Initech employs nobody.
 * Employments: Alice at Acme as CTO since 2015-03-01, Carol at Acme as
 * Engineer since 2018-06-01, Bob at Globex as Engineer since 2022-09-15,
 * Carol at Globex as CTO since 2025-02-01. Management: Alice manages Bob
 * since 2019-01-01 and Carol since 2021-05-01; Carol manages Dave since
 * 2023-01-01.
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
  const dave = await create(`${LENS}/entities/person`, { name: "Dave", age: 35 });
  for (const [from, to, role, since] of [
    [alice, acme, "CTO", "2015-03-01"],
    [bob, globex, "Engineer", "2022-09-15"],
    [carol, acme, "Engineer", "2018-06-01"],
    [carol, globex, "CTO", "2025-02-01"],
  ] as [Row, Row, string, string][]) {
    await create(`${LENS}/relations/works_for`, {
      fromEntityId: from._id,
      toEntityId: to._id,
      role,
      since,
    });
  }
  for (const [from, to, since] of [
    [alice, bob, "2019-01-01"],
    [alice, carol, "2021-05-01"],
    [carol, dave, "2023-01-01"],
  ] as [Row, Row, string][]) {
    await create(`${LENS}/relations/manages`, {
      fromEntityId: from._id,
      toEntityId: to._id,
      since,
    });
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

describe("the relation-property form — the condition is evaluated on the relation alone", () => {
  it("outgoing — persons holding a CTO employment", async () => {
    expect(await names(`${LENS}/entities/person?filter.works_for@role=CTO`)).toEqual({
      names: ["Alice", "Carol"],
      total: 2,
    });
  });

  it("incoming — companies with an employment that started before 2020", async () => {
    expect(
      await names(`${LENS}/entities/company?filter.works_for@since__lt=2020-01-01`),
    ).toEqual({ names: ["Acme"], total: 1 });
  });

  describe("the six operators, coerced by the relation property's data type", () => {
    it.each([
      ["filter.works_for@since=2015-03-01", ["Alice"]],
      ["filter.works_for@since__gt=2020-01-01", ["Bob", "Carol"]],
      ["filter.works_for@since__gte=2022-09-15", ["Bob", "Carol"]],
      ["filter.works_for@since__lt=2018-06-01", ["Alice"]],
      ["filter.works_for@since__lte=2018-06-01", ["Alice", "Carol"]],
      ["filter.works_for@role__contains=eng", ["Bob", "Carol"]],
    ])("%s", async (query, expected) => {
      const result = await names(`${LENS}/entities/person?${query}`);
      expect(result.names).toEqual(expected);
      expect(result.total).toBe(expected.length);
    });

    it.each([
      ["filter.works_for@since=2022-09-15", ["Globex"]],
      ["filter.works_for@since__gt=2018-06-01", ["Globex"]],
      ["filter.works_for@since__gte=2018-06-01", ["Acme", "Globex"]],
      ["filter.works_for@since__lt=2018-06-01", ["Acme"]],
      ["filter.works_for@since__lte=2018-06-01", ["Acme"]],
      ["filter.works_for@role__contains=cto", ["Acme", "Globex"]],
    ])("incoming, %s", async (query, expected) => {
      const result = await names(`${LENS}/entities/company?${query}`);
      expect(result.names).toEqual(expected);
      expect(result.total).toBe(expected.length);
    });

    it("a value the relation property cannot coerce is rejected under the path key", async () => {
      const { message, fields } = await rejected(
        `${LENS}/entities/person?filter.works_for@since__lt=soon`,
      );
      expect(message).toBe("Invalid filter value for 'works_for@since'");
      expect(Object.keys(fields)).toEqual(["works_for@since__lt"]);
    });
  });

  describe("existential matching across relations", () => {
    it("a person with two employments matches when either carries the role", async () => {
      // Carol is an Engineer at Acme and the CTO at Globex.
      expect((await names(`${LENS}/entities/person?filter.works_for@role=CTO`)).names).toContain(
        "Carol",
      );
      expect(
        (await names(`${LENS}/entities/person?filter.works_for@role=Engineer`)).names,
      ).toContain("Carol");
    });

    it("two relation-property conditions through the same relation type are independent", async () => {
      // Alice: CTO since 2015, one employment. Carol: CTO since 2025 at
      // Globex, Engineer since 2018 at Acme — each condition met by a
      // different employment.
      expect(
        await names(
          `${LENS}/entities/person?filter.works_for@role=CTO&filter.works_for@since__lt=2020-01-01`,
        ),
      ).toEqual({ names: ["Alice", "Carol"], total: 2 });
    });

    it("a related-entity condition and a relation-property condition through the same relation type are independent", async () => {
      // Carol works for Acme (as Engineer) and holds a CTO role (at Globex).
      expect(
        await names(
          `${LENS}/entities/person?filter.works_for.name=Acme&filter.works_for@role=CTO`,
        ),
      ).toEqual({ names: ["Alice", "Carol"], total: 2 });
    });

    it("an entity with no relation of the type never matches, in either direction", async () => {
      expect(
        (await names(`${LENS}/entities/person?filter.works_for@since__gte=1900-01-01`)).names,
      ).toEqual(["Alice", "Bob", "Carol"]);
      expect(
        (await names(`${LENS}/entities/company?filter.works_for@since__gte=1900-01-01`)).names,
      ).toEqual(["Acme", "Globex"]);
    });
  });

  it("combines with plain conditions by AND", async () => {
    expect(
      (await names(`${LENS}/entities/person?filter.works_for@role=CTO&filter.age__gt=30`)).names,
    ).toEqual(["Carol"]);
  });
});

describe("direction markers on the relation segment", () => {
  describe("on the self-relation, where the marker is required", () => {
    it("':out' — persons who manage a Bob; ':in' — persons managed by an Alice", async () => {
      expect(await names(`${LENS}/entities/person?filter.manages:out.name=Bob`)).toEqual({
        names: ["Alice"],
        total: 1,
      });
      expect(await names(`${LENS}/entities/person?filter.manages:in.name=Alice`)).toEqual({
        names: ["Bob", "Carol"],
        total: 2,
      });
    });

    it("the relation-property form follows the marker too", async () => {
      expect(
        await names(`${LENS}/entities/person?filter.manages:out@since__lt=2020-01-01`),
      ).toEqual({ names: ["Alice"], total: 1 });
      // Alice through Carol (2021), Carol through Dave (2023).
      expect(
        await names(`${LENS}/entities/person?filter.manages:out@since__gte=2020-01-01`),
      ).toEqual({ names: ["Alice", "Carol"], total: 2 });
      expect(
        await names(`${LENS}/entities/person?filter.manages:in@since__gte=2020-01-01`),
      ).toEqual({ names: ["Carol", "Dave"], total: 2 });
    });

    it("without a marker the path is rejected, naming both forms", async () => {
      const { message, fields } = await rejected(
        `${LENS}/entities/person?filter.manages@since=2019-01-01`,
      );
      expect(message).toBe("Query path 'manages@since' needs a direction marker");
      expect(fields).toEqual({
        "manages@since":
          "'manages' connects 'person' to 'person', so the direction cannot be derived; " +
          "write 'manages:out@since' or 'manages:in@since'",
      });
    });
  });

  describe("on a non-self relation, where the marker is optional", () => {
    it("an agreeing marker returns what the derived direction returns", async () => {
      expect((await names(`${LENS}/entities/person?filter.works_for:out.name=Acme`)).names).toEqual(
        ["Alice", "Carol"],
      );
      expect((await names(`${LENS}/entities/company?filter.works_for:in@role=CTO`)).names).toEqual(
        ["Acme", "Globex"],
      );
    });

    it("a contradicting marker is rejected, naming the direction the schema allows", async () => {
      const person = await rejected(`${LENS}/entities/person?filter.works_for:in.name=Acme`);
      expect(person.message).toBe(
        "Query path 'works_for:in.name' contradicts the derivable direction",
      );
      expect(person.fields).toEqual({
        "works_for:in.name":
          "'works_for' connects 'person' to 'company', so from 'person' it is followed " +
          "outgoing: write 'works_for:out.name' or omit the marker",
      });

      const company = await rejected(`${LENS}/entities/company?filter.works_for:out@role=CTO`);
      expect(company.message).toBe(
        "Query path 'works_for:out@role' contradicts the derivable direction",
      );
      expect(company.fields).toEqual({
        "works_for:out@role":
          "'works_for' connects 'person' to 'company', so from 'company' it is followed " +
          "incoming: write 'works_for:in@role' or omit the marker",
      });
    });
  });
});

describe("rejections, collected under their filter keys", () => {
  /** Widen the schema with what the fault kinds need beyond the fixture:
   * a relation type not touching persons and a document property on
   * companies. */
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
  }

  it("every fault kind in one answer, each under its own key", async () => {
    await widenSchema();
    const { message, fields } = await rejected(
      `${LENS}/entities/person` +
        "?filter.ghost.name=x" +
        "&filter.supplies.name=x" +
        "&filter.works_for.ghost=x" +
        "&filter.works_for@ghost=x" +
        "&filter.works_for.name.x=1" +
        "&filter.works_for.profile=x" +
        "&filter.manages.name=x" +
        "&filter.manages:sideways.name=x" +
        "&filter.works_for:in.name=x" +
        "&filter.works_for.name=Acme" +
        "&filter.works_for@role=CTO",
    );
    expect(message).toBe(
      "Unknown filter property or relation type: 'ghost'; " +
        "Relation type 'supplies' does not touch entity type 'person'; " +
        "Unknown filter property: 'ghost' on related entity type 'company'; " +
        "Unknown filter property: 'ghost' on relation type 'works_for'; " +
        "Query path 'works_for.name.x' crosses more than one relation; " +
        "Query path 'works_for.profile' ends in a document property; " +
        "Query path 'manages.name' needs a direction marker; " +
        "Unknown filter property or relation type: 'manages:sideways'; " +
        "Query path 'works_for:in.name' contradicts the derivable direction",
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
      "works_for@ghost": "Not defined in type 'works_for'. Property keys: role, since",
      "works_for.name.x":
        "A filter key may cross exactly one relation type: " +
        "<relationTypeKey>.<propertyKey> or <relationTypeKey>@<propertyKey>",
      "works_for.profile":
        "'profile' on 'company' is a document property; a query path cannot end in one",
      "manages.name":
        "'manages' connects 'person' to 'person', so the direction cannot be derived; " +
        "write 'manages:out.name' or 'manages:in.name'",
      "manages:sideways.name":
        "Not defined in type 'person'. Property keys: active, age, email, hired_at, name. " +
        "Relation types touching 'person': manages, works_for",
      "works_for:in.name":
        "'works_for' connects 'person' to 'company', so from 'person' it is followed " +
        "outgoing: write 'works_for:out.name' or omit the marker",
    });
  });

  it("a sort key that is a query path", async () => {
    const { message } = await rejected(`${LENS}/entities/person?sort=works_for.name`);
    expect(message).toBe("Sorting by query paths is not supported");
  });

  it.each(["works_for.name", "works_for@role"])("a path key on the relation list: %s", async (key) => {
    const { message, fields } = await rejected(`${LENS}/relations/works_for?filter.${key}=x`);
    expect(message).toBe(`Query paths apply to entity lists only: '${key}'`);
    expect(Object.keys(fields)).toEqual([key]);
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
