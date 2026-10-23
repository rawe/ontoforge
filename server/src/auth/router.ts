/**
 * Browser sign-in, mounted at `/api/auth`. The server is the browser's
 * OpenID client: `login` sends the browser to the provider with the login
 * transaction sealed into the login cookie, `callback` finishes it,
 * provisions the principal and starts the session, `logout` ends it and
 * names the provider's end-session page. `me` — mounted with
 * authentication off too — tells the web client the mode and who is
 * signed in.
 *
 * Also the protected-resource metadata (RFC 9728) MCP clients discover the
 * provider through, mounted at the root with authentication on.
 */

import type { FastifyPluginAsync } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Access } from "../access/caller.js";
import type { Assignment, Principal } from "../access/store.js";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../core/exceptions.js";
import { getModelingStore, getOntologyRegistry } from "../core/ports.js";
import {
  clearedCookie,
  cookieNames,
  LOGIN_COOKIE_PATH,
  loginCookie,
  newSessionId,
  readCookie,
  sessionCookie,
} from "./cookies.js";
import { LOGIN_LIFETIME_MS, loginCookieKey, openLogin, sealLogin } from "./loginCookie.js";
import { accessOf, API_SCOPE, checkOrigin, isConfiguredAdmin } from "./plugin.js";

const User = z.object({
  id: z.string(),
  kind: z.enum(["user", "service"]),
  displayName: z.string(),
  email: z.string().nullable(),
  username: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});

const MyAssignment = z.object({
  id: z.string(),
  role: z.enum(["platform_admin", "ontology_creator", "ontology_admin", "reader", "writer"]),
  ontologyKey: z.string().nullable(),
  lensKey: z.string().nullable(),
  ontologyId: z.string().nullable(),
  lensId: z.string().nullable(),
  createdAt: z.string(),
});

const MeResponse = z.object({
  authentication: z.boolean(),
  user: User.nullable().optional(),
  assignments: z.array(MyAssignment).optional(),
});

const LoginQuery = z.object({ returnTo: z.string().optional() });

const LogoutResponse = z.object({ logoutUrl: z.string() });

/**
 * Where the browser may be sent after signing in: a path with its query on
 * `PUBLIC_URL`'s origin. Anything else — another origin, a scheme, a
 * backslash or a control character browsers may read as one — becomes `/`.
 */
export function normalizeReturnTo(value: string | undefined, publicUrl: string): string {
  if (value === undefined || value === "" || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, publicUrl);
  } catch {
    return "/";
  }
  if (url.origin !== new URL(publicUrl).origin) return "/";
  return url.pathname + url.search;
}

function userOf(principal: Principal): z.infer<typeof User> {
  return {
    id: principal.id,
    kind: principal.kind,
    displayName: principal.displayName,
    email: principal.email,
    username: principal.username,
    status: principal.status,
    createdAt: principal.createdAt.toISOString(),
    lastLoginAt: principal.lastLoginAt?.toISOString() ?? null,
  };
}

