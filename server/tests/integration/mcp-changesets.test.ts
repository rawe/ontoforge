/**
 * Changesets over the runtime MCP server, with the official SDK client on a
 * real listening server and the in-test project hierarchy
 * (`buildProjectHierarchy`, rebuilt fresh per group): the tool surface, a
 * whole round through the tools alone (start, stage, read, submit,
 * unsubmit, unstage, cut, commit, discard) with the same answers and
 * errors as REST, the byte cap among them, a drift fixed by rebase, a
 * write without `changeset_id` staying immediate, and the ruleset mount's
 * binding: a changeset carries its ruleset, another ruleset does not reach
 * it, and the commit keeps it in the anchor's subtree. `edit_document` and
 * `write_document` stage with a `changeset_id`; REST stages them as the
 * `edit_document` operation, and mounts no document edit route under a
 * changeset.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
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
const RULESETS = `/api/ontologies/${O}/runtime/rulesets`;
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

let app: FastifyInstance;
let baseUrl: string;
let h: ProjectHierarchyIds;
let e: ProjectHierarchyIds["entities"];
const clients: Client[] = [];

async function connect(rulesetKey: string | null = null): Promise<Client> {
  const path = `/mcp/ontologies/${O}/runtime/lenses/all${rulesetKey === null ? "" : `/rulesets/${rulesetKey}`}`;
  const client = new Client({ name: "mcp-changesets-tests", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}${path}`)));
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Row = {}): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;
}

function text(result: ToolCallResult): string {
  return result.content[0]?.text ?? "";
}

/** The JSON answer of a successful call. */
async function ok(client: Client, name: string, args: Row = {}): Promise<any> {
  const result = await call(client, name, args);
  expect(result.isError, text(result)).toBeFalsy();
  return JSON.parse(text(result));
}

/** The error text of a refused call. */
async function refused(client: Client, name: string, args: Row = {}): Promise<string> {
  const result = await call(client, name, args);
  expect(result.isError, text(result)).toBe(true);
  return text(result);
}

