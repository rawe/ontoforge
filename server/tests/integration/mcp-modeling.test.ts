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
  it("lists exactly the twenty-eight modeling tools — and NO update-inclusion tool", async () => {
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(28);
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "add_entity_type_to_lens",
      "add_property",
      "add_relation_type_to_lens",
      "create_entity_type",
      "create_lens",
      "create_relation_type",
      "delete_ai_agent",
      "delete_entity_type",
      "delete_lens",
      "delete_property",
      "delete_relation_type",
      "delete_saved_query",
      "ensure_ontology",
      "export_schema",
      "get_schema",
      "import_schema",
      "list_ai_agents",
      "list_saved_queries",
      "remove_entity_type_from_lens",
      "remove_relation_type_from_lens",
      "set_ai_agent",
      "set_saved_query",
      "update_entity_type",
      "update_lens",
      "update_property",
      "update_relation_type",
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

    await call(client, "create_entity_type", { key: "company", display_name: "Company" });

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

    const deletedProp = await call(client, "delete_property", {
      type_kind: "relation_type",
      type_key: "works_for",
      property_key: "role",
    });
    expect(text(deletedProp)).toBe("Property 'role' deleted from relation_type 'works_for'.");

    // get_schema reflects it all in the transfer shape.
    const schema = json(await call(client, "get_schema"));
    expect(schema.formatVersion).toBe("4.0");
    expect(schema.lenses).toEqual([]);
    const entityTypes = schema.entityTypes as Record<string, unknown>[];
    expect(entityTypes.map((et) => et.key)).toEqual(["company", "person"]);
    const personExport = entityTypes.find((et) => et.key === "person");
    expect((personExport?.properties as unknown[])).toHaveLength(1);
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
    expect(clean).toEqual({ valid: true, errors: [] });

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
