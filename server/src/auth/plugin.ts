/**
 * Authentication on the app: who a request comes from (`accessOf`), and
 * the guard that hands every protected route's request to the one
 * authorization service. Installed by `createApp` only when authentication
 * is on; with it off nothing here runs and every request is trusted.
 *
 * Every route declares what it needs (`needOf`, the route table in
 * `access/routes.ts`), checked when the route is registered: a route
 * without one fails the boot. Public routes never resolve a caller, so
 * they keep working whatever the access store or the provider does.
 *
 * A request proves itself by a bearer access token or by the session
 * cookie, never both: a bearer header decides alone. MCP mounts take
 * bearer tokens only. A request authenticated by the cookie that may
 * change state must come from the deployment's own origin (CSRF).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import { authorize } from "../access/authorize.js";
import { TRUSTED, type Access, type Need } from "../access/caller.js";
import { needOf } from "../access/routes.js";
import type { Profile } from "../access/store.js";
import { ForbiddenError, UnauthenticatedError } from "../core/exceptions.js";
import { cookieNames, readCookie } from "./cookies.js";
import { API_SCOPE, type Identified } from "./oidc.js";
import type { AuthRuntime } from "./runtime.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** What the route needs, by method; set when authentication is on. */
    needs?: Record<string, Need>;
  }
}

const ANONYMOUS: Access = { kind: "anonymous" };
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Declares every route registered from here on: its need per method, or the boot fails. */
export function classifyRoutes(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const needs: Record<string, Need> = {};
    for (const method of methods) {
      const need = needOf(method, route.url);
      if (need === undefined) {
        throw new Error(`Route ${method} ${route.url} has no entry in the access route table`);
      }
      needs[method] = need;
    }
    route.config = { ...route.config, needs };
  });
}

/** Checks every protected request before its body is read. */
export function guardRoutes(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    const need = request.routeOptions.config.needs?.[request.method];
    if (need === undefined) {
      // Only the not-found handler has no route to declare a need.
      if (request.is404) return;
      throw new ForbiddenError("This route declares no access need");
    }
    if (need.kind === "public") return;
    await authorize(await accessOf(request), need, request.params as Record<string, string>);
  });
}

const resolved = new WeakMap<FastifyRequest, Promise<Access>>();

/**
 * Who the request comes from, resolved once per request: trusted with
 * authentication off; else the bearer token's principal, the session's, or
 * anonymous. Rejects with `UnauthenticatedError` for a bearer token this
 * server does not accept, with `ForbiddenError` for a disabled principal or
 * a cookie-authenticated cross-site change.
 */
export async function accessOf(request: FastifyRequest): Promise<Access> {
  let access = resolved.get(request);
  if (access === undefined) {
    access = resolve(request);
    resolved.set(request, access);
  }
  return access;
}

async function resolve(request: FastifyRequest): Promise<Access> {
  const auth = request.server.auth ?? null;
  if (auth === null) return TRUSTED;
  const header = request.headers.authorization;
  const bearer = header === undefined ? null : /^Bearer(?:\s+(.*))?$/is.exec(header.trim());
  if (bearer !== null) return bearerAccess(auth, bearer[1]?.trim() ?? "");
  if (isMcpRoute(request)) return ANONYMOUS;
  const sessionId = readCookie(request, cookieNames(auth.settings.publicUrl).session);
  if (sessionId === null) return ANONYMOUS;
  return sessionAccess(auth, request, sessionId);
}

function profileOf(identified: Identified): Profile {
  return { displayName: identified.displayName, email: identified.email, username: identified.username };
}

/** True for the identity the configuration names as the administrator. */
export function isConfiguredAdmin(auth: AuthRuntime, issuer: string, subject: string): boolean {
  return issuer === auth.settings.issuer && subject === auth.settings.adminSubject;
}

async function bearerAccess(auth: AuthRuntime, token: string): Promise<Access> {
  const identified = token === "" ? null : await auth.oidc.verifyAccessToken(token);
  if (identified === null) throw new UnauthenticatedError("The bearer token is not valid", true);
  const { issuer, subject } = identified;
  const admin = isConfiguredAdmin(auth, issuer, subject);
  // An unknown identity becomes a role-less principal, as at a first browser sign-in.
  let principal =
    (await auth.access.principalOf(issuer, subject)) ??
    (await auth.access.signIn(issuer, subject, profileOf(identified), admin));
  let assignments = await auth.access.assignmentsOf(principal.id);
  // The configured administrator is restored whenever it lost its standing.
  if (admin && (principal.status !== "active" || !assignments.some((a) => a.role === "platform_admin"))) {
    principal = await auth.access.signIn(issuer, subject, profileOf(identified), true);
    assignments = await auth.access.assignmentsOf(principal.id);
  }
  if (principal.status === "disabled") throw new ForbiddenError("This account is disabled");
  return { kind: "caller", caller: { principal, assignments, via: "bearer" } };
}

async function sessionAccess(auth: AuthRuntime, request: FastifyRequest, sessionId: string): Promise<Access> {
  const session = await auth.sessions.get(sessionId);
  if (session === null) return ANONYMOUS;
  const principal = await auth.access.principal(session.principalId);
  if (principal === null || principal.status === "disabled") {
    await auth.sessions.delete(sessionId);
    if (principal === null) return ANONYMOUS;
    throw new ForbiddenError("This account is disabled");
  }
  checkOrigin(auth, request);
  const assignments = await auth.access.assignmentsOf(principal.id);
  return { kind: "caller", caller: { principal, assignments, via: "session" } };
}

/** A request carrying the session cookie that may change state must come from `PUBLIC_URL`'s origin. */
export function checkOrigin(auth: AuthRuntime, request: FastifyRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (request.headers.origin !== new URL(auth.settings.publicUrl).origin) {
    throw new ForbiddenError("A signed-in change must come from this deployment's own origin");
  }
}

export function isMcpRoute(request: FastifyRequest): boolean {
  return request.routeOptions.url?.startsWith("/mcp/") ?? false;
}

/** The `WWW-Authenticate` challenge of a 401. An MCP mount points its client
 * to the mount's protected-resource metadata (RFC 9728), and from there to
 * the provider. */
export function challenge(request: FastifyRequest, error: UnauthenticatedError): string {
  const auth = request.server.auth ?? null;
  const invalid = error.invalidToken ? ', error="invalid_token"' : "";
  if (auth !== null && isMcpRoute(request)) {
    const path = request.url.split("?")[0];
    const metadata = `${auth.settings.publicUrl}/.well-known/oauth-protected-resource${path}`;
    return `Bearer resource_metadata="${metadata}", scope="${API_SCOPE}"${invalid}`;
  }
  return `Bearer realm="ontoforge"${invalid}`;
}
