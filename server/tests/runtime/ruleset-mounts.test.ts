/**
 * The ruleset mounts over a mocked store, with the seven write functions
 * spied: the REST mirror and the ruleset MCP server pass the ruleset key
 * to every write, the plain lens passes null; every request checks lens,
 * then ruleset, reads included; `get_ruleset` and the mirror's root give
 * the ruleset through the lens; only the ruleset MCP server has
 * `get_ruleset`. Over HTTP, a tools/list reads the ruleset once and lists
 * its level's tools; a tools/call reads it once, and a tool the level
 * leaves out answers the write access refusal.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RulesetRecord } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeEntity, makeFullSchema, type MockRuntimeStore } from "./helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
}));

const writes = vi.hoisted(() => ({
  createEntity: vi.fn(),
  updateEntity: vi.fn(),
  deleteEntity: vi.fn(),
  editDocument: vi.fn(),
  createRelation: vi.fn(),
  updateRelation: vi.fn(),
  deleteRelation: vi.fn(),
}));
vi.mock("../../src/runtime/service.js", async (original) => ({
  ...(await original<object>()),
  ...writes,
}));

const { createRuntimeMcpServer } = await import("../../src/mcp/runtime.js");

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let rulesets: Record<string, RulesetRecord>;

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
  holder.store.indices.readFullSchema.mockResolvedValue(makeFullSchema());
  // Lenses `all` (unscoped) and `no_person` (company only).
  holder.store.getFullSchemaWithLensInclusions.mockImplementation(async (lensKey: string) => {
    if (lensKey === "all") return makeFullSchema({ lensKey });
    if (lensKey === "no_person") {
      return makeFullSchema({ lensKey, entityInclusions: [{ key: "company", properties: null }] });
    }
    return null;
  });
  rulesets = { "agent-a": { key: "agent-a", anchor: { type: "person", id: ID }, anchorFound: true, writeAccess: "full" } };
  holder.store.rulesetStore.get.mockImplementation(async (key: string) => rulesets[key] ?? null);
  for (const spy of Object.values(writes)) spy.mockReset().mockResolvedValue({});
});

const PLAIN = "/api/ontologies/test_ont/runtime/lenses/all";
const RULESET = `${PLAIN}/rulesets/agent-a`;

/** Every write route, with the spy it reaches. */
const WRITE_ROUTES = [
  ["POST", `/entities/person`, { name: "Ann" }, writes.createEntity],
  ["PATCH", `/entities/person/${ID}`, { name: "Ann" }, writes.updateEntity],
  ["DELETE", `/entities/person/${ID}`, undefined, writes.deleteEntity],
  ["PATCH", `/entities/person/${ID}/documents/bio`, { op: "str_replace", oldString: "a", newString: "b" }, writes.editDocument],
  ["POST", `/relations/works_for`, { fromEntityId: ID, toEntityId: OTHER }, writes.createRelation],
  ["PATCH", `/relations/works_for/${ID}`, { role: "x" }, writes.updateRelation],
  ["DELETE", `/relations/works_for/${ID}`, undefined, writes.deleteRelation],
] as const;

describe("the ruleset REST mirror", () => {
  it.each(WRITE_ROUTES)("%s %s passes the ruleset key; the plain lens passes null", async (method, path, payload, spy) => {
    const viaRuleset = await app.inject({ method, url: `${RULESET}${path}`, payload });
    expect(viaRuleset.statusCode, viaRuleset.body).toBeLessThan(300);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]!.at(-1)).toBe("agent-a");
    expect(spy.mock.calls[0]![0]).toBe("all");

    spy.mockClear();
    const plain = await app.inject({ method, url: `${PLAIN}${path}`, payload });
    expect(plain.statusCode, plain.body).toBeLessThan(300);
    expect(spy.mock.calls[0]!.at(-1)).toBeNull();
  });

  it("no document edit route is mounted under a changeset: 404 and nothing written (F7)", async () => {
    for (const base of [PLAIN, RULESET]) {
      const res = await app.inject({
        method: "PATCH",
        url: `${base}/changesets/${OTHER}/documents/person/${ID}/bio`,
        payload: { op: "str_replace", oldString: "a", newString: "b" },
      });
      expect(res.statusCode, base).toBe(404);
    }
    expect(writes.editDocument).not.toHaveBeenCalled();
  });

  it("an unknown ruleset is not found on a read, a write and the root; nothing is written or created", async () => {
    for (const [method, path] of [
      ["GET", ""],
      ["GET", "/entities/person"],
      ["GET", `/entities/person/${ID}/path`],
      ["POST", "/entities/person"],
    ] as const) {
      const res = await app.inject({ method, url: `${PLAIN}/rulesets/nope${path}`, payload: method === "POST" ? { name: "Ann" } : undefined });
      expect(res.statusCode, path).toBe(404);
      expect(res.json().error.message).toBe("Ruleset 'nope' not found");
    }
    expect(writes.createEntity).not.toHaveBeenCalled();
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });

  it("an unknown lens is not found before the ruleset", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/nope/rulesets/nope/entities/person" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain("Lens 'nope' not found");
    expect(holder.store.rulesetStore.get).not.toHaveBeenCalled();
  });

  it("reads through the ruleset as through the plain lens", async () => {
    const res = await app.inject({ method: "GET", url: `${RULESET}/entities/person` });
    expect(res.statusCode, res.body).toBe(200);
    expect(holder.store.listEntities).toHaveBeenCalled();
  });
});

