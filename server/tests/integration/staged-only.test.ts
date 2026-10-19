/**
 * The staged-only anchor flag (V9 a, V43) over REST and MCP, on PostgreSQL
 * with the in-test project hierarchy (`buildProjectHierarchy`, fresh per
 * test): reported by the anchor reads; through a staged-only URL every
 * immediate write and the commit are 409s while staging, submit,
 * unsubmit, discard, the list and reads work; the same on an unanchored
 * key, with no coverage rules; a dangling anchor still refuses staging;
 * the escapes (the plain lens URL commits, the PUT lifts the flag); and
 * the staged-only MCP tool set (V29, R13).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import { runtimePrefix } from "./fixture.js";
import {
  buildProjectHierarchy,
  PROJECT_HIERARCHY_ONTOLOGY_KEY as O,
  type ProjectHierarchyIds,
} from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

const ALL = runtimePrefix(O, "all");
const ANCHORS = `/api/ontologies/${O}/runtime/anchors`;
const STAGED_ONLY = (key: string) => `Anchor '${key}' is staged-only: this connection only stages; pass a changeset`;
const NO_COMMIT = (key: string) =>
  `Anchor '${key}' is staged-only: this connection cannot commit; submit the changeset for review`;
const STAGEABLE = ["create_entity", "update_entity", "delete_entity", "create_relation", "update_relation", "delete_relation"];

let app: FastifyInstance;
let baseUrl: string;
let h: ProjectHierarchyIds;
let e: ProjectHierarchyIds["entities"];
const clients: Client[] = [];

async function rest(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function putAnchor(key: string, payload: Row): Promise<Row> {
  const res = await rest("PUT", `${ANCHORS}/${key}`, payload);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function connect(anchorKey: string): Promise<Client> {
  const path = `/mcp/ontologies/${O}/runtime/lenses/all/anchors/${anchorKey}`;
  const client = new Client({ name: "staged-only-tests", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}${path}`)));
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Row = {}): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;
}

const text = (result: ToolCallResult): string => result.content[0]?.text ?? "";

async function ok(client: Client, name: string, args: Row = {}): Promise<any> {
  const result = await call(client, name, args);
  expect(result.isError, text(result)).toBeFalsy();
  return JSON.parse(text(result));
}

/** Start a changeset through `base` and stage a task under P1 into it. */
async function startWithTask(base: string, name = "T9"): Promise<{ cs: string; task: string }> {
  const started = await rest("POST", `${base}/changesets`, {});
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const cs = started.body.id as string;
  const staged = await rest("POST", `${base}/changesets/${cs}/entities/task`, {
    name,
    parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "build" } },
  });
  expect(staged.status, JSON.stringify(staged.body)).toBe(202);
  return { cs, task: staged.body.id as string };
}

/** The seven immediate write routes, below `base`. */
function immediateWrites(base: string): [string, string, Row | undefined][] {
  const hasTask = h.relations["P1 has_task T1"]!;
  return [
    ["POST", `${base}/entities/task`, { name: "X", parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "build" } } }],
    ["PATCH", `${base}/entities/task/${e.T1}`, { name: "T1 renamed" }],
    ["DELETE", `${base}/entities/task/${e.T1a1}`, undefined],
    ["PATCH", `${base}/entities/task/${e.T1}/documents/notes`, { op: "str_replace", oldString: "Notes", newString: "Text" }],
    ["POST", `${base}/relations/assigned_to`, { fromEntityId: e.T2, toEntityId: e.Kim }],
    ["PATCH", `${base}/relations/has_task/${hasTask}`, { phase: "test" }],
    ["DELETE", `${base}/relations/assigned_to/${h.relations["T1 assigned_to Ben"]!}`, undefined],
  ];
}

beforeAll(async () => {
  await initStores();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  h = await buildProjectHierarchy(app);
  e = h.entities;
}, 60_000);

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("the flag on the anchor reads", () => {
  it("the GET, the list, the mount root and get_anchor report it", async () => {
    await putAnchor("agent-s", { entity: { type: "project", id: e.P1 }, stagedOnly: true });
    await putAnchor("agent-a", { entity: { type: "project", id: e.P1 } });
    expect((await rest("GET", `${ANCHORS}/agent-s`)).body.stagedOnly).toBe(true);
    expect((await rest("GET", ANCHORS)).body.map((a: Row) => [a.key, a.stagedOnly])).toEqual([
      ["agent-a", false],
      ["agent-s", true],
    ]);
    expect((await rest("GET", `${ALL}/anchors/agent-s`)).body).toMatchObject({ key: "agent-s", state: "anchored", stagedOnly: true });
    expect((await rest("GET", `${ALL}/anchors/agent-a`)).body.stagedOnly).toBe(false);
    expect(await ok(await connect("agent-s"), "get_anchor")).toMatchObject({ state: "anchored", stagedOnly: true });
    expect((await ok(await connect("agent-a"), "get_anchor")).stagedOnly).toBe(false);
  });
});

