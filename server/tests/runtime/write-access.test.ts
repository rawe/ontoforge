/**
 * Write access (`writeAccess.ts`): the levels as sets of operations, the
 * one check and its refusal, the tables against what the mounts register,
 * which tools a level lists, and the check at both entrances over a
 * mocked store, at each level: the REST mirror's preHandler and the MCP
 * tools (a level lowered since the tool list was built), after the
 * not-found order and before any service runs, reading the ruleset once.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError } from "../../src/core/exceptions.js";
import type { WriteAccess } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  LEVELS,
  ROUTES,
  TOOLS,
  allows,
  checkOperation,
  listsTool,
  routeOperation,
  toolOperation,
  type Operation,
} from "../../src/runtime/writeAccess.js";
import { NOW, createMockRuntimeStore, makeFullSchema, type MockRuntimeStore } from "./helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
  getSearchIndexStore: async () => holder.store.indices,
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
const { rulesetRuntimeRouter } = await import("../../src/runtime/rulesetRouter.js");

const OPERATIONS: Operation[] = ["read", "stage", "commit", "write"];
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** The refusal of `operation` through ruleset `agent-a` at `level`. */
function refusalText(level: WriteAccess, operation: Operation): string {
  try {
    checkOperation({ rulesetKey: "agent-a", writeAccess: level }, operation);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("the levels and the check", () => {
  it("each level allows everything the one before it does", () => {
    expect([...LEVELS.none]).toEqual(["read"]);
    expect([...LEVELS.propose]).toEqual(["read", "stage"]);
    expect([...LEVELS.full]).toEqual(["read", "stage", "commit", "write"]);
    for (const operation of LEVELS.none) expect(LEVELS.propose.has(operation)).toBe(true);
    for (const operation of LEVELS.propose) expect(LEVELS.full.has(operation)).toBe(true);
  });

  it("allows, per level and operation", () => {
    const allowed = (level: WriteAccess) => OPERATIONS.filter((operation) => allows(level, operation));
    expect(allowed("none")).toEqual(["read"]);
    expect(allowed("propose")).toEqual(["read", "stage"]);
    expect(allowed("full")).toEqual(OPERATIONS);
  });

  it("checkOperation passes what the level allows, and refuses the rest with a 409 saying what to do", () => {
    for (const operation of OPERATIONS) {
      expect(() => checkOperation({ rulesetKey: null, writeAccess: "full" }, operation)).not.toThrow();
      expect(() => checkOperation({ rulesetKey: "agent-a", writeAccess: "full" }, operation)).not.toThrow();
    }
    expect(() => checkOperation({ rulesetKey: "agent-a", writeAccess: "none" }, "write")).toThrow(ConflictError);
    expect(refusalText("propose", "read")).toBe("");
    expect(refusalText("propose", "stage")).toBe("");
    expect(refusalText("propose", "write")).toBe(
      "Ruleset 'agent-a' gives write access 'propose': this connection cannot write directly; stage the write into a changeset",
    );
    expect(refusalText("propose", "commit")).toBe(
      "Ruleset 'agent-a' gives write access 'propose': this connection cannot commit; submit the changeset, and a person commits it",
    );
    expect(refusalText("none", "read")).toBe("");
    expect(refusalText("none", "write")).toBe(
      "Ruleset 'agent-a' gives write access 'none': this connection cannot write directly; it can only read",
    );
    expect(refusalText("none", "stage")).toBe(
      "Ruleset 'agent-a' gives write access 'none': this connection cannot start or change a changeset; it can only read",
    );
    expect(refusalText("none", "commit")).toBe(
      "Ruleset 'agent-a' gives write access 'none': this connection cannot commit; it can only read",
    );
  });

  it("a stageable tool stages with changeset_id and writes without it; HEAD is GET's; no row throws", () => {
    const stageable = Object.entries(TOOLS).filter(([, row]) => row.stageable).map(([name]) => name);
    expect(stageable.sort()).toEqual(
      [
        "create_entity",
        "create_relation",
        "delete_entity",
        "delete_relation",
        "edit_document",
        "update_entity",
        "update_relation",
        "write_document",
      ],
    );
    for (const name of stageable) {
      expect(toolOperation(name, { changeset_id: ID })).toBe("stage");
      expect(toolOperation(name, {})).toBe("write");
    }
    expect(toolOperation("rebase", { changeset_id: ID })).toBe("stage");
    expect(toolOperation("check_changeset", { changeset_id: ID })).toBe("stage");
    expect(toolOperation("commit_changeset", { changeset_id: ID })).toBe("commit");
    expect(() => toolOperation("nope", {})).toThrow("Tool 'nope' has no row in the operation table");
    expect(routeOperation("HEAD", "/schema")).toBe("read");
    expect(routeOperation("POST", "/query")).toBe("read");
    expect(() => routeOperation("PUT", "/schema")).toThrow("Route 'PUT /schema' has no row in the operation table");
  });

  it("a level lists the tools whose operation it allows, and a stageable tool from staging up: 36, 35, 20", () => {
    const listed = (level: WriteAccess) => Object.keys(TOOLS).filter((name) => listsTool(level, name));
    expect(listed("full")).toHaveLength(36);
    expect(listed("propose").sort()).toEqual(Object.keys(TOOLS).filter((name) => name !== "commit_changeset").sort());
    expect(listed("none").sort()).toEqual(Object.keys(TOOLS).filter((name) => TOOLS[name]!.operation === "read").sort());
    expect(listed("none")).toHaveLength(20);
    expect(() => listsTool("full", "nope")).toThrow("Tool 'nope' has no row in the operation table");
  });
});

describe("the tables cannot drift", () => {
  it("ROUTES are exactly the routes the ruleset mirror registers (41)", async () => {
    const prefix = "/api/ontologies/:ontologyKey/runtime/lenses/:lensKey/rulesets/:rulesetKey";
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const registered = new Set<string>();
    app.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) {
        if (method === "HEAD") continue;
        registered.add(`${method} ${route.url.slice(prefix.length).replace(/(.)\/$/, "$1") || "/"}`);
      }
    });
    await app.register(rulesetRuntimeRouter, { prefix });
    await app.ready();
    await app.close();
    expect([...registered].sort()).toEqual(Object.keys(ROUTES).sort());
    expect(registered.size).toBe(41);
  });

  it("TOOLS are exactly the tools of a ruleset mount at full (36)", async () => {
    const client = await connect("agent-a");
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    await client.close();
    expect(names.sort()).toEqual(Object.keys(TOOLS).sort());
    expect(names).toHaveLength(36);
  });
});

