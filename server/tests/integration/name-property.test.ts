/**
 * Integration suite — the name property against the real database, on
 * every adapter (contract tier): an entity type is created with its name
 * property, reassigns it only to another of its string properties, and
 * cannot lose it; runtime schema reads show it where the lens exposes it;
 * transfer carries it in 6.0 and derives it for a 5.0 payload.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { buildFixture, modelPrefix, runtimePrefix, type FixtureIds } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, unknown>;

let app: FastifyInstance;
let fixture: FixtureIds;
let model: string;

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

beforeEach(async () => {
  await wipeDatabase();
  fixture = await buildFixture(app);
  model = modelPrefix(fixture.ontologyKey);
});

async function request(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: Row) {
  return app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
}

async function propertiesOf(entityTypeId: string): Promise<Row[]> {
  const res = await request("GET", `${model}/entity-types/${entityTypeId}/properties`);
  expect(res.statusCode).toBe(200);
  return res.json() as Row[];
}

async function propertyId(entityTypeId: string, key: string): Promise<string> {
  const found = (await propertiesOf(entityTypeId)).find((p) => p.key === key);
  expect(found, `property ${key}`).toBeDefined();
  return found!.propertyId as string;
}

describe("modeling", () => {
  it("creating an entity type creates its name property `name`", async () => {
    const res = await request("POST", `${model}/entity-types`, {
      key: "project",
      displayName: "Project",
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Row;
    expect(body.nameProperty).toBe("name");
    const properties = await propertiesOf(body.entityTypeId as string);
    expect(properties).toEqual([
      expect.objectContaining({
        key: "name",
        displayName: "Name",
        dataType: "string",
        required: false,
        defaultValue: null,
      }),
    ]);
  });

  it("creating an entity type takes another key for its name property", async () => {
    const res = await request("POST", `${model}/entity-types`, {
      key: "project",
      displayName: "Project",
      nameProperty: "title",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as Row).nameProperty).toBe("title");
    const properties = await propertiesOf((res.json() as Row).entityTypeId as string);
    expect(properties.map((p) => [p.key, p.displayName, p.dataType])).toEqual([
      ["title", "title", "string"],
    ]);
  });

  it("reassigns the name property to another string property, and reads it back", async () => {
    const res = await request("PUT", `${model}/entity-types/${fixture.personId}`, {
      nameProperty: "email",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Row).nameProperty).toBe("email");
    const read = await request("GET", `${model}/entity-types/${fixture.personId}`);
    expect((read.json() as Row).nameProperty).toBe("email");
    const listed = await request("GET", `${model}/entity-types`);
    expect((listed.json() as Row[]).map((et) => [et.key, et.nameProperty])).toEqual([
      ["company", "name"],
      ["person", "email"],
    ]);
  });

  it("refuses a name property that is not a string property of the type", async () => {
    for (const key of ["age", "founded", "nope"]) {
      const res = await request("PUT", `${model}/entity-types/${fixture.personId}`, {
        nameProperty: key,
      });
      expect(res.statusCode, key).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
    const read = await request("GET", `${model}/entity-types/${fixture.personId}`);
    expect((read.json() as Row).nameProperty).toBe("name");
  });

  it("refuses to delete the name property until another one is chosen", async () => {
    const nameId = await propertyId(fixture.personId, "name");
    const refused = await request(
      "DELETE",
      `${model}/entity-types/${fixture.personId}/properties/${nameId}?cascade=true`,
    );
    expect(refused.statusCode).toBe(409);
    const error = (refused.json() as { error: { code: string; message: string } }).error;
    expect(error.code).toBe("RESOURCE_CONFLICT");
    expect(error.message).toContain("Choose another name property first");
    expect((await propertiesOf(fixture.personId)).map((p) => p.key)).toContain("name");

    await request("PUT", `${model}/entity-types/${fixture.personId}`, { nameProperty: "email" });
    const deleted = await request(
      "DELETE",
      `${model}/entity-types/${fixture.personId}/properties/${nameId}`,
    );
    expect(deleted.statusCode).toBe(204);
  });

  it("deleting an entity type takes its name property with it", async () => {
    const created = await request("POST", `${model}/entity-types`, {
      key: "project",
      displayName: "Project",
    });
    const deleted = await request(
      "DELETE",
      `${model}/entity-types/${(created.json() as Row).entityTypeId as string}`,
    );
    expect(deleted.statusCode).toBe(204);
    const again = await request("POST", `${model}/entity-types`, {
      key: "project",
      displayName: "Project",
    });
    expect(again.statusCode, again.body).toBe(201);
  });
});

describe("runtime schema reads", () => {
  it("carry the name property where the lens exposes it, null where it hides it", async () => {
    // A type whose name property is optional, so a lens may hide it.
    const project = await request("POST", `${model}/entity-types`, {
      key: "project",
      displayName: "Project",
    });
    await request("POST", `${model}/entity-types/${(project.json() as Row).entityTypeId as string}/properties`, {
      key: "code",
      displayName: "Code",
      dataType: "string",
    });
    const lens = await request("POST", `${model}/lenses`, { key: "projects", name: "Projects" });
    const lensId = (lens.json() as Row).lensId as string;
    for (const inclusion of [{ key: "project", properties: ["code"] }, { key: "company" }]) {
      const included = await request(
        "POST",
        `${model}/lenses/${lensId}/includes/entity-types`,
        inclusion,
      );
      expect(included.statusCode, included.body).toBe(201);
    }

    const scoped = await request("GET", `${runtimePrefix(fixture.ontologyKey, "projects")}/schema`);
    expect(scoped.statusCode).toBe(200);
    const scopedTypes = (scoped.json() as { entityTypes: Row[] }).entityTypes;
    expect(scopedTypes.map((et) => [et.key, et.nameProperty])).toEqual([
      ["company", "name"],
      ["project", null],
    ]);

    const unscoped = await request(
      "GET",
      `${runtimePrefix(fixture.ontologyKey, "test_lens")}/schema/entity-types/person`,
    );
    expect((unscoped.json() as Row).nameProperty).toBe("name");
  });
});

describe("transfer", () => {
  it("exports 6.0 with the name property and imports it back identically", async () => {
    await request("PUT", `${model}/entity-types/${fixture.personId}`, { nameProperty: "email" });
    const exported = (await request("GET", `${model}/export`)).json() as Row;
    expect(exported.formatVersion).toBe("6.0");
    expect((exported.entityTypes as Row[]).map((et) => [et.key, et.nameProperty])).toEqual([
      ["company", "name"],
      ["person", "email"],
    ]);

    await wipeDatabase();
    await request("POST", "/api/ontologies", { key: fixture.ontologyKey });
    const imported = await request("POST", `${model}/import`, exported);
    expect(imported.statusCode, imported.body).toBe(201);
    const listed = await request("GET", `${model}/entity-types`);
    expect((listed.json() as Row[]).map((et) => [et.key, et.nameProperty])).toEqual([
      ["company", "name"],
      ["person", "email"],
    ]);
  });

  it("rejects a 6.0 entity type whose name property is not one of its string properties", async () => {
    const res = await request("POST", `${model}/import`, {
      formatVersion: "6.0",
      textSearchLanguage: "english",
      entityTypes: [
        {
          key: "project",
          displayName: "Project",
          nameProperty: "budget",
          properties: [{ key: "budget", displayName: "Budget", dataType: "float", required: false }],
        },
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("name property 'budget' of entity type 'project'");
    const listed = await request("GET", `${model}/entity-types`);
    expect((listed.json() as Row[]).map((et) => et.key)).toEqual(["company", "person"]);
  });

  it("derives the name property of a 5.0 payload, creating one where a type has no string property", async () => {
    const res = await request("POST", `${model}/import`, {
      formatVersion: "5.0",
      textSearchLanguage: "english",
      entityTypes: [
        {
          key: "article",
          displayName: "Article",
          properties: [
            { key: "summary", displayName: "Summary", dataType: "string", required: false },
            { key: "title", displayName: "Title", dataType: "string", required: true },
          ],
        },
        { key: "milestone", displayName: "Milestone", properties: [] },
        {
          key: "reading",
          displayName: "Reading",
          properties: [{ key: "name", displayName: "Name", dataType: "integer", required: false }],
        },
      ],
      relationTypes: [],
      lenses: [],
    });
    expect(res.statusCode, res.body).toBe(201);

    const exported = (await request("GET", `${model}/export`)).json() as Row;
    const byKey = new Map((exported.entityTypes as Row[]).map((et) => [et.key, et]));
    expect(byKey.get("article")!.nameProperty).toBe("title");
    expect(byKey.get("milestone")!.nameProperty).toBe("name");
    expect(byKey.get("reading")!.nameProperty).toBe("name_2");
    const readingProps = (byKey.get("reading")!.properties as Row[]).map((p) => [
      p.key,
      p.dataType,
      p.required,
    ]);
    expect(readingProps).toEqual([
      ["name", "integer", false],
      ["name_2", "string", false],
    ]);
  });
});
