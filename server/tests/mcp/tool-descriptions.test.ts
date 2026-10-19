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
import { VALID_AGENT_TOOLS } from "../../src/runtime/toolNames.js";

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
const runtimeTools = await listTools(createRuntimeMcpServer("onto", "all"));
const runtime = descriptions(runtimeTools);
const anchored = descriptions(await listTools(createRuntimeMcpServer("onto", "all", "agent-a")));
const stagedOnlyTools = await listTools(createRuntimeMcpServer("onto", "all", "agent-s", true));
const stagedOnly = descriptions(stagedOnlyTools);
const modeling = descriptions(modelingTools);
const agent = new Map(
  buildTools("all", {} as RuntimeStore, [...ALL_TOOL_NAMES]).map((tool) => [
    tool.name,
    tool.description,
  ]),
);
const all = [
  ...[...runtime].map(([name, text]) => [`runtime ${name}`, text] as const),
  ...[...anchored]
    .filter(([name, text]) => runtime.get(name) !== text)
    .map(([name, text]) => [`anchored ${name}`, text] as const),
  ...[...stagedOnly]
    .filter(([name, text]) => anchored.get(name) !== text)
    .map(([name, text]) => [`staged-only ${name}`, text] as const),
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

  it("the write tools state the parent rules", () => {
    expect(runtime.get("delete_entity")).toContain("delete its children first");
    expect(runtime.get("create_relation")).toContain("already has a parent");
    expect(runtime.get("create_relation")).toContain("one of its descendants");
  });

  it("get_path states the path's shape and the lens cut", () => {
    const text = runtime.get("get_path")!;
    for (const part of ["[{type, id, name}]", "root first", "ending with the entity", "cannot see"]) {
      expect(text).toContain(part);
    }
    expect(agent.has("get_path")).toBe(false);
  });

  it("get_anchor carries the agreed text, on the anchored mount only", () => {
    expect(anchored.get("get_anchor")).toBe(
      "Read where this connection is anchored. Returns key, state, stagedOnly, visible, entity " +
        "and path. state 'anchored': writes to the anchored entity's hierarchy are held to that " +
        "entity and its descendants; other types are written as usual. 'unanchored': no " +
        "restriction. 'dangling': the entity was deleted, and every write is refused until a " +
        "person re-anchors. visible false: this lens does not show the entity, and every write " +
        "is refused. stagedOnly true: this connection only stages, whatever the state: every " +
        "write needs 'changeset_id', and it cannot commit; submit the changeset so a person can " +
        "review and commit it. path lists the entity's visible ancestors, root first, ending with the " +
        "entity. Read-only: a person sets the anchor and may change it at any time, so read " +
        "it again after a refusal.",
    );
    expect(runtime.has("get_anchor")).toBe(false);
    expect(agent.has("get_anchor")).toBe(false);
  });

  it("create_entity states the create with a parent relation", () => {
    const text = runtime.get("create_entity")!;
    for (const part of ["'parent_relation'", "'type'", "'parent_id'", "'properties'", "child end", "parent end"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("stored together or not at all");
  });

  it("create_entity states the anchored create, on the anchored mount only", () => {
    const text = anchored.get("create_entity")!;
    // The immediate create comes first; the staged mode follows it.
    const immediate = (description: string) => description.slice(0, description.indexOf(" 'changeset_id'"));
    expect(immediate(text).startsWith(immediate(runtime.get("create_entity")!))).toBe(true);
    for (const part of ["anchored connection", "'parent_relation'", "one of its descendants", "other types"]) {
      expect(text).toContain(part);
    }
    expect(runtime.get("create_entity")).not.toContain("anchored");
  });

  const STAGEABLE = ["create_entity", "update_entity", "delete_entity", "create_relation", "update_relation", "delete_relation"];
  const CHANGESET_TOOLS = [
    "start_changeset",
    "list_changesets",
    "get_changeset",
    "get_staged_document",
    "unstage",
    "submit_changeset",
    "unsubmit_changeset",
    "commit_changeset",
    "discard_changeset",
  ];
  const parameters = (name: string) => runtimeTools.find((tool) => tool.name === name)!.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  it("the six stageable tools take an optional changeset_id and state the staged mode", () => {
    for (const name of STAGEABLE) {
      expect(parameters(name).properties, name).toHaveProperty("changeset_id");
      expect(parameters(name).required ?? [], name).not.toContain("changeset_id");
      for (const map of [runtime, anchored]) {
        const text = map.get(name)!;
        for (const part of ["'changeset_id'", "{seq, id}", "reads never see staged data", "id is final"]) {
          expect(text, name).toContain(part);
        }
      }
      expect(anchored.get(name), name).toContain("a dangling anchor refuses staging");
    }
    for (const name of ["create_entity", "create_relation"]) {
      expect(runtime.get(name)).toContain("relation ends, parents and the hierarchy rules are checked at commit");
    }
    for (const name of ["update_entity", "update_relation"]) {
      expect(runtime.get(name)).toContain("the commit is rejected");
    }
    for (const name of ["delete_entity", "delete_relation"]) {
      const text = runtime.get(name)!;
      expect(text).toContain("Staging checks the type and that the target exists");
      expect(text.slice(text.indexOf("'changeset_id'"))).not.toMatch(/propert|current values/);
    }
  });

  it("the document edit tools take no changeset_id and say they cannot be staged and refuse one", () => {
    for (const name of ["edit_document", "write_document"]) {
      expect(parameters(name).properties, name).not.toHaveProperty("changeset_id");
      expect(runtime.get(name), name).toContain("always writes immediately and cannot be staged");
      expect(runtime.get(name), name).toContain("a 'changeset_id' is refused and nothing is written");
      expect(runtime.get(name), name).toContain("whole new value to update_entity with 'changeset_id'");
    }
  });

  it("the changeset tools are listed on both mounts, with their required parameters", () => {
    for (const name of CHANGESET_TOOLS) {
      expect(runtime.has(name), name).toBe(true);
      expect(anchored.has(name), name).toBe(true);
    }
    expect(parameters("unsubmit_changeset").required).toEqual(["changeset_id", "note"]);
    expect(parameters("submit_changeset").required).toEqual(["changeset_id"]);
    expect(parameters("commit_changeset").required).toEqual(["changeset_id"]);
    expect(parameters("get_changeset").required).toEqual(["changeset_id"]);
    expect(parameters("get_staged_document").required).toEqual([
      "changeset_id",
      "entity_type_key",
      "entity_id",
      "property_key",
    ]);
    expect(Object.keys(parameters("get_staged_document").properties ?? {})).toEqual([
      "changeset_id",
      "entity_type_key",
      "entity_id",
      "property_key",
      "offset",
      "limit",
    ]);
    expect(parameters("unstage").required).toEqual(["changeset_id", "seq"]);
    expect(parameters("start_changeset").required ?? []).toEqual([]);
  });

  it("get_changeset shows no staged arguments, stubs documents and points to get_staged_document", () => {
    for (const map of [runtime, anchored, stagedOnly]) {
      const text = map.get("get_changeset")!;
      expect(text).not.toMatch(/argument|sha256|hash/);
      expect(text).toContain("{id, name, properties}");
      expect(text).toContain("Document values in before, current and after show as {document: true, length}");
      expect(text).toContain("get_staged_document reads the staged text");
      const staged = map.get("get_staged_document")!;
      for (const part of ["last write staged", "'offset' and 'limit' are character-based", "totalLength", "Not found when no staged write", "a later staged write deletes the entity"]) {
        expect(staged).toContain(part);
      }
    }
  });

  it("commit_changeset says how to tell the outcome after a lost response", () => {
    for (const map of [runtime, anchored]) {
      const text = map.get("commit_changeset")!;
      expect(text).toContain("If the response is lost");
      expect(text).toContain("reading an id a staged create minted");
      expect(text).toContain("a submitted changeset that is no longer listed was committed");
    }
  });

  it("the anchored mount states the anchor binding of a changeset", () => {
    expect(anchored.get("start_changeset")).toContain("carries this connection's anchor");
    expect(anchored.get("list_changesets")).toContain("started through this anchor");
    expect(runtime.get("start_changeset")).not.toContain("carries this connection's anchor");
  });

  it("a staged-only mount requires changeset_id and offers no commit or document edit (V29, R13)", () => {
    const params = (name: string) => stagedOnlyTools.find((tool) => tool.name === name)!.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    for (const name of STAGEABLE) {
      expect(params(name).required, name).toContain("changeset_id");
      const text = stagedOnly.get(name)!;
      expect(text, name).toContain("This connection only stages: 'changeset_id' is required");
      expect(text, name).toContain("a dangling anchor refuses staging");
    }
    for (const name of ["commit_changeset", "edit_document", "write_document"]) {
      expect(stagedOnly.has(name), name).toBe(false);
    }
    const names = [...stagedOnly.keys()].sort();
    expect(names).toEqual(
      [...anchored.keys()].filter((name) => !["commit_changeset", "edit_document", "write_document"].includes(name)).sort(),
    );
    // No description names a tool this mount does not offer.
    for (const [name, text] of stagedOnly) {
      expect(text, name).not.toMatch(/commit_changeset|edit_document|write_document/);
    }
    expect(stagedOnly.get("submit_changeset")).toContain("This connection cannot commit");
    expect(stagedOnly.get("unsubmit_changeset")).not.toContain("committed again");
    expect(stagedOnly.get("get_anchor")).toBe(anchored.get("get_anchor"));
  });

  it("no changeset tool is grantable to an agent", () => {
    for (const name of CHANGESET_TOOLS) {
      expect(VALID_AGENT_TOOLS.has(name), name).toBe(false);
      expect(agent.has(name), name).toBe(false);
    }
    expect(VALID_AGENT_TOOLS.size).toBe(12);
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
