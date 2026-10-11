/**
 * Every MCP and agent tool description is self-contained and fits
 * (`docs/decisions.md#interfaces`): at most 2000 characters, no rule
 * deferred to another tool, and the tools taking `filters` state the filter
 * rules themselves — the one text `filterRules` builds.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import type { RuntimeStore } from "../../src/core/ports.js";
import { createModelingMcpServer } from "../../src/mcp/modeling.js";
import { createRuntimeMcpServer } from "../../src/mcp/runtime.js";
import { ALL_TOOL_NAMES, buildTools } from "../../src/runtime/assistants/agents/runtime.js";
import { filterRules } from "../../src/runtime/readHelpers.js";

async function descriptions(server: McpServer): Promise<Map<string, string>> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tool-description-tests", version: "0.0.1" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return new Map(tools.map((tool) => [tool.name, tool.description ?? ""]));
}

const runtime = await descriptions(createRuntimeMcpServer("onto", "all"));
const modeling = await descriptions(createModelingMcpServer("onto"));
const agent = new Map(
  buildTools("all", {} as RuntimeStore, [...ALL_TOOL_NAMES]).map((tool) => [
    tool.name,
    tool.description,
  ]),
);
const all = [
  ...[...runtime].map(([name, text]) => [`runtime ${name}`, text] as const),
  ...[...modeling].map(([name, text]) => [`modeling ${name}`, text] as const),
  ...[...agent].map(([name, text]) => [`agent ${name}`, text] as const),
];

describe("tool descriptions", () => {
  it.each(all)("%s is at most 2000 characters", (_name, text) => {
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it.each(all)("%s defers no rule to another tool", (_name, text) => {
    expect(text).not.toMatch(/same (shape|syntax|keys|operators) as|as \w+ describes|\b\w+_\w+ (keys|operators)\b|search envelope/i);
  });

  it("the entity filter tools state the full filter rules", () => {
    expect(runtime.get("list_entities")).toContain(filterRules({ contains: true, relations: true }));
    for (const name of ["search", "search_documents", "search_by_index"]) {
      expect(runtime.get(name)).toContain(filterRules({ contains: false, relations: true }));
    }
    expect(runtime.get("list_relations")).toContain(filterRules({ contains: true, relations: false }));
  });

  it("the search-index tools state the definition shape and the status fields", () => {
    for (const name of ["create_search_index", "update_search_index", "preview_search_index"]) {
      expect(modeling.get(name)).toContain("definition: {key, name, description, entityType, fields");
    }
    for (const name of ["list_search_indices", "get_search_index", "get_search_index_status"]) {
      expect(modeling.get(name)).toContain("lastErrors (entityId, partKind, message, at)");
    }
  });
});

describe("filterRules", () => {
  it("names every operator the filter parser accepts", () => {
    const text = filterRules({ contains: true, relations: true });
    for (const op of ["ne", "gt", "gte", "lt", "lte", "contains", "exists", "missing"]) {
      expect(text).toContain(`__${op}`);
    }
  });

  it("leaves out what a surface rejects", () => {
    expect(filterRules({ contains: false, relations: true })).not.toContain("__contains");
    const own = filterRules({ contains: true, relations: false });
    expect(own).not.toMatch(/<relation>|:out/);
  });
});
