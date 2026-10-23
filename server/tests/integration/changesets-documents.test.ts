/**
 * Documents in changesets over REST and MCP, on the in-test project
 * hierarchy (`buildProjectHierarchy`: task carries the document `notes`)
 * with the official SDK client on a real listening server: the review read
 * shows every document value as a stub, a create's parent carries its
 * relation's properties, and the staged document read returns the text a
 * commit would leave, whole and in slices: the one staged value of the
 * property. Document edits stage through MCP on the staged text. Drift on a
 * document is still found by its hash; a lens that hides the type or the
 * property answers not found; a ruleset mount with an anchor and write
 * access propose reads it too.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache, invalidateSearchContext } from "../../src/runtime/schemaCache.js";
import { modelPrefix, runtimePrefix } from "./fixture.js";
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

/** A Markdown document of 2,000+ characters, an emoji (one character, two
 * UTF-16 units) among them. */
const PLAN = `# Plan of T1\n\n${Array.from({ length: 40 }, (_, i) => `- Step ${i + 1}: do the work 😀 well.`).join("\n")}\n`;
const chars = (text: string): number => [...text].length;

let app: FastifyInstance;
let baseUrl: string;
let h: ProjectHierarchyIds;
let e: ProjectHierarchyIds["entities"];
const clients: Client[] = [];

