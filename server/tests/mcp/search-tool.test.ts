/**
 * The runtime MCP search tools: `search_by_index` runs the index search —
 * `index` (one key or a list, absent for all), `relations`, the filters, the
 * clamped limit, the projection and the tools' fixed similarity floor —
 * while `search` and `search_documents` run only the default search.
 * `list_search_indices` returns the lens's catalog. The services are
 * stubbed; an in-memory client calls the tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";

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

const { createRuntimeMcpServer } = await import("../../src/mcp/runtime.js");

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

describe("search_by_index", () => {
  it("runs the index search with the mapped arguments and the fixed floor", async () => {
    const result = await call("search_by_index", {
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

  it("takes a list of keys, and without index searches every index of the lens", async () => {
    await call("search_by_index", { query: "x", index: ["a", "b"] });
    await call("search_by_index", { query: "x" });
    expect(stubs.searchByIndices.mock.calls[0]![1]).toMatchObject({ indices: ["a", "b"], relations: null, limit: 10 });
    expect(stubs.searchByIndices.mock.calls[1]![1]).toMatchObject({ indices: null, relations: null });
  });

  it("applies no floor when the server ranks by keyword only", async () => {
    setEmbeddingProvider(null);
    const result = await call("search_by_index", { query: "x", index: "a" });
    expect(stubs.searchByIndices.mock.calls[0]![1]).toMatchObject({ minScore: null });
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ minSimilarity: null });
  });

  it("reports a refused request as a tool error", async () => {
    stubs.searchByIndices.mockRejectedValueOnce(new Error("Search index 'nope' not found"));
    const result = await call("search_by_index", { query: "x", index: "nope" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error executing tool search_by_index");
  });
});

describe("search", () => {
  it("runs only the default search", async () => {
    await call("search", { query: "x", entity_type_key: "person", filters: { age__gte: 30 } });
    expect(stubs.search).toHaveBeenCalledWith(
      "all",
      expect.objectContaining({ query: "x", type: "person", filter: { age__gte: "30" }, minSimilarity: 0.75 }),
      expect.anything(),
    );
    expect(stubs.searchByIndices).not.toHaveBeenCalled();
  });

  it("each search tool has its own arguments: no index on search, no entity type on search_by_index", async () => {
    const { tools } = await client.listTools();
    const argumentsOf = (name: string) =>
      Object.keys(tools.find((tool) => tool.name === name)!.inputSchema.properties ?? {}).sort();
    expect(argumentsOf("search")).toEqual(["entity_type_key", "fields", "filters", "limit", "query"]);
    expect(argumentsOf("search_documents")).toEqual(["entity_type_key", "fields", "filters", "limit", "property", "query"]);
    expect(argumentsOf("search_by_index")).toEqual(["fields", "filters", "index", "limit", "query", "relations"]);
  });
});

describe("list_search_indices", () => {
  it("returns the lens's catalog", async () => {
    const result = await call("list_search_indices", {});
    expect(stubs.searchIndexCatalog).toHaveBeenCalledWith("all", expect.anything());
    expect(JSON.parse(result.content[0]!.text)).toEqual([{ key: "person~default" }]);
  });
});

describe("search tool descriptions", () => {
  async function descriptionOf(name: string): Promise<string> {
    const { tools } = await client.listTools();
    return tools.find((tool) => tool.name === name)!.description!;
  }

  it("define the keyword score for the caller, without the adapter, within 2000 characters", async () => {
    for (const name of ["search", "search_documents"]) {
      const description = await descriptionOf(name);
      expect(description).toContain(
        "keywordScore is then the distinct query words matched plus the full-text rank as a fraction below one",
      );
      expect(description).not.toMatch(/adapter/i);
      expect(description.length).toBeLessThanOrEqual(2000);
    }
  });

  it("describe search_by_index's own response — matched, no evidence — within 2000 characters", async () => {
    const description = await descriptionOf("search_by_index");
    expect(description).toContain("Returns query, mode, minSimilarity and hits");
    expect(description).toContain("matched");
    expect(description).not.toMatch(/\bmatches\b|semanticSimilarity|keywordScore|entity_type_key|adapter/i);
    expect(description.length).toBeLessThanOrEqual(2000);
  });

  it("name each envelope's fields, so the two shapes cannot be confused", async () => {
    expect(await descriptionOf("search")).toContain("Returns query, type, in, strategy, minSimilarity, filter and hits");
    expect(await descriptionOf("search_by_index")).toContain("for get_document use the index's documentProperty");
    expect(await descriptionOf("get_document")).toContain("search_by_index passage's matched");
  });

  it("point each search tool at the other, and the catalog at search_by_index", async () => {
    expect(await descriptionOf("search")).toContain("use search_by_index");
    expect(await descriptionOf("search")).not.toMatch(/\bindex argument|\brelations\b/);
    expect(await descriptionOf("search_by_index")).toContain("list_search_indices");
    expect(await descriptionOf("list_search_indices")).toContain("search_by_index's index argument");
  });
});
