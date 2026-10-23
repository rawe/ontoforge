/**
 * Who a request comes from (`accessOf`) and the route check of the boot,
 * on a bare app with fake provider, access store and sessions.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";

import type { Access } from "../../src/access/caller.js";
import { accessOf, classifyRoutes } from "../../src/auth/plugin.js";
import type { AuthRuntime } from "../../src/auth/runtime.js";
import { ForbiddenError, UnauthenticatedError } from "../../src/core/exceptions.js";
import { ADMIN_SUBJECT, fakeRuntime, identified, PUBLIC_URL, type Fakes } from "./fakes.js";

const SESSION_COOKIE = "ontoforge_session_5173";

function describeAccess(access: Access): Record<string, unknown> {
  if (access.kind !== "caller") return { kind: access.kind };
  const { principal, assignments, via } = access.caller;
  return { kind: "caller", via, subject: principal.username, roles: assignments.map((a) => a.role) };
}

async function bareApp(auth: AuthRuntime | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("auth", auth);
  const handler = async (request: Parameters<typeof accessOf>[0]) => {
    try {
      const first = accessOf(request);
      // Resolved once: a second ask gets the same answer without new work.
      const second = accessOf(request);
      return describeAccess(await Promise.all([first, second]).then(([a]) => a));
    } catch (error) {
      if (error instanceof UnauthenticatedError) return { error: "unauthenticated", invalidToken: error.invalidToken };
      if (error instanceof ForbiddenError) return { error: "forbidden", message: error.message };
      throw error;
    }
  };
  app.route({ method: ["GET", "POST"], url: "/api/x", handler });
  app.route({ method: ["GET", "POST"], url: "/mcp/ontologies/:ontologyKey/model", handler });
  await app.ready();
  return app;
}

describe("accessOf", () => {
  let fakes: Fakes;
  let app: FastifyInstance;

  beforeEach(async () => {
    fakes = fakeRuntime();
    app = await bareApp(fakes.runtime);
  });

  async function session(subject: string): Promise<string> {
    const principal = (await fakes.access.principalOf(fakes.runtime.settings.issuer, subject)) ?? fakes.access.add(subject);
    const id = `session-of-${subject}`;
    await fakes.runtime.sessions.create(id, { principalId: principal.id, issuer: fakes.runtime.settings.issuer, subject });
    return id;
  }

  async function ask(options: { method?: "GET" | "POST"; url?: string; headers?: Record<string, string> }) {
    const res = await app.inject({ method: options.method ?? "GET", url: options.url ?? "/api/x", headers: options.headers });
    return res.json();
  }

  it("trusts every request with authentication off", async () => {
    const off = await bareApp(null);
    expect((await off.inject({ url: "/api/x", headers: { authorization: "Bearer junk" } })).json()).toEqual({ kind: "trusted" });
  });

  it("is anonymous without a credential, or with a cookie naming no session", async () => {
    expect(await ask({})).toEqual({ kind: "anonymous" });
    expect(await ask({ headers: { cookie: `${SESSION_COOKIE}=gone` } })).toEqual({ kind: "anonymous" });
    // Another deployment's cookie on the same host is not ours.
    const id = await session("reader");
    expect(await ask({ headers: { cookie: `ontoforge_session_8000=${id}` } })).toEqual({ kind: "anonymous" });
  });

  it("takes the session's principal with its assignments", async () => {
    const id = await session("reader");
    const principal = (await fakes.access.principalOf(fakes.runtime.settings.issuer, "reader"))!;
    fakes.access.grant(principal.id, "reader", "o", "l");
    expect(await ask({ headers: { cookie: `a=b; ${SESSION_COOKIE}=${id}; c=d` } })).toEqual({
      kind: "caller",
      via: "session",
      subject: "reader",
      roles: ["reader"],
    });
    expect(fakes.access.calls.filter((c) => c.startsWith("assignmentsOf"))).toHaveLength(1);
  });

  it("refuses a cookie-authenticated change from another origin", async () => {
    const id = await session("writer");
    const cookie = `${SESSION_COOKIE}=${id}`;
    expect(await ask({ method: "POST", headers: { cookie } })).toMatchObject({ error: "forbidden" });
    expect(await ask({ method: "POST", headers: { cookie, origin: "http://evil.example.com" } })).toMatchObject({ error: "forbidden" });
    expect(await ask({ method: "POST", headers: { cookie, origin: PUBLIC_URL } })).toMatchObject({ kind: "caller" });
    expect(await ask({ method: "GET", headers: { cookie, origin: "http://evil.example.com" } })).toMatchObject({ kind: "caller" });
  });

  it("refuses a disabled session principal and ends the session", async () => {
    const id = await session("gone-bad");
    const principal = (await fakes.access.principalOf(fakes.runtime.settings.issuer, "gone-bad"))!;
    fakes.access.principals.set(principal.id, { ...principal, status: "disabled" });
    expect(await ask({ headers: { cookie: `${SESSION_COOKIE}=${id}` } })).toEqual({
      error: "forbidden",
      message: "This account is disabled",
    });
    expect(await fakes.runtime.sessions.get(id)).toBeNull();
  });

  it("decides by the bearer token alone when one is sent", async () => {
    const id = await session("reader");
    fakes.oidc.tokens.set("good", identified("writer"));
    fakes.access.add("writer");
    expect(await ask({ headers: { authorization: "Bearer good", cookie: `${SESSION_COOKIE}=${id}` } })).toMatchObject({
      kind: "caller",
      via: "bearer",
      subject: "writer",
    });
    expect(fakes.oidc.verifications).toBe(1);
    expect(await ask({ headers: { authorization: "Bearer bad", cookie: `${SESSION_COOKIE}=${id}` } })).toEqual({
      error: "unauthenticated",
      invalidToken: true,
    });
    expect(await ask({ headers: { authorization: "Bearer" } })).toEqual({ error: "unauthenticated", invalidToken: true });
  });

  it("needs no CSRF check for a bearer-authenticated change", async () => {
    fakes.oidc.tokens.set("good", identified("writer"));
    expect(await ask({ method: "POST", headers: { authorization: "bearer good" } })).toMatchObject({ kind: "caller", via: "bearer" });
  });

  it("provisions an unknown bearer identity as a role-less principal, once", async () => {
    fakes.oidc.tokens.set("new", identified("service-a"));
    expect(await ask({ headers: { authorization: "Bearer new" } })).toEqual({
      kind: "caller",
      via: "bearer",
      subject: "service-a",
      roles: [],
    });
    expect(await ask({ headers: { authorization: "Bearer new" } })).toMatchObject({ subject: "service-a" });
    expect(fakes.access.calls.filter((c) => c.startsWith("signIn"))).toEqual(["signIn service-a false"]);
  });

  it("restores the configured administrator when it lost its standing, and only then", async () => {
    fakes.oidc.tokens.set("admin", identified(ADMIN_SUBJECT));
    const admin = fakes.access.add(ADMIN_SUBJECT, "disabled");
    expect(await ask({ headers: { authorization: "Bearer admin" } })).toMatchObject({ kind: "caller", roles: ["platform_admin"] });
    expect(fakes.access.principals.get(admin.id)!.status).toBe("active");
    expect(await ask({ headers: { authorization: "Bearer admin" } })).toMatchObject({ kind: "caller" });
    expect(fakes.access.calls.filter((c) => c.startsWith("signIn"))).toEqual([`signIn ${ADMIN_SUBJECT} true`]);
  });

  it("refuses a disabled bearer principal", async () => {
    fakes.oidc.tokens.set("t", identified("blocked"));
    fakes.access.add("blocked", "disabled");
    expect(await ask({ headers: { authorization: "Bearer t" } })).toEqual({ error: "forbidden", message: "This account is disabled" });
  });

  it("takes bearer tokens only on MCP mounts", async () => {
    const id = await session("reader");
    const url = "/mcp/ontologies/o/model";
    expect(await ask({ url, headers: { cookie: `${SESSION_COOKIE}=${id}` } })).toEqual({ kind: "anonymous" });
    fakes.oidc.tokens.set("t", identified("reader"));
    expect(await ask({ url, headers: { authorization: "Bearer t" } })).toMatchObject({ kind: "caller", via: "bearer" });
  });
});

describe("route classification", () => {
  it("declares every route's need per method, public by default for the open surfaces", async () => {
    const app = Fastify();
    classifyRoutes(app);
    const seen: Record<string, unknown> = {};
    app.get("/livez", async () => ({}));
    app.get("/.well-known/oauth-protected-resource/*", async () => ({}));
    app.get("/api/auth/me", async () => ({}));
    app.get("/api/ontologies", async (request) => request.routeOptions.config.needs);
    app.route({
      method: ["GET", "POST"],
      url: "/mcp/ontologies/:ontologyKey/model",
      handler: async (request) => {
        seen[request.method] = request.routeOptions.config.needs?.[request.method];
        return {};
      },
    });
    await app.ready();
    expect((await app.inject({ url: "/api/ontologies" })).json()).toEqual({ GET: { kind: "signed-in" } });
    expect((await app.inject({ method: "HEAD", url: "/api/ontologies" })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/mcp/ontologies/o/model" });
    expect(seen["POST"]).toEqual({ kind: "ontology-admin" });
  });

  it("fails the boot for a route the table does not know", () => {
    const app = Fastify();
    classifyRoutes(app);
    expect(() => app.get("/api/unknown", async () => ({}))).toThrow(/GET \/api\/unknown/);
  });
});
