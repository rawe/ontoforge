/**
 * The runtime MCP server at the caller's role level (`mcp/runtime.ts`):
 * a Reader (level `none`) lists only the read tools, below a ruleset's
 * level too, and a write, stage or commit call is refused before any
 * store is opened, whatever list the client holds.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WriteAccess } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { TOOLS, type Binding } from "../../src/runtime/writeAccess.js";
import { createMockRuntimeStore, makeFullSchema, type MockRuntimeStore } from "../runtime/helpers.js";

const holder: { store: MockRuntimeStore; opened: number } = { store: createMockRuntimeStore(), opened: 0 };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => {
    holder.opened += 1;
    return holder.store;
  },
  getSearchIndexStore: async () => holder.store.indices,
}));

const { createRuntimeMcpServer } = await import("../../src/mcp/runtime.js");

const ID = "11111111-1111-4111-8111-111111111111";

async function connect(role: WriteAccess, binding?: Binding, listedRole: WriteAccess = role): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createRuntimeMcpServer("test_ont", "all", binding, role, listedRole).connect(serverTransport);
  const client = new Client({ name: "role-level-tests", version: "0.0.1" });
  await client.connect(clientTransport);
  return client;
}

async function listed(role: WriteAccess, binding?: Binding): Promise<string[]> {
  const client = await connect(role, binding);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  await client.close();
  return names.sort();
}

const READS = Object.keys(TOOLS).filter((name) => TOOLS[name]!.operation === "read");

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  holder.opened = 0;
  invalidateLoadedSchemaCache();
  holder.store.indices.readFullSchema.mockResolvedValue({ ...makeFullSchema(), indices: [] });
  holder.store.getFullSchemaWithLensInclusions.mockImplementation(async (lensKey: string) =>
    lensKey === "all" ? makeFullSchema({ lensKey }) : null,
  );
  holder.store.rulesetStore.get.mockImplementation(async (key: string) => ({
    key,
    anchor: null,
    anchorFound: false,
    writeAccess: "full",
  }));
});

describe("the role level", () => {
  it("a Reader lists only the read tools, on the plain lens and below a ruleset", async () => {
    expect(await listed("none")).toEqual(READS.filter((name) => name !== "get_ruleset").sort());
    expect(await listed("none", { rulesetKey: "r", writeAccess: "full" })).toEqual([...READS].sort());
  });

  it("a Writer lists what the ruleset allows, never more", async () => {
    expect(await listed("full")).toEqual(Object.keys(TOOLS).filter((name) => name !== "get_ruleset").sort());
    expect(await listed("full", { rulesetKey: "r", writeAccess: "propose" })).toEqual(
      Object.keys(TOOLS).filter((name) => name !== "commit_changeset").sort(),
    );
  });

  it("a Reader's write, stage and commit calls are refused before any store opens; reads pass", async () => {
    // A tool call's server lists every tool (`mount.ts`); the call's check judges the role.
    const client = await connect("none", undefined, "full");
    try {
      for (const [name, args] of [
        ["create_entity", { entity_type_key: "person", properties: { name: "Ann" } }],
        ["update_entity", { entity_type_key: "person", entity_id: ID, properties: { name: "Ann" }, changeset_id: ID }],
        ["start_changeset", {}],
        ["commit_changeset", { changeset_id: ID }],
      ] as const) {
        holder.opened = 0;
        const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
        expect(result.isError, name).toBe(true);
        expect(result.content[0]!.text, name).toBe(`Error executing tool ${name}: Reader on lens 'all' cannot write`);
        expect(holder.opened, name).toBe(0);
      }
      const read = (await client.callTool({ name: "get_schema", arguments: {} })) as { isError?: boolean };
      expect(read.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });
});
