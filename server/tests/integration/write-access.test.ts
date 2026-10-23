/**
 * Write access over REST and MCP, on PostgreSQL with the in-test project
 * hierarchy (`buildProjectHierarchy`, fresh per test): reported by the
 * ruleset reads; through a 'propose' ruleset's URL every immediate write
 * and the commit are 409s while staging, the check, submit, unsubmit,
 * discard, the list and reads work; the same on a ruleset without an anchor, with no
 * coverage rules; a deleted anchor, or one the lens hides, still refuses
 * staging, and write access wins over both; the escapes (the plain lens
 * URL commits, the PUT gives full access back); through a 'none'
 * ruleset's URL every write, stage and commit route is a 409 and every
 * read answers, the changeset reads included; and the MCP tool list at
 * 'propose' and 'none', with every refused call answering the
 * write access refusal, also for a tool the client's older list still
 * shows.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import { ROUTES } from "../../src/runtime/writeAccess.js";
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
const RULESETS = `/api/ontologies/${O}/runtime/rulesets`;
const NO_WRITE = (key: string) =>
  `Ruleset '${key}' gives write access 'propose': this connection cannot write directly; stage the write into a changeset`;
const NO_COMMIT = (key: string) =>
  `Ruleset '${key}' gives write access 'propose': this connection cannot commit; submit the changeset, and a person commits it`;
const ONLY_READ = (key: string, verb: string) =>
  `Ruleset '${key}' gives write access 'none': this connection cannot ${verb}; it can only read`;
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

let app: FastifyInstance;
let baseUrl: string;
let h: ProjectHierarchyIds;
let e: ProjectHierarchyIds["entities"];
const clients: Client[] = [];

async function rest(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function putRuleset(key: string, payload: Row): Promise<Row> {
  const res = await rest("PUT", `${RULESETS}/${key}`, payload);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function connect(rulesetKey: string): Promise<Client> {
  const path = `/mcp/ontologies/${O}/runtime/lenses/all/rulesets/${rulesetKey}`;
  const client = new Client({ name: "write-access-tests", version: "0.0.1" });
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

/** The body of a staged create of a task under `parentId`. */
function taskUnder(parentId: string, name: string): Row {
  return {
    operation: "create_entity",
    type: "task",
    properties: { name },
    parentRelation: { type: "has_task", parentId, properties: { phase: "build" } },
  };
}

/** Start a changeset through `base` and stage a task under P1 into it:
 * two objects, the task and its parent relation. */
