/**
 * The anchored mounts over a mocked store, with the seven write functions
 * spied: the REST mirror and the anchored MCP server pass the anchor key
 * to every write, the plain lens passes null; every request checks lens,
 * then anchor, reads included; `get_anchor` and the mirror's root give
 * the anchor through the lens; only the anchored MCP server has
 * `get_anchor`.
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

let anchors: Record<string, RulesetRecord>;

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
  anchors = { "agent-a": { key: "agent-a", anchor: { type: "person", id: ID }, anchorFound: true, writeAccess: "full" } };
  holder.store.rulesetStore.get.mockImplementation(async (key: string) => anchors[key] ?? null);
  for (const spy of Object.values(writes)) spy.mockReset().mockResolvedValue({});
});

const PLAIN = "/api/ontologies/test_ont/runtime/lenses/all";
const ANCHORED = `${PLAIN}/rulesets/agent-a`;

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

describe("the anchored REST mirror", () => {
  it.each(WRITE_ROUTES)("%s %s passes the anchor key; the plain lens passes null", async (method, path, payload, spy) => {
    const anchored = await app.inject({ method, url: `${ANCHORED}${path}`, payload });
    expect(anchored.statusCode, anchored.body).toBeLessThan(300);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]!.at(-1)).toBe("agent-a");
    expect(spy.mock.calls[0]![0]).toBe("all");

    spy.mockClear();
    const plain = await app.inject({ method, url: `${PLAIN}${path}`, payload });
    expect(plain.statusCode, plain.body).toBeLessThan(300);
    expect(spy.mock.calls[0]!.at(-1)).toBeNull();
  });

  it("no document edit route is mounted under a changeset: 404 and nothing written (F7)", async () => {
    for (const base of [PLAIN, ANCHORED]) {
      const res = await app.inject({
        method: "PATCH",
        url: `${base}/changesets/${OTHER}/documents/person/${ID}/bio`,
        payload: { op: "str_replace", oldString: "a", newString: "b" },
      });
      expect(res.statusCode, base).toBe(404);
    }
    expect(writes.editDocument).not.toHaveBeenCalled();
  });

  it("an unknown anchor is not found on a read, a write and the root; nothing is written or created", async () => {
    for (const [method, path] of [
      ["GET", ""],
      ["GET", "/entities/person"],
      ["GET", `/entities/person/${ID}/path`],
      ["POST", "/entities/person"],
    ] as const) {
      const res = await app.inject({ method, url: `${PLAIN}/rulesets/nope${path}`, payload: method === "POST" ? { name: "Ann" } : undefined });
      expect(res.statusCode, path).toBe(404);
      expect(res.json().error.message).toBe("Anchor 'nope' not found");
    }
    expect(writes.createEntity).not.toHaveBeenCalled();
    expect(holder.store.rulesetStore.save).not.toHaveBeenCalled();
  });

  it("an unknown lens is not found before the anchor", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/nope/rulesets/nope/entities/person" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain("Lens 'nope' not found");
    expect(holder.store.rulesetStore.get).not.toHaveBeenCalled();
  });

  it("reads through the anchor as through the plain lens", async () => {
    const res = await app.inject({ method: "GET", url: `${ANCHORED}/entities/person` });
    expect(res.statusCode, res.body).toBe(200);
    expect(holder.store.listEntities).toHaveBeenCalled();
  });
});

describe("the anchor through the lens", () => {
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
    anchors["agent-u"] = { key: "agent-u", anchor: null, anchorFound: false, writeAccess: "propose" };
    anchors["agent-d"] = { key: "agent-d", anchor: { type: "person", id: ID }, anchorFound: false, writeAccess: "full" };
    expect((await root("all", "agent-u")).json()).toEqual({ key: "agent-u", writeAccess: "propose", anchor: null });
    expect((await root("all", "agent-d")).json()).toEqual({
      key: "agent-d",
      writeAccess: "full",
      anchor: { type: null, id: null, name: null, state: "deleted", visible: true, path: [] },
    });
  });
});

describe("the anchored MCP server", () => {
  async function connect(anchorKey: string | null, lensKey = "all"): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createRuntimeMcpServer("test_ont", lensKey, anchorKey).connect(serverTransport);
    const client = new Client({ name: "anchored-mount-tests", version: "0.0.1" });
    await client.connect(clientTransport);
    return client;
  }

  interface ToolCallResult {
    content: { type: string; text: string }[];
    isError?: boolean;
  }
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;

  it("has get_anchor; the plain lens server does not", async () => {
    const anchored = await connect("agent-a");
    const plain = await connect(null);
    try {
      const names = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name);
      const anchoredNames = await names(anchored);
      const plainNames = await names(plain);
      expect(anchoredNames).toContain("get_anchor");
      expect(plainNames).not.toContain("get_anchor");
      expect(anchoredNames.filter((name) => name !== "get_anchor").sort()).toEqual([...plainNames].sort());
    } finally {
      await anchored.close();
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

  it.each(WRITE_TOOLS)("%s passes the anchor key; the plain lens passes null", async (name, args, spy) => {
    const anchored = await connect("agent-a");
    const plain = await connect(null);
    try {
      const result = await call(anchored, name, args);
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(spy.mock.calls[0]!.at(-1)).toBe("agent-a");
      spy.mockClear();
      await call(plain, name, args);
      expect(spy.mock.calls[0]!.at(-1)).toBeNull();
    } finally {
      await anchored.close();
      await plain.close();
    }
  });

  it.each(WRITE_TOOLS.filter(([name]) => name === "edit_document" || name === "write_document"))(
    "%s refuses any changeset_id and writes nothing, on both mounts (F7)",
    async (name, args, spy) => {
      for (const anchorKey of [null, "agent-a"]) {
        const client = await connect(anchorKey);
        try {
          for (const changesetId of [ID, "", null]) {
            const result = await call(client, name, { ...args, changeset_id: changesetId });
            expect(result.isError, String(changesetId)).toBe(true);
            expect(result.content[0]!.text).toBe(
              `Error executing tool ${name}: changeset_id is not accepted: ${name} always writes ` +
                "immediately and cannot be staged; to stage a document change, pass the whole new " +
                "value to update_entity with 'changeset_id'",
            );
          }
        } finally {
          await client.close();
        }
      }
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("an unknown anchor fails every tool, after an unknown lens", async () => {
    const unknownAnchor = await connect("nope");
    const unknownLens = await connect("nope", "nope");
    try {
      for (const [name, args] of [
        ["get_anchor", {}],
        ["list_entities", { entity_type_key: "person" }],
        ["create_entity", { entity_type_key: "person", properties: { name: "Ann" } }],
      ] as const) {
        const anchorMissing = await call(unknownAnchor, name, args);
        expect(anchorMissing.isError, name).toBe(true);
        expect(anchorMissing.content[0]!.text).toContain("Anchor 'nope' not found");
        const lensMissing = await call(unknownLens, name, args);
        expect(lensMissing.content[0]!.text).toContain("Lens 'nope' not found");
      }
      expect(writes.createEntity).not.toHaveBeenCalled();
    } finally {
      await unknownAnchor.close();
      await unknownLens.close();
    }
  });

  it("get_anchor gives the mirror's answer", async () => {
    holder.store.getEntitiesByIds.mockResolvedValue({ [ID]: makeEntity({ _id: ID, name: "Ann" }) });
    const client = await connect("agent-a");
    try {
      const result = await call(client, "get_anchor");
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