describe("the ruleset through the lens", () => {
  const root = (lens = "all", key = "agent-a") =>
    app.inject({ method: "GET", url: `/api/ontologies/test_ont/runtime/lenses/${lens}/rulesets/${key}` });

  it("found: the entity with its name, and the path ending with it", async () => {
    holder.store.getEntitiesByIds.mockResolvedValue({ [ID]: makeEntity({ _id: ID, name: "Ann" }) });
    const res = await root();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      key: "agent-a",
      writeAccess: "full",
      anchor: {
        type: "person",
        id: ID,
        name: "Ann",
        state: "found",
        visible: true,
        path: [{ type: "person", id: ID, name: "Ann" }],
      },
    });
  });

  it("the lens hides the entity's type: not visible, no entity, no path, no path read", async () => {
    const res = await root("no_person");
    expect(res.json()).toEqual({
      key: "agent-a",
      writeAccess: "full",
      anchor: { type: null, id: null, name: null, state: "found", visible: false, path: [] },
    });
    expect(holder.store.getAncestors).not.toHaveBeenCalled();
  });

  it("no anchor: null; deleted: visible, no entity, no path", async () => {
    rulesets["agent-u"] = { key: "agent-u", anchor: null, anchorFound: false, writeAccess: "propose" };
    rulesets["agent-d"] = { key: "agent-d", anchor: { type: "person", id: ID }, anchorFound: false, writeAccess: "full" };
    expect((await root("all", "agent-u")).json()).toEqual({ key: "agent-u", writeAccess: "propose", anchor: null });
    expect((await root("all", "agent-d")).json()).toEqual({
      key: "agent-d",
      writeAccess: "full",
      anchor: { type: null, id: null, name: null, state: "deleted", visible: true, path: [] },
    });
  });
});