async function startWithTask(base: string, name = "T9"): Promise<{ cs: string; task: string }> {
  const started = await rest("POST", `${base}/changesets`, {});
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const cs = started.body.id as string;
  const staged = await rest("POST", `${base}/changesets/${cs}/writes`, taskUnder(e.P1, name));
  expect(staged.status, JSON.stringify(staged.body)).toBe(201);
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

describe("the level on the ruleset reads", () => {
  it("the GET, the list, the mount root and get_ruleset report it", async () => {
    await putRuleset("agent-s", { anchor: { type: "project", id: e.P1 }, writeAccess: "propose" });
    await putRuleset("agent-a", { anchor: { type: "project", id: e.P1 } });
    await putRuleset("agent-n", { writeAccess: "none" });
    expect((await rest("GET", `${RULESETS}/agent-s`)).body.writeAccess).toBe("propose");
    expect((await rest("GET", RULESETS)).body.map((r: Row) => [r.key, r.writeAccess])).toEqual([
      ["agent-a", "full"],
      ["agent-n", "none"],
      ["agent-s", "propose"],
    ]);
    expect((await rest("GET", `${ALL}/rulesets/agent-s`)).body).toMatchObject({
      key: "agent-s",
      writeAccess: "propose",
      anchor: { state: "found" },
    });
    expect((await rest("GET", `${ALL}/rulesets/agent-a`)).body.writeAccess).toBe("full");
    expect((await rest("GET", `${ALL}/rulesets/agent-n`)).body).toEqual({ key: "agent-n", writeAccess: "none", anchor: null });
    expect(await ok(await connect("agent-s"), "get_ruleset")).toMatchObject({ writeAccess: "propose", anchor: { state: "found" } });
    expect((await ok(await connect("agent-a"), "get_ruleset")).writeAccess).toBe("full");
  });
});

describe("through a 'propose' ruleset's URL (REST)", () => {
  const S = `${ALL}/rulesets/agent-s`;
  beforeEach(async () => {
    await putRuleset("agent-s", { anchor: { type: "project", id: e.P1 }, writeAccess: "propose" });
  });

  it("every immediate write answers 409, and nothing is written", async () => {
    for (const [method, url, payload] of immediateWrites(S)) {
      const res = await rest(method, url, payload);
      expect(res.status, `${method} ${url}`).toBe(409);
      expect(res.body.error.message).toBe(NO_WRITE("agent-s"));
    }
    const t1 = (await rest("GET", `${ALL}/entities/task/${e.T1}`)).body;
    expect(t1.name).toBe("T1");
    expect((await rest("GET", `${ALL}/entities/task/${e.T1a1}`)).status).toBe(200);
    expect((await rest("GET", `${ALL}/relations/assigned_to/${h.relations["T1 assigned_to Ben"]!}`)).status).toBe(200);
  });

  it("stage, unstage, cut, rebase, list, read, check, submit, unsubmit and discard work; the commit answers 409", async () => {
    const { cs } = await startWithTask(S);
    const update = await rest("POST", `${S}/changesets/${cs}/writes`, {
      operation: "update_entity",
      type: "project",
      id: e.P2,
      properties: { name: "P2 Website" },
    });
    expect(update).toEqual({ status: 201, body: { id: e.P2 } });
    expect((await rest("POST", `${S}/changesets/${cs}/objects/${e.P2}/rebase`, {})).status).toBe(200);
    expect((await rest("DELETE", `${S}/changesets/${cs}/objects/${e.P2}/properties/name`)).status).toBe(204);
    await rest("POST", `${S}/changesets/${cs}/writes`, { operation: "delete_entity", type: "person", id: e.Kim });
    expect((await rest("DELETE", `${S}/changesets/${cs}/objects/${e.Kim}`)).status).toBe(204);
    expect((await rest("GET", `${S}/changesets`)).body.map((c: Row) => c.id)).toEqual([cs]);
    const read = await rest("GET", `${S}/changesets/${cs}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ ruleset: "agent-s", objectCount: 2 });
    expect((await rest("GET", `${S}/entities/task`)).status).toBe(200);
    expect(await rest("POST", `${S}/changesets/${cs}/check`)).toEqual({
      status: 200,
      body: { version: read.body.version, committed: 2, alreadyGone: [] },
    });

    const commit = await rest("POST", `${S}/changesets/${cs}/commit`, {});
    expect(commit.status).toBe(409);
    expect(commit.body.error.message).toBe(NO_COMMIT("agent-s"));

    expect((await rest("POST", `${S}/changesets/${cs}/submit`, { note: "please review" })).body.state).toBe("submitted");
    const submittedCommit = await rest("POST", `${S}/changesets/${cs}/commit`, { expectedVersion: 1 });
    expect(submittedCommit.status).toBe(409);
    expect(submittedCommit.body.error.message).toBe(NO_COMMIT("agent-s"));
    expect(await rest("POST", `${S}/changesets/${cs}/check`)).toMatchObject({ status: 200, body: { committed: 2 } });
    expect((await rest("POST", `${S}/changesets/${cs}/unsubmit`, { note: "fix it" })).body.state).toBe("draft");
    expect((await rest("DELETE", `${S}/changesets/${cs}`)).status).toBe(204);
    expect((await rest("GET", `${S}/changesets/${cs}`)).status).toBe(404);
  });

  it("write access refuses before the changeset lookup: an unknown changeset's commit is its 409", async () => {
    const commit = await rest("POST", `${S}/changesets/00000000-0000-4000-8000-000000000000/commit`, {});
    expect(commit.status).toBe(409);
    expect(commit.body.error.message).toBe(NO_COMMIT("agent-s"));
    expect((await rest("POST", `${ALL}/changesets/00000000-0000-4000-8000-000000000000/commit`, {})).status).toBe(404);
  });

  it("the escapes: the plain lens URL commits it, and a PUT back to full access restores immediate writes", async () => {
    const { cs, task } = await startWithTask(S);
    expect((await rest("POST", `${S}/changesets/${cs}/submit`, {})).status).toBe(200);
    const committed = await rest("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body).toEqual({ committed: 2, alreadyGone: [] });
    expect((await rest("GET", `${ALL}/entities/task/${task}`)).body.name).toBe("T9");

    expect((await putRuleset("agent-s", { anchor: { type: "project", id: e.P1 }, writeAccess: "full" })).writeAccess).toBe("full");
    const renamed = await rest("PATCH", `${S}/entities/task/${e.T1}`, { name: "T1 renamed" });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.name).toBe("T1 renamed");
    const { cs: again } = await startWithTask(S, "T10");
    expect((await rest("POST", `${S}/changesets/${again}/commit`, {})).status).toBe(200);
  });

  it("a deleted anchor refuses staging (R10); write access refuses every immediate write first", async () => {
    await putRuleset("agent-s", { anchor: { type: "task", id: e.T2a } });
    const { cs, task } = await startWithTask(S);
    expect((await rest("DELETE", `${ALL}/entities/task/${e.T2a}`)).status).toBe(204);
    const staged = await rest("POST", `${S}/changesets/${cs}/writes`, {
      operation: "update_entity",
      type: "person",
      id: e.Kim,
      properties: { name: "Kim2" },
    });
    expect(staged.status).toBe(409);
    expect(staged.body.error.message).toMatch(/no longer exists/);
    const immediate = await rest("PATCH", `${S}/entities/person/${e.Kim}`, { name: "Kim2" });
    expect(immediate.status).toBe(409);
    expect(immediate.body.error.message).toBe(NO_WRITE("agent-s"));
    expect((await rest("DELETE", `${S}/changesets/${cs}/objects/${task}`)).status).toBe(204);
  });

  it("an anchor the lens hides refuses staging; write access refuses every immediate write first", async () => {
    const H = `${runtimePrefix(O, "no_projects")}/rulesets/agent-s`;
    const started = await rest("POST", `${H}/changesets`, {});
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const staged = await rest("POST", `${H}/changesets/${started.body.id as string}/writes`, {
      operation: "update_entity",
      type: "task",
      id: e.T1,
      properties: { name: "T1x" },
    });
    expect(staged.status).toBe(409);
    expect(staged.body.error.message).toBe("The anchor of ruleset 'agent-s' is an entity that lens 'no_projects' does not show");
    const immediate = await rest("PATCH", `${H}/entities/task/${e.T1}`, { name: "T1x" });
    expect(immediate.status).toBe(409);
    expect(immediate.body.error.message).toBe(NO_WRITE("agent-s"));
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}`)).body.name).toBe("T1");
  });
});