/** A client of a server whose tool list was built at `listed`. */
async function connect(rulesetKey: string | null, listed: WriteAccess = "full"): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const binding = rulesetKey === null ? undefined : { rulesetKey, writeAccess: listed };
  await createRuntimeMcpServer("test_ont", "all", binding).connect(serverTransport);
  const client = new Client({ name: "write-access-tests", version: "0.0.1" });
  await client.connect(clientTransport);
  return client;
}

let level: WriteAccess;

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
  holder.store.indices.readFullSchema.mockResolvedValue(makeFullSchema());
  holder.store.getFullSchemaWithLensInclusions.mockImplementation(async (lensKey: string) =>
    lensKey === "all" ? makeFullSchema({ lensKey }) : null,
  );
  level = "full";
  holder.store.rulesetStore.get.mockImplementation(async (key: string) =>
    key === "agent-a" ? { key, anchor: null, anchorFound: false, writeAccess: level } : null,
  );
  holder.store.changesetStore.start.mockImplementation(async (started: object) => ({
    ...started,
    version: 1,
    submittedAt: null,
    createdAt: NOW,
    lastChangeAt: NOW,
    objectCount: 0,
  }));
  for (const spy of Object.values(writes)) spy.mockReset().mockResolvedValue({});
});

const WRITE = "write access";
const isRefusal = (message: unknown): boolean => typeof message === "string" && message.includes(WRITE);

