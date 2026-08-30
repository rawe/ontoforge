/**
 * Runtime MCP server integration — official SDK client against
 * `/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey` on a real
 * listening server, backed by the docker-compose test database.
 *
 * Covers the URL-only ontology + lens binding (no header, no environment
 * fallback), ontology isolation between two bound clients, the
 * limit/offset CLAMPING that diverges by design from REST's rejection,
 * and the entity tool round trip.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";
import { supportsMultipleOntologies } from "./tiers.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture } from "./fixture.js";

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

let app: FastifyInstance;
let baseUrl: string;

async function connectClient(url: string, headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "runtime-mcp-tests", version: "0.0.1" });
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

describe("URL binding", () => {
  it("the mount URL binds ontology and lens", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/hr_view`);
    try {
      const schema = json(await call(client, "get_schema"));
      expect((schema.lens as Record<string, unknown>).key).toBe("hr_view");
    } finally {
      await client.close();
    }
  });

  it("a legacy X-Lens-Key header is dead — the URL is the only binding channel", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`, {
      "X-Lens-Key": "hr_view",
    });
    try {
      const schema = json(await call(client, "get_schema"));
      expect((schema.lens as Record<string, unknown>).key).toBe("test_lens");
    } finally {
      await client.close();
    }
  });

  it("a mount naming an unknown ontology answers a not-found tool error", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/no_such_ont/runtime/lenses/test_lens`);
    try {
      const result = await call(client, "get_schema");
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Ontology 'no_such_ont' not found");
    } finally {
      await client.close();
    }
  });

  it("a mount naming an unknown lens answers a not-found tool error", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/no_such_lens`);
    try {
      const result = await call(client, "get_schema");
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("not found");
    } finally {
      await client.close();
    }
  });

  it("a mount URL naming no lens is an error", async () => {
    for (const url of [
      "/mcp/ontologies/test_ont/runtime",
      "/mcp/ontologies/test_ont/runtime/lenses",
      "/mcp/ontologies/test_ont/runtime/lenses//",
    ]) {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

describe.skipIf(!supportsMultipleOntologies)("ontology isolation", () => {
  it("two clients on two mounts cannot observe each other", async () => {
    // A second ontology with the SAME type key and the SAME lens key —
    // legal since keys are per-ontology — holding disjoint data.
    const post = async (url: string, payload: Record<string, unknown>) => {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
      return res.json() as Record<string, unknown>;
    };
    await post("/api/ontologies", { key: "other_ont" });
    const person = await post("/api/ontologies/other_ont/model/entity-types", {
      key: "person",
      displayName: "Person",
    });
    await post(`/api/ontologies/other_ont/model/entity-types/${person.entityTypeId as string}/properties`, {
      key: "name",
      displayName: "Name",
      dataType: "string",
      required: true,
    });
    await post("/api/ontologies/other_ont/model/lenses", { key: "test_lens", name: "Other Lens" });

    const clientA = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
    const clientB = await connectClient(`${baseUrl}/mcp/ontologies/other_ont/runtime/lenses/test_lens`);
    try {
      await call(clientA, "create_entity", {
        entity_type_key: "person",
        properties: { name: "Alice" },
      });
      await call(clientB, "create_entity", {
        entity_type_key: "person",
        properties: { name: "Zoe" },
      });

      // Listing, OQL, and the schema each see only the bound ontology.
      const listedA = json(await call(clientA, "list_entities", { entity_type_key: "person" }));
      const listedB = json(await call(clientB, "list_entities", { entity_type_key: "person" }));
      expect((listedA.items as { name: string }[]).map((i) => i.name)).toEqual(["Alice"]);
      expect((listedB.items as { name: string }[]).map((i) => i.name)).toEqual(["Zoe"]);

      const queriedB = json(
        await call(clientB, "execute_query", {
          query: "MATCH (p:person) RETURN p.name AS name ORDER BY p.name",
        }),
      );
      expect(queriedB.results).toEqual([{ name: "Zoe" }]);

      const schemaB = json(await call(clientB, "get_schema"));
      expect((schemaB.lens as Record<string, unknown>).name).toBe("Other Lens");
      expect(JSON.stringify(schemaB)).not.toContain("test_ont");

      // No tool reaches the other ontology's data by id either.
      const alice = (listedA.items as { _id: string }[])[0]!;
      const stolen = await call(clientB, "get_entity", {
        entity_type_key: "person",
        entity_id: alice._id,
      });
      expect(stolen.isError).toBe(true);
      expect(text(stolen)).toContain("not found");
    } finally {
      await clientA.close();
      await clientB.close();
    }
  });
});

describe("tool surface", () => {
  it("lists exactly the twenty runtime tools", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "create_entity",
        "create_relation",
        "delete_entity",
        "delete_relation",
        "edit_document",
        "execute_query",
        "get_document",
        "get_entity",
        "get_neighbors",
        "get_relation",
        "get_schema",
        "list_entities",
        "list_relations",
        "list_saved_queries",
        "run_saved_query",
        "search_saved_queries",
        "semantic_search",
        "update_entity",
        "update_relation",
        "write_document",
      ]);
    } finally {
      await client.close();
    }
  });
});

describe("document tools", () => {
  /** The fixture has no document property; declare one on person. */
  async function addBioProperty(): Promise<void> {
    const list = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/model/entity-types" });
    const person = (list.json() as { entityTypeId: string; key: string }[]).find(
      (et) => et.key === "person",
    )!;
    const res = await app.inject({
      method: "POST",
      url: `/api/ontologies/test_ont/model/entity-types/${person.entityTypeId}/properties`,
      payload: { key: "bio", displayName: "Bio", dataType: "document" },
    });
    expect(res.statusCode).toBe(201);
  }

  it("get_document reads whole documents and clamped slices", async () => {
    await addBioProperty();
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
    try {
      const created = json(
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name: "Ada", bio: "# Title\n\nBody text of the bio." },
        }),
      );
      // The stub, never the content, in the create result.
      expect(created.bio).toEqual({ document: true, length: 30 });
      const entityId = created._id as string;

      const full = json(
        await call(client, "get_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
        }),
      );
      expect(full).toEqual({
        propertyKey: "bio",
        content: "# Title\n\nBody text of the bio.",
        offset: 0,
        length: 30,
        totalLength: 30,
      });

      const slice = json(
        await call(client, "get_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
          offset: 9,
          limit: 4,
        }),
      );
      expect(slice.content).toBe("Body");

      // MCP clamps where REST rejects: negative offset -> 0, limit 0 -> 1.
      const clamped = json(
        await call(client, "get_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
          offset: -5,
          limit: 0,
        }),
      );
      expect(clamped.offset).toBe(0);
      expect(clamped.content).toBe("#");
    } finally {
      await client.close();
    }
  });

  it("edit_document replaces exactly and reports ambiguity as a tool error", async () => {
    await addBioProperty();
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
    try {
      const created = json(
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name: "Ada", bio: "one two one two" },
        }),
      );
      const entityId = created._id as string;

      const ambiguous = await call(client, "edit_document", {
        entity_type_key: "person",
        entity_id: entityId,
        property_key: "bio",
        old_string: "two",
        new_string: "three",
      });
      expect(ambiguous.isError).toBe(true);
      expect(text(ambiguous)).toContain("2 times");

      const replaced = json(
        await call(client, "edit_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
          old_string: "two",
          new_string: "three",
          replace_all: true,
        }),
      );
      expect(replaced.replacements).toBe(2);
      expect(replaced.totalLength).toBe("one three one three".length);
      expect(replaced.context).toBe("one three one three");

      const readBack = json(
        await call(client, "get_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
        }),
      );
      expect(readBack.content).toBe("one three one three");
    } finally {
      await client.close();
    }
  });

  it("write_document overwrites ranges and surfaces the expect conflict", async () => {
    await addBioProperty();
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
    try {
      const created = json(
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name: "Ada", bio: "Hello world" },
        }),
      );
      const entityId = created._id as string;

      // Append at offset == totalLength.
      const appended = json(
        await call(client, "write_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
          offset: 11,
          length: 0,
          content: "!",
        }),
      );
      expect(appended.totalLength).toBe(12);

      const conflict = await call(client, "write_document", {
        entity_type_key: "person",
        entity_id: entityId,
        property_key: "bio",
        offset: 6,
        length: 5,
        content: "docs",
        expect: "stale",
      });
      expect(conflict.isError).toBe(true);
      expect(text(conflict)).toContain("expect mismatch");

      const overwritten = json(
        await call(client, "write_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
          offset: 6,
          length: 5,
          content: "docs",
          expect: "world",
        }),
      );
      expect(overwritten.totalLength).toBe("Hello docs!".length);

      const readBack = json(
        await call(client, "get_document", {
          entity_type_key: "person",
          entity_id: entityId,
          property_key: "bio",
        }),
      );
      expect(readBack.content).toBe("Hello docs!");
    } finally {
      await client.close();
    }
  });
});