describe("a 'propose' ruleset without an anchor", () => {
  const U = `${ALL}/rulesets/agent-u`;
  beforeEach(async () => {
    await putRuleset("agent-u", { anchor: null, writeAccess: "propose" });
  });

  it("refuses immediate writes and the commit, and stages with no coverage rules", async () => {
    for (const [method, url, payload] of immediateWrites(U)) {
      const res = await rest(method, url, payload);
      expect(res.status, `${method} ${url}`).toBe(409);
      expect(res.body.error.message).toBe(NO_WRITE("agent-u"));
    }
    const { cs } = await startWithTask(U);
    // Under P2 and P3: no anchored entity to hold them to.
    for (const parent of [e.P2, e.P3]) {
      const staged = await rest("POST", `${U}/changesets/${cs}/writes`, taskUnder(parent, "Free"));
      expect(staged.status).toBe(201);
    }
    expect((await rest("POST", `${U}/changesets/${cs}/commit`, {})).body.error.message).toBe(NO_COMMIT("agent-u"));
    expect((await rest("POST", `${U}/changesets/${cs}/submit`, {})).status).toBe(200);
    const committed = await rest("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body.committed).toBe(6);
  });
});

describe("through a 'none' ruleset's URL (REST)", () => {
  const N = `${ALL}/rulesets/agent-n`;
  let cs: string;
  let task: string;
  beforeEach(async () => {
    // A changeset with a staged task and staged notes of T1, started while
    // the level was full.
    await putRuleset("agent-n", { anchor: { type: "project", id: e.P1 } });
    ({ cs, task } = await startWithTask(N));
    const notes = { operation: "update_entity", type: "task", id: e.T1, properties: { notes: "Staged notes" } };
    expect((await rest("POST", `${N}/changesets/${cs}/writes`, notes)).status).toBe(201);
    await putRuleset("agent-n", { writeAccess: "none" });
  });

  /** One request per mirror route, on the hierarchy's data. */
  function requests(): [string, string, Row?][] {
    const C = `/changesets/${cs}`;
    const hasTask = h.relations["P1 has_task T1"]!;
    const assigned = h.relations["T1 assigned_to Ben"]!;
    return [
      ["GET /", ""],
      ["GET /schema", "/schema"],
      ["GET /schema/entity-types", "/schema/entity-types"],
      ["GET /schema/entity-types/:key", "/schema/entity-types/task"],
      ["GET /schema/relation-types", "/schema/relation-types"],
      ["GET /schema/relation-types/:key", "/schema/relation-types/has_task"],
      ["GET /search", "/search?q=T1"],
      ["GET /search-indices", "/search-indices"],
      ["POST /search", "/search", { query: "T1" }],
      ["POST /entities/:entityTypeKey", "/entities/person", { name: "Ann" }],
      ["GET /entities/:entityTypeKey", "/entities/task"],
      ["GET /entities/:entityTypeKey/:entityId", `/entities/task/${e.T1}`],
      ["PATCH /entities/:entityTypeKey/:entityId", `/entities/task/${e.T1}`, { name: "T1 renamed" }],
      ["DELETE /entities/:entityTypeKey/:entityId", `/entities/task/${e.T1a1}`],
      ["GET /entities/:entityTypeKey/:entityId/path", `/entities/task/${e.T1}/path`],
      ["GET /entities/:entityTypeKey/:entityId/documents/:propertyKey", `/entities/task/${e.T1}/documents/notes`],
      [
        "PATCH /entities/:entityTypeKey/:entityId/documents/:propertyKey",
        `/entities/task/${e.T1}/documents/notes`,
        { op: "str_replace", oldString: "Notes", newString: "Text" },
      ],
      ["GET /entities/:entityTypeKey/:entityId/neighbors", `/entities/task/${e.T1}/neighbors`],
      ["POST /query", "/query", { query: "MATCH (t:task) RETURN t" }],
      ["GET /saved-queries", "/saved-queries"],
      ["GET /saved-queries/search", "/saved-queries/search?q=task"],
      ["POST /saved-queries/:queryKey/run", "/saved-queries/q1/run", {}],
      ["POST /relations/:relationTypeKey", "/relations/assigned_to", { fromEntityId: e.T2, toEntityId: e.Kim }],
      ["GET /relations/:relationTypeKey", "/relations/has_task"],
      ["GET /relations/:relationTypeKey/:relationId", `/relations/has_task/${hasTask}`],
      ["PATCH /relations/:relationTypeKey/:relationId", `/relations/has_task/${hasTask}`, { phase: "test" }],
      ["DELETE /relations/:relationTypeKey/:relationId", `/relations/assigned_to/${assigned}`],
      ["POST /changesets", "/changesets", {}],
      ["GET /changesets", "/changesets"],
      ["GET /changesets/:changesetId", C],
      ["GET /changesets/:changesetId/documents/:entityTypeKey/:entityId/:propertyKey", `${C}/documents/task/${e.T1}/notes`],
      ["GET /changesets/:changesetId/entities/:entityTypeKey/:entityId", `${C}/entities/task/${task}`],
      ["DELETE /changesets/:changesetId", C],
      ["POST /changesets/:changesetId/writes", `${C}/writes`, taskUnder(e.P1, "T10")],
      ["DELETE /changesets/:changesetId/objects/:objectId", `${C}/objects/${task}`],
      ["DELETE /changesets/:changesetId/objects/:objectId/properties/:propertyKey", `${C}/objects/${e.T1}/properties/notes`],
      ["POST /changesets/:changesetId/objects/:objectId/rebase", `${C}/objects/${e.T1}/rebase`, {}],
      ["POST /changesets/:changesetId/submit", `${C}/submit`, {}],
      ["POST /changesets/:changesetId/unsubmit", `${C}/unsubmit`, { note: "again" }],
      ["POST /changesets/:changesetId/check", `${C}/check`],
      ["POST /changesets/:changesetId/commit", `${C}/commit`, {}],
    ];
  }

  /** The reads this test server cannot serve: no saved query, no
   * embedding provider for the semantic saved-query search. */
  const UNSERVED: Record<string, number> = {
    "GET /saved-queries/search": 422,
    "POST /saved-queries/:queryKey/run": 404,
  };
  const VERBS = { write: "write directly", stage: "start or change a changeset", commit: "commit" } as const;

  it("refuses the 7 writes, the 9 stage routes and the commit with 409; the 24 reads answer", async () => {
    const all = requests();
    expect(all.map(([route]) => route).sort()).toEqual(Object.keys(ROUTES).sort());
    const refused: string[] = [];
    for (const [route, path, payload] of all) {
      const res = await rest(route.split(" ")[0]!, `${N}${path}`, payload);
      const operation = ROUTES[route]!;
      if (operation === "read") {
        expect(res.status, `${route} ${JSON.stringify(res.body)}`).toBe(UNSERVED[route] ?? 200);
      } else {
        expect(res.status, route).toBe(409);
        expect(res.body.error.message, route).toBe(ONLY_READ("agent-n", VERBS[operation]));
        refused.push(route);
      }
    }
    expect(refused).toHaveLength(17);
    expect(all.length - refused.length).toBe(24);
    // Nothing written, nothing staged, nothing started.
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}`)).body.name).toBe("T1");
    expect((await rest("GET", `${ALL}/entities/task/${e.T1a1}`)).status).toBe(200);
    expect((await rest("GET", `${ALL}/entities/person`)).body.items.map((p: Row) => p.name)).not.toContain("Ann");
    expect((await rest("GET", `${N}/changesets`)).body.map((c: Row) => [c.id, c.state, c.objectCount])).toEqual([
      [cs, "draft", 3],
    ]);
  });

  it("the staged entity read answers the staged task", async () => {
    const res = await rest("GET", `${N}/changesets/${cs}/entities/task/${task}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ deleted: false, entity: { _id: task, name: "T9" } });
  });

  it("the plain lens still stages into and commits the changeset", async () => {
    expect((await rest("POST", `${ALL}/changesets/${cs}/writes`, taskUnder(e.P1, "T10"))).status).toBe(201);
    const committed = await rest("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body.committed).toBe(5);
  });
});

