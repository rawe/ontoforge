/**
 * Modeling MCP server integration — official SDK client against
 * `/mcp/ontologies/:ontologyKey/model` on a real listening server,
 * backed by the docker-compose test database.
 *
 * Covers: the URL-bound mount (the only binding channel), every modeling
 * tool including `ensure_ontology`, stateless JSON transport with two
 * interleaved clients, key (not id) addressing, ontology isolation
 * between two bound clients, and validation failures surfacing every
 * offending field in one message string.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";
import { supportsMultipleOntologies } from "./tiers.js";

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

let app: FastifyInstance;
let baseUrl: string;
let client: Client;

async function connectClient(name: string, ontologyKey = "test_ont"): Promise<Client> {
  const c = new Client({ name, version: "0.0.1" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ontologies/${ontologyKey}/model`)),
  );
  return c;
}

async function call(
  c: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  return (await c.callTool({ name, arguments: args })) as unknown as ToolCallResult;
}

function text(result: ToolCallResult): string {
  return result.content[0]?.text ?? "";
}

function json(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(text(result)) as Record<string, unknown>;
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  client = await connectClient("modeling-mcp-tests");
});

afterAll(async () => {
  await client.close();
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  // The mount binds the ontology its URL names; the shared client above
  // is bound to `test_ont`, which every test starts from.
  const created = await app.inject({
    method: "POST",
    url: "/api/ontologies",
    payload: { key: "test_ont" },
  });
  expect(created.statusCode, created.body).toBe(201);
});

describe("tool surface", () => {
  it("lists exactly the forty-five modeling tools — and NO update-inclusion tool", async () => {
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(45);
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "add_entity_type_to_lens",
      "add_property",
      "add_relation_type_to_lens",
      "add_search_index_to_lens",
      "create_entity_type",
      "create_lens",
      "create_relation_type",
      "create_search_index",
      "delete_agent",
      "delete_entity_type",
      "delete_lens",
      "delete_property",
      "delete_relation_type",
      "delete_retriever",
      "delete_saved_query",
      "delete_search_index",
      "ensure_ontology",
      "export_schema",
      "get_agent",
      "get_retriever",
      "get_schema",
      "get_search_index",
      "get_search_index_status",
      "get_search_settings",
      "import_schema",
      "list_agents",
      "list_retrievers",
      "list_saved_queries",
      "list_search_indices",
      "preview_search_index",
      "rebuild_search_index",
      "remove_entity_type_from_lens",
      "remove_relation_type_from_lens",
      "remove_search_index_from_lens",
      "set_agent",
      "set_retriever",
      "set_saved_query",
      "set_search_settings",
      "update_entity_type",
      "update_lens",
      "update_property",
      "update_relation_type",
      "update_search_index",
      "validate_lens",
      "validate_schema",
    ]);
  });

  it("no tool takes an ontology parameter — the mount URL is the only binding", async () => {
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(Object.keys(properties), tool.name).not.toContain("ontology_key");
      expect(Object.keys(properties), tool.name).not.toContain("ontology_id");
    }
    const ensure = tools.tools.find((tool) => tool.name === "ensure_ontology")!;
    expect(Object.keys((ensure.inputSchema.properties ?? {}) as Record<string, unknown>)).toEqual([]);
  });
});

describe("ensure_ontology", () => {
  it("no-ops on a mount whose ontology already exists", async () => {
    const result = await call(client, "ensure_ontology");
    expect(result.isError, text(result)).toBeUndefined();
    expect(json(result)).toEqual({ key: "test_ont", created: false });
  });

  // Multi-ontology tier: `fresh_ont` is a second ontology beside the
  // fixture's `test_ont`.
  it.skipIf(!supportsMultipleOntologies)("creates the mount's own ontology, no-ops on the second call, and the result is fully usable", async () => {
    // No REST create for fresh_ont — the mount names an ontology that
    // does not exist yet.
    const fresh = await connectClient("ensure-tests", "fresh_ont");
    try {
      // Every other tool fails with not-found until the ontology exists.
      const before = await call(fresh, "get_schema");
      expect(before.isError).toBe(true);
      expect(text(before)).toContain("Ontology 'fresh_ont' not found");

      const first = await call(fresh, "ensure_ontology");
      expect(first.isError, text(first)).toBeUndefined();
      expect(json(first)).toEqual({ key: "fresh_ont", created: true });

      const second = await call(fresh, "ensure_ontology");
      expect(json(second)).toEqual({ key: "fresh_ont", created: false });

      // Fully usable: modeling works on the mount, and the registry has it.
      const created = await call(fresh, "create_entity_type", {
        key: "person",
        display_name: "Person",
      });
      expect(created.isError, text(created)).toBeUndefined();
      const listed = await app.inject({ method: "GET", url: "/api/ontologies/fresh_ont" });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().displayName).toBeNull();
    } finally {
      await fresh.close();
    }
  });

  it("rejects a mount key that is no valid ontology key", async () => {
    const bad = await connectClient("ensure-bad-key", "Bad-Key");
    try {
      const result = await call(bad, "ensure_ontology");
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("key");
    } finally {
      await bad.close();
    }
  });
});

describe("schema lifecycle over MCP (keys, never ids)", () => {
  it("creates, updates and deletes both type kinds and properties", async () => {
    // Entity types.
    const person = await call(client, "create_entity_type", {
      key: "person",
      display_name: "Person",
      description: "A person",
    });
    expect(person.isError).toBeUndefined();
    expect(json(person).key).toBe("person");
    expect(json(person).displayName).toBe("Person");
    expect(json(person).nameProperty).toBe("name");

    const company = await call(client, "create_entity_type", {
      key: "company",
      display_name: "Company",
      name_property: "title",
    });
    expect(json(company).nameProperty).toBe("title");

    const renamed = await call(client, "update_entity_type", {
      entity_type_key: "person",
      display_name: "Human",
    });
    expect(json(renamed).displayName).toBe("Human");
    expect(json(renamed).description).toBe("A person"); // sparse

    // Relation type between them, endpoints by key.
    const worksFor = await call(client, "create_relation_type", {
      key: "works_for",
      display_name: "Works For",
      source_entity_type_key: "person",
      target_entity_type_key: "company",
    });
    expect(json(worksFor).sourceEntityTypeKey).toBe("person");

    const rtUpdated = await call(client, "update_relation_type", {
      relation_type_key: "works_for",
      description: "Employment",
    });
    expect(json(rtUpdated).description).toBe("Employment");

    // Properties via the type_kind discriminator.
    const nameProp = await call(client, "add_property", {
      type_kind: "entity_type",
      type_key: "person",
      key: "full_name",
      display_name: "Full Name",
      data_type: "string",
      required: true,
    });
    expect(json(nameProp).required).toBe(true);

    const roleProp = await call(client, "add_property", {
      type_kind: "relation_type",
      type_key: "works_for",
      key: "role",
      display_name: "Role",
      data_type: "string",
    });
    expect(json(roleProp).key).toBe("role");

    const updatedProp = await call(client, "update_property", {
      type_kind: "entity_type",
      type_key: "person",
      property_key: "full_name",
      display_name: "Name",
    });
    expect(json(updatedProp).displayName).toBe("Name");

    // The name property moves to another string property; the one it
    // names cannot be deleted.
    const renamedTo = await call(client, "update_entity_type", {
      entity_type_key: "person",
      name_property: "full_name",
    });
    expect(json(renamedTo).nameProperty).toBe("full_name");
    const refused = await call(client, "delete_property", {
      type_kind: "entity_type",
      type_key: "person",
      property_key: "full_name",
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("Choose another name property first");

    const deletedProp = await call(client, "delete_property", {
      type_kind: "relation_type",
      type_key: "works_for",
      property_key: "role",
    });
    expect(text(deletedProp)).toBe("Property 'role' deleted from relation_type 'works_for'.");

    // get_schema reflects it all in the transfer shape.
    const schema = json(await call(client, "get_schema"));
    expect(schema.formatVersion).toBe("7.0");
    expect(schema.lenses).toEqual([]);
    const entityTypes = schema.entityTypes as Record<string, unknown>[];
    expect(entityTypes.map((et) => et.key)).toEqual(["company", "person"]);
    const personExport = entityTypes.find((et) => et.key === "person");
    expect(personExport?.nameProperty).toBe("full_name");
    expect((personExport?.properties as Record<string, unknown>[]).map((p) => p.key)).toEqual([
      "full_name",
      "name",
    ]);
    const relationTypes = schema.relationTypes as Record<string, unknown>[];
    expect(relationTypes[0]?.fromEntityTypeKey).toBe("person");
    expect(relationTypes[0]?.toEntityTypeKey).toBe("company");

    // Deletion order: the relation type first, then its endpoints.
    const rtGone = await call(client, "delete_relation_type", {
      relation_type_key: "works_for",
    });
    expect(text(rtGone)).toBe("Relation type 'works_for' deleted successfully.");
    const etGone = await call(client, "delete_entity_type", { entity_type_key: "person" });
    expect(text(etGone)).toBe("Entity type 'person' deleted successfully.");
    await call(client, "delete_entity_type", { entity_type_key: "company" });

    const emptied = json(await call(client, "get_schema"));
    expect(emptied.entityTypes).toEqual([]);
    expect(emptied.relationTypes).toEqual([]);
  });
});

describe("search settings over MCP", () => {
  it.skipIf(settings.DB_BACKEND !== "postgres")("reads and changes the keyword language set and the switches", async () => {
    expect(json(await call(client, "get_search_settings"))).toEqual({
      keywordLanguages: ["german", "english"],
      disabledIndices: [],
    });
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    const changed = json(
      await call(client, "set_search_settings", {
        keyword_languages: ["english"],
        disabled_indices: ["person~default"],
      }),
    );
    expect(changed).toEqual({ keywordLanguages: ["english"], disabledIndices: ["person~default"] });
    // An omitted argument stays as it is.
    expect(json(await call(client, "set_search_settings", { disabled_indices: [] }))).toEqual({
      keywordLanguages: ["english"],
      disabledIndices: [],
    });
    expect((json(await call(client, "export_schema")) as { keywordLanguages: string[] }).keywordLanguages).toEqual([
      "english",
    ]);
    const invalid = await call(client, "set_search_settings", {
      keyword_languages: ["french"],
      disabled_indices: ["nope"],
    });
    expect(invalid.isError).toBe(true);
    expect(text(invalid)).toContain("keywordLanguages");
  });

  it.skipIf(settings.DB_BACKEND === "postgres")("is not supported by an adapter without search indices", async () => {
    const result = await call(client, "get_search_settings");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not supported");
  });
});

describe("search indices over MCP", () => {
  const PEOPLE = {
    key: "people",
    name: "People",
    description: "People by name and employer",
    entityType: "person",
    fields: ["name"],
    relations: [{ relationType: "works_for", direction: "outgoing", target: { company: ["name"] } }],
  };

  async function schema(): Promise<void> {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "create_entity_type", { key: "company", display_name: "Company" });
    await call(client, "create_relation_type", {
      key: "works_for",
      display_name: "Works for",
      source_entity_type_key: "person",
      target_entity_type_key: "company",
    });
  }

  it.skipIf(settings.DB_BACKEND !== "postgres")("creates, previews, reads, updates, rebuilds and deletes a custom index", async () => {
    await schema();
    const preview = json(await call(client, "preview_search_index", { definition: { ...PEOPLE, key: undefined } }));
    expect(preview).toMatchObject({ valid: true, issues: [], estimate: { entities: 0, entries: 0 } });
    const invalid = json(
      await call(client, "preview_search_index", { definition: { ...PEOPLE, fields: ["nope"] } }),
    );
    expect(invalid).toMatchObject({ valid: false, estimate: null });

    const created = json(await call(client, "create_search_index", { definition: PEOPLE }));
    expect(created).toMatchObject({ key: "people", kind: "custom", enabled: true });
    const listed = json(await call(client, "list_search_indices")) as unknown as { key: string }[];
    expect(listed.map((i) => i.key)).toEqual(["company~default", "people", "person~default"]);
    expect(json(await call(client, "get_search_index", { index_key: "people" }))).toMatchObject({ key: "people" });
    expect(json(await call(client, "get_search_index_status", { index_key: "people" }))).toHaveProperty("state");

    const updated = json(
      await call(client, "update_search_index", { index_key: "people", definition: { ...PEOPLE, relations: [] } }),
    );
    expect((updated.definition as { relations: unknown[] }).relations).toEqual([]);
    expect(json(await call(client, "rebuild_search_index", { index_key: "people" }))).toHaveProperty("representations");

    // The schema reads carry the custom definitions and the switches.
    const exported = json(await call(client, "get_schema")) as { searchIndices: { custom: { key: string }[] } };
    expect(exported.searchIndices.custom.map((d) => d.key)).toEqual(["people"]);

    const invalidCreate = await call(client, "create_search_index", { definition: { ...PEOPLE, key: "other", fields: ["nope"] } });
    expect(invalidCreate.isError).toBe(true);
    expect(text(invalidCreate)).toContain("fields.0");
    const managed = await call(client, "update_search_index", { index_key: "person~default", definition: PEOPLE });
    expect(managed.isError).toBe(true);
    expect(text(managed)).toContain("managed indices can only be switched");

    expect(text(await call(client, "delete_search_index", { index_key: "people" }))).toBe(
      "Search index 'people' deleted.",
    );
    expect((await call(client, "get_search_index", { index_key: "people" })).isError).toBe(true);
  }, 20_000);

  it.skipIf(settings.DB_BACKEND !== "postgres")("delete tools' cascade flag covers custom indices", async () => {
    await schema();
    await call(client, "create_search_index", { definition: PEOPLE });
    const refused = await call(client, "delete_relation_type", { relation_type_key: "works_for" });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("custom search index(es) (people)");
    await call(client, "delete_relation_type", { relation_type_key: "works_for", cascade: true });
    const people = json(await call(client, "get_search_index", { index_key: "people" }));
    expect((people.definition as { relations: unknown[] }).relations).toEqual([]);
  });

  it.skipIf(settings.DB_BACKEND !== "postgres")("includes indices in a lens by key; schema reads and validation show them", async () => {
    await schema();
    await call(client, "create_search_index", { definition: PEOPLE });
    await call(client, "create_lens", { key: "hr", name: "HR" });
    await call(client, "add_entity_type_to_lens", { lens_key: "hr", entity_type_key: "person" });
    // Company with no property: the group's target field is hidden.
    await call(client, "add_entity_type_to_lens", { lens_key: "hr", entity_type_key: "company", properties: [] });

    const added = await call(client, "add_search_index_to_lens", { lens_key: "hr", index_key: "people" });
    expect(json(added)).toEqual({ key: "people" });
    const twice = await call(client, "add_search_index_to_lens", { lens_key: "hr", index_key: "people" });
    expect(twice.isError).toBe(true);
    await call(client, "create_lens", { key: "desk", name: "Desk" });
    await call(client, "add_entity_type_to_lens", { lens_key: "desk", entity_type_key: "company" });
    const foreign = await call(client, "add_search_index_to_lens", { lens_key: "desk", index_key: "people" });
    expect(foreign.isError).toBe(true);
    expect(text(foreign)).toContain("Root entity type 'person'");

    const exported = json(await call(client, "get_schema")) as { lenses: { key: string; indexInclusions: string[] }[] };
    expect(exported.lenses.find((l) => l.key === "hr")!.indexInclusions).toEqual(["people"]);
    const validated = json(await call(client, "validate_lens", { lens_key: "hr" })) as { warnings: { path: string }[] };
    expect(validated.warnings.map((w) => w.path)).toEqual(["lenses.hr.includes.searchIndices.people.relations.0.target.company.0"]);

    expect(text(await call(client, "remove_search_index_from_lens", { lens_key: "hr", index_key: "people" }))).toBe(
      "Search index 'people' removed from lens 'hr'.",
    );
    expect((await call(client, "remove_search_index_from_lens", { lens_key: "hr", index_key: "people" })).isError).toBe(true);
  });

  it.skipIf(settings.DB_BACKEND === "postgres")("is not supported by an adapter without search indices", async () => {
    const result = await call(client, "list_search_indices");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not supported");
    await call(client, "create_lens", { key: "hr", name: "HR" });
    const included = await call(client, "add_search_index_to_lens", { lens_key: "hr", index_key: "x" });
    expect(included.isError).toBe(true);
    expect(text(included)).toContain("not supported");
  });
});

describe("retrievers over MCP", () => {
  const CONFIG = {
    indices: [{ index: "person~default" }],
    filters: [{ id: "city", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], field: "name" }],
    answerFields: { person: ["name", "email"] },
  };

  async function schema(): Promise<void> {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "add_property", {
      type_kind: "entity_type", type_key: "person", key: "email", display_name: "Email", data_type: "string",
    });
    await call(client, "create_entity_type", { key: "city", display_name: "City" });
    await call(client, "create_relation_type", {
      key: "lives_in",
      display_name: "Lives in",
      source_entity_type_key: "person",
      target_entity_type_key: "city",
    });
    await call(client, "create_lens", { key: "hr", name: "HR" });
  }

  it.skipIf(settings.DB_BACKEND !== "postgres")("creates, reads, lists, replaces and deletes a retriever", async () => {
    await schema();
    const created = await call(client, "set_retriever", { lens_key: "hr", key: "people-finder", name: "People", config: CONFIG });
    expect(created.isError, text(created)).toBeUndefined();
    expect(json(created)).toMatchObject({
      key: "people-finder",
      lensKey: "hr",
      name: "People",
      description: null,
      configVersion: 2,
      config: { ...CONFIG, threshold: 0.35, answerFieldCharacters: 800 },
      validation: { valid: true, errors: [], warnings: [] },
      created: true,
    });
    const replaced = await call(client, "set_retriever", {
      lens_key: "hr", key: "people-finder", name: "People v2", description: "By home", config: CONFIG,
    });
    expect(json(replaced)).toMatchObject({ name: "People v2", description: "By home", created: false });

    expect(json(await call(client, "get_retriever", { lens_key: "hr", retriever_key: "people-finder" }))).toMatchObject({
      key: "people-finder",
      name: "People v2",
    });
    const listed = json(await call(client, "list_retrievers", { lens_key: "hr" })) as unknown as { key: string }[];
    expect(listed.map((r) => r.key)).toEqual(["people-finder"]);
    // `_default` is runtime only: modeling neither lists nor reads it.
    expect((await call(client, "get_retriever", { lens_key: "hr", retriever_key: "_default" })).isError).toBe(true);

    expect(text(await call(client, "delete_retriever", { lens_key: "hr", retriever_key: "people-finder" }))).toBe(
      "Retriever 'people-finder' deleted from lens 'hr'.",
    );
    const missing = await call(client, "get_retriever", { lens_key: "hr", retriever_key: "people-finder" });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("not found");
  });

  it.skipIf(settings.DB_BACKEND !== "postgres")("an invalid configuration answers every error at once and saves nothing", async () => {
    await schema();
    const refused = await call(client, "set_retriever", {
      lens_key: "hr",
      key: "broken",
      name: "Broken",
      config: {
        indices: [{ index: "person~default" }, { index: "ghost" }],
        filters: [{ id: "zip", entityType: "person", path: [], field: "zip" }],
        answerFields: { person: ["name", "nope"] },
      },
    });
    expect(refused.isError).toBe(true);
    const message = text(refused);
    expect(message).toContain("Search index 'ghost'");
    expect(message).toContain("field 'zip'");
    expect(message).toContain("Answer field 'nope'");
    // Each error is named once, not repeated by the flattening.
    expect(message.split("Search index 'ghost'")).toHaveLength(2);

    const shape = await call(client, "set_retriever", {
      lens_key: "hr", key: "broken", name: "Broken", config: { indices: [], answerFields: {}, threshold: 5 },
    });
    expect(shape.isError).toBe(true);
    expect(text(shape)).toContain("indices");
    expect(text(shape)).toContain("threshold");

    const badKey = await call(client, "set_retriever", { lens_key: "hr", key: "Bad Key", name: "X", config: CONFIG });
    expect(badKey.isError).toBe(true);
    expect(text(badKey)).toContain("Must match pattern");
    expect(json(await call(client, "list_retrievers", { lens_key: "hr" }))).toEqual([]);
  });

  it.skipIf(settings.DB_BACKEND === "postgres")("every retriever tool is refused without search indices", async () => {
    await schema();
    for (const [name, args] of [
      ["list_retrievers", { lens_key: "hr" }],
      ["get_retriever", { lens_key: "hr", retriever_key: "people" }],
      ["set_retriever", { lens_key: "hr", key: "people", name: "People", config: CONFIG }],
      ["delete_retriever", { lens_key: "hr", retriever_key: "people" }],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.isError, name).toBe(true);
      expect(text(result), name).toContain("not supported");
    }
  });
});

describe("tool errors", () => {
  it("a domain conflict surfaces as a tool error, not a protocol failure", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    const dup = await call(client, "create_entity_type", {
      key: "person",
      display_name: "Person",
    });
    expect(dup.isError).toBe(true);
    expect(text(dup)).toContain("Error executing tool create_entity_type");
    expect(text(dup)).toContain("already exists");
  });

  it("deleting a referenced entity type is refused", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "create_entity_type", { key: "company", display_name: "Company" });
    await call(client, "create_relation_type", {
      key: "works_for",
      display_name: "Works For",
      source_entity_type_key: "person",
      target_entity_type_key: "company",
    });
    const refused = await call(client, "delete_entity_type", { entity_type_key: "person" });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("referenced by one or more relation types");
  });

  it("document on a relation type is rejected with the same rule as REST", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "create_entity_type", { key: "company", display_name: "Company" });
    await call(client, "create_relation_type", {
      key: "works_for",
      display_name: "Works For",
      source_entity_type_key: "person",
      target_entity_type_key: "company",
    });
    const rejected = await call(client, "add_property", {
      type_kind: "relation_type",
      type_key: "works_for",
      key: "notes",
      display_name: "Notes",
      data_type: "document",
    });
    expect(rejected.isError).toBe(true);
    expect(text(rejected)).toContain("Document properties are only supported on entity types");
  });

  it("an unknown type_kind is rejected", async () => {
    const rejected = await call(client, "add_property", {
      type_kind: "lens",
      type_key: "person",
      key: "x",
      display_name: "X",
      data_type: "string",
    });
    expect(rejected.isError).toBe(true);
    expect(text(rejected)).toContain("Invalid type_kind 'lens'");
  });

  it("an unknown key answers a not-found tool error", async () => {
    const missing = await call(client, "update_entity_type", {
      entity_type_key: "ghost",
      display_name: "Ghost",
    });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("Entity type 'ghost' not found");
  });

  it("a multi-field validation failure surfaces every offending field in one message", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    const rejected = await call(client, "add_property", {
      type_kind: "entity_type",
      type_key: "person",
      key: "Bad Key",
      display_name: "X",
      data_type: "uuid",
    });
    expect(rejected.isError).toBe(true);
    const message = text(rejected);
    expect(message).toContain("key");
    expect(message).toContain("dataType");
    expect(message.split(";").length).toBeGreaterThanOrEqual(2);
  });

  // The reserved-type-key rejection is adapter-specific (only the Neo4j
  // adapter reserves keys) and lives in
  // `tests/integration/neo4j/mcp-modeling.test.ts`.
});

describe("lenses over MCP", () => {
  it("full lens lifecycle by key: create, update, include, validate, delete", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "add_property", {
      type_kind: "entity_type",
      type_key: "person",
      key: "full_name",
      display_name: "Full Name",
      data_type: "string",
    });

    const created = await call(client, "create_lens", {
      key: "hr",
      name: "Human Resources",
      description: "People",
    });
    expect(created.isError).toBeUndefined();
    expect(json(created).key).toBe("hr");
    expect(json(created).name).toBe("Human Resources");

    const renamed = await call(client, "update_lens", {
      lens_key: "hr",
      name: "People",
    });
    expect(json(renamed).name).toBe("People");
    expect(json(renamed).key).toBe("hr"); // immutable

    const included = await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "person",
      properties: ["full_name"],
    });
    expect(json(included)).toEqual({ key: "person", properties: ["full_name"] });

    const validation = json(await call(client, "validate_lens", { lens_key: "hr" }));
    expect(validation.valid).toBe(true);

    const removed = await call(client, "remove_entity_type_from_lens", {
      lens_key: "hr",
      entity_type_key: "person",
    });
    expect(text(removed)).toBe("Entity type 'person' removed from lens 'hr'.");

    const deleted = await call(client, "delete_lens", { lens_key: "hr" });
    expect(text(deleted)).toBe("Lens 'hr' deleted successfully.");

    const gone = await call(client, "validate_lens", { lens_key: "hr" });
    expect(gone.isError).toBe(true);
    expect(text(gone)).toContain("Lens 'hr' not found");
  });

  it("adding again is the MCP way to change an allowlist (there is no update tool)", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "add_property", {
      type_kind: "entity_type",
      type_key: "person",
      key: "full_name",
      display_name: "Full Name",
      data_type: "string",
    });
    await call(client, "add_property", {
      type_kind: "entity_type",
      type_key: "person",
      key: "age",
      display_name: "Age",
      data_type: "integer",
    });
    await call(client, "create_lens", { key: "hr", name: "HR" });

    const first = await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "person",
      properties: ["full_name"],
    });
    expect(json(first).properties).toEqual(["full_name"]);

    // Re-add with a different allowlist — an upsert, not a conflict.
    const second = await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "person",
      properties: ["full_name", "age"],
    });
    expect(second.isError).toBeUndefined();
    expect(json(second).properties).toEqual(["full_name", "age"]);

    // Re-add with no properties widens back to all.
    const third = await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "person",
    });
    expect(json(third).properties).toBeNull();
  });

  it("relation inclusions: endpoint rule enforced once entity inclusions exist", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "create_entity_type", { key: "company", display_name: "Company" });
    await call(client, "create_relation_type", {
      key: "works_for",
      display_name: "Works For",
      source_entity_type_key: "person",
      target_entity_type_key: "company",
    });
    await call(client, "create_lens", { key: "hr", name: "HR" });
    await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "person",
    });

    const refused = await call(client, "add_relation_type_to_lens", {
      lens_key: "hr",
      relation_type_key: "works_for",
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("company");

    await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "company",
    });
    const accepted = await call(client, "add_relation_type_to_lens", {
      lens_key: "hr",
      relation_type_key: "works_for",
    });
    expect(accepted.isError).toBeUndefined();
    expect(json(accepted).key).toBe("works_for");

    const removed = await call(client, "remove_relation_type_from_lens", {
      lens_key: "hr",
      relation_type_key: "works_for",
    });
    expect(text(removed)).toBe("Relation type 'works_for' removed from lens 'hr'.");
  });

  it("validate_schema combines the global half with every lens", async () => {
    const clean = json(await call(client, "validate_schema"));
    expect(clean).toEqual({ valid: true, errors: [], warnings: [] });

    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "add_property", {
      type_kind: "entity_type",
      type_key: "person",
      key: "full_name",
      display_name: "Full Name",
      data_type: "string",
    });
    await call(client, "create_lens", { key: "hr", name: "HR" });
    await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "person",
      properties: ["full_name"],
    });
    // Delete the property WITHOUT cascade — the allowlist goes stale.
    await call(client, "delete_property", {
      type_kind: "entity_type",
      type_key: "person",
      property_key: "full_name",
    });

    const result = json(await call(client, "validate_schema"));
    expect(result.valid).toBe(false);
    const errors = result.errors as { path: string; message: string }[];
    expect(errors).toContainEqual({
      path: "lenses.hr.includes.entityTypes.person.properties",
      message: "Property 'full_name' does not exist on entity type 'person'",
    });
  });

  it("a cascade refusal over MCP carries only the message — no structured lens list", async () => {
    await call(client, "create_entity_type", { key: "person", display_name: "Person" });
    await call(client, "create_lens", { key: "hr", name: "HR" });
    await call(client, "add_entity_type_to_lens", {
      lens_key: "hr",
      entity_type_key: "person",
    });

    const refused = await call(client, "delete_entity_type", { entity_type_key: "person" });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("included by 1 lens(es)");
    // Only the flat message: the structured affectedLenses list is REST-only.
    expect(refused.content).toHaveLength(1);
    expect(text(refused)).not.toContain("affectedLenses");

    // The cascade flag works end-to-end.
    const consented = await call(client, "delete_entity_type", {
      entity_type_key: "person",
      cascade: true,
    });
    expect(consented.isError).toBeUndefined();
    const inclusions = await call(client, "validate_lens", { lens_key: "hr" });
    expect(json(inclusions).valid).toBe(true); // lens now unscoped again
  });
});

describe.skipIf(!supportsMultipleOntologies)("ontology isolation", () => {
  it("two clients on two mounts cannot observe each other", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "other_ont" },
    });
    expect(created.statusCode, created.body).toBe(201);

    const clientA = await connectClient("isolation-a", "test_ont");
    const clientB = await connectClient("isolation-b", "other_ont");
    try {
      // The same type key exists in both ontologies without conflict.
      const personA = await call(clientA, "create_entity_type", {
        key: "person",
        display_name: "Person in A",
      });
      expect(personA.isError, text(personA)).toBeUndefined();
      const personB = await call(clientB, "create_entity_type", {
        key: "person",
        display_name: "Person in B",
      });
      expect(personB.isError, text(personB)).toBeUndefined();

      await call(clientA, "create_entity_type", { key: "only_in_a", display_name: "A" });

      // Each client sees only its own ontology's schema — and nothing in
      // any response names the other ontology.
      const schemaA = json(await call(clientA, "get_schema"));
      const schemaB = json(await call(clientB, "get_schema"));
      expect((schemaA.entityTypes as Record<string, unknown>[]).map((et) => et.key)).toEqual([
        "only_in_a",
        "person",
      ]);
      expect((schemaB.entityTypes as Record<string, unknown>[]).map((et) => et.key)).toEqual([
        "person",
      ]);
      const personBExport = (schemaB.entityTypes as Record<string, unknown>[])[0]!;
      expect(personBExport.displayName).toBe("Person in B");
      expect(JSON.stringify(schemaB)).not.toContain("test_ont");
      expect(JSON.stringify(schemaB)).not.toContain("only_in_a");
      expect(JSON.stringify(schemaA)).not.toContain("other_ont");

      // A tool cannot be steered at the other ontology: keys resolve
      // within the binding only.
      const missing = await call(clientB, "update_entity_type", {
        entity_type_key: "only_in_a",
        display_name: "Stolen",
      });
      expect(missing.isError).toBe(true);
      expect(text(missing)).toContain("Entity type 'only_in_a' not found");
    } finally {
      await clientA.close();
      await clientB.close();
    }
  });
});

describe("stateless transport", () => {
  it("two interleaved clients work over one mount", async () => {
    const clientA = await connectClient("interleaved-a");
    const clientB = await connectClient("interleaved-b");
    try {
      const a1 = await call(clientA, "create_entity_type", {
        key: "alpha",
        display_name: "Alpha",
      });
      expect(a1.isError).toBeUndefined();
      const b1 = await call(clientB, "create_entity_type", {
        key: "beta",
        display_name: "Beta",
      });
      expect(b1.isError).toBeUndefined();
      const a2 = json(await call(clientA, "get_schema"));
      const b2 = json(await call(clientB, "get_schema"));
      // Both clients see the same bound ontology — no per-connection state.
      expect((a2.entityTypes as Record<string, unknown>[]).map((et) => et.key)).toEqual([
        "alpha",
        "beta",
      ]);
      expect(b2).toEqual(a2);
    } finally {
      await clientA.close();
      await clientB.close();
    }
  });

  it("answers plain JSON, not SSE", async () => {
    const res = await fetch(`${baseUrl}/mcp/ontologies/test_ont/model`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "raw", version: "0.0.1" },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("OntoForge Modeling");
  });

  it("a trailing path segment below the mount is an unknown route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/ontologies/test_ont/model/extra",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });
});

describe("mount addressing", () => {
  it("the old mount paths are gone", async () => {
    for (const url of ["/mcp/model", "/mcp/model/some_lens", "/mcp/runtime", "/mcp/runtime/test_lens"]) {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    }
  });

  it("a mount URL naming no ontology is an error", async () => {
    for (const url of ["/mcp/ontologies//model", "/mcp/ontologies/model", "/mcp/ontologies"]) {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode, url).toBe(404);
    }
  });
});
