/**
 * Authentication on the whole app: the 401 and 403 envelopes with their
 * challenges, CSRF, CORS, resource metadata, `me`, and the browser sign-in
 * round trip — against a fake provider, access store and registry.
 */

import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeRuntime, identified, ISSUER, PUBLIC_URL, SETTINGS, WEB_CLIENT_URL, type Fakes } from "./fakes.js";

const ONTOLOGY_ID = "00000000-0000-4000-8000-000000000001";
const LENS_ID = "00000000-0000-4000-8000-000000000002";

vi.mock("../../src/core/ports.js", () => ({
  getOntologyRegistry: () => ({
    listOntologies: async () => [{ ontologyId: ONTOLOGY_ID, key: "books", displayName: null }],
    getOntology: async () => null,
  }),
  getModelingStore: async () => ({ listLenses: async () => [{ lensId: LENS_ID, key: "public" }] }),
  getRuntimeStore: async () => ({}),
  supportsKeywordRanking: async () => false,
}));

const SESSION_COOKIE = "ontoforge_session_5173";
const LOGIN_COOKIE = "ontoforge_login_5173";

function setCookies(res: LightMyRequestResponse): string[] {
  const header = res.headers["set-cookie"];
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
}

function cookieValue(res: LightMyRequestResponse, name: string): string | undefined {
  const cookie = setCookies(res).find((c) => c.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1).split(";")[0];
}

let fakes: Fakes;
let app: FastifyInstance;
let off: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  fakes = fakeRuntime();
  app = await createApp(undefined, fakes.runtime);
  await app.ready();
  off = await createApp();
  await off.ready();
});
afterAll(async () => {
  await app.close();
  await off.close();
});

async function sessionOf(subject: string): Promise<string> {
  const principal = (await fakes.access.principalOf(ISSUER, subject)) ?? fakes.access.add(subject);
  const id = `session-${subject}-${Math.random()}`;
  await fakes.runtime.sessions.create(id, { principalId: principal.id });
  return id;
}