describe("the ruleset MCP server", () => {
  async function connect(rulesetKey: string | null, lensKey = "all"): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const binding = rulesetKey === null ? undefined : { rulesetKey, writeAccess: "full" as const };
    await createRuntimeMcpServer("test_ont", lensKey, binding).connect(serverTransport);
    const client = new Client({ name: "ruleset-mount-tests", version: "0.0.1" });
    await client.connect(clientTransport);
    return client;
  }

  interface ToolCallResult {
    content: { type: string; text: string }[];
    isError?: boolean;
  }
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;

  it("has get_ruleset; the plain lens server does not", async () => {
    const viaRuleset = await connect("agent-a");
    const plain = await connect(null);
    try {
      const names = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name);
      const rulesetNames = await names(viaRuleset);
      const plainNames = await names(plain);
      expect(rulesetNames).toContain("get_ruleset");
      expect(plainNames).not.toContain("get_ruleset");
      expect(rulesetNames.filter((name) => name !== "get_ruleset").sort()).toEqual([...plainNames].sort());
    } finally {
      await viaRuleset.close();
      await plain.close();
    }
  });

  const WRITE_TOOLS = [
    ["create_entity", { entity_type_key: "person", properties: { name: "Ann" } }, writes.createEntity],
    ["update_entity", { entity_type_key: "person", entity_id: ID, properties: { name: "Ann" } }, writes.updateEntity],
    ["delete_entity", { entity_type_key: "person", entity_id: ID }, writes.deleteEntity],
    ["edit_document", { entity_type_key: "person", entity_id: ID, property_key: "bio", old_string: "a", new_string: "b" }, writes.editDocument],
    ["write_document", { entity_type_key: "person", entity_id: ID, property_key: "bio", offset: 0, length: 0, content: "x" }, writes.editDocument],
    ["create_relation", { relation_type_key: "works_for", from_entity_id: ID, to_entity_id: OTHER }, writes.createRelation],
    ["update_relation", { relation_type_key: "works_for", relation_id: ID, properties: { role: "x" } }, writes.updateRelation],
    ["delete_relation", { relation_type_key: "works_for", relation_id: ID }, writes.deleteRelation],
  ] as const;

  it.each(WRITE_TOOLS)("%s passes the ruleset key; the plain lens passes null", async (name, args, spy) => {
    const viaRuleset = await connect("agent-a");
    const plain = await connect(null);
    try {
      const result = await call(viaRuleset, name, args);
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(spy.mock.calls[0]!.at(-1)).toBe("agent-a");
      spy.mockClear();
      await call(plain, name, args);
      expect(spy.mock.calls[0]!.at(-1)).toBeNull();
    } finally {
      await viaRuleset.close();
      await plain.close();
    }
  });

  it.each(WRITE_TOOLS.filter(([name]) => name === "edit_document" || name === "write_document"))(
    "%s with changeset_id stages instead of writing, on both mounts",
    async (name, args, spy) => {
      for (const rulesetKey of [null, "agent-a"]) {
        const client = await connect(rulesetKey);
        try {
          const result = await call(client, name, { ...args, changeset_id: ID });
          // The mocked changeset store holds no changeset: the staging path answers.
          expect(result.isError).toBe(true);
          expect(result.content[0]!.text).toBe(`Error executing tool ${name}: Changeset '${ID}' not found`);
        } finally {
          await client.close();
        }
      }
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("an unknown ruleset fails every tool, after an unknown lens", async () => {
    const unknownRuleset = await connect("nope");
    const unknownLens = await connect("nope", "nope");
    try {
      for (const [name, args] of [
        ["get_ruleset", {}],
        ["list_entities", { entity_type_key: "person" }],
        ["create_entity", { entity_type_key: "person", properties: { name: "Ann" } }],
      ] as const) {
        const rulesetMissing = await call(unknownRuleset, name, args);
        expect(rulesetMissing.isError, name).toBe(true);
        expect(rulesetMissing.content[0]!.text).toContain("Ruleset 'nope' not found");
        const lensMissing = await call(unknownLens, name, args);
        expect(lensMissing.content[0]!.text).toContain("Lens 'nope' not found");
      }
      expect(writes.createEntity).not.toHaveBeenCalled();
    } finally {
      await unknownRuleset.close();
      await unknownLens.close();
    }
  });

  it("get_ruleset gives the mirror's answer", async () => {
    holder.store.getEntitiesByIds.mockResolvedValue({ [ID]: makeEntity({ _id: ID, name: "Ann" }) });
    const client = await connect("agent-a");
    try {
      const result = await call(client, "get_ruleset");
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        key: "agent-a",
        writeAccess: "full",
        anchor: {
          type: "person",
          id: ID,
          name: "Ann",
          state: "found",
          visible: true,
          path: [{ type: "person", id: ID, name: "Ann" }],
        },
      });
    } finally {
      await client.close();
    }
  });
});

describe("the MCP ruleset mount over HTTP", () => {
  const MOUNT = "/mcp/ontologies/test_ont/runtime/lenses/all/rulesets/agent-a";
  /** One stateless JSON-RPC request to the mount. */
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await app.inject({
      method: "POST",
      url: MOUNT,
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method, params },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().result;
  };

  it("tools/list reads the ruleset once and lists what its level allows", async () => {
    for (const [level, count] of [["full", 35], ["propose", 34], ["none", 20]] as const) {
      rulesets["agent-a"]!.writeAccess = level;
      holder.store.rulesetStore.get.mockClear();
      const { tools } = await rpc("tools/list");
      expect(tools, level).toHaveLength(count);
      expect(holder.store.rulesetStore.get, level).toHaveBeenCalledTimes(1);
    }
  });

  it("a tools/call reads the ruleset once; a tool its level leaves out answers the refusal", async () => {
    rulesets["agent-a"]!.writeAccess = "none";
    const result = await rpc("tools/call", {
      name: "create_entity",
      arguments: { entity_type_key: "person", properties: { name: "Ann" } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Error executing tool create_entity: Ruleset 'agent-a' gives write access 'none': this " +
        "connection cannot write directly; it can only read",
    );
    expect(holder.store.rulesetStore.get).toHaveBeenCalledTimes(1);
    expect(writes.createEntity).not.toHaveBeenCalled();
  });
});