async function rest(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function fresh(): Promise<void> {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  invalidateSearchContext();
  h = await buildProjectHierarchy(app);
  e = h.entities;
}

async function pointAnchor(key: string, type: string, id: string): Promise<void> {
  const res = await rest("PUT", `${RULESETS}/${key}`, { anchor: { type, id } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  await initStores();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("the tool surface", () => {
  beforeAll(fresh, 60_000);

  it("lists the ten changeset tools and an optional changeset_id on the eight stageable tools", async () => {
    for (const rulesetKey of [null, "agent-a"]) {
      if (rulesetKey !== null) await pointAnchor(rulesetKey, "project", e.P1);
      const { tools } = await (await connect(rulesetKey)).listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool.inputSchema as { properties?: Row; required?: string[] }]));
      for (const name of CHANGESET_TOOLS) expect(byName.has(name), name).toBe(true);
      for (const name of STAGEABLE) {
        expect(byName.get(name)!.properties, name).toHaveProperty("changeset_id");
        expect(byName.get(name)!.required ?? [], name).not.toContain("changeset_id");
      }
      // No other tool takes one: the changeset tools name theirs, as required.
      for (const [name, schema] of byName) {
        if (STAGEABLE.includes(name)) continue;
        if (CHANGESET_TOOLS.includes(name) && name !== "start_changeset" && name !== "list_changesets") {
          expect(schema.required, name).toContain("changeset_id");
        } else {
          expect(schema.properties ?? {}, name).not.toHaveProperty("changeset_id");
        }
      }
      expect(byName.get("unsubmit_changeset")!.required).toEqual(["changeset_id", "note"]);
      expect(byName.get("unstage")!.required).toEqual(["changeset_id", "object_id"]);
      expect(byName.get("rebase")!.required).toEqual(["changeset_id", "object_id"]);
      for (const tool of tools) expect((tool.description ?? "").length, tool.name).toBeLessThanOrEqual(2000);
    }
  });
});

describe("a whole round through MCP alone", () => {
  beforeAll(fresh, 60_000);

  it("starts, stages, reads, submits, unsubmits, unstages, cuts and commits, as REST does", async () => {
    const client = await connect();
    const started = await ok(client, "start_changeset", { note: "g12" });
    expect(started).toMatchObject({ state: "draft", version: 1, note: "g12", ruleset: null, objectCount: 0 });
    const cs = started.id as string;

    const t9 = await ok(client, "create_entity", {
      entity_type_key: "task",
      properties: { name: "T9" },
      parent_relation: { type: "has_task", parent_id: e.P1, properties: { phase: "build" } },
      changeset_id: cs,
    });
    // With a parent relation: two objects, the entity and the relation.
    expect(t9).toEqual({ id: expect.any(String), relation: { id: expect.any(String) } });
    // Reads never see staged data.
    expect(await refused(client, "get_entity", { entity_type_key: "task", entity_id: t9.id })).toContain("not found");

    // A staged create's id is final: later calls name it, and merge into it.
    expect(
      await ok(client, "update_entity", { entity_type_key: "task", entity_id: t9.id, properties: { name: "T9b" }, changeset_id: cs }),
    ).toEqual({ id: t9.id });
    await ok(client, "update_entity", { entity_type_key: "project", entity_id: e.P2, properties: { name: "P2 Website" }, changeset_id: cs });
    await ok(client, "delete_entity", { entity_type_key: "task", entity_id: e.T4, changeset_id: cs });
    const assigned = await ok(client, "create_relation", {
      relation_type_key: "assigned_to",
      from_entity_id: e.T1,
      to_entity_id: e.Kim,
      changeset_id: cs,
    });
    await ok(client, "update_relation", {
      relation_type_key: "has_task",
      relation_id: h.relations["P1 has_task T2"],
      properties: { phase: "test" },
      changeset_id: cs,
    });
    const mentors = await ok(client, "delete_relation", {
      relation_type_key: "mentors",
      relation_id: h.relations["Ben mentors Kim"],
      changeset_id: cs,
    });
    expect(mentors).toEqual({ id: h.relations["Ben mentors Kim"] });
    await ok(client, "update_entity", { entity_type_key: "project", entity_id: e.P3, properties: { name: "P3 x" }, changeset_id: cs });

    // The read and the list are REST's, field for field.
    const read = await ok(client, "get_changeset", { changeset_id: cs });
    expect(read).toEqual((await rest("GET", `${ALL}/changesets/${cs}`)).body);
    expect(read.objects.map((o: Row) => [o.id, o.action, o.type])).toEqual([
      [t9.id, "create", "task"],
      [t9.relation.id, "create", "has_task"],
      [e.P2, "update", "project"],
      [e.T4, "delete", "task"],
      [assigned.id, "create", "assigned_to"],
      [h.relations["P1 has_task T2"], "update", "has_task"],
      [h.relations["Ben mentors Kim"], "delete", "mentors"],
      [e.P3, "update", "project"],
    ]);
    expect(read.objects[0].values).toEqual([{ property: "name", before: null, current: null, after: "T9b", markers: [] }]);
    expect(read.objects[1]).toMatchObject({
      from: { id: e.P1, name: "P1" },
      to: { id: t9.id, name: "T9b" },
      values: [{ property: "phase", after: "build" }],
    });
    expect(read.objects[2]).toMatchObject({ values: [{ property: "name", before: "P2", current: "P2", after: "P2 Website", markers: [] }], markers: [] });
    const page = await ok(client, "get_changeset", { changeset_id: cs, offset: 6, limit: 1000 });
    expect(page).toMatchObject({ offset: 6, limit: 500 });
    expect(page.objects.map((o: Row) => o.id)).toEqual([h.relations["Ben mentors Kim"], e.P3]);
    expect(await ok(client, "list_changesets")).toEqual((await rest("GET", `${ALL}/changesets`)).body);

    // Submit freezes it.
    const submitted = await ok(client, "submit_changeset", { changeset_id: cs, note: "please review" });
    expect(submitted).toMatchObject({ state: "submitted", note: "please review", version: read.version + 1 });
    const frozen = `Changeset '${cs}' is submitted; unsubmit it first`;
    expect(
      await refused(client, "update_entity", { entity_type_key: "project", entity_id: e.P1, properties: { name: "x" }, changeset_id: cs }),
    ).toContain(frozen);
    expect(await refused(client, "unstage", { changeset_id: cs, object_id: e.P3 })).toContain(frozen);
    expect(await refused(client, "rebase", { changeset_id: cs, object_id: e.P3 })).toContain(frozen);
    expect(await refused(client, "discard_changeset", { changeset_id: cs })).toContain(frozen);
    expect(await refused(client, "commit_changeset", { changeset_id: cs, expected_version: submitted.version - 1 })).toContain(
      `Changeset '${cs}' changed since you looked: version ${submitted.version}, not ${submitted.version - 1}`,
    );

    // Unsubmit needs a note.
    expect(await refused(client, "unsubmit_changeset", { changeset_id: cs, note: "  " })).toContain("A note is required to unsubmit");
    expect(await refused(client, "unsubmit_changeset", { changeset_id: cs })).toContain("Invalid arguments");
    const draft = await ok(client, "unsubmit_changeset", { changeset_id: cs, note: "keep the mentoring" });
    expect(draft).toMatchObject({ state: "draft", note: "keep the mentoring", submittedAt: null, version: submitted.version + 1 });

    const link = h.relations["Ben mentors Kim"];
    expect(await ok(client, "unstage", { changeset_id: cs, object_id: link })).toEqual({
      message: `Staged object '${link}' removed from changeset '${cs}'.`,
    });
    expect(await refused(client, "unstage", { changeset_id: cs, object_id: link })).toContain(
      `Object '${link}' is not staged in changeset '${cs}'`,
    );
    // A cut: one value out; the update left without values goes too.
    expect(await ok(client, "unstage", { changeset_id: cs, object_id: e.P3, property: "name" })).toEqual({
      message: `Staged value 'name' of '${e.P3}' removed from changeset '${cs}'.`,
    });
    expect((await ok(client, "get_changeset", { changeset_id: cs })).objectCount).toBe(6);

    const again = await ok(client, "submit_changeset", { changeset_id: cs });
    expect(again).toMatchObject({ state: "submitted", note: "keep the mentoring" });
    expect(await ok(client, "commit_changeset", { changeset_id: cs, expected_version: again.version })).toEqual({
      committed: 6,
      alreadyGone: [],
    });

    // Persisted, and the changeset is gone.
    const task = await ok(client, "get_entity", { entity_type_key: "task", entity_id: t9.id });
    expect(task.name).toBe("T9b");
    expect((await ok(client, "get_path", { entity_type_key: "task", entity_id: t9.id })).map((p: Row) => p.name)).toEqual([
      "ACME",
      "P1",
      "T9b",
    ]);
    expect((await ok(client, "get_entity", { entity_type_key: "project", entity_id: e.P2 })).name).toBe("P2 Website");
    expect((await ok(client, "get_entity", { entity_type_key: "project", entity_id: e.P3 })).name).toBe("P3");
    expect(await refused(client, "get_entity", { entity_type_key: "task", entity_id: e.T4 })).toContain("not found");
    const assignedNow = await ok(client, "list_relations", { relation_type_key: "assigned_to", from_entity_id: e.T1 });
    expect(assignedNow.items.map((r: Row) => r.toEntityId).sort()).toEqual([e.Ben, e.Kim].sort());
    expect(
      (await ok(client, "get_relation", { relation_type_key: "has_task", relation_id: h.relations["P1 has_task T2"] })).phase,
    ).toBe("test");
    expect(await ok(client, "get_relation", { relation_type_key: "mentors", relation_id: link })).toMatchObject({ _id: link });
    expect(await refused(client, "get_changeset", { changeset_id: cs })).toContain(`Changeset '${cs}' not found`);
    expect(await ok(client, "list_changesets")).toEqual([]);
  });

  it("drift: the commit refuses; rebase accepts the stored value now and keeps the staged one; then it commits", async () => {
    const client = await connect();
    const cs = (await ok(client, "start_changeset")).id as string;
    await ok(client, "update_entity", { entity_type_key: "person", entity_id: e.Ana, properties: { name: "Ana W" }, changeset_id: cs });
    expect((await rest("PATCH", `${ALL}/entities/person/${e.Ana}`, { name: "Ana M" })).status).toBe(200);
    expect(await refused(client, "commit_changeset", { changeset_id: cs })).toContain(
      `1 violation: object ${e.Ana} property name drift: Changed since it was staged`,
    );
    expect(await ok(client, "rebase", { changeset_id: cs, object_id: e.Ana, properties: ["name"] })).toMatchObject({
      id: e.Ana,
      action: "update",
      values: [{ property: "name", before: "Ana M", current: "Ana M", after: "Ana W", markers: [] }],
    });
    expect(await refused(client, "rebase", { changeset_id: cs, object_id: e.Ana, properties: ["email"] })).toContain(
      `No value of 'email' is staged for object '${e.Ana}' in changeset '${cs}'`,
    );
    expect(await ok(client, "commit_changeset", { changeset_id: cs })).toEqual({ committed: 1, alreadyGone: [] });
    expect((await ok(client, "get_entity", { entity_type_key: "person", entity_id: e.Ana })).name).toBe("Ana W");
  });
});

describe("the errors are REST's", () => {
  beforeAll(fresh, 60_000);

  it("staging faults, a rejected commit with its violations, and discard", async () => {
    const client = await connect();
    const cs = (await ok(client, "start_changeset")).id as string;
    const unknown = "00000000-0000-4000-8000-000000000000";

    const writes = `${ALL}/changesets/${cs}/writes`;
    const missing = await rest("POST", writes, { operation: "update_entity", type: "task", id: unknown, properties: { name: "x" } });
    expect(missing.status).toBe(404);
    expect(
      await refused(client, "update_entity", { entity_type_key: "task", entity_id: unknown, properties: { name: "x" }, changeset_id: cs }),
    ).toContain(missing.body.error.message);

    const bad = await rest("POST", writes, { operation: "create_relation", type: "has_task", fromEntityId: e.P1, toEntityId: e.T1 });
    expect(bad.status).toBe(422);
    const badText = await refused(client, "create_relation", {
      relation_type_key: "has_task",
      from_entity_id: e.P1,
      to_entity_id: e.T1,
      changeset_id: cs,
    });
    expect(badText).toContain(bad.body.error.message);
    for (const field of Object.keys(bad.body.error.details.fields)) expect(badText).toContain(`${field}: `);
    expect((await ok(client, "get_changeset", { changeset_id: cs })).objectCount).toBe(0);

    // A rejected commit names its violations; nothing is persisted.
    await ok(client, "delete_entity", { entity_type_key: "project", entity_id: e.P2, changeset_id: cs });
    const before = (await ok(client, "get_changeset", { changeset_id: cs })).version;
    const rejected = await refused(client, "commit_changeset", { changeset_id: cs });
    expect(rejected).toContain(`The commit was rejected; nothing was persisted — 1 violation: object ${e.P2} has_children: `);
    expect((await ok(client, "get_entity", { entity_type_key: "project", entity_id: e.P2 })).name).toBe("P2");
    expect(await ok(client, "get_changeset", { changeset_id: cs })).toMatchObject({ state: "draft", version: before });

    expect(await refused(client, "unsubmit_changeset", { changeset_id: cs, note: "n" })).toContain(
      `Changeset '${cs}' is not submitted`,
    );
    expect(await ok(client, "discard_changeset", { changeset_id: cs })).toEqual({ message: `Changeset '${cs}' discarded.` });
    expect(await refused(client, "discard_changeset", { changeset_id: cs })).toContain(`Changeset '${cs}' not found`);
    expect((await rest("GET", `${ALL}/changesets/${cs}`)).status).toBe(404);
  });

  it("a write past the byte cap is refused as over REST", async () => {
    const cap = settings.CHANGESET_MAX_BYTES;
    settings.CHANGESET_MAX_BYTES = 100;
    try {
      const client = await connect();
      const cs = (await ok(client, "start_changeset")).id as string;
      const name = "x".repeat(200);
      const full = await rest("POST", `${ALL}/changesets/${cs}/writes`, {
        operation: "update_entity",
        type: "project",
        id: e.P1,
        properties: { name },
      });
      expect(full.status).toBe(409);
      expect(
        await refused(client, "update_entity", { entity_type_key: "project", entity_id: e.P1, properties: { name }, changeset_id: cs }),
      ).toContain(full.body.error.message);
      expect((await ok(client, "get_changeset", { changeset_id: cs })).objectCount).toBe(0);
      await ok(client, "discard_changeset", { changeset_id: cs });
    } finally {
      settings.CHANGESET_MAX_BYTES = cap;
    }
  });

  it("without changeset_id the write is immediate", async () => {
    const client = await connect();
    const updated = await ok(client, "update_entity", { entity_type_key: "project", entity_id: e.P3, properties: { name: "P3 now" } });
    expect(updated.name).toBe("P3 now");
    expect((await rest("GET", `${ALL}/entities/project/${e.P3}`)).body.name).toBe("P3 now");
    expect(await ok(client, "list_changesets")).toEqual([]);
  });
});

describe("the ruleset mount", () => {
  beforeAll(async () => {
    await fresh();
    await pointAnchor("agent-a", "project", e.P1);
    await pointAnchor("agent-b", "project", e.P3);
  }, 60_000);

  it("binds a started changeset to its ruleset; another ruleset does not reach it", async () => {
    const a = await connect("agent-a");
    const b = await connect("agent-b");
    const plain = await connect();
    const started = await ok(a, "start_changeset", { note: "through a" });
    expect(started.ruleset).toBe("agent-a");
    const cs = started.id as string;

    const notFound = `Changeset '${cs}' not found`;
    expect(await refused(b, "get_changeset", { changeset_id: cs })).toContain(notFound);
    expect(await refused(b, "commit_changeset", { changeset_id: cs })).toContain(notFound);
    expect(
      await refused(b, "update_entity", { entity_type_key: "project", entity_id: e.P3, properties: { name: "x" }, changeset_id: cs }),
    ).toContain(notFound);
    expect(await ok(b, "list_changesets")).toEqual([]);
    expect((await ok(a, "list_changesets")).map((c: Row) => c.id)).toEqual([cs]);
    expect((await ok(plain, "list_changesets")).map((c: Row) => [c.id, c.ruleset])).toEqual([[cs, "agent-a"]]);
    expect((await ok(plain, "get_changeset", { changeset_id: cs })).ruleset).toBe("agent-a");
    await ok(a, "discard_changeset", { changeset_id: cs });
  });

  it("staging takes a write outside the anchor; the commit rejects it as outside the subtree", async () => {
    const a = await connect("agent-a");
    const cs = (await ok(a, "start_changeset")).id as string;
    const staged = await ok(a, "create_entity", {
      entity_type_key: "task",
      properties: { name: "T under P2" },
      parent_relation: { type: "has_task", parent_id: e.P2, properties: { phase: "build" } },
      changeset_id: cs,
    });
    expect(staged).toEqual({ id: expect.any(String), relation: { id: expect.any(String) } });
    const rejected = await refused(a, "commit_changeset", { changeset_id: cs });
    expect(rejected).toContain("The commit was rejected; nothing was persisted");
    expect(rejected).toContain(`object ${staged.id} outside_subtree: `);
    expect(rejected).toContain(`object ${staged.relation.id} outside_subtree: `);
    expect(await refused(a, "get_entity", { entity_type_key: "task", entity_id: staged.id })).toContain("not found");
    await ok(a, "discard_changeset", { changeset_id: cs });
  });

  it("a deleted anchor refuses staging and submit, allows unstage, and rejects the commit", async () => {
    await pointAnchor("agent-d", "task", e.T2a);
    const d = await connect("agent-d");
    const cs = (await ok(d, "start_changeset")).id as string;
    await ok(d, "update_entity", { entity_type_key: "person", entity_id: e.Kim, properties: { name: "Kim B" }, changeset_id: cs });
    expect((await rest("DELETE", `${ALL}/entities/task/${e.T2a}`)).status).toBe(204);

    const deleted = "The anchor of ruleset 'agent-d' no longer exists";
    expect(
      await refused(d, "update_entity", { entity_type_key: "person", entity_id: e.Ana, properties: { name: "x" }, changeset_id: cs }),
    ).toContain(deleted);
    expect(await refused(d, "submit_changeset", { changeset_id: cs })).toContain(deleted);
    expect(await refused(d, "commit_changeset", { changeset_id: cs })).toContain("anchor_deleted");
    await ok(d, "unstage", { changeset_id: cs, object_id: e.Kim });
    expect((await ok(d, "get_changeset", { changeset_id: cs })).objectCount).toBe(0);
  });

  it("a deleted ruleset leaves its changeset to the plain lens, whose commit answers ruleset_gone", async () => {
    const b = await connect("agent-b");
    const cs = (await ok(b, "start_changeset")).id as string;
    await ok(b, "update_entity", { entity_type_key: "project", entity_id: e.P3, properties: { name: "P3 b" }, changeset_id: cs });
    expect((await rest("DELETE", `${RULESETS}/agent-b`)).status).toBe(204);

    expect(await refused(b, "get_changeset", { changeset_id: cs })).toContain("Ruleset 'agent-b' not found");
    const plain = await connect();
    expect((await ok(plain, "get_changeset", { changeset_id: cs })).ruleset).toBe("agent-b");
    expect(await refused(plain, "commit_changeset", { changeset_id: cs })).toContain("ruleset_gone");
    expect((await ok(plain, "get_entity", { entity_type_key: "project", entity_id: e.P3 })).name).toBe("P3");
  });
});

describe("the document edit tools stage with a changeset_id", () => {
  beforeAll(async () => {
    await fresh();
    await pointAnchor("agent-a", "project", e.P1);
  }, 60_000);

  const notes = async (id: string): Promise<string> =>
    (await rest("GET", `${ALL}/entities/task/${id}/documents/notes`)).body.content as string;

  it("on both mounts: the edits apply to the staged text, as REST's edit_document operation; nothing is written", async () => {
    for (const rulesetKey of [null, "agent-a"]) {
      const client = await connect(rulesetKey);
      const cs = (await ok(client, "start_changeset")).id as string;
      const target = { entity_type_key: "task", entity_id: e.T1, property_key: "notes", changeset_id: cs };
      expect(await ok(client, "edit_document", { ...target, old_string: "Notes", new_string: "Changed" })).toMatchObject({
        id: e.T1,
        propertyKey: "notes",
        totalLength: 13,
        replacements: 1,
      });
      expect(await ok(client, "write_document", { ...target, offset: 0, length: 0, content: "New: " })).toMatchObject({
        id: e.T1,
        totalLength: 18,
        context: "New: Changed of T1",
      });
      // The same call over REST, against the same staged text.
      const base = rulesetKey === null ? ALL : `${ALL}/rulesets/${rulesetKey}`;
      const viaRest = await rest("POST", `${base}/changesets/${cs}/writes`, {
        operation: "edit_document",
        type: "task",
        id: e.T1,
        property: "notes",
        op: "replace_range",
        offset: 18,
        length: 0,
        content: "!",
      });
      expect(viaRest).toMatchObject({ status: 201, body: { id: e.T1, totalLength: 19 } });
      expect(
        (await ok(client, "get_staged_document", { changeset_id: cs, entity_type_key: "task", entity_id: e.T1, property_key: "notes" }))
          .content,
      ).toBe("New: Changed of T1!");
      expect(await notes(e.T1)).toBe("Notes of T1");
      expect(await ok(client, "get_changeset", { changeset_id: cs })).toMatchObject({ version: 4, objectCount: 1 });
      await ok(client, "discard_changeset", { changeset_id: cs });
    }
  });

  it("without changeset_id the document edit stays immediate", async () => {
    const client = await connect();
    await ok(client, "edit_document", {
      entity_type_key: "task",
      entity_id: e.T2,
      property_key: "notes",
      old_string: "Notes",
      new_string: "Edited notes",
    });
    expect(await notes(e.T2)).toBe("Edited notes of T2");
  });

  it("REST mounts no document edit route under a changeset: 404 and nothing written", async () => {
    const cs = (await rest("POST", `${ALL}/changesets`)).body.id as string;
    const res = await rest("PATCH", `${ALL}/changesets/${cs}/documents/task/${e.T3}/notes`, {
      op: "str_replace",
      oldString: "Notes",
      newString: "Changed",
    });
    expect(res.status).toBe(404);
    expect(await notes(e.T3)).toBe("Notes of T3");
    expect((await rest("GET", `${ALL}/changesets/${cs}`)).body).toMatchObject({ version: 1, objectCount: 0 });
  });
});