describe("with authentication on", () => {
  beforeEach(() => fakes.oidc.tokens.clear());

  it("says so in the server description and in me", async () => {
    expect((await app.inject({ url: "/api/server/info" })).json()).toMatchObject({ authentication: true });
    expect((await app.inject({ url: "/api/auth/me" })).json()).toEqual({ authentication: true, user: null, assignments: [] });
    // An unusable token is no sign-in, never a 401 here.
    const res = await app.inject({ url: "/api/auth/me", headers: { authorization: "Bearer junk" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toBeNull();
  });

  it("answers an anonymous request 401 with a bearer challenge", async () => {
    const res = await app.inject({ url: "/api/ontologies" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: expect.any(String) } });
    expect(res.headers["www-authenticate"]).toBe('Bearer realm="ontoforge"');
  });

  it("names a rejected token in the challenge", async () => {
    const res = await app.inject({ url: "/api/ontologies", headers: { authorization: "Bearer junk" } });
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toBe('Bearer realm="ontoforge", error="invalid_token"');
  });

  it("points an MCP client to the mount's resource metadata, before the transport takes over", async () => {
    const url = "/mcp/ontologies/books/runtime/lenses/public";
    const cookie = `${SESSION_COOKIE}=${await sessionOf("reader")}`;
    for (const headers of [{}, { cookie }]) {
      const res = await app.inject({ method: "POST", url, headers, payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
      expect(res.headers["www-authenticate"]).toBe(
        `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource${url}", scope="ontoforge-api"`,
      );
    }
  });

  it("answers an authenticated caller without the role 403", async () => {
    fakes.oidc.tokens.set("t", identified("plain"));
    const res = await app.inject({ method: "POST", url: "/api/ontologies", headers: { authorization: "Bearer t" }, payload: { key: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: "FORBIDDEN", message: expect.stringMatching(/Ontology Creator/) } });
  });

  it("answers 503 while the provider's keys cannot be fetched, admitting nothing", async () => {
    fakes.oidc.tokens.set("t", identified("plain"));
    fakes.oidc.unavailable = true;
    try {
      const res = await app.inject({ url: "/api/ontologies", headers: { authorization: "Bearer t" } });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        error: { code: "PROVIDER_UNAVAILABLE", message: "The identity provider cannot be reached; try again later" },
      });
    } finally {
      fakes.oidc.unavailable = false;
    }
  });

  it("refuses a cookie-authenticated change from another origin before judging the role", async () => {
    const cookie = `${SESSION_COOKIE}=${await sessionOf("plain")}`;
    const crossSite = await app.inject({ method: "POST", url: "/api/ontologies", headers: { cookie, origin: "http://evil.example.com" }, payload: { key: "x" } });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json().error.message).toMatch(/own origin/);
    const sameSite = await app.inject({ method: "POST", url: "/api/ontologies", headers: { cookie, origin: WEB_CLIENT_URL }, payload: { key: "x" } });
    expect(sameSite.statusCode).toBe(403);
    expect(sameSite.json().error.message).toMatch(/Ontology Creator/);
  });

  it("allows CORS without credentials and exposes the challenge", async () => {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/ontologies",
      headers: { origin: "http://elsewhere.example.com", "access-control-request-method": "GET" },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
    const refused = await app.inject({ url: "/api/ontologies", headers: { origin: "http://elsewhere.example.com" } });
    expect(refused.statusCode).toBe(401);
    expect(refused.headers["access-control-allow-origin"]).toBe("http://elsewhere.example.com");
    expect(refused.headers["access-control-expose-headers"]).toMatch(/WWW-Authenticate/i);
  });

  it("publishes protected-resource metadata for the server and each mount", async () => {
    const expected = (resource: string) => ({
      resource,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ["header"],
      scopes_supported: ["ontoforge-api"],
    });
    expect((await app.inject({ url: "/.well-known/oauth-protected-resource" })).json()).toEqual(expected(PUBLIC_URL));
    const mount = "/mcp/ontologies/books/runtime/lenses/public";
    expect((await app.inject({ url: `/.well-known/oauth-protected-resource${mount}` })).json()).toEqual(
      expected(`${PUBLIC_URL}${mount}`),
    );
  });

  it("tells the signed-in caller who it is, with the keys of its assignments", async () => {
    const id = await sessionOf("reader");
    const principal = (await fakes.access.principalOf(ISSUER, "reader"))!;
    fakes.access.grant(principal.id, "reader", ONTOLOGY_ID, LENS_ID);
    fakes.access.grant(principal.id, "writer", ONTOLOGY_ID, "00000000-0000-4000-8000-0000000000ff");
    fakes.access.grant(principal.id, "ontology_admin", "00000000-0000-4000-8000-0000000000fe");
    fakes.access.grant(principal.id, "ontology_creator");
    const res = await app.inject({ url: "/api/auth/me", headers: { cookie: `${SESSION_COOKIE}=${id}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ id: principal.id, kind: "user", username: "reader", status: "active", lastLoginAt: null });
    expect(body.assignments.map((a: { role: string; ontologyKey: string | null; lensKey: string | null }) => [a.role, a.ontologyKey, a.lensKey])).toEqual([
      ["reader", "books", "public"],
      ["ontology_creator", null, null],
    ]);
  });
});

describe("browser sign-in", () => {
  async function startLogin(returnTo: string) {
    const res = await app.inject({ url: `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.searchParams.get("redirect_uri")).toBe(`${WEB_CLIENT_URL}/api/auth/callback`);
    const login = setCookies(res).find((c) => c.startsWith(`${LOGIN_COOKIE}=`))!;
    expect(login).toMatch(/; Path=\/api\/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    return { state: location.searchParams.get("state")!, cookie: `${LOGIN_COOKIE}=${cookieValue(res, LOGIN_COOKIE)}` };
  }

  it("goes to the provider and back, provisions the principal and starts a session", async () => {
    fakes.oidc.login = identified("newcomer");
    const { state, cookie } = await startLogin("/workbench/books?lens=public");
    const res = await app.inject({ url: `/api/auth/callback?code=c1&state=${state}`, headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/workbench/books?lens=public");
    const finished = fakes.oidc.finished.at(-1)!;
    expect(finished.callbackUrl.toString()).toBe(`${WEB_CLIENT_URL}/api/auth/callback?code=c1&state=${state}`);
    expect(finished.checks.state).toBe(state);
    expect(fakes.access.calls).toContain("signIn newcomer false");
    expect(setCookies(res)).toContain(`${LOGIN_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    const sessionId = cookieValue(res, SESSION_COOKIE)!;
    expect(setCookies(res)).toContain(`${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax`);

    const me = await app.inject({ url: "/api/auth/me", headers: { cookie: `${SESSION_COOKIE}=${sessionId}` } });
    expect(me.json()).toMatchObject({ authentication: true, user: { username: "newcomer" }, assignments: [] });

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: `${SESSION_COOKIE}=${sessionId}`, origin: WEB_CLIENT_URL } });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ logoutUrl: fakes.oidc.logoutUrl(`${WEB_CLIENT_URL}/`) });
    expect(setCookies(logout)).toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    expect(await fakes.runtime.sessions.get(sessionId)).toBeNull();
  });

  it("makes the configured administrator's sign-in a bootstrap", async () => {
    fakes.oidc.login = identified(fakes.runtime.settings.adminSubject);
    const { state, cookie } = await startLogin("/");
    await app.inject({ url: `/api/auth/callback?code=c&state=${state}`, headers: { cookie } });
    expect(fakes.access.calls).toContain(`signIn ${fakes.runtime.settings.adminSubject} true`);
  });

  it("sends an unsafe returnTo home", async () => {
    fakes.oidc.login = identified("newcomer");
    const { state, cookie } = await startLogin("https://evil.example.com/x");
    const res = await app.inject({ url: `/api/auth/callback?code=c&state=${state}`, headers: { cookie } });
    expect(res.headers.location).toBe("/");
  });

  it("fails without the login cookie, with another state, or when the provider refuses", async () => {
    const { state, cookie } = await startLogin("/");
    const attempts = [
      { url: `/api/auth/callback?code=c&state=${state}`, headers: {} },
      { url: "/api/auth/callback?code=c&state=forged", headers: { cookie } },
      { url: `/api/auth/callback?code=c&state=${state}`, headers: { cookie: `${LOGIN_COOKIE}=tampered` } },
    ];
    for (const attempt of attempts) {
      const res = await app.inject(attempt);
      expect(res.statusCode, attempt.url).toBe(302);
      expect(res.headers.location).toBe("/?login=failed");
      expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
    }
    fakes.oidc.login = new Error("invalid_grant");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = await app.inject({ url: `/api/auth/callback?error=access_denied&state=${state}`, headers: { cookie } });
    errors.mockRestore();
    expect(refused.headers.location).toBe("/?login=failed");
  });

  it("starts no session for a disabled account", async () => {
    fakes.access.add("blocked", "disabled");
    fakes.oidc.login = identified("blocked");
    const { state, cookie } = await startLogin("/");
    const res = await app.inject({ url: `/api/auth/callback?code=c&state=${state}`, headers: { cookie } });
    expect(res.headers.location).toBe("/?login=disabled");
    expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("refuses a cross-site logout of a session", async () => {
    const id = await sessionOf("reader");
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: `${SESSION_COOKIE}=${id}`, origin: "http://evil.example.com" } });
    expect(res.statusCode).toBe(403);
    expect(await fakes.runtime.sessions.get(id)).not.toBeNull();
  });
});

describe("without a web client", () => {
  let bare: FastifyInstance;
  let bareFakes: Fakes;
  beforeAll(async () => {
    const { createApp } = await import("../../src/app.js");
    bareFakes = fakeRuntime({ ...SETTINGS, webClientUrl: null });
    bare = await createApp(undefined, bareFakes.runtime);
    await bare.ready();
  });
  afterAll(async () => {
    await bare.close();
  });

  it("mounts no browser sign-in and reads no session cookie", async () => {
    for (const [method, url] of [["GET", "/api/auth/login"], ["GET", "/api/auth/callback"], ["POST", "/api/auth/logout"]] as const) {
      expect((await bare.inject({ method, url })).statusCode, url).toBe(404);
    }
    const principal = bareFakes.access.add("reader");
    await bareFakes.runtime.sessions.create("s1", { principalId: principal.id });
    const cookie = `${SESSION_COOKIE}=s1`;
    expect((await bare.inject({ url: "/api/auth/me", headers: { cookie } })).json()).toEqual({ authentication: true, user: null, assignments: [] });
    const write = await bare.inject({ method: "POST", url: "/api/ontologies", headers: { cookie, origin: WEB_CLIENT_URL }, payload: { key: "x" } });
    expect(write.statusCode).toBe(401);
  });

  it("still serves bearer callers and MCP sign-in under PUBLIC_URL", async () => {
    bareFakes.oidc.tokens.set("t", identified("plain"));
    const me = await bare.inject({ url: "/api/auth/me", headers: { authorization: "Bearer t" } });
    expect(me.json()).toMatchObject({ authentication: true, user: { username: "plain" } });
    const mount = "/mcp/ontologies/books/runtime/lenses/public";
    expect((await bare.inject({ url: `/.well-known/oauth-protected-resource${mount}` })).json()).toMatchObject({
      resource: `${PUBLIC_URL}${mount}`,
    });
  });
});

describe("with authentication off", () => {
  it("says so, mounts no sign-in and trusts every request", async () => {
    expect((await off.inject({ url: "/api/auth/me" })).json()).toEqual({ authentication: false });
    expect((await off.inject({ url: "/api/server/info" })).json()).toMatchObject({ authentication: false });
    for (const url of ["/api/auth/login", "/.well-known/oauth-protected-resource", "/api/users"]) {
      expect((await off.inject({ url })).statusCode, url).toBe(404);
    }
    const preflight = await off.inject({
      method: "OPTIONS",
      url: "/api/ontologies",
      headers: { origin: "http://elsewhere.example.com", "access-control-request-method": "GET" },
    });
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
  });
});
