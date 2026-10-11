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
import { z } from "zod";

import type { RuntimeStore } from "../../src/core/ports.js";
import { RelationGroup, SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { createModelingMcpServer } from "../../src/mcp/modeling.js";
import { createRuntimeMcpServer } from "../../src/mcp/runtime.js";
import { ALL_TOOL_NAMES, buildTools } from "../../src/runtime/assistants/agents/runtime.js";
import { filterRules } from "../../src/runtime/readHelpers.js";

interface ListedTool {
  name: string;
  description?: string | undefined;
  inputSchema: { properties?: Record<string, unknown> };
}

async function listTools(server: McpServer): Promise<ListedTool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tool-description-tests", version: "0.0.1" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const descriptions = (tools: ListedTool[]) =>
  new Map(tools.map((tool) => [tool.name, tool.description ?? ""]));

const modelingTools = await listTools(createModelingMcpServer("onto"));
const runtime = descriptions(await listTools(createRuntimeMcpServer("onto", "all")));
const modeling = descriptions(modelingTools);
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

  it("the search-index tools state the status fields", () => {
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

describe("the search-index definition input schema", () => {
  interface JsonObject {
    properties: Record<string, JsonObject & { description?: string; items?: JsonObject }>;
    required?: string[];
  }

  const definitionOf = (tool: string) =>
    modelingTools.find((t) => t.name === tool)!.inputSchema.properties!.definition as JsonObject;

  /** The field keys of a wire-format object, defaults unwrapped. */
  const wireKeys = (schema: z.ZodType): string[] => {
    const inner = schema instanceof z.ZodDefault ? (schema.def.innerType as z.ZodType) : schema;
    return Object.keys((inner as z.ZodObject).shape).sort();
  };

  it("has exactly the wire format's fields, at every level", () => {
    const definition = definitionOf("create_search_index");
    const shape = SearchIndexDefinition.shape;
    expect(Object.keys(definition.properties).sort()).toEqual(wireKeys(SearchIndexDefinition));
    expect(Object.keys(definition.properties.relations!.items!.properties).sort()).toEqual(wireKeys(RelationGroup));
    expect(Object.keys(definition.properties.semantic!.properties).sort()).toEqual(wireKeys(shape.semantic));
    expect(Object.keys(definition.properties.keyword!.properties).sort()).toEqual(wireKeys(shape.keyword));
  });

  it("describes every field", () => {
    const definition = definitionOf("create_search_index");
    const objects = [
      definition.properties,
      definition.properties.relations!.items!.properties,
      definition.properties.semantic!.properties,
      definition.properties.keyword!.properties,
    ];
    for (const properties of objects) {
      for (const [key, field] of Object.entries(properties)) {
        expect(field.description, key).toBeTruthy();
      }
    }
  });

  it("requires the key on create only", () => {
    expect(definitionOf("create_search_index").required).toContain("key");
    for (const tool of ["update_search_index", "preview_search_index"]) {
      expect(definitionOf(tool).required).not.toContain("key");
      expect(definitionOf(tool).required).toContain("entityType");
    }
  });
});