describe("the MCP tool set at 'propose'", () => {
  beforeEach(async () => {
    await putRuleset("agent-s", { anchor: { type: "project", id: e.P1 }, writeAccess: "propose" });
  });

  it("tools/list: the eight write tools require changeset_id; no commit_changeset", async () => {
    const { tools } = await (await connect("agent-s")).listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.inputSchema as { required?: string[] }]));
    for (const name of STAGEABLE) expect(byName.get(name)?.required, name).toContain("changeset_id");
    expect(byName.has("commit_changeset")).toBe(false);
    for (const name of ["start_changeset", "list_changesets", "get_changeset", "unstage", "rebase", "check_changeset", "submit_changeset", "unsubmit_changeset", "discard_changeset", "get_ruleset"]) {
      expect(byName.has(name), name).toBe(true);
    }
    for (const tool of tools) expect((tool.description ?? "").length, tool.name).toBeLessThanOrEqual(2000);
  });

  it("a write without changeset_id is refused; staging, check, submit, unsubmit, discard, list and reads work", async () => {
    const client = await connect("agent-s");
    const immediate = await call(client, "update_entity", { entity_type_key: "task", entity_id: e.T1, properties: { name: "T1x" } });
    expect(immediate.isError).toBe(true);
    expect(text(immediate)).toBe(`Error executing tool update_entity: ${NO_WRITE("agent-s")}`);
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}`)).body.name).toBe("T1");

    const cs = (await ok(client, "start_changeset", { note: "plan" })).id as string;
    const staged = await ok(client, "update_entity", {
      entity_type_key: "task",
      entity_id: e.T1,
      properties: { name: "T1x" },
      changeset_id: cs,
    });
    expect(staged).toEqual({ id: e.T1 });
    const edited = await ok(client, "edit_document", {
      entity_type_key: "task",
      entity_id: e.T1,
      property_key: "notes",
      old_string: "Notes",
      new_string: "Text",
      changeset_id: cs,
    });
    expect(edited).toMatchObject({ id: e.T1, totalLength: 10 });
    expect((await ok(client, "list_changesets")).map((c: Row) => c.id)).toEqual([cs]);
    expect((await ok(client, "get_changeset", { changeset_id: cs })).objectCount).toBe(1);
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}/documents/notes`)).body.content).toBe("Notes of T1");
    expect((await ok(client, "get_entity", { entity_type_key: "task", entity_id: e.T1 })).name).toBe("T1");
    const { version } = await ok(client, "get_changeset", { changeset_id: cs });
    expect(await ok(client, "check_changeset", { changeset_id: cs })).toEqual({ version, committed: 1, alreadyGone: [] });
    expect((await ok(client, "submit_changeset", { changeset_id: cs })).state).toBe("submitted");
    expect((await ok(client, "unsubmit_changeset", { changeset_id: cs, note: "again" })).state).toBe("draft");
    expect((await ok(client, "discard_changeset", { changeset_id: cs })).message).toContain("discarded");
  });

  it("write access is read on every request: back at 'full', the normal tool set is back", async () => {
    await putRuleset("agent-s", { anchor: { type: "project", id: e.P1 }, writeAccess: "full" });
    const { tools } = await (await connect("agent-s")).listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of ["commit_changeset", "edit_document", "write_document"]) expect(names, name).toContain(name);
    const update = tools.find((tool) => tool.name === "update_entity")!.inputSchema as { required?: string[] };
    expect(update.required ?? []).not.toContain("changeset_id");
  });

  it("a tool the list leaves out answers the write access refusal, not an unknown tool", async () => {
    const client = await connect("agent-s");
    const cs = (await ok(client, "start_changeset")).id as string;
    const commit = await call(client, "commit_changeset", { changeset_id: cs });
    expect(text(commit)).toBe(`Error executing tool commit_changeset: ${NO_COMMIT("agent-s")}`);
  });

  it("a level lowered after tools/list: the listed tool answers the refusal", async () => {
    await putRuleset("agent-s", { writeAccess: "full" });
    const client = await connect("agent-s");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("commit_changeset");
    const cs = (await ok(client, "start_changeset")).id as string;
    await putRuleset("agent-s", { writeAccess: "propose" });
    const commit = await call(client, "commit_changeset", { changeset_id: cs });
    expect(text(commit)).toBe(`Error executing tool commit_changeset: ${NO_COMMIT("agent-s")}`);
  });

  it("an unknown ruleset keeps the normal tool set, and every call answers not found", async () => {
    const client = await connect("nope");
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("commit_changeset");
    const result = await call(client, "get_ruleset");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Ruleset 'nope' not found");
  });
});

