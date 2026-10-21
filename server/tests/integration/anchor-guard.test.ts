/**
 * The write guard of an anchored mount on PostgreSQL, over the REST mirror
 * and the MCP mount alike, on the fixture-shaped hierarchy
 * (`buildProjectHierarchy`). `agent-a` points at P1 through lens `all`
 * unless a test says otherwise. Each test proves one rule of the spec's
 * rule table, with the refusal's field key; no refusal names an entity the
 * caller did not send. Then the anchor's states: unanchored is the plain
 * lens, dangling and hidden refuse every write with a 409, and a re-point
 * applies on the next call.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { modelPrefix, runtimePrefix } from "./fixture.js";
import {
  buildProjectHierarchy,
  PROJECT_HIERARCHY_ONTOLOGY_KEY as O,
  type ProjectHierarchyIds,
  type ProjectHierarchyName,
} from "./hierarchy.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

/** One write's outcome on either transport. */
interface Outcome {
  ok: boolean;
  /** The HTTP status on REST; null on MCP. */
  status: number | null;
  /** The field keys of a 422 (REST: `details.fields`; MCP: the flattened text). */
  fields: string[];
  /** The whole response text. */
  text: string;
}

interface ParentRelation {
  type: string;
  parentId: string;
  properties?: Row;
}

/** The seven write functions, as one transport offers them. */
interface Writes {
  createEntity(type: string, props: Row, parentRelation?: ParentRelation): Promise<Outcome>;
  updateEntity(type: string, id: string, props: Row): Promise<Outcome>;
  deleteEntity(type: string, id: string): Promise<Outcome>;
  editDocument(type: string, id: string, oldString: string, newString: string): Promise<Outcome>;
  createRelation(type: string, from: string, to: string, props?: Row): Promise<Outcome>;
  updateRelation(type: string, id: string, props: Row): Promise<Outcome>;
  deleteRelation(type: string, id: string): Promise<Outcome>;
}

let app: FastifyInstance;
let baseUrl: string;
let ids: ProjectHierarchyIds;
const clients: Client[] = [];

const id = (name: ProjectHierarchyName) => ids.entities[name];

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  ids = await buildProjectHierarchy(app);
  await putAnchor("agent-a", "P1");
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function putAnchor(key: string, name: ProjectHierarchyName | null, type?: string): Promise<void> {
  const entity = name === null ? null : { type: type ?? (await typeOf(name)), id: id(name) };
  const res = await app.inject({ method: "PUT", url: `/api/ontologies/${O}/runtime/rulesets/${key}`, payload: { anchor: entity } });
  expect(res.statusCode, res.body).toBe(200);
}

async function typeOf(name: ProjectHierarchyName): Promise<string> {
  if (/^(ACME|BETA)$/.test(name)) return "customer";
  if (/^P\d$/.test(name)) return "project";
  if (/^T/.test(name)) return "task";
  if (/^M\d$/.test(name)) return "milestone";
  return name === "open" ? "status" : "person";
}

// ---------------------------------------------------------------------------
// The two transports
// ---------------------------------------------------------------------------

function restWrites(base: string): Writes {
  const send = async (method: "POST" | "PATCH" | "DELETE", url: string, payload?: Row): Promise<Outcome> => {
    const res = await app.inject({ method, url: `${base}${url}`, ...(payload === undefined ? {} : { payload }) });
    const body = res.body === "" ? {} : (res.json() as Row);
    return {
      ok: res.statusCode < 300,
      status: res.statusCode,
      fields: Object.keys(body.error?.details?.fields ?? {}),
      text: res.body,
    };
  };
  return {
    createEntity: (type, props, parentRelation) =>
      send("POST", `/entities/${type}`, parentRelation === undefined ? props : { ...props, parentRelation }),
    updateEntity: (type, entityId, props) => send("PATCH", `/entities/${type}/${entityId}`, props),
    deleteEntity: (type, entityId) => send("DELETE", `/entities/${type}/${entityId}`),
    editDocument: (type, entityId, oldString, newString) =>
      send("PATCH", `/entities/${type}/${entityId}/documents/notes`, { op: "str_replace", oldString, newString }),
    createRelation: (type, from, to, props = {}) =>
      send("POST", `/relations/${type}`, { fromEntityId: from, toEntityId: to, ...props }),
    updateRelation: (type, relationId, props) => send("PATCH", `/relations/${type}/${relationId}`, props),
    deleteRelation: (type, relationId) => send("DELETE", `/relations/${type}/${relationId}`),
  };
}