describe("the REST mirror", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { createApp } = await import("../../src/app.js");
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const MOUNT = "/api/ontologies/test_ont/runtime/lenses/all/rulesets/agent-a";
  const CS = `/changesets/${ID}`;

  /** One request per row of ROUTES, with a body that passes validation. */
  const REQUESTS: Record<string, [string, unknown?]> = {
    "GET /": [""],
    "GET /schema": ["/schema"],
    "GET /schema/entity-types": ["/schema/entity-types"],
    "GET /schema/entity-types/:key": ["/schema/entity-types/person"],
    "GET /schema/relation-types": ["/schema/relation-types"],
    "GET /schema/relation-types/:key": ["/schema/relation-types/works_for"],
    "GET /search": ["/search?q=ann"],
    "GET /search-indices": ["/search-indices"],
    "POST /search": ["/search", { query: "ann" }],
    "POST /entities/:entityTypeKey": ["/entities/person", { name: "Ann" }],
    "GET /entities/:entityTypeKey": ["/entities/person"],
    "GET /entities/:entityTypeKey/:entityId": [`/entities/person/${ID}`],
    "PATCH /entities/:entityTypeKey/:entityId": [`/entities/person/${ID}`, { name: "Ann" }],
    "DELETE /entities/:entityTypeKey/:entityId": [`/entities/person/${ID}`],
    "GET /entities/:entityTypeKey/:entityId/path": [`/entities/person/${ID}/path`],
    "GET /entities/:entityTypeKey/:entityId/documents/:propertyKey": [`/entities/person/${ID}/documents/bio`],
    "PATCH /entities/:entityTypeKey/:entityId/documents/:propertyKey": [
      `/entities/person/${ID}/documents/bio`,
      { op: "str_replace", oldString: "a", newString: "b" },
    ],
    "GET /entities/:entityTypeKey/:entityId/neighbors": [`/entities/person/${ID}/neighbors`],
    "POST /query": ["/query", { query: "MATCH (p:person) RETURN p" }],
    "GET /saved-queries": ["/saved-queries"],
    "GET /saved-queries/search": ["/saved-queries/search?q=ann"],
    "POST /saved-queries/:queryKey/run": ["/saved-queries/q1/run", {}],
    "POST /relations/:relationTypeKey": ["/relations/works_for", { fromEntityId: ID, toEntityId: OTHER }],
    "GET /relations/:relationTypeKey": ["/relations/works_for"],
    "GET /relations/:relationTypeKey/:relationId": [`/relations/works_for/${ID}`],
    "PATCH /relations/:relationTypeKey/:relationId": [`/relations/works_for/${ID}`, { role: "x" }],
    "DELETE /relations/:relationTypeKey/:relationId": [`/relations/works_for/${ID}`],
    "POST /changesets": ["/changesets", {}],
    "GET /changesets": ["/changesets"],
    "GET /changesets/:changesetId": [CS],
    "GET /changesets/:changesetId/documents/:entityTypeKey/:entityId/:propertyKey": [`${CS}/documents/person/${ID}/bio`],
    "GET /changesets/:changesetId/entities/:entityTypeKey/:entityId": [`${CS}/entities/person/${ID}`],
    "DELETE /changesets/:changesetId": [CS],
    "POST /changesets/:changesetId/writes": [
      `${CS}/writes`,
      { operation: "update_entity", type: "person", id: OTHER, properties: { name: "Ann" } },
    ],
    "DELETE /changesets/:changesetId/objects/:objectId": [`${CS}/objects/${ID}`],
    "DELETE /changesets/:changesetId/objects/:objectId/properties/:propertyKey": [`${CS}/objects/${ID}/properties/name`],
    "POST /changesets/:changesetId/objects/:objectId/rebase": [`${CS}/objects/${ID}/rebase`, {}],
    "POST /changesets/:changesetId/submit": [`${CS}/submit`, {}],
    "POST /changesets/:changesetId/unsubmit": [`${CS}/unsubmit`, { note: "again" }],
    "POST /changesets/:changesetId/check": [`${CS}/check`],
    "POST /changesets/:changesetId/commit": [`${CS}/commit`, {}],
  };

  /** Every route at `writeAccess`: the routes refused, each having read
   * the ruleset once and reached no service; the others past the check. */
  async function refusedAt(writeAccess: WriteAccess): Promise<string[]> {
    level = writeAccess;
    const refused: string[] = [];
    for (const route of Object.keys(ROUTES)) {
      const [path, payload] = REQUESTS[route]!;
      holder.store.rulesetStore.get.mockClear();
      holder.store.changesets.mockClear();
      const method = route.split(" ")[0] as "GET";
      const res = await app.inject({ method, url: `${MOUNT}${path}`, ...(payload === undefined ? {} : { payload: payload as object }) });
      expect(holder.store.rulesetStore.get, route).toHaveBeenCalled();
      const message = res.statusCode === 409 ? res.json().error.message : undefined;
      if (isRefusal(message)) {
        expect(res.statusCode, route).toBe(409);
        expect(res.json().error.code, route).toBe("RESOURCE_CONFLICT");
        expect(message, route).toBe(refusalText(writeAccess, ROUTES[route]!));
        expect(holder.store.rulesetStore.get, route).toHaveBeenCalledTimes(1);
        expect(holder.store.changesets, route).not.toHaveBeenCalled();
        refused.push(route);
      }
    }
    return refused;
  }

  it("full answers all 41", async () => {
    expect(await refusedAt("full")).toEqual([]);
  });

  it("propose refuses the 7 immediate writes and the commit: 33 / 8", async () => {
    const refused = await refusedAt("propose");
    expect(refused.map((route) => ROUTES[route])).toEqual([...Array(7).fill("write"), "commit"]);
    expect(Object.keys(ROUTES).length - refused.length).toBe(33);
  });

  it("none refuses every write, stage and commit: 24 / 17; the changeset reads still answer", async () => {
    const refused = await refusedAt("none");
    expect(refused).toEqual(Object.keys(ROUTES).filter((route) => ROUTES[route] !== "read"));
    expect(refused).toHaveLength(17);
    expect(refused).not.toContain("GET /changesets/:changesetId/entities/:entityTypeKey/:entityId");
    for (const spy of Object.values(writes)) expect(spy).not.toHaveBeenCalled();
  });

  it("an unknown ruleset is not found before write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/all/rulesets/nope/entities/person",
      payload: { name: "Ann" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("Ruleset 'nope' not found");
  });
});

