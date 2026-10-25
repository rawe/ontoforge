/**
 * Authorization and user management end to end: the app with
 * authentication on over the real access store (`ontoforge_access_test`,
 * beside the suite's database) and a stub provider whose bearer token is
 * the caller's subject. Covers the route checks (401, 403, 404), the
 * filtered lists, the creator becoming administrator, user management's
 * scope, deletes forgetting assignments, the runtime MCP mount at a
 * Reader's level, a Proposer's changesets a Writer commits and owned
 * assistant threads.
 */

import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AccessStore } from "../../src/access/store.js";
import { openAccessStore } from "../../src/adapters/postgres/accessStore.js";
import { createApp } from "../../src/app.js";
import type { AuthRuntime } from "../../src/auth/runtime.js";
import { settings } from "../../src/config.js";
import { StoreError } from "../../src/core/exceptions.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";

const DATABASE = "ontoforge_access_test";
const ISSUER = "http://issuer.test/realms/x";
const PUBLIC_URL = "http://localhost:5173";

function accessUrl(): string {
  const url = new URL(settings.DB_URI);
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

async function truncate(): Promise<void> {
  const url = new URL(settings.DB_URI);
  const client = new pg.Client({
    host: url.hostname,
    port: url.port === "" ? 5432 : Number(url.port),
    database: DATABASE,
    user: settings.DB_USER,
    password: settings.DB_PASSWORD,
  });
  await client.connect();
  try {
    await client.query("TRUNCATE audit, assignment, identity, principal");
  } finally {
    await client.end();
  }
}

let app: FastifyInstance;
let access: AccessStore;
let baseUrl: string;

type Json = Record<string, unknown>;

/** A request as `subject` (a bearer token the stub accepts), or anonymous. */
async function as(subject: string | null, method: string, url: string, payload?: object) {
  const res = await app.inject({
    method: method as "GET",
    url,
    headers: subject === null ? {} : { authorization: `Bearer ${subject}` },
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: res.statusCode, body: res.body === "" ? null : (res.json() as Json & Json[]) };
}

async function idOf(subject: string): Promise<string> {
  return (await access.principalOf(ISSUER, subject))!.id;
}

/** An MCP client on `path` as `subject`. */
async function mcpAs(subject: string, path: string): Promise<Client> {
  const client = new Client({ name: "access-tests", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}${path}`), {
      requestInit: { headers: { authorization: `Bearer ${subject}` } },
    }),
  );
  return client;
}

async function grant(by: string, subject: string, body: object): Promise<Json> {
  const res = await as(by, "POST", `/api/users/${await idOf(subject)}/assignments`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

const fair = "/api/ontologies/fair";
const visitor = `${fair}/runtime/lenses/visitor`;

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  access = await openAccessStore(accessUrl(), settings.DB_USER, settings.DB_PASSWORD);
  await truncate();
  const auth = {
    settings: { issuer: ISSUER, adminSubject: "admin", publicUrl: PUBLIC_URL, clientSecret: "x".repeat(32) },
    oidc: {
      issuer: ISSUER,
      verifyAccessToken: async (token: string) => ({
        issuer: ISSUER,
        subject: token,
        displayName: token,
        email: `${token}@x.test`,
        username: token,
      }),
    },
    sessions: { get: async () => null, create: async () => {}, delete: async () => {} },
    access,
  } as unknown as AuthRuntime;
  app = await createApp(undefined, auth);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  // Every principal signs in once.
  for (const subject of ["admin", "creator", "alice", "bob"]) {
    expect((await as(subject, "GET", "/api/ontologies")).status).toBe(200);
  }
});

afterAll(async () => {
  await app?.close(); // closes the access store too
  await wipeDatabase();
  await closeStores();
});

describe("authorization with authentication on", () => {
  it("the anonymous are refused; public routes answer", async () => {
    expect((await as(null, "GET", "/api/ontologies")).status).toBe(401);
    expect((await as(null, "GET", "/api/server/info")).status).toBe(200);
  });

  it("creating an ontology needs Ontology Creator; the creator becomes its administrator", async () => {
    expect((await as("creator", "POST", "/api/ontologies", { key: "fair" })).status).toBe(403);
    await grant("admin", "creator", { role: "ontology_creator" });
    expect((await as("creator", "POST", "/api/ontologies", { key: "fair" })).status).toBe(201);
    for (const key of ["visitor", "staff"]) {
      expect((await as("creator", "POST", `${fair}/model/lenses`, { key, name: key })).status).toBe(201);
    }
    const roles = (await access.assignmentsOf(await idOf("creator"))).map((a) => a.role).sort();
    expect(roles).toEqual(["ontology_admin", "ontology_creator"]);
  });

  it("the creator's role is written before the ontology: a failed create takes it back, a failed role creates nothing", async () => {
    const roles = async () => (await access.assignmentsOf(await idOf("creator"))).length;
    const before = await roles();
    expect((await as("creator", "POST", "/api/ontologies", { key: "fair" })).status).toBe(409);
    expect(await roles()).toBe(before);
    const assign = access.assign;
    access.assign = async () => {
      throw new StoreError("The access database is down");
    };
    try {
      expect((await as("creator", "POST", "/api/ontologies", { key: "orphan" })).status).toBe(500);
    } finally {
      access.assign = assign;
    }
    expect((await as("admin", "GET", "/api/ontologies/orphan")).status).toBe(404);
  });

  it("lists are filtered: ontologies by any role, lenses by a lens role", async () => {
    expect(((await as("alice", "GET", "/api/ontologies")).body as Json[]).length).toBe(0);
    expect((await as("alice", "GET", fair)).status).toBe(404);
    await grant("creator", "alice", { role: "reader", ontologyKey: "fair", lensKey: "visitor" });
    expect(((await as("alice", "GET", "/api/ontologies")).body as Json[]).map((o) => o.key)).toEqual(["fair"]);
    expect(((await as("alice", "GET", `${fair}/model/lenses`)).body as Json[]).map((l) => l.key)).toEqual(["visitor"]);
    expect(((await as("creator", "GET", `${fair}/model/lenses`)).body as Json[]).length).toBe(2);
    // A Platform Administrator sees every ontology and its lenses, to assign roles.
    expect(((await as("admin", "GET", "/api/ontologies")).body as Json[]).map((o) => o.key)).toEqual(["fair"]);
    expect(((await as("admin", "GET", `${fair}/model/lenses`)).body as Json[]).length).toBe(2);
  });

  it("a Reader reads its lens, cannot write it, and knows no other lens nor the design", async () => {
    expect((await as("alice", "GET", `${visitor}/schema`)).status).toBe(200);
    const write = await as("alice", "POST", `${visitor}/changesets`, {});
    expect(write.status).toBe(403);
    expect(write.body.error).toEqual({ code: "FORBIDDEN", message: "Reader on lens 'visitor' cannot write" });
    expect((await as("alice", "GET", `${fair}/runtime/lenses/staff/schema`)).status).toBe(404);
    expect((await as("alice", "GET", `${fair}/model/entity-types`)).status).toBe(403);
    expect((await as("alice", "GET", `${fair}/runtime/rulesets`)).status).toBe(200);
    expect((await as("alice", "PUT", `${fair}/runtime/rulesets/r1`, { writeAccess: "none" })).status).toBe(403);
  });

  it("a Reader reads its lens's inclusions as its runtime serves them; the administrator as designed", async () => {
    const model = `${fair}/model`;
    for (const key of ["a", "b"]) {
      expect((await as("creator", "POST", `${model}/entity-types`, { key, displayName: key })).status).toBe(201);
    }
    const relation = { key: "a_to_b", displayName: "a to b", sourceEntityTypeKey: "a", targetEntityTypeKey: "b" };
    expect((await as("creator", "POST", `${model}/relation-types`, relation)).status).toBe(201);
    const lensId = ((await as("creator", "GET", `${model}/lenses`)).body as Json[]).find((l) => l.key === "visitor")!.lensId;
    const includes = `${model}/lenses/${lensId}/includes`;
    for (const key of ["a", "b"]) expect((await as("creator", "POST", `${includes}/entity-types`, { key })).status).toBe(201);
    expect((await as("creator", "POST", `${includes}/relation-types`, { key: "a_to_b" })).status).toBe(201);
    expect((await as("creator", "POST", `${includes}/search-indices`, { key: "b~default" })).status).toBe(201);
    // Hiding b leaves the relation type into it and b's index behind, unserved.
    const types = (await as("creator", "GET", `${model}/entity-types`)).body as Json[];
    const b = types.find((t) => t.key === "b")!.entityTypeId;
    expect((await as("creator", "DELETE", `${includes}/entity-types/${b}`)).status).toBe(204);

    const keys = async (subject: string, kind: string) =>
      ((await as(subject, "GET", `${includes}/${kind}`)).body as Json[]).map((row) => row.key);
    expect(await keys("alice", "entity-types")).toEqual(["a"]);
    expect(await keys("alice", "relation-types")).toEqual([]);
    expect(await keys("alice", "search-indices")).toEqual([]);
    expect(await keys("creator", "relation-types")).toEqual(["a_to_b"]);
    expect(await keys("creator", "search-indices")).toEqual(["b~default"]);
  });

  it("an Ontology Administrator gets no runtime data without a lens role; a Writer writes", async () => {
    expect((await as("creator", "GET", `${visitor}/schema`)).status).toBe(403);
    expect((await as("admin", "GET", `${visitor}/schema`)).status).toBe(403);
    await grant("creator", "bob", { role: "writer", ontologyKey: "fair", lensKey: "visitor" });
    expect((await as("bob", "POST", `${visitor}/changesets`, {})).status).toBe(201);
  });

  it("user management: an Ontology Administrator manages lens roles within its ontologies only", async () => {
    const aliceId = await idOf("alice");
    expect((await as("creator", "POST", `/api/users/${aliceId}/assignments`, { role: "ontology_admin", ontologyKey: "fair" })).status).toBe(403);
    expect((await as("creator", "POST", `/api/users/${aliceId}/assignments`, { role: "ontology_creator" })).status).toBe(403);
    expect((await as("alice", "GET", "/api/users")).status).toBe(403);
    const users = (await as("creator", "GET", "/api/users?search=ali")).body;
    expect(users.items.map((u: Json) => u.username)).toEqual(["alice"]);
    // The admin grants alice a role in an ontology the creator does not administer.
    await grant("admin", "admin", { role: "ontology_creator" });
    expect((await as("admin", "POST", "/api/ontologies", { key: "other" })).status).toBe(201);
    expect((await as("admin", "POST", "/api/ontologies/other/model/lenses", { key: "x", name: "x" })).status).toBe(201);
    await grant("admin", "alice", { role: "writer", ontologyKey: "other", lensKey: "x" });
    const seen = (await as("creator", "GET", `/api/users/${aliceId}`)).body.assignments as Json[];
    expect(seen.map((a) => [a.role, a.ontologyKey, a.lensKey])).toEqual([["reader", "fair", "visitor"]]);
    const all = (await as("admin", "GET", `/api/users/${aliceId}`)).body.assignments as Json[];
    expect(all).toHaveLength(2);
    const other = all.find((a) => a.ontologyKey === "other")!;
    expect((await as("creator", "DELETE", `/api/users/${aliceId}/assignments/${other.id}`)).status).toBe(404);
    expect((await as("creator", "GET", "/api/ontologies/other/access")).status).toBe(404);
  });

  it("an ontology's access list holds its administrators and lens roles with their users", async () => {
    const list = (await as("creator", "GET", `${fair}/access`)).body.assignments as Json[];
    expect(list.map((a) => [(a.user as Json).username, a.role, a.lensKey]).sort()).toEqual([
      ["alice", "reader", "visitor"],
      ["bob", "writer", "visitor"],
      ["creator", "ontology_admin", null],
    ]);
    expect((await as("bob", "GET", `${fair}/access`)).status).toBe(403);
  });

  it("status and service principals are a Platform Administrator's", async () => {
    const bobId = await idOf("bob");
    expect((await as("creator", "PATCH", `/api/users/${bobId}`, { status: "disabled" })).status).toBe(403);
    expect((await as("admin", "PATCH", `/api/users/${await idOf("admin")}`, { status: "disabled" })).status).toBe(409);
    expect((await as("admin", "PATCH", `/api/users/${bobId}`, { status: "disabled" })).body.status).toBe("disabled");
    expect((await as("bob", "GET", "/api/ontologies")).status).toBe(403);
    expect((await as("admin", "PATCH", `/api/users/${bobId}`, { status: "active" })).status).toBe(200);
    const service = { kind: "service", displayName: "Importer", subject: "importer" };
    const admitted = await as("admin", "POST", "/api/users", service);
    expect(admitted.status).toBe(201);
    expect(admitted.body.kind).toBe("service");
    expect((await as("admin", "POST", "/api/users", service)).status).toBe(409);
    // A service whose token called first is a role-less user until it is admitted.
    expect((await as("early-service", "GET", "/api/ontologies")).status).toBe(200);
    const early = await as("admin", "POST", "/api/users", { ...service, subject: "early-service" });
    expect(early.status).toBe(201);
    expect(early.body).toMatchObject({ id: await idOf("early-service"), kind: "service", displayName: "Importer" });
  });

  it("the configured administrator is neither disabled nor demoted by another administrator", async () => {
    const adminId = await idOf("admin");
    const bobRole = await grant("admin", "bob", { role: "platform_admin" });
    const disable = await as("bob", "PATCH", `/api/users/${adminId}`, { status: "disabled" });
    expect(disable.status).toBe(409);
    expect(disable.body.error.message).toContain("change AUTH_ADMIN_SUBJECT first");
    const role = (await access.assignmentsOf(adminId)).find((a) => a.role === "platform_admin")!;
    expect((await as("bob", "DELETE", `/api/users/${adminId}/assignments/${role.id}`)).status).toBe(409);
    expect((await as("admin", "DELETE", `/api/users/${await idOf("bob")}/assignments/${bobRole.id}`)).status).toBe(204);
  });

  it("a Reader's runtime MCP mount lists only reads and refuses a write call", async () => {
    const connect = async (subject: string) => {
      const client = new Client({ name: "access-tests", version: "0.0.1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ontologies/fair/runtime/lenses/visitor`), {
          requestInit: { headers: { authorization: `Bearer ${subject}` } },
        }),
      );
      return client;
    };
    const reader = await connect("alice");
    const writer = await connect("bob");
    try {
      const names = (await reader.listTools()).tools.map((t) => t.name);
      expect(names).toContain("get_schema");
      expect(names).not.toContain("create_entity");
      expect(names).not.toContain("start_changeset");
      expect((await writer.listTools()).tools.map((t) => t.name)).toContain("create_entity");
      const refused = (await reader.callTool({ name: "start_changeset", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toBe("Error executing tool start_changeset: Reader on lens 'visitor' cannot write");
    } finally {
      await reader.close();
      await writer.close();
    }
    // The modeling mount needs the ontology's administrator.
    const res = await fetch(`${baseUrl}/mcp/ontologies/fair/model`, {
      method: "POST",
      headers: { authorization: "Bearer alice", "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });

  it("a Proposer stages and submits a changeset, cannot write directly nor commit; a Writer commits it", async () => {
    expect((await as("carol", "GET", "/api/ontologies")).status).toBe(200);
    await grant("creator", "carol", { role: "proposer", ontologyKey: "fair", lensKey: "visitor" });
    expect((await as("carol", "GET", `${visitor}/schema`)).status).toBe(200);
    const direct = await as("carol", "POST", `${visitor}/entities/a`, {});
    expect(direct.status).toBe(403);
    expect(direct.body.error).toEqual({
      code: "FORBIDDEN",
      message: "Proposer on lens 'visitor' cannot write directly; stage the write into a changeset",
    });

    const started = await as("carol", "POST", `${visitor}/changesets`, {});
    expect(started.status).toBe(201);
    const changeset = `${visitor}/changesets/${started.body.id as string}`;
    const staged = await as("carol", "POST", `${changeset}/writes`, { operation: "create_entity", type: "a", properties: {} });
    expect(staged.status, JSON.stringify(staged.body)).toBe(201);
    expect((await as("carol", "POST", `${changeset}/check`)).status).toBe(200);
    expect((await as("carol", "POST", `${changeset}/submit`, {})).status).toBe(200);
    const commit = await as("carol", "POST", `${changeset}/commit`);
    expect(commit.status).toBe(403);
    expect(commit.body.error.message).toBe(
      "Proposer on lens 'visitor' cannot commit; submit the changeset, and a Writer commits it",
    );
    expect((await as("bob", "POST", `${changeset}/commit`)).status).toBe(200);
    expect(((await as("carol", "GET", `${visitor}/entities/a`)).body.items as Json[]).length).toBe(1);

    // Its MCP mount offers what a 'propose' ruleset offers, and refuses the rest.
    const client = await mcpAs("carol", "/mcp/ontologies/fair/runtime/lenses/visitor");
    try {
      const tools = (await client.listTools()).tools;
      const names = tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["start_changeset", "submit_changeset", "create_entity"]));
      expect(names).not.toContain("commit_changeset");
      expect(tools.find((t) => t.name === "create_entity")!.inputSchema.required).toContain("changeset_id");
      const refused = (await client.callTool({ name: "commit_changeset", arguments: { changeset_id: started.body.id } })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toContain("Proposer on lens 'visitor' cannot commit");
    } finally {
      await client.close();
    }
  });

  it("deleting a lens over MCP removes its assignments too", async () => {
    expect((await as("creator", "POST", `${fair}/model/lenses`, { key: "temp", name: "temp" })).status).toBe(201);
    const assignment = await grant("creator", "alice", { role: "reader", ontologyKey: "fair", lensKey: "temp" });
    const client = await mcpAs("creator", "/mcp/ontologies/fair/model");
    try {
      const result = (await client.callTool({ name: "delete_lens", arguments: { lens_key: "temp" } })) as { isError?: boolean };
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    expect(await access.assignment(assignment.id as string)).toBeNull();
  });

  it("deleting a lens or an ontology removes its assignments", async () => {
    const lenses = (await as("creator", "GET", `${fair}/model/lenses`)).body as Json[];
    const lensId = lenses.find((l) => l.key === "visitor")!.lensId as string;
    const fairId = (await as("creator", "GET", fair)).body.ontologyId as string;
    expect((await as("creator", "DELETE", `${fair}/model/lenses/${lensId}`)).status).toBe(200);
    expect((await access.assignmentsInOntology(fairId)).filter((a) => a.lensId !== null)).toEqual([]);
    expect((await as("alice", "GET", "/api/ontologies")).body.map((o: Json) => o.key)).toEqual(["other"]);
    // A role a deleted lens left behind reveals nothing.
    await access.assign({ principalId: await idOf("alice"), role: "reader", ontologyId: fairId, lensId: randomUUID() }, await idOf("creator"));
    expect((await as("alice", "GET", "/api/ontologies")).body.map((o: Json) => o.key)).toEqual(["other"]);
    expect((await as("alice", "GET", fair)).status).toBe(404);
    expect((await as("alice", "GET", `${fair}/runtime/rulesets`)).status).toBe(404);
    expect((await as("creator", "DELETE", fair)).status).toBe(204);
    expect(await access.assignmentsInOntology(fairId)).toEqual([]);
    expect((await as("creator", "GET", "/api/ontologies")).body).toEqual([]);
  });
});