describe("the MCP tool set at 'none'", () => {
  let cs: string;
  beforeEach(async () => {
    // A changeset with a staged update of T1, started while the level was 'propose'.
    await putRuleset("agent-n", { anchor: { type: "project", id: e.P1 }, writeAccess: "propose" });
    const client = await connect("agent-n");
    cs = (await ok(client, "start_changeset", { note: "plan" })).id as string;
    await ok(client, "update_entity", { entity_type_key: "task", entity_id: e.T1, properties: { notes: "Staged notes" }, changeset_id: cs });
    await putRuleset("agent-n", { writeAccess: "none" });
  });

  it("tools/list: the reads, the changeset reads and get_ruleset, 20", async () => {
    const names = (await (await connect("agent-n")).listTools()).tools.map((tool) => tool.name);
    expect(names.sort()).toEqual([
      "execute_query",
      "get_changeset",
      "get_document",
      "get_entity",
      "get_neighbors",
      "get_path",
      "get_relation",
      "get_ruleset",
      "get_schema",
      "get_staged_document",
      "list_changesets",
      "list_entities",
      "list_relations",
      "list_saved_queries",
      "list_search_indices",
      "run_saved_query",
      "search",
      "search_by_index",
      "search_documents",
      "search_saved_queries",
    ]);
  });

  it("the reads and the changeset reads answer; every write, stage and commit call answers the refusal", async () => {
    const client = await connect("agent-n");
    expect((await ok(client, "get_ruleset")).writeAccess).toBe("none");
    expect((await ok(client, "get_entity", { entity_type_key: "task", entity_id: e.T1 })).name).toBe("T1");
    expect((await ok(client, "list_changesets")).map((c: Row) => c.id)).toEqual([cs]);
    expect((await ok(client, "get_changeset", { changeset_id: cs })).objectCount).toBe(1);
    const staged = await ok(client, "get_staged_document", {
      changeset_id: cs,
      entity_type_key: "task",
      entity_id: e.T1,
      property_key: "notes",
    });
    expect(staged.content).toBe("Staged notes");
    for (const [name, args, verb] of [
      ["create_entity", { entity_type_key: "person", properties: { name: "Ann" } }, "write directly"],
      ["update_entity", { entity_type_key: "task", entity_id: e.T1, properties: { name: "T1x" } }, "write directly"],
      ["write_document", { entity_type_key: "task", entity_id: e.T1, property_key: "notes", offset: 0, length: 0, content: "x" }, "write directly"],
      ["update_entity", { entity_type_key: "task", entity_id: e.T1, properties: { name: "T1x" }, changeset_id: cs }, "start or change a changeset"],
      ["edit_document", { entity_type_key: "task", entity_id: e.T1, property_key: "notes", old_string: "N", new_string: "M", changeset_id: cs }, "start or change a changeset"],
      ["unstage", { changeset_id: cs, object_id: e.T1 }, "start or change a changeset"],
      ["rebase", { changeset_id: cs, object_id: e.T1 }, "start or change a changeset"],
      ["start_changeset", {}, "start or change a changeset"],
      ["submit_changeset", { changeset_id: cs }, "start or change a changeset"],
      ["check_changeset", { changeset_id: cs }, "start or change a changeset"],
      ["discard_changeset", { changeset_id: cs }, "start or change a changeset"],
      ["commit_changeset", { changeset_id: cs }, "commit"],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.isError, name).toBe(true);
      expect(text(result), name).toBe(`Error executing tool ${name}: ${ONLY_READ("agent-n", verb)}`);
    }
    // Nothing written, nothing staged.
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}`)).body.name).toBe("T1");
    expect((await rest("GET", `${ALL}/entities/person`)).body.items.map((p: Row) => p.name)).not.toContain("Ann");
    expect((await ok(client, "get_changeset", { changeset_id: cs })).objectCount).toBe(1);
  });
});
