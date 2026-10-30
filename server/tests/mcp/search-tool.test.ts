/**
 * The runtime MCP search tools: `search` runs the entity search and
 * `search_documents` the passage search — the scope, the filters as text,
 * the clamped limit, the passage options and, with an embedding provider,
 * both method blocks under the tools' fixed similarity floor — and answer
 * with the search's response. `list_search_indices` returns the lens's
 * catalog. The services are stubbed; an in-memory client calls the tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";

const stubs = vi.hoisted(() => ({
  searchEntities: vi.fn(),
  searchPassages: vi.fn(),
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

const RESPONSE = { ran: ["semantic", "keyword"], items: [], limitations: [] };

beforeEach(async () => {
  stubs.searchEntities.mockReset().mockResolvedValue(RESPONSE);
  stubs.searchPassages.mockReset().mockResolvedValue(RESPONSE);
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

const FLOOR = { semantic: { minSimilarity: 0.75 }, keyword: {} };

describe("search", () => {
  it("runs the entity search with the mapped arguments and the fixed floor, and answers its response", async () => {
    const result = await call("search", {
      query: "CTO ACME",
      types: ["person"],
      filters: { since__gte: 2020, active: true },
      limit: 500,
    });
    expect(result.isError).toBeFalsy();
    expect(stubs.searchEntities).toHaveBeenCalledWith(
      "all",
      { query: "CTO ACME", types: ["person"], ...FLOOR, filter: { since__gte: "2020", active: "true" }, limit: 100 },
      expect.anything(),
    );
    expect(stubs.searchPassages).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0]!.text)).toEqual(RESPONSE);
  });

  it("takes indices instead of types; without either it searches the whole lens", async () => {
    await call("search", { query: "x", indices: ["employment"] });
    await call("search", { query: "x" });
    expect(stubs.searchEntities.mock.calls[0]![1]).toEqual({ query: "x", indices: ["employment"], ...FLOOR, filter: {}, limit: 10 });
    expect(stubs.searchEntities.mock.calls[1]![1]).toEqual({ query: "x", ...FLOOR, filter: {}, limit: 10 });
  });

  it("sends no method block when the server ranks by keyword only", async () => {
    setEmbeddingProvider(null);
    await call("search", { query: "x" });
    expect(stubs.searchEntities.mock.calls[0]![1]).toEqual({ query: "x", filter: {}, limit: 10 });
  });

  it("reports a refused request as a tool error", async () => {
    stubs.searchEntities.mockRejectedValueOnce(new Error("Search index 'nope' is not available in this lens"));
    const result = await call("search", { query: "x", indices: ["nope"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error executing tool search");
  });
});

describe("search_documents", () => {
  it("runs the passage search with its scope, per_entity and text, and answers its response", async () => {
    const result = await call("search_documents", {
      query: "kubernetes",
      documents: ["person.bio"],
      filters: { age__gte: 30 },
      limit: 0,
      per_entity: 2,
      text: false,
    });
    expect(stubs.searchPassages).toHaveBeenCalledWith(
      "all",
      {
        query: "kubernetes",
        documents: ["person.bio"],
        ...FLOOR,
        filter: { age__gte: "30" },
        limit: 1,
        perEntity: 2,
        text: false,
      },
      expect.anything(),
    );
    expect(stubs.searchEntities).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0]!.text)).toEqual(RESPONSE);
  });

  it("leaves per_entity and text to the search when not given", async () => {
    await call("search_documents", { query: "x", types: ["person"] });
    expect(stubs.searchPassages.mock.calls[0]![1]).toEqual({ query: "x", types: ["person"], ...FLOOR, filter: {}, limit: 10 });
  });

  it("each search tool has the arguments of its search; search_by_index is gone", async () => {
    const { tools } = await client.listTools();
    const argumentsOf = (name: string) =>
      Object.keys(tools.find((tool) => tool.name === name)!.inputSchema.properties ?? {}).sort();
    expect(argumentsOf("search")).toEqual(["filters", "indices", "limit", "query", "types"]);
    expect(argumentsOf("search_documents")).toEqual([
      "documents", "filters", "indices", "limit", "per_entity", "query", "text", "types",
    ]);
    expect(tools.some((tool) => tool.name === "search_by_index")).toBe(false);
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

  it("describe each search's response, its scores and the fixed floor, within 2000 characters", async () => {
    const search = await descriptionOf("search");
    expect(search).toContain("Returns ran (methods that ran), items and limitations");
    expect(search).toContain("match, the entry that found it");
    const documents = await descriptionOf("search_documents");
    expect(documents).toContain("passage: property (the document), ordinal, charOffset and charLength");
    for (const description of [search, documents]) {
      expect(description).toContain("fixed similarity floor (0.75)");
      expect(description).toContain("a missing score says nothing");
      expect(description).toContain("scores (each method that found it: semantic, similarity 0.75 to 1");
      expect(description).not.toMatch(/relativeScore|strategy|evidence|adapter/i);
      expect(description.length).toBeLessThanOrEqual(2000);
    }
  });

  it("point from a passage to get_document, and the catalog at the indices argument", async () => {
    expect(await descriptionOf("search_documents")).toContain("with get_document");
    expect(await descriptionOf("get_document")).toContain(
      "Pass a search_documents passage's property, charOffset and charLength",
    );
    for (const name of ["search", "search_documents"]) expect(await descriptionOf(name)).toContain("list_search_indices");
    expect(await descriptionOf("list_search_indices")).toContain("indices argument of search and search_documents");
  });
});
