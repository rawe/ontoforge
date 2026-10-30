/**
 * Runtime MCP `search` and `search_documents` round-trips — official SDK
 * client against a real listening server with the Ollama provider active.
 * Also pins the documented interface difference: the tools take no method
 * blocks and no similarity floor. SKIPPED when Ollama or the model is
 * unavailable.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { drainSearchWork } from "../../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";
import { defineEntityProperty } from "../fixture.js";

type Row = Record<string, unknown>;

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;
let baseUrl: string;
let client: Client;

describe.skipIf(!ollamaUp)("MCP search (Ollama)", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    enableOllamaProvider();
    app = await createApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a bound TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Fixture: lens + person type + two entities.
    const post = async (url: string, payload: Row): Promise<Row> => {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
      return res.json() as Row;
    };
    await post("/api/ontologies", { key: "test_ont" });
    await post("/api/ontologies/test_ont/model/lenses", { key: "mcp_search", name: "MCP Search" });
    const et = await post("/api/ontologies/test_ont/model/entity-types", { key: "person", displayName: "Person" });
    for (const prop of [
      { key: "name", displayName: "Name", dataType: "string", required: true },
      { key: "bio", displayName: "Bio", dataType: "document", required: false },
      { key: "role", displayName: "Role", dataType: "string", required: false },
      { key: "age", displayName: "Age", dataType: "integer", required: false },
    ]) {
      await defineEntityProperty(app, "test_ont", et.entityTypeId as string, prop);
    }
    await post("/api/ontologies/test_ont/runtime/lenses/mcp_search/entities/person", {
      name: "Alice Chen",
      role: "Distributed systems engineer",
      bio: "Expert in distributed systems and microservices",
      age: 34,
    });
    await post("/api/ontologies/test_ont/runtime/lenses/mcp_search/entities/person", {
      name: "Bob Smith",
      role: "Marketing manager",
      bio: "Leads brand strategy and market research",
      age: 51,
    });
    // Search entries are built in the background.
    await drainSearchWork();

    client = new Client({ name: "semantic-search-mcp-tests", version: "0.0.1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ontologies/test_ont/runtime/lenses/mcp_search`)),
    );
  });

  afterAll(async () => {
    await client.close();
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  async function call(name: string, args: Row = {}): Promise<ToolCallResult> {
    return (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;
  }

  function json(result: ToolCallResult): Row {
    return JSON.parse(result.content[0]?.text ?? "{}") as Row;
  }

  it("round-trips a type-scoped search", async () => {
    const result = await call("search", { query: "distributed systems engineer", types: ["person"] });
    expect(result.isError).toBeFalsy();
    const data = json(result);
    expect(data.ran).toEqual(["semantic", "keyword"]);
    const items = data.items as Row[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ rank: 1, entity: { _entityTypeKey: "person", name: "Alice Chen" } });
    // The best entry of the type's default index matched.
    expect(items[0]!.match).toMatchObject({ index: "person~default", part: "self" });
  });

  it("supports filters; items name their entities only", async () => {
    const result = await call("search", { query: "engineer", types: ["person"], filters: { age__lt: "40" } });
    expect(result.isError).toBeFalsy();
    const items = json(result).items as Row[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.entity).toEqual({ _id: expect.any(String), _entityTypeKey: "person", name: "Alice Chen" });
    }
  });

  it("omits every candidate below the fixed floor: a nonsense query returns no items", async () => {
    expect(json(await call("search", { query: "xqzv plork wumble" })).items).toEqual([]);
    expect(json(await call("search_documents", { query: "xqzv plork wumble" })).items).toEqual([]);
  });

  it("search with indices searches those indices under the same fixed floor", async () => {
    const found = json(await call("search", { query: "distributed systems engineer", indices: ["person~default"] }));
    expect(found.ran).toEqual(["semantic", "keyword"]);
    const top = (found.items as Row[])[0]!;
    expect((top.entity as Row).name).toBe("Alice Chen");
    expect(top.match).toMatchObject({ index: "person~default", part: "self" });
    const nonsense = json(await call("search", { query: "xqzv plork wumble", indices: ["person~default", "person~bio"] }));
    expect(nonsense.items).toEqual([]);
  });

  it("exposes no method block and no floor input (documented interface difference)", async () => {
    const tools = await client.listTools();
    const propertiesOf = (name: string) => {
      const tool = tools.tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      return (tool!.inputSchema as { properties: Row }).properties;
    };
    expect(Object.keys(propertiesOf("search")).sort()).toEqual(["filters", "indices", "limit", "query", "types"]);
    expect(Object.keys(propertiesOf("search_documents")).sort()).toEqual([
      "documents", "filters", "indices", "limit", "per_entity", "query", "text", "types",
    ]);
    expect(tools.tools.map((t) => t.name)).not.toContain("search_by_index");
    for (const searchTool of tools.tools.filter((item) => ["search", "search_documents"].includes(item.name))) {
      for (const input of ["min_score", "min_similarity", "semantic", "keyword"]) {
        expect(propertiesOf(searchTool.name)).not.toHaveProperty(input);
      }
      expect(searchTool.description).toContain("fixed similarity floor");
      expect(searchTool.description!.length).toBeLessThanOrEqual(2000);
      expect(searchTool.outputSchema).toBeUndefined();
    }
  });

  it("search_documents returns passages with their place and text", async () => {
    const response = await call("search_documents", {
      query: "distributed systems",
      documents: ["person.bio"],
      filters: { age__lt: "40" },
    });
    expect(response.isError).toBeFalsy();
    const body = json(response);
    expect(body.ran).toEqual(["semantic", "keyword"]);
    const item = (body.items as Row[])[0]!;
    expect(item).toEqual({
      rank: 1,
      entity: { _id: expect.any(String), _entityTypeKey: "person", name: "Alice Chen" },
      passage: {
        property: "bio",
        ordinal: 0,
        charOffset: expect.any(Number),
        charLength: expect.any(Number),
        text: expect.stringContaining("distributed systems"),
      },
    });
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).not.toContain("semantic_search");
  });

  it("reports a search failure as a tool error", async () => {
    const result = await call("search", {
      query: "anything",
      types: ["person"],
      filters: { name__contains: "Ali" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Not supported on search");
  });
});
