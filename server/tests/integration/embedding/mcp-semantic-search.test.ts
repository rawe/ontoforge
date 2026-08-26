/**
 * Runtime MCP `semantic_search` round-trip — official SDK client against a
 * real listening server with the Ollama provider active. Also pins the
 * documented interface difference: the tool exposes NO min_score.
 * SKIPPED when Ollama or the model is unavailable.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;
let baseUrl: string;
let client: Client;

describe.skipIf(!ollamaUp)("MCP semantic_search (Ollama)", () => {
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

    // Fixture: ontology + person type + two entities.
    const post = async (url: string, payload: Row): Promise<Row> => {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
      return res.json() as Row;
    };
    await post("/api/model/ontologies", { key: "mcp_search", name: "MCP Search" });
    const et = await post("/api/model/entity-types", { key: "person", displayName: "Person" });
    for (const prop of [
      { key: "name", displayName: "Name", dataType: "string", required: true },
      { key: "bio", displayName: "Bio", dataType: "string", required: false },
      { key: "age", displayName: "Age", dataType: "integer", required: false },
    ]) {
      await post(`/api/model/entity-types/${et.entityTypeId as string}/properties`, prop);
    }
    await post("/api/runtime/mcp_search/entities/person", {
      name: "Alice Chen",
      bio: "Expert in distributed systems and microservices",
      age: 34,
    });
    await post("/api/runtime/mcp_search/entities/person", {
      name: "Bob Smith",
      bio: "Leads brand strategy and market research",
      age: 51,
    });

    client = new Client({ name: "semantic-search-mcp-tests", version: "0.0.1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/runtime/mcp_search`)),
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
    const result = await call("semantic_search", {
      query: "distributed systems engineer",
      entity_type_key: "person",
    });
    expect(result.isError).toBeFalsy();
    const data = json(result);
    expect(data.total as number).toBeGreaterThan(0);
    const results = data.results as Row[];
    expect((results[0]!.entity as Row).name).toBe("Alice Chen");
    expect((results[0]!.matchedVia as Row).similarity).toBeTypeOf("number");
  });

  it("supports filters and field projection", async () => {
    const result = await call("semantic_search", {
      query: "engineer",
      entity_type_key: "person",
      filters: { age__lt: "40" },
      fields: ["name"],
    });
    expect(result.isError).toBeFalsy();
    const data = json(result);
    const results = data.results as Row[];
    expect(results.length).toBeGreaterThan(0);
    for (const hit of results) {
      const entity = hit.entity as Row;
      expect(entity.name).toBe("Alice Chen");
      expect(entity).not.toHaveProperty("age");
      expect(entity).not.toHaveProperty("bio");
    }
  });

  it("exposes no min_score input (documented interface difference)", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "semantic_search");
    expect(tool).toBeDefined();
    const properties = (tool!.inputSchema as { properties: Row }).properties;
    expect(Object.keys(properties).sort()).toEqual([
      "entity_type_key",
      "fields",
      "filters",
      "limit",
      "query",
      "search_in",
      "snippets",
    ]);
    expect(properties).not.toHaveProperty("min_score");
  });

  it("reports a search failure as a tool error", async () => {
    const result = await call("semantic_search", {
      query: "anything",
      entity_type_key: "person",
      filters: { name__contains: "Ali" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("__contains");
  });
});