describe("through a staged-only anchored URL (REST)", () => {
  const S = `${ALL}/anchors/agent-s`;
  beforeEach(async () => {
    await putAnchor("agent-s", { entity: { type: "project", id: e.P1 }, stagedOnly: true });
  });

  it("every immediate write answers 409, and nothing is written", async () => {
    for (const [method, url, payload] of immediateWrites(S)) {
      const res = await rest(method, url, payload);
      expect(res.status, `${method} ${url}`).toBe(409);
      expect(res.body.error.message).toBe(STAGED_ONLY("agent-s"));
    }
    const t1 = (await rest("GET", `${ALL}/entities/task/${e.T1}`)).body;
    expect(t1.name).toBe("T1");
    expect((await rest("GET", `${ALL}/entities/task/${e.T1a1}`)).status).toBe(200);
    expect((await rest("GET", `${ALL}/relations/assigned_to/${h.relations["T1 assigned_to Ben"]!}`)).status).toBe(200);
  });

  it("stage, unstage, list, read, submit, unsubmit and discard work; the commit answers 409", async () => {
    const { cs } = await startWithTask(S);
    const update = await rest("PATCH", `${S}/changesets/${cs}/entities/project/${e.P2}`, { name: "P2 Website" });
    expect(update.status).toBe(202);
    expect((await rest("DELETE", `${S}/changesets/${cs}/writes/${update.body.seq}`)).status).toBe(204);
    expect((await rest("GET", `${S}/changesets`)).body.map((c: Row) => c.id)).toEqual([cs]);
    const read = await rest("GET", `${S}/changesets/${cs}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ anchor: "agent-s", writeCount: 1 });
    expect((await rest("GET", `${S}/entities/task`)).status).toBe(200);

    const commit = await rest("POST", `${S}/changesets/${cs}/commit`, {});
    expect(commit.status).toBe(409);
    expect(commit.body.error.message).toBe(NO_COMMIT("agent-s"));

    expect((await rest("POST", `${S}/changesets/${cs}/submit`, { note: "please review" })).body.state).toBe("submitted");
    const submittedCommit = await rest("POST", `${S}/changesets/${cs}/commit`, { expectedVersion: 1 });
    expect(submittedCommit.status).toBe(409);
    expect(submittedCommit.body.error.message).toBe(NO_COMMIT("agent-s"));
    expect((await rest("POST", `${S}/changesets/${cs}/unsubmit`, { note: "fix it" })).body.state).toBe("draft");
    expect((await rest("DELETE", `${S}/changesets/${cs}`)).status).toBe(204);
    expect((await rest("GET", `${S}/changesets/${cs}`)).status).toBe(404);
  });

  it("the escapes: the plain lens URL commits it, and a PUT stagedOnly false restores immediate writes", async () => {
    const { cs, task } = await startWithTask(S);
    expect((await rest("POST", `${S}/changesets/${cs}/submit`, {})).status).toBe(200);
    const committed = await rest("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body).toEqual({ committed: 1, alreadyGone: [] });
    expect((await rest("GET", `${ALL}/entities/task/${task}`)).body.name).toBe("T9");

    expect((await putAnchor("agent-s", { entity: { type: "project", id: e.P1 }, stagedOnly: false })).stagedOnly).toBe(false);
    const renamed = await rest("PATCH", `${S}/entities/task/${e.T1}`, { name: "T1 renamed" });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.name).toBe("T1 renamed");
    const { cs: again } = await startWithTask(S, "T10");
    expect((await rest("POST", `${S}/changesets/${again}/commit`, {})).status).toBe(200);
  });

  it("a dangling staged-only anchor refuses staging (R10) and still every immediate write", async () => {
    await putAnchor("agent-s", { entity: { type: "task", id: e.T2a } });
    const { cs } = await startWithTask(S);
    expect((await rest("DELETE", `${ALL}/entities/task/${e.T2a}`)).status).toBe(204);
    const staged = await rest("PATCH", `${S}/changesets/${cs}/entities/person/${e.Kim}`, { name: "Kim2" });
    expect(staged.status).toBe(409);
    expect(staged.body.error.message).toMatch(/is dangling/);
    const immediate = await rest("PATCH", `${S}/entities/person/${e.Kim}`, { name: "Kim2" });
    expect(immediate.status).toBe(409);
    expect(immediate.body.error.message).toBe(STAGED_ONLY("agent-s"));
    expect((await rest("DELETE", `${S}/changesets/${cs}/writes/1`)).status).toBe(204);
  });
});

describe("an unanchored staged-only key", () => {
  const U = `${ALL}/anchors/agent-u`;
  beforeEach(async () => {
    await putAnchor("agent-u", { entity: null, stagedOnly: true });
  });

  it("refuses immediate writes and the commit, and stages with no coverage rules", async () => {
    for (const [method, url, payload] of immediateWrites(U)) {
      const res = await rest(method, url, payload);
      expect(res.status, `${method} ${url}`).toBe(409);
      expect(res.body.error.message).toBe(STAGED_ONLY("agent-u"));
    }
    const { cs } = await startWithTask(U);
    // Under P2 and P3: no anchored entity to hold them to.
    for (const parent of [e.P2, e.P3]) {
      const staged = await rest("POST", `${U}/changesets/${cs}/entities/task`, {
        name: "Free",
        parentRelation: { type: "has_task", parentId: parent, properties: { phase: "build" } },
      });
      expect(staged.status).toBe(202);
    }
    expect((await rest("POST", `${U}/changesets/${cs}/commit`, {})).body.error.message).toBe(NO_COMMIT("agent-u"));
    expect((await rest("POST", `${U}/changesets/${cs}/submit`, {})).status).toBe(200);
    const committed = await rest("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body.committed).toBe(3);
  });
});

describe("the staged-only MCP tool set (V29, R13)", () => {
  beforeEach(async () => {
    await putAnchor("agent-s", { entity: { type: "project", id: e.P1 }, stagedOnly: true });
  });

  it("tools/list: the six write tools require changeset_id; no commit_changeset, edit_document or write_document", async () => {
    const { tools } = await (await connect("agent-s")).listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.inputSchema as { required?: string[] }]));
    for (const name of STAGEABLE) expect(byName.get(name)?.required, name).toContain("changeset_id");
    for (const name of ["commit_changeset", "edit_document", "write_document"]) expect(byName.has(name), name).toBe(false);
    for (const name of ["start_changeset", "list_changesets", "get_changeset", "unstage", "submit_changeset", "unsubmit_changeset", "discard_changeset", "get_anchor"]) {
      expect(byName.has(name), name).toBe(true);
    }
    for (const tool of tools) expect((tool.description ?? "").length, tool.name).toBeLessThanOrEqual(2000);
  });

  it("a write without changeset_id is an error; staging, submit, unsubmit, discard, list and reads work", async () => {
    const client = await connect("agent-s");
    const immediate = await call(client, "update_entity", { entity_type_key: "task", entity_id: e.T1, properties: { name: "T1x" } });
    expect(immediate.isError).toBe(true);
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}`)).body.name).toBe("T1");

    const cs = (await ok(client, "start_changeset", { note: "plan" })).id as string;
    const staged = await ok(client, "update_entity", {
      entity_type_key: "task",
      entity_id: e.T1,
      properties: { name: "T1x" },
      changeset_id: cs,
    });
    expect(staged.seq).toBeGreaterThan(0);
    expect((await ok(client, "list_changesets")).map((c: Row) => c.id)).toEqual([cs]);
    expect((await ok(client, "get_changeset", { changeset_id: cs })).writeCount).toBe(1);
    expect((await ok(client, "get_entity", { entity_type_key: "task", entity_id: e.T1 })).name).toBe("T1");
    expect((await ok(client, "submit_changeset", { changeset_id: cs })).state).toBe("submitted");
    expect((await ok(client, "unsubmit_changeset", { changeset_id: cs, note: "again" })).state).toBe("draft");
    expect((await ok(client, "discard_changeset", { changeset_id: cs })).message).toContain("discarded");
  });

  it("the flag is read on every request: lifted, the normal tool set is back", async () => {
    await putAnchor("agent-s", { entity: { type: "project", id: e.P1 }, stagedOnly: false });
    const { tools } = await (await connect("agent-s")).listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of ["commit_changeset", "edit_document", "write_document"]) expect(names, name).toContain(name);
    const update = tools.find((tool) => tool.name === "update_entity")!.inputSchema as { required?: string[] };
    expect(update.required ?? []).not.toContain("changeset_id");
  });

  it("an unknown anchor keeps the normal tool set, and every call answers not found", async () => {
    const client = await connect("nope");
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("commit_changeset");
    const result = await call(client, "get_anchor");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Anchor 'nope' not found");
  });
});