async function connect(rulesetKey: string | null = null): Promise<Client> {
  const path = `/mcp/ontologies/${O}/runtime/lenses/all${rulesetKey === null ? "" : `/rulesets/${rulesetKey}`}`;
  const client = new Client({ name: "changesets-documents-tests", version: "0.0.1" });
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

async function start(base = ALL): Promise<string> {
  const res = await rest("POST", `${base}/changesets`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Stage one call: its body, answered 201. */
async function staged(base: string, cs: string, write: Row): Promise<Row> {
  const res = await rest("POST", `${base}/changesets/${cs}/writes`, write);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** The staged document read of a task's notes over REST. */
function stagedNotes(cs: string, task: string, query = "", base = ALL): Promise<{ status: number; body: Row }> {
  return rest("GET", `${base}/changesets/${cs}/documents/task/${task}/notes${query}`);
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

describe("the review read and the staged document read (F6)", () => {
  let cs: string;
  let t9: string;

  beforeAll(async () => {
    await fresh();
    cs = await start();
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T1,
      properties: { notes: PLAN },
    }); // a whole document
    t9 = (
      await staged(ALL, cs, {
        operation: "create_entity",
        type: "task",
        properties: { name: "T9", notes: "Draft of T9" },
        parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "plan" } },
      })
    ).id as string; // a create with a document, and its parent relation
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T2,
      properties: { notes: "First rewrite of T2" },
    });
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: t9,
      properties: { notes: "Final text of T9" },
    }); // the created entity again: merged into its create
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T2,
      properties: { notes: "Second rewrite" },
    }); // the later value replaces the earlier
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T5,
      properties: { name: "T5 b" },
    }); // sets no document
  }, 60_000);

  it("one object per entity, every document value as a stub, over REST and MCP alike", async () => {
    const read = (await rest("GET", `${ALL}/changesets/${cs}`)).body;
    expect(read.objectCount).toBe(5);
    const [t1, create, parent, t2, t5] = read.objects as Row[];
    expect(t1).toMatchObject({
      id: e.T1,
      name: "T1",
      action: "update",
      markers: [],
      values: [
        {
          property: "notes",
          before: { document: true, length: chars("Notes of T1") },
          current: { document: true, length: chars("Notes of T1") },
          after: { document: true, length: chars(PLAN) },
          markers: [],
        },
      ],
    });
    expect(create).toMatchObject({
      id: t9,
      name: "T9",
      action: "create",
      values: [
        { property: "name", before: null, current: null, after: "T9" },
        { property: "notes", before: null, current: null, after: { document: true, length: chars("Final text of T9") } },
      ],
    });
    expect(create).not.toHaveProperty("parent");
    // The parent relation is an object of its own, its ends named.
    expect(parent).toMatchObject({
      kind: "relation",
      action: "create",
      type: "has_task",
      from: { id: e.P1, name: "P1" },
      to: { id: t9, name: "T9" },
      values: [{ property: "phase", after: "plan" }],
    });
    expect(t2).toMatchObject({ id: e.T2, values: [{ property: "notes", after: { document: true, length: chars("Second rewrite") } }] });
    expect(t5).toMatchObject({ id: e.T5, values: [{ property: "name", after: "T5 b" }] });
    const json = JSON.stringify(read);
    for (const staged of ["Plan of T1", "Draft of T9", "Final text of T9", "Rewrite", "rewrite", "sha256", "Notes of"]) {
      expect(json).not.toContain(staged);
    }

    const client = await connect();
    expect(await ok(client, "get_changeset", { changeset_id: cs })).toEqual(read);
  });

  it("reads the staged text whole, as get_document answers a document", async () => {
    const whole = await stagedNotes(cs, e.T1);
    expect(whole.status, JSON.stringify(whole.body)).toBe(200);
    expect(whole.body).toEqual({ propertyKey: "notes", content: PLAN, offset: 0, length: chars(PLAN), totalLength: chars(PLAN) });
    // Reads never see staged data: the stored text is unchanged.
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}/documents/notes`)).body.content).toBe("Notes of T1");

    const client = await connect();
    expect(
      await ok(client, "get_staged_document", { changeset_id: cs, entity_type_key: "task", entity_id: e.T1, property_key: "notes" }),
    ).toEqual(whole.body);
  });

  it("reads it in slices by characters, with totalLength, as get_document slices", async () => {
    const at = PLAN.indexOf("😀");
    const offset = chars(PLAN.slice(0, at));
    const slice = await stagedNotes(cs, e.T1, `?offset=${offset}&limit=6`);
    expect(slice.body).toEqual({ propertyKey: "notes", content: "😀 well", offset, length: 6, totalLength: chars(PLAN) });
    const tail = await stagedNotes(cs, e.T1, `?offset=${chars(PLAN) - 6}`);
    expect(tail.body).toMatchObject({ content: "well.\n", length: 6, totalLength: chars(PLAN) });
    expect((await stagedNotes(cs, e.T1, "?offset=99999&limit=10")).body).toMatchObject({ content: "", length: 0 });
    expect((await stagedNotes(cs, e.T1, "?limit=0")).status).toBe(422);
    expect((await stagedNotes(cs, e.T1, "?offset=-1")).status).toBe(422);

    // MCP answers the same slices, clamped as get_document clamps.
    const client = await connect();
    const args = { changeset_id: cs, entity_type_key: "task", entity_id: e.T1, property_key: "notes" };
    expect(await ok(client, "get_staged_document", { ...args, offset, limit: 6 })).toEqual(slice.body);
    expect(await ok(client, "get_staged_document", { ...args, offset: -5, limit: 0 })).toMatchObject({
      offset: 0,
      content: "#",
      length: 1,
      totalLength: chars(PLAN),
    });
    // get_document clamps the same way.
    expect(
      await ok(client, "get_document", { entity_type_key: "task", entity_id: e.T1, property_key: "notes", offset: -5, limit: 0 }),
    ).toMatchObject({ offset: 0, content: "N", length: 1 });
  });

  it("an entity created in this changeset, and one staged value per document: the later replaced the earlier", async () => {
    expect((await stagedNotes(cs, t9)).body).toMatchObject({ content: "Final text of T9", totalLength: 16 });
    expect((await stagedNotes(cs, e.T2)).body).toMatchObject({ content: "Second rewrite", totalLength: 14 });
    // Cutting the value takes it out; nothing earlier comes back.
    expect((await rest("DELETE", `${ALL}/changesets/${cs}/objects/${e.T2}/properties/notes`)).status).toBe(204);
    expect((await stagedNotes(cs, e.T2)).status).toBe(404);
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T2,
      properties: { notes: "Second rewrite" },
    });
  });

  it("not found when the changeset stages no value of it, or for what is no document or no changeset", async () => {
    const none = (task: string) => `Changeset '${cs}' stages no 'notes' of entity '${task}'`;
    for (const task of [e.T3, e.T5]) {
      const res = await stagedNotes(cs, task);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "RESOURCE_NOT_FOUND", message: none(task) });
    }
    const name = await rest("GET", `${ALL}/changesets/${cs}/documents/task/${e.T1}/name`);
    expect(name.status).toBe(404);
    expect(name.body.error.message).toBe("Document property 'name' not found on entity type 'task'");
    expect((await rest("GET", `${ALL}/changesets/${cs}/documents/nope/${e.T1}/notes`)).body.error.message).toBe(
      "Entity type 'nope' not found",
    );
    const gone = "00000000-0000-4000-8000-000000000000";
    expect((await stagedNotes(gone, e.T1)).body.error.message).toBe(`Changeset '${gone}' not found`);

    const client = await connect();
    expect(
      await refused(client, "get_staged_document", { changeset_id: cs, entity_type_key: "task", entity_id: e.T3, property_key: "notes" }),
    ).toContain(none(e.T3));
  });

  it("not found when the changeset deletes the entity, or took its create out, over REST and MCP", async () => {
    const other = await start();
    await staged(ALL, other, {
      operation: "update_entity",
      type: "task",
      id: e.T1a1,
      properties: { notes: "Doomed notes" },
    });
    const t10 = (await staged(ALL, other, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T10", notes: "Short-lived" },
    })).id as string;
    expect((await stagedNotes(other, e.T1a1)).body.content).toBe("Doomed notes");
    await staged(ALL, other, { operation: "delete_entity", type: "task", id: e.T1a1 });
    await staged(ALL, other, { operation: "delete_entity", type: "task", id: t10 });
    const client = await connect();
    for (const [task, message] of [
      [e.T1a1, `Changeset '${other}' deletes entity '${e.T1a1}': a commit leaves no 'notes'`],
      [t10, `Changeset '${other}' stages no 'notes' of entity '${t10}'`],
    ] as const) {
      const res = await stagedNotes(other, task);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "RESOURCE_NOT_FOUND", message });
      expect(
        await refused(client, "get_staged_document", { changeset_id: other, entity_type_key: "task", entity_id: task, property_key: "notes" }),
      ).toContain(message);
    }
    // Unstaging the delete brings nothing back: the delete dropped the staged text.
    expect((await rest("DELETE", `${ALL}/changesets/${other}/objects/${e.T1a1}`)).status).toBe(204);
    expect((await stagedNotes(other, e.T1a1)).status).toBe(404);
    expect((await rest("DELETE", `${ALL}/changesets/${other}`)).status).toBe(204);
  });

  it("a submitted changeset is read the same way", async () => {
    expect((await rest("POST", `${ALL}/changesets/${cs}/submit`, { note: "review" })).status).toBe(200);
    expect((await stagedNotes(cs, e.T1)).body).toMatchObject({ content: PLAN });
    expect((await rest("POST", `${ALL}/changesets/${cs}/unsubmit`, { note: "back" })).status).toBe(200);
  });
});

describe("drift on a document (F6)", () => {
  beforeAll(fresh, 60_000);

  it("is still found by the hash, even at the same length; before and current are stubs", async () => {
    const cs = await start();
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T4,
      properties: { notes: "Planned notes of T4" },
    });
    // An immediate edit of the stored text, keeping its length: "Notes of T4" → "Texts of T4".
    const edit = await rest("PATCH", `${ALL}/entities/task/${e.T4}/documents/notes`, {
      op: "str_replace",
      oldString: "Notes",
      newString: "Texts",
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);

    const [object] = (await rest("GET", `${ALL}/changesets/${cs}`)).body.objects as Row[];
    expect(object!.values).toEqual([
      {
        property: "notes",
        before: { document: true, length: 11 },
        current: { document: true, length: 11 },
        after: { document: true, length: chars("Planned notes of T4") },
        markers: [{ kind: "drift", message: "Changed since it was staged" }],
      },
    ]);
    expect(object!.markers).toEqual([]);
    const commit = await rest("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(commit.status).toBe(422);
    expect(commit.body.error.details.violations.map((v: Row) => v.kind)).toEqual(["drift"]);
    // The staged text still reads; the stored text is the edited one.
    expect((await stagedNotes(cs, e.T4)).body.content).toBe("Planned notes of T4");
    expect((await rest("GET", `${ALL}/entities/task/${e.T4}/documents/notes`)).body.content).toBe("Texts of T4");
  });
});

describe("document edits staged through MCP", () => {
  beforeAll(fresh, 60_000);

  it("edit_document and write_document with changeset_id edit the staged text; the stored text stays until the commit", async () => {
    const client = await connect();
    const cs = (await ok(client, "start_changeset", {})).id as string;
    const target = { entity_type_key: "task", entity_id: e.T1, property_key: "notes", changeset_id: cs };
    expect(await ok(client, "edit_document", { ...target, old_string: "Notes", new_string: "Plans" })).toEqual({
      id: e.T1,
      propertyKey: "notes",
      totalLength: 11,
      editedRange: { offset: 0, length: 5 },
      replacements: 1,
      context: "Plans of T1",
      contextOffset: 0,
    });
    expect(await ok(client, "write_document", { ...target, offset: 11, length: 0, content: " for 2027" })).toMatchObject({
      id: e.T1,
      totalLength: 20,
      context: "Plans of T1 for 2027",
    });
    // The immediate edit's faults, unchanged.
    expect(await refused(client, "edit_document", { ...target, old_string: "missing", new_string: "x" })).toContain(
      "oldString not found in document",
    );
    expect(await refused(client, "write_document", { ...target, offset: 0, length: 5, content: "x", expect: "Notes" })).toContain(
      "expect mismatch",
    );

    expect((await stagedNotes(cs, e.T1)).body.content).toBe("Plans of T1 for 2027");
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}/documents/notes`)).body.content).toBe("Notes of T1");
    const [object] = (await ok(client, "get_changeset", { changeset_id: cs })).objects as Row[];
    expect(object).toMatchObject({
      id: e.T1,
      action: "update",
      values: [{ property: "notes", before: { document: true, length: 11 }, after: { document: true, length: 20 }, markers: [] }],
    });

    expect(await ok(client, "commit_changeset", { changeset_id: cs })).toEqual({ committed: 1, alreadyGone: [] });
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}/documents/notes`)).body.content).toBe("Plans of T1 for 2027");
  });
});

describe("each review page judges its own objects", () => {
  beforeAll(fresh, 60_000);

  it("every page answers as the whole read, and their markers are submit's violations: drift on a document and a relation, missing, dangling across pages", async () => {
    const cs = await start();
    const link = h.relations["P1 has_task T1"]!;
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: e.T1, properties: { notes: "Planned T1" } }); // drift by hash
    const t9 = await staged(ALL, cs, {
      operation: "create_entity",
      type: "task",
      properties: { name: "T9", notes: PLAN },
      parentRelation: { type: "has_task", parentId: e.P1, properties: { phase: "plan" } },
    });
    await staged(ALL, cs, { operation: "update_relation", type: "has_task", id: link, properties: { phase: "review" } }); // drift
    await staged(ALL, cs, { operation: "update_relation", type: "has_task", id: t9.relation.id, properties: { phase: "done" } }); // merged into its create
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: e.T4, properties: { name: "T4 b" } }); // missing
    const t10 = await staged(ALL, cs, { operation: "create_entity", type: "task", properties: { name: "T10" } }); // taken out below
    const toT10 = await staged(ALL, cs, { operation: "create_relation", type: "assigned_to", fromEntityId: t10.id, toEntityId: e.Ben }); // dangling
    const toT9 = await staged(ALL, cs, { operation: "create_relation", type: "assigned_to", fromEntityId: t9.id, toEntityId: e.Ben }); // an end created here
    await staged(ALL, cs, { operation: "update_entity", type: "task", id: e.T2, properties: { notes: "T2 again" } }); // clean
    expect((await rest("DELETE", `${ALL}/changesets/${cs}/objects/${t10.id}`)).status).toBe(204);
    // Immediate writes since: the text of T1 at the same length, the link's phase, T4 gone.
    const edit = await rest("PATCH", `${ALL}/entities/task/${e.T1}/documents/notes`, { op: "str_replace", oldString: "Notes", newString: "Texts" });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await rest("PATCH", `${ALL}/relations/has_task/${link}`, { phase: "test" })).status).toBe(200);
    expect((await rest("DELETE", `${ALL}/entities/task/${e.T4}`)).status).toBe(204);

    const whole = (await rest("GET", `${ALL}/changesets/${cs}?limit=500`)).body.objects as Row[];
    const all = (object: Row): Row[] => [...object.markers, ...object.values.flatMap((v: Row) => v.markers)];
    expect(whole.map((o) => [o.id, all(o).map((m: Row) => m.kind)])).toEqual([
      [e.T1, ["drift"]],
      [t9.id, []],
      [t9.relation.id, []],
      [link, ["drift"]],
      [e.T4, ["missing"]],
      [toT10.id, ["dangling"]],
      [toT9.id, []],
      [e.T2, []],
    ]);
    expect(whole[0]!.values[0]).toMatchObject({
      before: { document: true, length: chars("Notes of T1") },
      current: { document: true, length: chars("Texts of T1") },
    });
    expect(whole[2]).toMatchObject({ from: { id: e.P1, name: "P1" }, to: { id: t9.id, name: "T9" }, values: [{ property: "phase", after: "done" }] });
    expect(whole[3]).toMatchObject({ from: { id: e.P1, name: "P1" }, to: { id: e.T1, name: "T1" }, values: [{ before: "build", current: "test" }] });
    expect(whole[6]).toMatchObject({ from: { id: t9.id, name: "T9" }, to: { id: e.Ben, name: "Ben" } });
    expect(whole[7]!.values[0]).toMatchObject({ current: { document: true, length: chars("Notes of T2") } });

    for (const limit of [1, 3]) {
      for (let offset = 0; offset < whole.length; offset += 1) {
        const page = await rest("GET", `${ALL}/changesets/${cs}?offset=${offset}&limit=${limit}`);
        expect(page.body.objects, `offset ${offset}, limit ${limit}`).toEqual(whole.slice(offset, offset + limit));
      }
    }

    // Submit runs the pass over the whole changeset: the same faults.
    const submit = await rest("POST", `${ALL}/changesets/${cs}/submit`, {});
    expect(submit.status).toBe(422);
    expect(submit.body.error.details.violations).toEqual(
      whole.flatMap((o) => [
        ...o.markers.map((m: Row) => ({ object: o.id, kind: m.kind, message: m.message })),
        ...o.values.flatMap((v: Row) => v.markers.map((m: Row) => ({ object: o.id, property: v.property, kind: m.kind, message: m.message }))),
      ]),
    );
  });
});

describe("through the lens and the mounts (F6)", () => {
  beforeAll(fresh, 60_000);

  it("a lens that hides the type, or the property, answers not found", async () => {
    const model = modelPrefix(O);
    const lensId = (await rest("POST", `${model}/lenses`, { key: "docs", name: "Docs" })).body.lensId as string;
    for (const key of ["customer", "project", "task"]) {
      await rest("POST", `${model}/lenses/${lensId}/includes/entity-types`, { key });
    }
    const DOCS = runtimePrefix(O, "docs");
    const cs = await start(DOCS);
    await staged(DOCS, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T1,
      properties: { name: "T1 b", notes: "Hidden plan" },
    });
    expect((await stagedNotes(cs, e.T1, "", DOCS)).body.content).toBe("Hidden plan");

    const types = (await rest("GET", `${model}/entity-types`)).body as unknown as Row[];
    const task = types.find((t) => t.key === "task")!.entityTypeId as string;
    // The property hidden: the type stays, notes goes.
    const narrowed = await rest("PUT", `${model}/lenses/${lensId}/includes/entity-types/${task}`, { properties: ["name"] });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);
    const hiddenProperty = await stagedNotes(cs, e.T1, "", DOCS);
    expect(hiddenProperty.status).toBe(404);
    expect(hiddenProperty.body.error.message).toBe("Document property 'notes' not found on entity type 'task'");
    const read = (await rest("GET", `${DOCS}/changesets/${cs}`)).body;
    expect(JSON.stringify(read)).not.toMatch(/notes|Hidden plan/);

    // The type hidden.
    expect((await rest("DELETE", `${model}/lenses/${lensId}/includes/entity-types/${task}`)).status).toBe(204);
    const hiddenType = await stagedNotes(cs, e.T1, "", DOCS);
    expect(hiddenType.status).toBe(404);
    expect(hiddenType.body.error.message).toBe("Entity type 'task' not found");
    // Another lens does not reach the changeset at all.
    expect((await stagedNotes(cs, e.T1)).body.error.message).toBe(`Changeset '${cs}' not found`);
  });

  it("a ruleset mount with an anchor at propose reads it; another ruleset does not reach it", async () => {
    expect((await rest("PUT", `${RULESETS}/agent-s`, { anchor: { type: "project", id: e.P1 }, writeAccess: "propose" })).status).toBe(200);
    expect((await rest("PUT", `${RULESETS}/agent-b`, { anchor: { type: "project", id: e.P3 } })).status).toBe(200);
    const client = await connect("agent-s");
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("get_staged_document");
    expect(tools).not.toContain("commit_changeset");

    const cs = (await ok(client, "start_changeset", {})).id as string;
    await ok(client, "update_entity", {
      entity_type_key: "task",
      entity_id: e.T2,
      properties: { notes: "Proposed notes" },
      changeset_id: cs,
    });
    const args = { changeset_id: cs, entity_type_key: "task", entity_id: e.T2, property_key: "notes" };
    const mcp = await ok(client, "get_staged_document", args);
    expect(mcp).toEqual({ propertyKey: "notes", content: "Proposed notes", offset: 0, length: 14, totalLength: 14 });
    expect((await stagedNotes(cs, e.T2, "", `${ALL}/rulesets/agent-s`)).body).toEqual(mcp);
    // The plain lens URL reaches every changeset of its lens.
    expect((await stagedNotes(cs, e.T2)).body).toEqual(mcp);

    const other = await stagedNotes(cs, e.T2, "", `${ALL}/rulesets/agent-b`);
    expect(other.status).toBe(404);
    expect(other.body.error.message).toBe(`Changeset '${cs}' not found`);
    expect(await refused(await connect("agent-b"), "get_staged_document", args)).toContain(`Changeset '${cs}' not found`);
  });
});

describe("the commit applies the staged values (F6)", () => {
  beforeAll(fresh, 60_000);

  it("the commit applies the staged document and the parent relation's properties", async () => {
    const cs = await start();
    const t9 = (
      await staged(ALL, cs, {
        operation: "create_entity",
        type: "task",
        properties: { name: "T9", notes: PLAN },
        parentRelation: { type: "has_task", parentId: e.P2, properties: { phase: "plan" } },
      })
    ).id as string;
    await staged(ALL, cs, {
      operation: "update_entity",
      type: "task",
      id: e.T1,
      properties: { notes: "Committed notes" },
    });
    const commit = await rest("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    expect((await rest("GET", `${ALL}/entities/task/${t9}/documents/notes`)).body.content).toBe(PLAN);
    expect((await rest("GET", `${ALL}/entities/task/${e.T1}/documents/notes`)).body.content).toBe("Committed notes");
    const relations = (await rest("GET", `${ALL}/relations/has_task?toEntityId=${t9}`)).body;
    const items = (relations.items ?? relations) as Row[];
    expect(items.find((r) => r.toEntityId === t9)).toMatchObject({ fromEntityId: e.P2, phase: "plan" });
  });
});