function mcpWrites(url: string): Writes {
  let client: Promise<Client> | null = null;
  const connect = () => {
    client ??= (async () => {
      const c = new Client({ name: "anchor-guard-tests", version: "0.0.1" });
      await c.connect(new StreamableHTTPClientTransport(new URL(url)));
      clients.push(c);
      return c;
    })();
    return client;
  };
  const call = async (name: string, args: Row): Promise<Outcome> => {
    const result = (await (await connect()).callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    // "Error executing tool …: <message> — key: text; key: text"
    const flattened = result.isError === true && text.includes(" — ") ? text.slice(text.indexOf(" — ") + 3) : "";
    return {
      ok: result.isError !== true,
      status: null,
      fields: flattened === "" ? [] : flattened.split("; ").map((part) => part.slice(0, part.indexOf(": "))),
      text,
    };
  };
  return {
    createEntity: (type, props, parentRelation) =>
      call("create_entity", {
        entity_type_key: type,
        properties: props,
        ...(parentRelation === undefined
          ? {}
          : {
              parent_relation: {
                type: parentRelation.type,
                parent_id: parentRelation.parentId,
                properties: parentRelation.properties,
              },
            }),
      }),
    updateEntity: (type, entityId, props) =>
      call("update_entity", { entity_type_key: type, entity_id: entityId, properties: props }),
    deleteEntity: (type, entityId) => call("delete_entity", { entity_type_key: type, entity_id: entityId }),
    editDocument: (type, entityId, oldString, newString) =>
      call("edit_document", {
        entity_type_key: type,
        entity_id: entityId,
        property_key: "notes",
        old_string: oldString,
        new_string: newString,
      }),
    createRelation: (type, from, to, props = {}) =>
      call("create_relation", { relation_type_key: type, from_entity_id: from, to_entity_id: to, properties: props }),
    updateRelation: (type, relationId, props) =>
      call("update_relation", { relation_type_key: type, relation_id: relationId, properties: props }),
    deleteRelation: (type, relationId) =>
      call("delete_relation", { relation_type_key: type, relation_id: relationId }),
  };
}

const TRANSPORTS = {
  REST: (lens: string, anchor: string) => restWrites(`${runtimePrefix(O, lens)}/rulesets/${anchor}`),
  MCP: (lens: string, anchor: string) => mcpWrites(`${baseUrl}/mcp/ontologies/${O}/runtime/lenses/${lens}/anchors/${anchor}`),
};

/** The plain lens `all`, over REST: the setup and the checks. */
const plain = () => restWrites(runtimePrefix(O, "all"));

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function allowed(outcome: Outcome, status?: number): void {
  expect(outcome.ok, outcome.text).toBe(true);
  if (status !== undefined && outcome.status !== null) expect(outcome.status).toBe(status);
}

/**
 * A 422 on exactly `field`, whose text names no entity of the hierarchy
 * but the ones in `sent`.
 */
function refusedOn(outcome: Outcome, field: string, sent: ProjectHierarchyName[] = []): void {
  expect(outcome.ok, outcome.text).toBe(false);
  if (outcome.status !== null) expect(outcome.status, outcome.text).toBe(422);
  expect(outcome.fields, outcome.text).toEqual([field]);
  namesOnly(outcome, sent);
}

function conflict(outcome: Outcome, fragment: string): void {
  expect(outcome.ok, outcome.text).toBe(false);
  if (outcome.status !== null) expect(outcome.status, outcome.text).toBe(409);
  expect(outcome.text).toContain(fragment);
}

function namesOnly(outcome: Outcome, sent: ProjectHierarchyName[]): void {
  for (const [name, entityId] of Object.entries(ids.entities)) {
    if (!sent.includes(name as ProjectHierarchyName)) {
      expect(outcome.text, `names ${name}`).not.toContain(entityId);
    }
  }
}

const HAS_TASK = (parent: ProjectHierarchyName) => ({ type: "has_task", parentId: id(parent), properties: { phase: "x" } });

// ---------------------------------------------------------------------------
// The rule table, one rule per test, on both transports
// ---------------------------------------------------------------------------

describe.each(Object.entries(TRANSPORTS))("the guard over %s, agent-a → P1 via all", (_name, mount) => {
  const agentA = () => mount("all", "agent-a");

  describe("create with a parent relation", () => {
    it("a task under P1: created together with its relation", async () => {
      allowed(await agentA().createEntity("task", { name: "T7" }, HAS_TASK("P1")), 201);
      const listed = await app.inject({ url: `${runtimePrefix(O, "all")}/entities/task?filter.name=T7` });
      const t7 = listed.json().items[0]._id as string;
      const relations = await app.inject({ url: `${runtimePrefix(O, "all")}/relations/has_task?toEntityId=${t7}` });
      expect(relations.json().items.map((r: Row) => r.fromEntityId)).toEqual([id("P1")]);
    });

    it("a subtask under T1a1 through has_subtask: created (covered)", async () => {
      allowed(await agentA().createEntity("task", { name: "T1a1x" }, { type: "has_subtask", parentId: id("T1a1") }), 201);
    });

    it("a task under P2: parentRelation.parentId", async () => {
      const outcome = await agentA().createEntity("task", { name: "T8" }, HAS_TASK("P2"));
      refusedOn(outcome, "parentRelation.parentId", ["P2"]);
      expect(outcome.text).toContain(`Entity '${id("P2")}' is not under anchor 'agent-a'`);
    });

    it("a task without parentRelation: parentRelation", async () => {
      refusedOn(await agentA().createEntity("task", { name: "T8" }), "parentRelation");
    });

    it("a task through the wrong relation: parentRelation.type", async () => {
      refusedOn(
        await agentA().createEntity("task", { name: "T8" }, { type: "has_project", parentId: id("ACME") }),
        "parentRelation.type",
        ["ACME"],
      );
    });

    it("nothing is written on a refusal", async () => {
      await agentA().createEntity("task", { name: "T8" }, HAS_TASK("P2"));
      const listed = await app.inject({ url: `${runtimePrefix(O, "all")}/entities/task?filter.name=T8` });
      expect(listed.json().total).toBe(0);
    });
  });

  describe("a hierarchy type that cannot be placed", () => {
    it("a customer: entityTypeKey", async () => {
      refusedOn(await agentA().createEntity("customer", { name: "GAMMA" }), "entityTypeKey");
    });

    it("a milestone via no_projects (its only parent relation hidden): entityTypeKey, the customer's text", async () => {
      await putAnchor("agent-c", "ACME");
      const agentC = mount("no_projects", "agent-c");
      const milestone = await agentC.createEntity("milestone", { name: "M3" });
      refusedOn(milestone, "entityTypeKey");
      expect(milestone.text).not.toMatch(/project|belongs_to/);
      const customer = await agentC.createEntity("customer", { name: "GAMMA" });
      refusedOn(customer, "entityTypeKey");
      expect(milestone.text.replace("milestone", "customer")).toBe(customer.text);
    });
  });

  describe("free types", () => {
    for (const type of ["person", "status"]) {
      it(`a ${type}: created, updated and deleted`, async () => {
        const created = await agentA().createEntity(type, { name: "Neu" });
        allowed(created, 201);
        const newId = JSON.parse(created.text)._id as string;
        allowed(await agentA().updateEntity(type, newId, { name: "Neu2" }), 200);
        allowed(await agentA().deleteEntity(type, newId), 204);
      });
    }
  });

  describe("updates and document edits", () => {
    it("T1 (covered): updated", async () => {
      allowed(await agentA().updateEntity("task", id("T1"), { name: "T1!" }), 200);
    });

    it("T4 (in P2): entityId", async () => {
      refusedOn(await agentA().updateEntity("task", id("T4"), { name: "T4!" }), "entityId", ["T4"]);
    });

    it("ACME (above the anchor): entityId", async () => {
      refusedOn(await agentA().updateEntity("customer", id("ACME"), { name: "ACME!" }), "entityId", ["ACME"]);
    });

    it("a document of T1 (covered): edited", async () => {
      allowed(await agentA().editDocument("task", id("T1"), "Notes", "Remarks"), 200);
    });

    it("a document of T4 (in P2): entityId", async () => {
      refusedOn(await agentA().editDocument("task", id("T4"), "Notes", "Remarks"), "entityId", ["T4"]);
    });
  });

  describe("deletes", () => {
    it("T1a1 (a covered leaf): deleted", async () => {
      allowed(await agentA().deleteEntity("task", id("T1a1")), 204);
    });

    it("T5 (a P2 leaf, outside the subtree): entityId", async () => {
      refusedOn(await agentA().deleteEntity("task", id("T5")), "entityId", ["T5"]);
    });

    it("T2a while agent-b points at it: entityId, frozen; deleted once agent-b is gone", async () => {
      await putAnchor("agent-b", "T2a");
      const frozen = await agentA().deleteEntity("task", id("T2a"));
      refusedOn(frozen, "entityId", ["T2a"]);
      expect(frozen.text).toContain("anchored");
      expect(frozen.text).not.toContain("agent-b");

      const res = await app.inject({ method: "DELETE", url: `/api/ontologies/${O}/runtime/rulesets/agent-b` });
      expect(res.statusCode).toBe(204);
      allowed(await agentA().deleteEntity("task", id("T2a")), 204);
    });

    it("outside wins over frozen: T5 under agent-b is refused as outside", async () => {
      await putAnchor("agent-b", "T5");
      const outcome = await agentA().deleteEntity("task", id("T5"));
      refusedOn(outcome, "entityId", ["T5"]);
      expect(outcome.text).toContain("is not under anchor 'agent-a'");
    });

    it("frozen wins over has children: P1 itself is refused as anchored", async () => {
      const outcome = await agentA().deleteEntity("project", id("P1"));
      refusedOn(outcome, "entityId", ["P1"]);
      expect(outcome.text).toContain("anchored");
    });

    it("T1a (covered, not anchored, child T1a1): 409 has children", async () => {
      conflict(await agentA().deleteEntity("task", id("T1a")), "This entity has children; delete them first");
    });

    it("an anchored free entity is frozen too", async () => {
      await putAnchor("agent-b", "Kim");
      refusedOn(await agentA().deleteEntity("person", id("Kim")), "entityId", ["Kim"]);
    });
  });

  describe("ordinary relations", () => {
    it("T1 assigned_to Kim (covered → free): created", async () => {
      allowed(await agentA().createRelation("assigned_to", id("T1"), id("Kim")), 201);
    });

    it("T6 assigned_to Kim (outside → free): fromEntityId", async () => {
      refusedOn(await agentA().createRelation("assigned_to", id("T6"), id("Kim")), "fromEntityId", ["T6", "Kim"]);
    });

    it("Kim reviews T6 (free → outside): toEntityId", async () => {
      refusedOn(await agentA().createRelation("reviews", id("Kim"), id("T6")), "toEntityId", ["Kim", "T6"]);
    });

    it("Kim reviews T1 (free → covered): created", async () => {
      allowed(await agentA().createRelation("reviews", id("Kim"), id("T1")), 201);
    });

    it("Ben mentors Ana (free → free): created", async () => {
      allowed(await agentA().createRelation("mentors", id("Ben"), id("Ana")), 201);
    });

    it("T1 assigned_to Ben (covered → free): updated and deleted", async () => {
      const relationId = ids.relations["T1 assigned_to Ben"]!;
      allowed(await agentA().updateRelation("assigned_to", relationId, {}), 200);
      allowed(await agentA().deleteRelation("assigned_to", relationId), 204);
    });

    it("T6 assigned_to Ana (outside → free): update refused on relationId", async () => {
      refusedOn(await agentA().updateRelation("assigned_to", ids.relations["T6 assigned_to Ana"]!, {}), "relationId");
    });

    it("T6 assigned_to Ana (outside → free): delete refused on relationId", async () => {
      refusedOn(await agentA().deleteRelation("assigned_to", ids.relations["T6 assigned_to Ana"]!), "relationId");
    });
  });

  describe("parent relations of the anchor's hierarchy", () => {
    it("a standalone T1 has_subtask R2 (R2 a root from the plain lens): relationTypeKey", async () => {
      const created = await plain().createEntity("task", { name: "R2" });
      const r2 = JSON.parse(created.text)._id as string;
      refusedOn(await agentA().createRelation("has_subtask", id("T1"), r2), "relationTypeKey", ["T1"]);
    });

    it("deleting P1 has_task T3: relationId", async () => {
      const outcome = await agentA().deleteRelation("has_task", ids.relations["P1 has_task T3"]!);
      refusedOn(outcome, "relationId");
      expect(outcome.text).toContain("places an entity under anchor 'agent-a'");
    });

    it("deleting P2 has_task T4 (child outside): relationId, not under the anchor", async () => {
      const outcome = await agentA().deleteRelation("has_task", ids.relations["P2 has_task T4"]!);
      refusedOn(outcome, "relationId");
      expect(outcome.text).toContain("is not under anchor 'agent-a'");
    });

    it("updating the phase of P1 has_task T1 (child covered): updated", async () => {
      allowed(await agentA().updateRelation("has_task", ids.relations["P1 has_task T1"]!, { phase: "test" }), 200);
    });

    it("updating the phase of P2 has_task T4 (child outside): relationId", async () => {
      refusedOn(await agentA().updateRelation("has_task", ids.relations["P2 has_task T4"]!, { phase: "test" }), "relationId");
    });
  });

  describe("another hierarchy", () => {
    it("Lea manages a new person: created; Lea manages Ana: deleted", async () => {
      const created = await agentA().createEntity("person", { name: "Neu" });
      const neu = JSON.parse(created.text)._id as string;
      allowed(await agentA().createRelation("manages", id("Lea"), neu), 201);
      allowed(await agentA().deleteRelation("manages", ids.relations["Lea manages Ana"]!), 204);
    });
  });

  // -------------------------------------------------------------------------
  // States
  // -------------------------------------------------------------------------

  describe("states", () => {
    it("unanchored is the plain lens: T5 is updated, a customer created", async () => {
      await putAnchor("agent-a", null);
      allowed(await agentA().updateEntity("task", id("T5"), { name: "T5!" }), 200);
      allowed(await agentA().createEntity("customer", { name: "GAMMA" }), 201);
    });

    it("dangling by a deleted entity: every write a 409 until re-anchored", async () => {
      await putAnchor("agent-a", "T5");
      allowed(await plain().deleteEntity("task", id("T5")), 204);
      const writes = agentA();
      for (const outcome of [
        await writes.updateEntity("task", id("T1"), { name: "T1!" }),
        await writes.createEntity("person", { name: "Neu" }),
        await writes.createRelation("mentors", id("Ben"), id("Ana")),
        await writes.deleteRelation("mentors", ids.relations["Ben mentors Kim"]!),
      ]) {
        conflict(outcome, "Anchor 'agent-a' is dangling");
      }
      await putAnchor("agent-a", "P1");
      allowed(await writes.updateEntity("task", id("T1"), { name: "T1!" }), 200);
    });

    it("dangling by a deleted entity type: a 409", async () => {
      await putAnchor("agent-d", "open", "status");
      const relationTypes = await app.inject({ url: `${modelPrefix(O)}/relation-types` });
      const hasStatus = (relationTypes.json() as Row[]).find((rt) => rt.key === "has_status")!;
      const removed = await app.inject({
        method: "DELETE",
        url: `${modelPrefix(O)}/relation-types/${hasStatus.relationTypeId as string}?cascade=true`,
      });
      expect(removed.statusCode, removed.body).toBe(204);
      const listed = await app.inject({ url: `${modelPrefix(O)}/entity-types` });
      const status = (listed.json() as Row[]).find((et) => et.key === "status")!;
      const res = await app.inject({
        method: "DELETE",
        url: `${modelPrefix(O)}/entity-types/${status.entityTypeId as string}?cascade=true`,
      });
      expect(res.statusCode, res.body).toBe(204);
      conflict(await mount("all", "agent-d").createEntity("person", { name: "Neu" }), "Anchor 'agent-d' is dangling");
    });

    it("an anchored entity the lens hides: every write a 409 naming only the anchor and the lens", async () => {
      const writes = mount("no_projects", "agent-a");
      for (const outcome of [
        await writes.createEntity("task", { name: "T9" }, { type: "has_subtask", parentId: id("T1") }),
        await writes.updateEntity("task", id("T1"), { name: "T1!" }),
        await writes.deleteEntity("task", id("T1a1")),
      ]) {
        conflict(outcome, "Anchor 'agent-a'");
        expect(outcome.text).toContain("'no_projects'");
        expect(outcome.text).not.toMatch(/'project'/);
        namesOnly(outcome, ["T1", "T1a1"]);
      }
    });

    it("a re-point applies on the next call: P1 → P2", async () => {
      const writes = agentA();
      allowed(await writes.updateEntity("task", id("T1"), { name: "T1!" }), 200);
      await putAnchor("agent-a", "P2");
      allowed(await writes.updateEntity("task", id("T4"), { name: "T4!" }), 200);
      refusedOn(await writes.updateEntity("task", id("T1"), { name: "T1!!" }), "entityId", ["T1"]);
    });
  });
});

describe("the plain lens", () => {
  it("is not held: T5 is updated and a parent relation deleted while agent-a points at P1", async () => {
    allowed(await plain().updateEntity("task", id("T5"), { name: "T5!" }), 200);
    allowed(await plain().deleteRelation("has_task", ids.relations["P1 has_task T3"]!), 204);
  });
});