describe("the MCP tools", () => {
  interface ToolCallResult {
    content: { type: string; text: string }[];
    isError?: boolean;
  }
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;

  const WRITE_CALLS = [
    ["create_entity", { entity_type_key: "person", properties: { name: "Ann" } }],
    ["update_entity", { entity_type_key: "person", entity_id: ID, properties: { name: "Ann" } }],
    ["delete_entity", { entity_type_key: "person", entity_id: ID }],
    ["edit_document", { entity_type_key: "person", entity_id: ID, property_key: "bio", old_string: "a", new_string: "b" }],
    ["write_document", { entity_type_key: "person", entity_id: ID, property_key: "bio", offset: 0, length: 0, content: "x" }],
    ["create_relation", { relation_type_key: "works_for", from_entity_id: ID, to_entity_id: OTHER }],
    ["update_relation", { relation_type_key: "works_for", relation_id: ID, properties: { role: "x" } }],
    ["delete_relation", { relation_type_key: "works_for", relation_id: ID }],
  ] as const;
  const CHANGESET_CALLS = [
    ["start_changeset", {}],
    ["update_entity", { entity_type_key: "person", entity_id: ID, properties: { name: "Ann" }, changeset_id: ID }],
    ["edit_document", { entity_type_key: "person", entity_id: ID, property_key: "bio", old_string: "a", new_string: "b", changeset_id: ID }],
    ["unstage", { changeset_id: ID, object_id: ID }],
    ["rebase", { changeset_id: ID, object_id: ID }],
    ["submit_changeset", { changeset_id: ID }],
    ["unsubmit_changeset", { changeset_id: ID, note: "again" }],
    ["check_changeset", { changeset_id: ID }],
    ["discard_changeset", { changeset_id: ID }],
    ["commit_changeset", { changeset_id: ID }],
  ] as const;

  it("lowered to none since the list was built: every write and changeset change is refused at call time, reading the ruleset once; reads pass", async () => {
    const client = await connect("agent-a", "full");
    level = "none";
    try {
      for (const [name, args] of [...WRITE_CALLS, ...CHANGESET_CALLS]) {
        holder.store.rulesetStore.get.mockClear();
        const result = await call(client, name, args);
        expect(result.isError, name).toBe(true);
        expect(result.content[0]!.text, name).toBe(
          `Error executing tool ${name}: ${refusalText("none", toolOperation(name, args))}`,
        );
        expect(holder.store.rulesetStore.get, name).toHaveBeenCalledTimes(1);
      }
      for (const spy of Object.values(writes)) expect(spy).not.toHaveBeenCalled();
      expect(holder.store.changesets).not.toHaveBeenCalled();
      for (const [name, args] of [
        ["get_schema", {}],
        ["list_entities", { entity_type_key: "person" }],
        ["list_changesets", {}],
      ] as const) {
        holder.store.rulesetStore.get.mockClear();
        const result = await call(client, name, args);
        expect(isRefusal(result.content[0]!.text), name).toBe(false);
        expect(holder.store.rulesetStore.get, name).toHaveBeenCalled();
      }
    } finally {
      await client.close();
    }
  });

  it("lowered to propose since the list was built: a stageable tool with changeset_id stages; the commit is refused", async () => {
    const client = await connect("agent-a", "full");
    level = "propose";
    try {
      const staged = await call(client, "update_entity", CHANGESET_CALLS[1][1]);
      expect(isRefusal(staged.content[0]!.text)).toBe(false);
      expect(holder.store.changesets).toHaveBeenCalled();
      const commit = await call(client, "commit_changeset", { changeset_id: ID });
      expect(commit.content[0]!.text).toBe(`Error executing tool commit_changeset: ${refusalText("propose", "commit")}`);
    } finally {
      await client.close();
    }
  });

  it("full and the plain lens: every write reaches its service, once per call", async () => {
    for (const rulesetKey of ["agent-a", null]) {
      const client = await connect(rulesetKey);
      try {
        for (const [name, args] of WRITE_CALLS) {
          holder.store.rulesetStore.get.mockClear();
          const result = await call(client, name, args);
          expect(result.isError, `${name}: ${result.content[0]!.text}`).toBeFalsy();
          expect(holder.store.rulesetStore.get, name).toHaveBeenCalledTimes(rulesetKey === null ? 0 : 1);
        }
      } finally {
        await client.close();
      }
    }
  });
});
