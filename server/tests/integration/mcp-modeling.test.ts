/**
 * Modeling MCP server integration — official SDK client against
 * `/mcp/model` on a real listening server, backed by the docker-compose
 * Neo4j.
 *
 * Covers: every tool shipped this session, stateless JSON transport with
 * two interleaved clients, key (not id) addressing, and validation
 * failures surfacing every offending field in one message string.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores, wipeDatabase } from "../../src/core/ports.js";

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

let app: FastifyInstance;
let baseUrl: string;
let client: Client;

async function connectClient(name: string): Promise<Client> {
  const c = new Client({ name, version: "0.0.1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/model`)));
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
  client = await connectClient("session-02-tests");
});

afterAll(async () => {
  await client.close();
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
});

describe("tool surface", () => {
  it("lists exactly the ten tools of this session", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "add_property",
      "create_entity_type",
      "create_relation_type",
      "delete_entity_type",
      "delete_property",
      "delete_relation_type",
      "get_schema",
      "update_entity_type",
      "update_property",
      "update_relation_type",
    ]);
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
    expect(schema.formatVersion).toBe("3.0");
    expect(schema.ontologies).toEqual([]);
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

  it("a reserved type key is rejected with the vendor-free reserved-set message", async () => {
    const rejected = await call(client, "create_entity_type", {
      key: "ontology",
      display_name: "Injected",
    });
    expect(rejected.isError).toBe(true);
    const message = text(rejected);
    expect(message).toContain("reserved");
    expect(message.toLowerCase()).not.toContain("neo4j");
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
      // Both clients see the one global schema — no per-connection state.
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
    const res = await fetch(`${baseUrl}/mcp/model`, {
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

  it("a trailing path segment is not a lens — it is an unknown route", async () => {
    const res = await app.inject({ method: "POST", url: "/mcp/model/some_ontology" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });
});
