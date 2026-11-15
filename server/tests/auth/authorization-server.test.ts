/**
 * The authorization server on the app, against the fake provider and the
 * fake access store: its metadata, the authorization of a configured client
 * and of a client metadata document, the refusals, the consent page's
 * protections, CORS of the token endpoint, and a clean configuration (no
 * warning of the library).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { authorize, Jar, pkce, token, visit } from "./oauthFlow.js";
import { fakeRuntime, identified, ISSUER, PUBLIC_URL, SETTINGS, type Fakes } from "./fakes.js";

vi.mock("../../src/core/ports.js", () => ({
  getOntologyRegistry: () => ({ listOntologies: async () => [], getOntology: async () => null }),
  getModelingStore: async () => ({ listLenses: async () => [] }),
  getRuntimeStore: async () => ({}),
  supportsKeywordRanking: async () => false,
}));

const CLI = "ontoforge-cli";
const MOUNT = `${PUBLIC_URL}/mcp/ontologies/books/runtime/lenses/public`;
const API = `${PUBLIC_URL}/api`;
const PROVIDER = new URL(ISSUER).origin;
const CIMD = "https://client.example.com/oauth/metadata.json";

let fakes: Fakes;
let app: FastifyInstance;
const notices: string[] = [];

beforeAll(async () => {
  for (const level of ["info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void notices.push(args.join(" ")));
  }
  const { createApp } = await import("../../src/app.js");
  fakes = fakeRuntime({ ...SETTINGS, oauthClients: [{ id: CLI, name: "OntoForge CLI", redirectUris: ["http://127.0.0.1/callback"] }] });
  fakes.oidc.login = identified("alice");
  app = await createApp(undefined, fakes.runtime);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

const flow = (request: Partial<Parameters<typeof authorize>[2]> & { challenge: string }, decision: "allow" | "deny" = "allow") =>
  authorize(
    [app],
    new Jar(),
    { clientId: CLI, redirectUri: "http://127.0.0.1:43210/callback", resource: MOUNT, ...request },
    { publicUrl: PUBLIC_URL, providerOrigin: PROVIDER, decision },
  );

describe("the authorization server", () => {
  it("publishes its metadata at the issuer's well-known address, readable cross-origin", async () => {
    const res = await app.inject({ url: "/.well-known/oauth-authorization-server", headers: { origin: "chrome-extension://abc" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://abc");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    const metadata = res.json();
    expect(metadata).toMatchObject({
      issuer: PUBLIC_URL,
      authorization_endpoint: `${PUBLIC_URL}/oauth/authorize`,
      token_endpoint: `${PUBLIC_URL}/oauth/token`,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(metadata.registration_endpoint).toBeUndefined();
    expect(metadata.scopes_supported).toContain("ontoforge");
  });

  it("takes its URLs from PUBLIC_URL, whatever host a request names", async () => {
    const res = await app.inject({ url: "/.well-known/oauth-authorization-server", headers: { host: "evil.example.com", "x-forwarded-host": "evil.example.com" } });
    expect(res.json().token_endpoint).toBe(`${PUBLIC_URL}/oauth/token`);
  });

  it("authorizes a configured client on any loopback port, and its token opens the REST API only", async () => {
    const { verifier, challenge } = pkce();
    const outcome = await flow({ challenge, resource: API });
    expect(outcome.consent).toContain("OntoForge CLI");
    expect(outcome.consent).toContain("the REST API, with everything your roles allow");
    expect(outcome.consent).toContain("http://127.0.0.1:43210/callback");
    const answer = outcome.location!;
    expect(answer.origin + answer.pathname).toBe("http://127.0.0.1:43210/callback");
    expect(answer.searchParams.get("state")).toBe("client-state");
    expect(answer.searchParams.get("iss")).toBe(PUBLIC_URL);
    const issued = await token(app, {
      grant_type: "authorization_code",
      code: answer.searchParams.get("code")!,
      redirect_uri: "http://127.0.0.1:43210/callback",
      code_verifier: verifier,
      client_id: CLI,
      resource: API,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(issued.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "ontoforge" });
    expect(issued.body.refresh_token).toEqual(expect.any(String));
    expect(issued.body.id_token).toBeUndefined();
    const accessToken = issued.body.access_token as string;
    expect(accessToken.split(".")).toHaveLength(1);
    // Not the token itself in storage: digests only.
    expect(JSON.stringify([...fakes.access.oauth.records])).not.toContain(accessToken);

    const me = await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.json().user).toMatchObject({ username: "alice" });
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp/ontologies/books/runtime/lenses/public",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(mcp.statusCode).toBe(401);
    expect(fakes.oidc.verifications).toBe(0);
  });

  it("refuses a resource it does not serve, a second resource and a missing one with invalid_target", async () => {
    for (const resource of [`${PUBLIC_URL}/elsewhere`, "https://other.example.com/api", [MOUNT, API], undefined]) {
      const outcome = await flow({ challenge: pkce().challenge, resource });
      expect(outcome.location?.searchParams.get("error"), JSON.stringify(resource)).toBe("invalid_target");
      expect(outcome.consent).toBeNull();
    }
  });

  it("authorizes whatever scope the client asked for, or none: clients deal with no scopes", async () => {
    for (const scope of [undefined, "openid", "something else"]) {
      const outcome = await flow({ challenge: pkce().challenge, scope });
      expect(outcome.location?.searchParams.get("error"), String(scope)).toBeNull();
      expect(outcome.location?.searchParams.get("code"), String(scope)).toBeTruthy();
    }
  });

  it("refuses a redirect URI the client did not register, without redirecting", async () => {
    const outcome = await flow({ challenge: pkce().challenge, redirectUri: "https://attacker.example.com/cb" });
    expect(outcome.location).toBeNull();
    expect(outcome.page!.statusCode).toBe(400);
  });

  it("signs in again at every authorization and keeps no session of its own: a second person in the same browser", async () => {
    const jar = new Jar();
    const options = { publicUrl: PUBLIC_URL, providerOrigin: PROVIDER };
    const asWho = async (subject: string) => {
      fakes.oidc.login = identified(subject);
      const { verifier, challenge } = pkce();
      const request = { clientId: CLI, redirectUri: "http://127.0.0.1:5000/callback", resource: API, challenge };
      const outcome = await authorize([app], jar, request, options);
      const issued = await token(app, {
        grant_type: "authorization_code",
        code: outcome.location!.searchParams.get("code")!,
        redirect_uri: request.redirectUri,
        code_verifier: verifier,
        client_id: CLI,
      });
      const me = await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${issued.body.access_token as string}` } });
      return me.json().user.username as string;
    };
    try {
      const before = fakes.oidc.finished.length;
      expect(await asWho("carol")).toBe("carol");
      expect(await asWho("dave")).toBe("dave");
      expect(fakes.oidc.finished.length - before).toBe(2);
      expect([...fakes.access.oauth.records.keys()].filter((key) => key.startsWith("Session "))).toEqual([]);
    } finally {
      fakes.oidc.login = identified("alice");
    }
  });

  it("answers Deny with access_denied", async () => {
    const outcome = await flow({ challenge: pkce().challenge }, "deny");
    expect(outcome.location?.searchParams.get("error")).toBe("access_denied");
  });

  it("shows no consent to a disabled person", async () => {
    fakes.access.add("blocked", "disabled");
    fakes.oidc.login = identified("blocked");
    try {
      const outcome = await flow({ challenge: pkce().challenge });
      expect(outcome.page!.statusCode).toBe(403);
      expect(outcome.page!.body).toContain("This account is disabled");
      expect(outcome.consent).toBeNull();
    } finally {
      fakes.oidc.login = identified("alice");
    }
  });

  it("keeps the consent page out of frames and refuses its answer from another origin", async () => {
    const jar = new Jar();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: CLI,
      redirect_uri: "http://127.0.0.1/callback",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
      resource: MOUNT,
    });
    let res = await visit(app, jar, { url: `/oauth/authorize?${query}` });
    const interaction = res.headers.location as string;
    res = await visit(app, jar, { url: interaction });
    const state = new URL(res.headers.location as string).searchParams.get("state");
    await visit(app, jar, { url: `/oauth/callback?code=c&state=${state}` });
    res = await visit(app, jar, { url: interaction });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.body).not.toContain("<script");
    for (const headers of [{}, { origin: "http://localhost:5173" }, { origin: "null" }]) {
      const answer = await visit(app, jar, { method: "POST", url: interaction, form: { decision: "allow" }, headers });
      expect(answer.statusCode).toBe(403);
    }
    // Without the browser's interaction cookie the page is gone.
    expect((await visit(app, new Jar(), { url: interaction })).statusCode).toBe(400);
  });

  it("lets a public client call the token endpoint cross-origin, without credentials", async () => {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/oauth/token",
      headers: { origin: "chrome-extension://abc", "access-control-request-method": "POST" },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("chrome-extension://abc");
    const refused = await token(app, { grant_type: "refresh_token", refresh_token: "nope", client_id: CLI }, { origin: "chrome-extension://abc" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_grant");
    expect(refused.headers["access-control-allow-origin"]).toBe("chrome-extension://abc");
    expect(refused.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("knows a client by its metadata document, showing its host", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      fetched.push(String(url));
      return new Response(
        JSON.stringify({ client_id: CIMD, client_name: "Example Agent", redirect_uris: ["https://client.example.com/callback"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const { verifier, challenge } = pkce();
    // Asking for OpenID scopes too changes nothing: no ID token, a refresh token all the same.
    const outcome = await flow({ challenge, clientId: CIMD, redirectUri: "https://client.example.com/callback", scope: "openid offline_access" });
    expect(fetched).toEqual([CIMD]);
    expect(outcome.consent).toContain("Example Agent");
    expect(outcome.consent).toContain("<strong>client.example.com</strong>");
    const issued = await token(app, {
      grant_type: "authorization_code",
      code: outcome.location!.searchParams.get("code")!,
      redirect_uri: "https://client.example.com/callback",
      code_verifier: verifier,
      client_id: CIMD,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(issued.body.id_token).toBeUndefined();
    expect(issued.body.refresh_token).toEqual(expect.any(String));
    expect(issued.body.scope).toBe("ontoforge");
  });

  it("boots without a warning or notice of the library", () => {
    expect(notices.filter((line) => line.includes("oidc-provider"))).toEqual([]);
    expect(notices).toContain("Authorization server clients from OAUTH_CLIENTS: ontoforge-cli");
  });
});

describe("with authentication off", () => {
  it("has none of the authorization server's routes", async () => {
    const { createApp } = await import("../../src/app.js");
    const off = await createApp();
    try {
      for (const url of ["/.well-known/oauth-authorization-server", "/oauth/authorize", "/oauth/callback", "/oauth/interaction/x"]) {
        expect((await off.inject({ url })).statusCode, url).toBe(404);
      }
      expect((await off.inject({ method: "POST", url: "/oauth/token" })).statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });
});

describe("OAUTH_CLIENT_HOSTS", () => {
  it("fetches client metadata documents from the named hosts only", async () => {
    const { createApp } = await import("../../src/app.js");
    const limited = fakeRuntime({ ...SETTINGS, oauthClientHosts: ["claude.ai"] });
    const other = await createApp(undefined, limited.runtime);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: CIMD,
        redirect_uri: "https://client.example.com/callback",
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
        resource: API,
      });
      const res = await other.inject({ url: `/oauth/authorize?${query}` });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("client_id metadata document fetch not allowed");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await other.close();
    }
  });
});

describe("OAUTH_CLIENTS", () => {
  it("fails the boot on an entry the library refuses, naming it", async () => {
    const { createApp } = await import("../../src/app.js");
    const bad = fakeRuntime({ ...SETTINGS, oauthClients: [{ id: "x", name: "X", redirectUris: ["https://localhost/cb"] }] });
    await expect(createApp(undefined, bad.runtime)).rejects.toThrow(/OAUTH_CLIENTS: entry 'x' is not valid: .*localhost/);
  });
});
