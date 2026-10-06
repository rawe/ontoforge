/**
 * The runtime MCP `search` tool's index arguments: `index` (one key or a
 * list) switches to the index search with `relations`, the filters, the
 * clamped limit, the projection and the tools' fixed similarity floor;
 * without `index` the default search runs as before. `list_search_indices`
 * returns the lens's catalog. The services are stubbed; an in-memory
 * client calls the tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { ValidationError } from "../../src/core/exceptions.js";

const stubs = vi.hoisted(() => ({
  searchByIndices: vi.fn(),
  search: vi.fn(),
  searchIndexCatalog: vi.fn(),
}));
vi.mock("../../src/runtime/service.js", () => stubs);
vi.mock("../../src/core/ports.js", async (original) => ({
  ...(await original<object>()),
  getRuntimeStore: async () => ({ supportsKeywordRanking: () => true }),
}));

const { createRuntimeMcpServer, indexSearchOf } = await import("../../src/mcp/runtime.js");

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

let client: Client;

async function call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;
}

beforeEach(async () => {
  stubs.searchByIndices.mockReset().mockResolvedValue({ query: "q", mode: "hybrid", hits: [] });
  stubs.search.mockReset().mockResolvedValue({ hits: [] });
  stubs.searchIndexCatalog.mockReset().mockResolvedValue([{ key: "person~default" }]);
  setEmbeddingProvider({
    dimensions: 2,
    modelId: "fake:hash:2",
    embed: async () => [1, 0],
    embedBatch: async (texts) => texts.map(() => [1, 0]),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createRuntimeMcpServer("onto", "all").connect(serverTransport);
  client = new Client({ name: "search-tool-tests", version: "0.0.1" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  setEmbeddingProvider(null);
});

describe("indexSearchOf", () => {
  it("maps one key or a list to indices, relations alongside", () => {
    expect(indexSearchOf({})).toBeNull();
    expect(indexSearchOf({ index: "people" })).toEqual({ indices: ["people"], relations: null });
    expect(indexSearchOf({ index: ["a", "b"], relations: ["works_for"] })).toEqual({
      indices: ["a", "b"],
      relations: ["works_for"],
    });
  });

  it("refuses relations without index and an entity type with it", () => {
    expect(() => indexSearchOf({ relations: ["works_for"] })).toThrow(ValidationError);
    expect(() => indexSearchOf({ index: "people", entity_type_key: "person" })).toThrow(
      "entity_type_key does not apply with index",
    );
  });
});

describe("search with index", () => {
  it("runs the index search with the mapped arguments and the fixed floor", async () => {
    const result = await call("search", {
      query: "CTO ACME",
      index: "employment",
      relations: ["works_for"],
      filters: { since__gte: 2020, active: true },
      limit: 500,
      fields: ["name"],
    });
    expect(result.isError).toBeFalsy();
    expect(stubs.searchByIndices).toHaveBeenCalledWith(
      "all",
      {
        indices: ["employment"],
        relations: ["works_for"],
        query: "CTO ACME",
        filters: { since__gte: "2020", active: "true" },
        minScore: 0.75,
        limit: 100,
        fields: ["name"],
      },
      expect.anything(),
    );
    expect(stubs.search).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      query: "q",
      mode: "hybrid",
      minSimilarity: 0.75,
      hits: [],
    });
  });

  it("applies no floor when the server ranks by keyword only", async () => {
    setEmbeddingProvider(null);
    await call("search", { query: "x", index: ["a", "b"] });
    expect(stubs.searchByIndices.mock.calls[0]![1]).toMatchObject({ indices: ["a", "b"], minScore: null });
  });

  it("without index the default search runs; relations alone is a tool error", async () => {
    await call("search", { query: "x", entity_type_key: "person" });
    expect(stubs.search).toHaveBeenCalledWith("all", expect.objectContaining({ type: "person" }), expect.anything());
    expect(stubs.searchByIndices).not.toHaveBeenCalled();
    const refused = await call("search", { query: "x", relations: ["works_for"] });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("relations: Applies only with index");
  });

  it("search_documents takes no index", async () => {
    const tools = await client.listTools();
    const documents = tools.tools.find((tool) => tool.name === "search_documents")!;
    expect(Object.keys(documents.inputSchema.properties ?? {})).not.toContain("index");
    const search = tools.tools.find((tool) => tool.name === "search")!;
    expect(Object.keys(search.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["index", "relations"]),
    );
  });
});

describe("list_search_indices", () => {
  it("returns the lens's catalog", async () => {
    const result = await call("list_search_indices", {});
    expect(stubs.searchIndexCatalog).toHaveBeenCalledWith("all", expect.anything());
    expect(JSON.parse(result.content[0]!.text)).toEqual([{ key: "person~default" }]);
  });
});
