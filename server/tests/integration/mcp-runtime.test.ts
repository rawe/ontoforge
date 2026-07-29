/**
 * Runtime MCP server integration — official SDK client against
 * `/mcp/runtime` on a real listening server, backed by the docker-compose
 * Neo4j.
 *
 * Covers the three lens-resolution sources in priority order plus the 400
 * refusal, the limit/offset CLAMPING that diverges by design from REST's
 * rejection, and the entity tool round trip.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores, wipeDatabase } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture } from "./fixture.js";

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

let app: FastifyInstance;
let baseUrl: string;

async function connectClient(url: string, headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "session-04-tests", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: headers ? { headers } : undefined,
    }),
  );
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;
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
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  await buildFixture(app);
});

afterEach(() => {
  delete process.env.DEFAULT_MCP_ONTOLOGY_KEY;
});

describe("lens resolution", () => {
  it("1 — the first path segment binds the lens", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/hr_view`);
    try {
      const schema = json(await call(client, "get_schema"));
      expect((schema.ontology as Record<string, unknown>).key).toBe("hr_view");
    } finally {
      await client.close();
    }
  });

  it("2 — the X-Ontology-Key header binds the lens when the path names none", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime`, {
      "X-Ontology-Key": "test_ontology",
    });
    try {
      const schema = json(await call(client, "get_schema"));
      expect((schema.ontology as Record<string, unknown>).key).toBe("test_ontology");
    } finally {
      await client.close();
    }
  });

  it("3 — the DEFAULT_MCP_ONTOLOGY_KEY environment variable is the fallback", async () => {
    process.env.DEFAULT_MCP_ONTOLOGY_KEY = "hr_view";
    const client = await connectClient(`${baseUrl}/mcp/runtime`);
    try {
      const schema = json(await call(client, "get_schema"));
      expect((schema.ontology as Record<string, unknown>).key).toBe("hr_view");
    } finally {
      await client.close();
    }
  });

  it("the path takes priority over the header", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`, {
      "X-Ontology-Key": "hr_view",
    });
    try {
      const schema = json(await call(client, "get_schema"));
      expect((schema.ontology as Record<string, unknown>).key).toBe("test_ontology");
    } finally {
      await client.close();
    }
  });

  it("with none of the three the request is refused with 400", async () => {
    const res = await fetch(`${baseUrl}/mcp/runtime`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Ontology key required");
  });
});

describe("tool surface", () => {
  it("lists exactly the twelve session-04/05 tools", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "create_entity",
        "create_relation",
        "delete_entity",
        "delete_relation",
        "get_entity",
        "get_neighbors",
        "get_relation",
        "get_schema",
        "list_entities",
        "list_relations",
        "update_entity",
        "update_relation",
      ]);
    } finally {
      await client.close();
    }
  });
});

describe("entity tools", () => {
  it("round-trips create, list, get, update, delete through one lens", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const created = json(
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name: "Alice", age: 30, email: "a@b.com" },
        }),
      );
      expect(created.name).toBe("Alice");
      expect(created.active).toBe(true); // default applied
      const entityId = created._id as string;

      const listed = json(
        await call(client, "list_entities", {
          entity_type_key: "person",
          filters: { age__gte: 29 },
        }),
      );
      expect(listed.total).toBe(1);

      const fetched = json(
        await call(client, "get_entity", {
          entity_type_key: "person",
          entity_id: entityId,
          fields: ["name"],
        }),
      );
      expect(fetched).toEqual({ _id: entityId, name: "Alice" });

      const updated = json(
        await call(client, "update_entity", {
          entity_type_key: "person",
          entity_id: entityId,
          properties: { email: "new@b.com", age: null },
        }),
      );
      expect(updated.email).toBe("new@b.com");
      expect(updated).not.toHaveProperty("age");

      const deleted = await call(client, "delete_entity", {
        entity_type_key: "person",
        entity_id: entityId,
      });
      expect(json(deleted).message).toContain("deleted successfully");

      const gone = await call(client, "get_entity", {
        entity_type_key: "person",
        entity_id: entityId,
      });
      expect(gone.isError).toBe(true);
      expect(text(gone)).toContain("not found");
    } finally {
      await client.close();
    }
  });

  it("clamps limit and offset into range where REST rejects", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      await call(client, "create_entity", {
        entity_type_key: "person",
        properties: { name: "Bob" },
      });

      const oversized = json(
        await call(client, "list_entities", { entity_type_key: "person", limit: 500, offset: -5 }),
      );
      expect(oversized.limit).toBe(200); // clamped, not rejected
      expect(oversized.offset).toBe(0);

      const undersized = json(
        await call(client, "list_entities", { entity_type_key: "person", limit: 0 }),
      );
      expect(undersized.limit).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("a validation failure flattens every offending field into the tool error", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const result = await call(client, "create_entity", {
        entity_type_key: "person",
        properties: { age: "abc", nickname: "x" },
      });
      expect(result.isError).toBe(true);
      const message = text(result);
      expect(message).toContain("name");
      expect(message).toContain("age");
      expect(message).toContain("nickname");
    } finally {
      await client.close();
    }
  });

  it("relation tools round-trip create, list, get, update, delete", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const alice = json(
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name: "Alice" },
        }),
      );
      const acme = json(
        await call(client, "create_entity", {
          entity_type_key: "company",
          properties: { name: "Acme" },
        }),
      );

      const created = json(
        await call(client, "create_relation", {
          relation_type_key: "works_for",
          from_entity_id: alice._id,
          to_entity_id: acme._id,
          properties: { role: "Engineer", since: "2024-01-15" },
        }),
      );
      expect(created.fromEntityId).toBe(alice._id);
      expect(created.toEntityId).toBe(acme._id);
      expect(created.role).toBe("Engineer");
      const relId = created._id as string;

      const listed = json(
        await call(client, "list_relations", {
          relation_type_key: "works_for",
          from_entity_id: alice._id,
        }),
      );
      expect(listed.total).toBe(1);

      // Limit clamps into range where REST rejects.
      const clamped = json(
        await call(client, "list_relations", { relation_type_key: "works_for", limit: 999 }),
      );
      expect(clamped.limit).toBe(200);

      const fetched = json(
        await call(client, "get_relation", {
          relation_type_key: "works_for",
          relation_id: relId,
        }),
      );
      expect(fetched.role).toBe("Engineer");

      const updated = json(
        await call(client, "update_relation", {
          relation_type_key: "works_for",
          relation_id: relId,
          properties: { role: "Manager", fromEntityId: "ignored" },
        }),
      );
      expect(updated.role).toBe("Manager");
      expect(updated.fromEntityId).toBe(alice._id); // endpoint silently kept

      const deleted = json(
        await call(client, "delete_relation", {
          relation_type_key: "works_for",
          relation_id: relId,
        }),
      );
      expect(deleted.message).toContain("deleted successfully");

      const gone = await call(client, "get_relation", {
        relation_type_key: "works_for",
        relation_id: relId,
      });
      expect(gone.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("create_relation reports endpoint and property errors together as a tool error", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const result = await call(client, "create_relation", {
        relation_type_key: "works_for",
        from_entity_id: "no-such",
        to_entity_id: "also-missing",
        properties: { bogus: "x" },
      });
      expect(result.isError).toBe(true);
      const message = text(result);
      expect(message).toContain("fromEntityId");
      expect(message).toContain("toEntityId");
      expect(message).toContain("bogus");
    } finally {
      await client.close();
    }
  });

  it("get_neighbors round-trips with projections and clamps its limit", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const alice = json(
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name: "Alice", email: "a@b.com" },
        }),
      );
      const acme = json(
        await call(client, "create_entity", {
          entity_type_key: "company",
          properties: { name: "Acme" },
        }),
      );
      await call(client, "create_relation", {
        relation_type_key: "works_for",
        from_entity_id: alice._id,
        to_entity_id: acme._id,
        properties: { role: "Engineer" },
      });

      const hood = json(
        await call(client, "get_neighbors", {
          entity_type_key: "person",
          entity_id: alice._id,
          fields: ["name"],
          relation_fields: ["role"],
          limit: 9999, // clamped, not rejected
        }),
      );
      const entity = hood.entity as Record<string, unknown>;
      expect(Object.keys(entity).sort()).toEqual(["_id", "name"]);
      const neighbors = hood.neighbors as Record<string, unknown>[];
      expect(neighbors).toHaveLength(1);
      const relation = neighbors[0]!.relation as Record<string, unknown>;
      expect(Object.keys(relation).sort()).toEqual([
        "_id",
        "_relationTypeKey",
        "direction",
        "role",
      ]);
      expect(relation.direction).toBe("outgoing");
      const neighborEntity = neighbors[0]!.entity as Record<string, unknown>;
      expect(neighborEntity._entityTypeKey).toBe("company");
    } finally {
      await client.close();
    }
  });

  it("the scoped lens governs the tools exactly as it governs REST", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/hr_view`);
    try {
      const rejected = await call(client, "create_entity", {
        entity_type_key: "person",
        properties: { name: "Eve", age: 30 }, // age hidden by the lens
      });
      expect(rejected.isError).toBe(true);
      expect(text(rejected)).toContain("age");

      const created = json(
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name: "Eve", email: "e@b.com" },
        }),
      );
      expect(created).not.toHaveProperty("active"); // hidden default invisible here
    } finally {
      await client.close();
    }
  });
});