/** The assignments with their keys, as of now; those whose ontology or lens is gone are left out. */
async function withKeys(assignments: Assignment[]): Promise<z.infer<typeof MyAssignment>[]> {
  if (assignments.length === 0) return [];
  const ontologyKeys = new Map(
    (await getOntologyRegistry().listOntologies()).map((row) => [row.ontologyId as string, row.key as string]),
  );
  const lensKeys = new Map<string, string>();
  const withLenses = new Set(assignments.filter((a) => a.lensId !== null).map((a) => a.ontologyId!));
  for (const ontologyId of withLenses) {
    const key = ontologyKeys.get(ontologyId);
    if (key === undefined) continue;
    try {
      for (const lens of await (await getModelingStore(key)).listLenses()) {
        lensKeys.set(lens.lensId as string, lens.key as string);
      }
    } catch (error) {
      // Deleted since the registry was read.
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return assignments.flatMap((a) => {
    const ontologyKey = a.ontologyId === null ? null : ontologyKeys.get(a.ontologyId);
    const lensKey = a.lensId === null ? null : lensKeys.get(a.lensId);
    if (ontologyKey === undefined || lensKey === undefined) return [];
    return [
      {
        id: a.id,
        role: a.role,
        ontologyKey,
        lensKey,
        ontologyId: a.ontologyId,
        lensId: a.lensId,
        createdAt: a.createdAt.toISOString(),
      },
    ];
  });
}

/** Routes mounted at `/api/auth`: `me` always, the rest with authentication on. */
export const authRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    { schema: { tags: ["auth"], response: { 200: MeResponse } } },
    async (request) => {
      if (app.auth === null) return { authentication: false };
      let access: Access;
      try {
        access = await accessOf(request);
      } catch (error) {
        // An unusable credential or a disabled account: not signed in.
        if (!(error instanceof UnauthenticatedError || error instanceof ForbiddenError)) throw error;
        access = { kind: "anonymous" };
      }
      if (access.kind !== "caller") return { authentication: true, user: null, assignments: [] };
      const { principal, assignments } = access.caller;
      return { authentication: true, user: userOf(principal), assignments: await withKeys(assignments) };
    },
  );

  const auth = app.auth;
  if (auth === null) return;
  const { publicUrl } = auth.settings;
  const names = cookieNames(publicUrl);
  const key = loginCookieKey(auth.settings.clientSecret);
  const callbackUrl = `${publicUrl}/api/auth/callback`;
  const clearLogin = clearedCookie(names.login, LOGIN_COOKIE_PATH);

  app.get(
    "/login",
    { schema: { tags: ["auth"], querystring: LoginQuery } },
    async (request, reply) => {
      const returnTo = normalizeReturnTo(request.query.returnTo, publicUrl);
      const { state, nonce, codeVerifier, url } = await auth.oidc.startLogin(callbackUrl);
      const sealed = sealLogin({ state, nonce, codeVerifier, returnTo, exp: Date.now() + LOGIN_LIFETIME_MS }, key);
      return reply
        .header("set-cookie", loginCookie(names.login, sealed, LOGIN_LIFETIME_MS / 1000))
        .redirect(url.toString());
    },
  );

  app.get("/callback", { schema: { tags: ["auth"] } }, async (request, reply) => {
    const fail = (outcome: "failed" | "disabled") =>
      reply.header("set-cookie", clearLogin).redirect(`/?login=${outcome}`);
    const sealed = readCookie(request, names.login);
    const transaction = sealed === null ? null : openLogin(sealed, key);
    const { state } = request.query as { state?: unknown };
    if (transaction === null || typeof state !== "string" || state !== transaction.state) return fail("failed");

    const raw = request.raw.url ?? "";
    const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
    let identified;
    try {
      identified = await auth.oidc.finishLogin(new URL(callbackUrl + search), transaction);
    } catch (error) {
      const { message, code } = error as { message?: string; code?: string };
      console.error(`Login failed at the provider${code ? ` (${code})` : ""}: ${message ?? String(error)}`);
      return fail("failed");
    }
    const { issuer, subject } = identified;
    const principal = await auth.access.signIn(
      issuer,
      subject,
      { displayName: identified.displayName, email: identified.email, username: identified.username },
      isConfiguredAdmin(auth, issuer, subject),
    );
    if (principal.status === "disabled") return fail("disabled");

    // A new session at every sign-in; one the browser still carries ends.
    const previous = readCookie(request, names.session);
    if (previous !== null) await auth.sessions.delete(previous);
    const sessionId = newSessionId();
    await auth.sessions.create(sessionId, { principalId: principal.id, issuer, subject });
    return reply
      .header("set-cookie", [sessionCookie(names.session, sessionId), clearLogin])
      .redirect(transaction.returnTo);
  });

  app.post(
    "/logout",
    { schema: { tags: ["auth"], response: { 200: LogoutResponse } } },
    async (request, reply) => {
      const sessionId = readCookie(request, names.session);
      if (sessionId !== null) {
        checkOrigin(auth, request);
        await auth.sessions.delete(sessionId);
      }
      reply.header("set-cookie", clearedCookie(names.session, "/"));
      return { logoutUrl: auth.oidc.logoutUrl(`${publicUrl}/`) };
    },
  );
};

/** Protected-resource metadata (RFC 9728), mounted at the root with authentication on:
 * the bare document describes the server, `/<mount path>` one MCP mount. */
export const resourceMetadataRouter: FastifyPluginAsync = async (app) => {
  const auth = app.auth!;
  const describe = (path: string) => ({
    resource: auth.settings.publicUrl + path,
    authorization_servers: [auth.settings.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [API_SCOPE],
  });
  const prefix = "/.well-known/oauth-protected-resource";
  app.get(prefix, { schema: { hide: true } }, async () => describe(""));
  app.get(`${prefix}/*`, { schema: { hide: true } }, async (request) =>
    describe(`/${(request.params as { "*": string })["*"]}`),
  );
};
