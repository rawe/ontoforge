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

import type { RuntimeStore, WriteAccess } from "../../src/core/ports.js";
import { RelationGroup, SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { createModelingMcpServer } from "../../src/mcp/modeling.js";
import { createRuntimeMcpServer } from "../../src/mcp/runtime.js";
import { ALL_TOOL_NAMES, buildTools } from "../../src/runtime/assistants/agents/runtime.js";
import { filterRules } from "../../src/runtime/readHelpers.js";
import { VALID_AGENT_TOOLS } from "../../src/runtime/toolNames.js";
import { TOOLS, allows } from "../../src/runtime/writeAccess.js";

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
const rulesetTools = (rulesetKey: string, writeAccess: WriteAccess) =>
  listTools(createRuntimeMcpServer("onto", "all", { rulesetKey, writeAccess }));
const full = descriptions(await rulesetTools("agent-a", "full"));
const proposeTools = await rulesetTools("agent-s", "propose");
const propose = descriptions(proposeTools);
const none = descriptions(await rulesetTools("agent-n", "none"));
const modeling = descriptions(modelingTools);
const agent = new Map(
  buildTools("all", {} as RuntimeStore, [...ALL_TOOL_NAMES]).map((tool) => [
    tool.name,
    tool.description,
  ]),
);
const all = [
  ...[...runtime].map(([name, text]) => [`runtime ${name}`, text] as const),
  ...[...full]
    .filter(([name, text]) => runtime.get(name) !== text)
    .map(([name, text]) => [`ruleset ${name}`, text] as const),
  ...[...propose]
    .filter(([name, text]) => full.get(name) !== text)
    .map(([name, text]) => [`propose ${name}`, text] as const),
  ...[...none]
    .filter(([name, text]) => full.get(name) !== text)
    .map(([name, text]) => [`none ${name}`, text] as const),
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

  it("get_ruleset carries the agreed text, on the ruleset mount only, equal on every level", () => {
    expect(full.get("get_ruleset")).toBe(
      "Read the ruleset of this connection: what it may write. Call this first; read it again " +
        "after a refusal, because a person sets the ruleset and may change it at any time. " +
        "Returns key, writeAccess and anchor. writeAccess 'full': every write this lens allows, " +
        "directly or through a changeset. 'propose': writes only into a changeset, so every " +
        "write needs 'changeset_id'; it can submit the changeset for review but not commit it, " +
        "a person commits it. 'none': read only, no writes; it can read changesets but not " +
        "start, stage into or submit one. The tools this connection lists follow writeAccess. " +
        "anchor null: writes are not limited to a subtree. Otherwise anchor is {type, id, name, " +
        "state, visible, path}: writes to the entity types of the anchor's hierarchy (the types " +
        "joined to it by parent relations) must stay in its subtree, the anchor entity and its " +
        "descendants; other types are written as usual. state 'found': the anchor entity " +
        "exists. state 'deleted': the anchor entity no longer exists, so every write is " +
        "refused, staged or not, until a person sets a new anchor. visible false: this lens " +
        "does not show the anchor entity, so every write is refused. When the anchor entity is " +
        "deleted or not visible, type, id and name are null and path is empty. path lists the " +
        "anchor entity's visible ancestors, root first, ending with the entity. Read-only.",
    );
    expect(propose.get("get_ruleset")).toBe(full.get("get_ruleset"));
    expect(none.get("get_ruleset")).toBe(full.get("get_ruleset"));
    expect(runtime.has("get_ruleset")).toBe(false);
    expect(agent.has("get_ruleset")).toBe(false);
  });

  it("get_schema says to call it first, and on a ruleset mount after get_ruleset", () => {
    expect(runtime.get("get_schema")).toContain("Call this first.");
    for (const map of [full, propose, none]) {
      expect(map.get("get_schema")).toContain("Call this after get_ruleset.");
      expect(map.get("get_schema")).not.toContain("Call this first");
    }
  });

  it("create_entity states the create with a parent relation", () => {
    const text = runtime.get("create_entity")!;
    for (const part of ["'parent_relation'", "'type'", "'parent_id'", "'properties'", "child end", "parent end"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("stored together or not at all");
  });

  it("create_entity states the create in the anchor's subtree, on the ruleset mount only", () => {
    const text = full.get("create_entity")!;
    // The immediate create comes first; the staged mode follows it.
    const immediate = (description: string) => description.slice(0, description.indexOf(" 'changeset_id'"));
    expect(immediate(text).startsWith(immediate(runtime.get("create_entity")!))).toBe(true);
    for (const part of ["If this connection's ruleset sets an anchor", "'parent_relation'", "the anchor's subtree", "one of its descendants", "other types"]) {
      expect(text).toContain(part);
    }
    expect(runtime.get("create_entity")).not.toContain("anchor");
  });

  const STAGEABLE = [
    "create_entity",
    "update_entity",
    "delete_entity",
    "create_relation",
    "update_relation",
    "delete_relation",
    "edit_document",
    "write_document",
  ];
  const CHANGESET_TOOLS = [
    "start_changeset",
    "list_changesets",
    "get_changeset",
    "get_staged_document",
    "unstage",
    "rebase",
    "submit_changeset",
    "unsubmit_changeset",
    "commit_changeset",
    "discard_changeset",
  ];
  const parameters = (name: string) => runtimeTools.find((tool) => tool.name === name)!.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  it("the eight stageable tools take an optional changeset_id and state the staged mode", () => {
    for (const name of STAGEABLE) {
      expect(parameters(name).properties, name).toHaveProperty("changeset_id");
      expect(parameters(name).required ?? [], name).not.toContain("changeset_id");
      for (const map of [runtime, full]) {
        const text = map.get(name)!;
        for (const part of ["'changeset_id'", "reads never see staged data"]) {
          expect(text, name).toContain(part);
        }
        expect(text, name).not.toMatch(/\bseq\b/);
      }
      expect(full.get(name), name).toContain("staging is refused while the anchor entity no longer exists");
    }
    for (const name of STAGEABLE.slice(0, 6)) expect(runtime.get(name), name).toContain("the answer is {id}");
    for (const name of ["edit_document", "write_document"]) {
      const text = runtime.get(name)!;
      expect(text).toContain("the answer is the edit's answer with id");
      expect(text).toContain("The edit applies to the staged text of the property, or else the stored text");
    }
    expect(runtime.get("create_entity")).toContain("A staged create's id is final");
    expect(runtime.get("update_entity")).toContain("The changeset holds one staged value per property");
    expect(runtime.get("delete_entity")).toContain("the answer lists their ids as cascaded");
    for (const name of ["create_entity", "create_relation"]) {
      expect(runtime.get(name)).toContain("relation ends, parents and the hierarchy rules are checked at commit");
    }
    // A create with a parent relation stages two objects; only create_entity says so.
    for (const map of [runtime, full, propose]) {
      expect(map.get("create_entity")).toContain(
        "With 'parent_relation' and 'changeset_id', two objects are staged, the entity and its " +
          "parent relation, and the answer is {id, relation: {id}}",
      );
      for (const name of STAGEABLE.slice(1)) expect(map.get(name), name).not.toContain("relation: {id}");
    }
    for (const name of ["update_entity", "update_relation", "edit_document", "write_document"]) {
      expect(runtime.get(name)).toContain("the commit is rejected, until rebase accepts the change");
    }
    for (const name of ["delete_entity", "delete_relation"]) {
      const text = runtime.get(name)!;
      expect(text).toContain("Staging checks the type and that the target exists");
      expect(text.slice(text.indexOf("'changeset_id'"))).not.toMatch(/propert|current values/);
    }
  });

  it("the changeset tools are listed on both mounts, with their required parameters", () => {
    for (const name of CHANGESET_TOOLS) {
      expect(runtime.has(name), name).toBe(true);
      expect(full.has(name), name).toBe(true);
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
    expect(parameters("unstage").required).toEqual(["changeset_id", "object_id"]);
    expect(Object.keys(parameters("unstage").properties ?? {})).toEqual(["changeset_id", "object_id", "property"]);
    expect(parameters("rebase").required).toEqual(["changeset_id", "object_id"]);
    expect(Object.keys(parameters("rebase").properties ?? {})).toEqual(["changeset_id", "object_id", "properties"]);
    expect(parameters("start_changeset").required ?? []).toEqual([]);
  });

  it("get_changeset shows no staged arguments, stubs documents and points to get_staged_document", () => {
    for (const map of [runtime, full, propose, none]) {
      const text = map.get("get_changeset")!;
      expect(text).not.toMatch(/argument|sha256|hash/);
      expect(text).not.toMatch(/\bseq\b/);
      expect(text).toContain("an entity adds name, a relation from and to {id, name}");
      expect(text).toContain("values lists its staged values [{property, before, current, after, markers}]");
      expect(text).not.toContain("{id, name, properties}");
      expect(text).toContain("Document values in before, current and after show as {document: true, length}");
      expect(text).toContain("get_staged_document reads the staged text");
      const staged = map.get("get_staged_document")!;
      for (const part of ["its staged value", "'offset' and 'limit' are character-based", "totalLength", "Not found when the changeset stages no value", "when it deletes the entity"]) {
        expect(staged).toContain(part);
      }
    }
  });

  it("commit_changeset says how to tell the outcome after a lost response", () => {
    for (const map of [runtime, full]) {
      const text = map.get("commit_changeset")!;
      expect(text).toContain("If the response is lost");
      expect(text).toContain("reading an id a staged create minted");
      expect(text).toContain("a submitted changeset that is no longer listed was committed");
    }
  });

  it("the drift guidance is stated in get_changeset and commit_changeset: compare, then rebase or unstage", () => {
    for (const map of [runtime, full, propose]) {
      expect(map.get("get_changeset")).toContain("compare them, then rebase to keep your value, or unstage it");
    }
    expect(none.get("get_changeset")).toContain("drift (current differs from before: compare them)");
    for (const map of [runtime, full]) {
      const text = map.get("commit_changeset")!;
      expect(text).toContain("On drift, compare before and current in get_changeset, then rebase to keep your value or unstage it");
    }
  });

  it("the ruleset mount states the ruleset binding of a changeset", () => {
    expect(full.get("start_changeset")).toContain("carries this connection's ruleset");
    expect(full.get("list_changesets")).toContain("started through this ruleset");
    expect(runtime.get("start_changeset")).not.toContain("carries this connection's ruleset");
    expect(runtime.get("start_changeset")).toContain("without a ruleset reach it");
  });

  /** The names a level lists, derived from the operation table. */
  const allowed = (level: WriteAccess) =>
    Object.keys(TOOLS)
      .filter((name) => allows(level, TOOLS[name]!.operation) || (TOOLS[name]!.stageable === true && allows(level, "stage")))
      .sort();

  it("the tool list follows the operation table: 34 on the plain lens; 35, 34 and 20 at full, propose and none", () => {
    expect(runtime.size).toBe(34);
    expect(full.size).toBe(35);
    expect(propose.size).toBe(34);
    expect(none.size).toBe(20);
    expect([...runtime.keys()].sort()).toEqual(allowed("full").filter((name) => name !== "get_ruleset"));
    for (const [level, map] of [["full", full], ["propose", propose], ["none", none]] as const) {
      expect([...map.keys()].sort(), level).toEqual(allowed(level));
      // No description names a tool this level does not list.
      const absent = Object.keys(TOOLS).filter((name) => !map.has(name));
      for (const [name, text] of map) {
        for (const other of absent) expect(text, `${level} ${name}`).not.toMatch(new RegExp(`\\b${other}\\b`));
      }
    }
  });

  it("propose requires changeset_id and lists no commit", () => {
    const params = (name: string) => proposeTools.find((tool) => tool.name === name)!.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    for (const name of STAGEABLE) {
      expect(params(name).required, name).toContain("changeset_id");
      const text = propose.get(name)!;
      expect(text, name).toContain("This connection has write access 'propose': it only stages, so 'changeset_id' is required");
      expect(text, name).toContain("staging is refused while the anchor entity no longer exists");
    }
    expect(propose.has("commit_changeset")).toBe(false);
    expect([...propose.keys()].sort()).toEqual([...full.keys()].filter((name) => name !== "commit_changeset").sort());
    expect(propose.get("submit_changeset")).toContain("This connection has write access 'propose' and cannot commit");
    expect(propose.get("unsubmit_changeset")).not.toContain("committed again");
    expect(propose.get("update_entity")).toContain("prefer edit_document / write_document for partial edits");
  });

  it("none lists the reads and the changeset reads only", () => {
    for (const name of none.keys()) expect(TOOLS[name]!.operation, name).toBe("read");
    for (const name of ["list_changesets", "get_changeset", "get_staged_document", "get_ruleset"]) {
      expect(none.has(name), name).toBe(true);
    }
    for (const name of [...STAGEABLE, ...CHANGESET_TOOLS.filter((name) => !none.has(name))]) {
      expect(none.has(name), name).toBe(false);
    }
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