describe("entity tools", () => {
  it("round-trips create, list, get, update, delete through one lens", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
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
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
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

  it("refuses a sort direction outside asc/desc at the tool boundary", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
    try {
      // A crafted tail must die at argument validation, never reach a query.
      const entities = await call(client, "list_entities", {
        entity_type_key: "person",
        sort: "name",
        order: "asc, n._embedding",
      });
      expect(entities.isError).toBe(true);
      expect(text(entities)).toContain("Invalid arguments for tool list_entities");
      expect(text(entities)).toContain("order");

      const relations = await call(client, "list_relations", {
        relation_type_key: "works_for",
        order: "asc, r._createdAt",
      });
      expect(relations.isError).toBe(true);
      expect(text(relations)).toContain("Invalid arguments for tool list_relations");
      expect(text(relations)).toContain("order");
    } finally {
      await client.close();
    }
  });

  it("sorts descending when order is 'desc'", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
    try {
      for (const name of ["Alice", "Bob"]) {
        await call(client, "create_entity", {
          entity_type_key: "person",
          properties: { name },
        });
      }
      const listed = json(
        await call(client, "list_entities", {
          entity_type_key: "person",
          sort: "name",
          order: "desc",
        }),
      );
      const items = listed.items as { name: string }[];
      expect(items.map((i) => i.name)).toEqual(["Bob", "Alice"]);
    } finally {
      await client.close();
    }
  });

  it("a validation failure flattens every offending field into the tool error", async () => {
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
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
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
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
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
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
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/test_lens`);
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
    const client = await connectClient(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/hr_view`);
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
