/**
 * The authorization server end to end, on two app instances over one real
 * access database (`ontoforge_access_test`) with a stub identity provider:
 * a configured client authorizes with the requests going to both instances
 * in turn, redeems its code on the other, calls the REST API and an MCP
 * mount, refreshes with rotation; the refusals — a reused refresh token, a
 * wrong resource, a token on another mount, a disabled principal, Deny.
 */

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AccessStore } from "../../src/access/store.js";
import { openAccessStore } from "../../src/adapters/postgres/accessStore.js";
import { createApp } from "../../src/app.js";
import { createAuthorizationServer } from "../../src/auth/authorizationServer.js";
import type { Identified, LoginStart } from "../../src/auth/oidc.js";
import type { AuthRuntime } from "../../src/auth/runtime.js";
import { settings, type AuthSettings } from "../../src/config.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { authorize, Jar, pkce, token } from "../auth/oauthFlow.js";
import { wipeDatabase } from "./reset.js";

const DATABASE = "ontoforge_access_test";
const ISSUER = "http://issuer.test/realms/x";
const PUBLIC_URL = "http://localhost:8000";
const CLIENT = "ontoforge-cli";
const REDIRECT = "http://127.0.0.1:51234/callback";
const API = `${PUBLIC_URL}/api`;
const VISITOR = "/mcp/ontologies/fair/runtime/lenses/visitor";
const STAFF = "/mcp/ontologies/fair/runtime/lenses/staff";

function databaseUrl(): string {
  const url = new URL(settings.DB_URI);
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

async function query(sql: string): Promise<pg.QueryResult> {
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
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

const identity = (subject: string): Identified => ({
  issuer: ISSUER,
  subject,
  displayName: subject,
  email: `${subject}@x.test`,
  username: subject,
});

/** Who signs in at the stub provider next. */
let signingIn = "alice";

const SETTINGS = {
  issuer: ISSUER,
  adminSubject: "admin",
  publicUrl: PUBLIC_URL,
  webClientUrl: null,
  clientSecret: "y".repeat(32),
  oauthClients: [{ id: CLIENT, name: "OntoForge CLI", redirectUris: ["http://127.0.0.1/callback"] }],
  oauthClientHosts: null,
} as unknown as AuthSettings;

/** One server instance: its own access store and authorization server over the shared database. */
async function instance(): Promise<{ app: FastifyInstance; access: AccessStore }> {
  const access = await openAccessStore(databaseUrl(), settings.DB_USER, settings.DB_PASSWORD);
  const oidc = {
    async startLogin(redirectUri: string): Promise<LoginStart> {
      const state = randomUUID();
      return { state, nonce: "n", codeVerifier: "v", url: new URL(`${ISSUER}/auth?state=${state}&redirect_uri=${redirectUri}`) };
    },
    finishLogin: async () => identity(signingIn),
    // The stub provider's JWTs are `jwt.<subject>.sig`.
    verifyAccessToken: async (value: string) => identity(value.split(".")[1]!),
    logoutUrl: (to: string) => to,
  };
  const runtime = {
    settings: SETTINGS,
    oidc,
    access,
    sessions: { get: async () => null, create: async () => {}, delete: async () => {} },
    oauth: createAuthorizationServer(SETTINGS, access),
  } as unknown as AuthRuntime;
  const app = await createApp(undefined, runtime);
  await app.ready();
  return { app, access };
}

let a: FastifyInstance;
let b: FastifyInstance;
let access: AccessStore;

type Json = Record<string, unknown>;

async function call(app: FastifyInstance, authorization: string, method: string, url: string, payload?: object) {
  const res = await app.inject({ method: method as "GET", url, headers: { authorization }, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.body === "" ? null : (res.json() as Json), headers: res.headers };
}

const admin = (method: string, url: string, payload?: object) => call(a, "Bearer jwt.admin.sig", method, url, payload);

async function toolsList(app: FastifyInstance, path: string, accessToken: string) {
  const res = await app.inject({
    method: "POST",
    url: path,
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** Authorizes the CLI for `resource` with the browser's requests going to both instances, redeems on `b`. */
async function tokensFor(resource: string): Promise<Tokens> {
  const { verifier, challenge } = pkce();
  const outcome = await authorize([a, b], new Jar(), { clientId: CLIENT, redirectUri: REDIRECT, resource, challenge }, {
    publicUrl: PUBLIC_URL,
    providerOrigin: new URL(ISSUER).origin,
  });
  const code = outcome.location?.searchParams.get("code");
  expect(code, outcome.page?.body).toEqual(expect.any(String));
  const issued = await token(b, { grant_type: "authorization_code", code: code!, redirect_uri: REDIRECT, code_verifier: verifier, client_id: CLIENT, resource });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return issued.body as unknown as Tokens;
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  const first = await instance();
  a = first.app;
  access = first.access;
  await query("TRUNCATE audit, assignment, identity, principal, oauth_record");
  b = (await instance()).app;
  // The administrator sets up an ontology with two lenses; alice reads one.
  expect((await admin("GET", "/api/ontologies")).status).toBe(200);
  const adminId = (await access.principalOf(ISSUER, "admin"))!.id;
  expect((await admin("POST", `/api/users/${adminId}/assignments`, { role: "ontology_creator" })).status).toBe(201);
  expect((await admin("POST", "/api/ontologies", { key: "fair" })).status).toBe(201);
  for (const key of ["visitor", "staff"]) {
    expect((await admin("POST", "/api/ontologies/fair/model/lenses", { key, name: key })).status).toBe(201);
  }
  await access.signIn(ISSUER, "alice", { displayName: "alice", email: null, username: "alice" }, false);
  const aliceId = (await access.principalOf(ISSUER, "alice"))!.id;
  expect((await admin("POST", `/api/users/${aliceId}/assignments`, { role: "reader", ontologyKey: "fair", lensKey: "visitor" })).status).toBe(201);
});

afterAll(async () => {
  await a?.close();
  await b?.close();
  await wipeDatabase();
  await closeStores();
});

describe("the authorization server on two instances", () => {
  it("publishes the same metadata on both", async () => {
    const [ma, mb] = await Promise.all([a, b].map((app) => app.inject({ url: "/.well-known/oauth-authorization-server" })));
    expect(ma!.json()).toEqual(mb!.json());
    expect(ma!.json().issuer).toBe(PUBLIC_URL);
  });

  it("issues a REST API token that opens /api/* as the person, and nothing else", async () => {
    const tokens = await tokensFor(API);
    const bearer = `Bearer ${tokens.access_token}`;
    const ontologies = await call(a, bearer, "GET", "/api/ontologies");
    expect(ontologies.status).toBe(200);
    expect((ontologies.body as unknown as Json[]).map((o) => o.key)).toEqual(["fair"]);
    expect((await call(b, bearer, "GET", "/api/ontologies/fair/runtime/lenses/visitor/schema")).status).toBe(200);
    // Roles still decide: alice reads no other lens.
    expect((await call(a, bearer, "GET", "/api/ontologies/fair/runtime/lenses/staff/schema")).status).toBe(404);
    // Not an MCP mount's token.
    const mcp = await toolsList(a, VISITOR, tokens.access_token);
    expect(mcp.status).toBe(401);
    expect(mcp.headers["www-authenticate"]).toContain('error="invalid_token"');
    // The database holds digests, never the tokens.
    const rows = await query("SELECT id, payload::text AS payload FROM oauth_record");
    const stored = JSON.stringify(rows.rows);
    expect(stored).not.toContain(tokens.access_token);
    expect(stored).not.toContain(tokens.refresh_token);
    expect(rows.rows.every((r) => /^[0-9a-f]{64}$/.test(r.id as string))).toBe(true);
  });

  it("issues an MCP mount's token that opens that mount only", async () => {
    const tokens = await tokensFor(`${PUBLIC_URL}${VISITOR}`);
    const listed = await toolsList(b, VISITOR, tokens.access_token);
    expect(listed.status, listed.body).toBe(200);
    const names = (JSON.parse(listed.body).result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain("get_schema");
    expect(names).not.toContain("create_entity");
    expect((await toolsList(a, STAFF, tokens.access_token)).status).toBe(401);
    expect((await toolsList(a, `${VISITOR}/rulesets/r1`, tokens.access_token)).status).toBe(401);
    expect((await call(a, `Bearer ${tokens.access_token}`, "GET", "/api/ontologies")).status).toBe(401);
  });

  it("rotates refresh tokens across instances; a reused one is refused and ends the chain", async () => {
    const first = await tokensFor(API);
    const refreshed = await token(a, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT });
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    const second = refreshed.body as unknown as Tokens;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await call(b, `Bearer ${second.access_token}`, "GET", "/api/ontologies")).status).toBe(200);

    const reused = await token(b, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT });
    expect(reused.status).toBe(400);
    expect(reused.body.error).toBe("invalid_grant");
    // Reuse revokes the whole grant: the rotated tokens stop working too.
    expect((await token(a, { grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: CLIENT })).body.error).toBe("invalid_grant");
    expect((await call(a, `Bearer ${second.access_token}`, "GET", "/api/ontologies")).status).toBe(401);
  });

  it("redeems a code once", async () => {
    const { verifier, challenge } = pkce();
    const outcome = await authorize([a], new Jar(), { clientId: CLIENT, redirectUri: REDIRECT, resource: API, challenge }, {
      publicUrl: PUBLIC_URL,
      providerOrigin: new URL(ISSUER).origin,
    });
    const form = { grant_type: "authorization_code", code: outcome.location!.searchParams.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier, client_id: CLIENT };
    const [one, two] = await Promise.all([token(a, form), token(b, form)]);
    expect([one.status, two.status].sort()).toEqual([200, 400]);
  });

  it("refuses a resource it does not serve with invalid_target", async () => {
    const outcome = await authorize([a, b], new Jar(), {
      clientId: CLIENT,
      redirectUri: REDIRECT,
      resource: `${PUBLIC_URL}/api/ontologies`,
      challenge: pkce().challenge,
    }, { publicUrl: PUBLIC_URL, providerOrigin: new URL(ISSUER).origin });
    expect(outcome.location?.searchParams.get("error")).toBe("invalid_target");
  });

  it("answers Deny with access_denied", async () => {
    const outcome = await authorize([b, a], new Jar(), {
      clientId: CLIENT,
      redirectUri: REDIRECT,
      resource: API,
      challenge: pkce().challenge,
    }, { publicUrl: PUBLIC_URL, providerOrigin: new URL(ISSUER).origin, decision: "deny" });
    expect(outcome.location?.searchParams.get("error")).toBe("access_denied");
    expect(outcome.location?.searchParams.get("code")).toBeNull();
  });

  it("refuses a disabled principal at once: its token, its refresh and a new authorization", async () => {
    const tokens = await tokensFor(API);
    const aliceId = (await access.principalOf(ISSUER, "alice"))!.id;
    expect((await admin("PATCH", `/api/users/${aliceId}`, { status: "disabled" })).status).toBe(200);
    try {
      expect((await call(b, `Bearer ${tokens.access_token}`, "GET", "/api/ontologies")).status).toBe(403);
      expect((await token(a, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT })).body.error).toBe("invalid_grant");
      const outcome = await authorize([a, b], new Jar(), {
        clientId: CLIENT,
        redirectUri: REDIRECT,
        resource: API,
        challenge: pkce().challenge,
      }, { publicUrl: PUBLIC_URL, providerOrigin: new URL(ISSUER).origin });
      expect(outcome.page?.statusCode).toBe(403);
      expect(outcome.page?.body).toContain("This account is disabled");
    } finally {
      expect((await admin("PATCH", `/api/users/${aliceId}`, { status: "active" })).status).toBe(200);
    }
  });

  it("keeps provider JWTs working beside its own tokens", async () => {
    expect((await call(b, "Bearer jwt.alice.sig", "GET", "/api/ontologies")).status).toBe(200);
  });
});
