/**
 * The authorization server on the app (`authorizationServer.ts`), with
 * authentication on only. `mountAuthorizationServer` hands the library its
 * routes below `/oauth` (`/oauth/authorize`, `/oauth/token`, `/oauth/jwks`)
 * and its metadata at `/.well-known/oauth-authorization-server` (RFC 8414;
 * the issuer is `PUBLIC_URL`). The library builds its URLs from the
 * forwarded headers, which the mount sets from `PUBLIC_URL`: they are right
 * behind a TLS-terminating proxy and whatever a request claims.
 *
 * `oauthRouter` serves what the library asks the person for, below
 * `/oauth`:
 *
 * - `GET interaction/:uid` — first sends the browser to the identity
 *   provider, with the login in progress sealed into a cookie scoped to the
 *   callback (as browser sign-in does); once signed in, the consent page.
 * - `GET callback` — the provider's answer: the principal is found or
 *   created as at browser sign-in and recorded on the interaction.
 * - `POST interaction/:uid` — Allow or Deny. Accepted only from this
 *   server's own origin; the library's interaction cookie (SameSite=Lax)
 *   must name this very interaction.
 *
 * Nothing is kept in one instance's memory: the interaction lives in the
 * access database, the login in progress in the browser.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import middie from "@fastify/middie";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { InteractionResults } from "oidc-provider";

import type { Principal } from "../access/store.js";
import { clearedCookie, cookieNames, loginCookie, readCookie } from "./cookies.js";
import { LOGIN_LIFETIME_MS, loginCookieKey, openLogin, sealLogin } from "./loginCookie.js";
import { consentPage, messagePage, PAGE_HEADERS } from "./oauthPages.js";
import { AUTHORIZE } from "./authorizationServer.js";
import { isConfiguredAdmin, profileOf } from "./plugin.js";
import { resourceOf, SCOPE } from "./resources.js";
import type { AuthRuntime } from "./runtime.js";

const METADATA = "/.well-known/oauth-authorization-server";
/** The paths below `/oauth` this server's own routes serve, not the library. */
const OWN_ROUTES = /^\/(?:callback|interaction\/[^/?]*)(?:\?|$)/;

/** The sign-in in progress of one authorization, sealed into the login cookie. */
interface AuthorizationLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** The interaction the sign-in belongs to. */
  uid: string;
  exp: number;
}

function basePath(publicUrl: string): string {
  return new URL(publicUrl).pathname.replace(/\/$/, "");
}

/** An authorization request with the one scope set, whatever the client asked for: clients
 * deal with no scopes (`resources.ts`). Any other path is returned as it is. */
function withScope(path: string): string {
  const url = new URL(path, "http://localhost");
  if (url.pathname !== AUTHORIZE) return path;
  url.searchParams.set("scope", SCOPE);
  return url.pathname + url.search;
}

/** Checks the clients of `OAUTH_CLIENTS` the way the library will, and names them. */
async function checkClients(auth: AuthRuntime): Promise<void> {
  const { oauthClients } = auth.settings;
  for (const client of oauthClients) {
    try {
      await auth.oauth.provider.Client.find(client.id);
    } catch (error) {
      const { error_description: description, message } = error as { error_description?: string; message?: string };
      throw new Error(`Environment variable OAUTH_CLIENTS: entry '${client.id}' is not valid: ${description ?? message}`);
    }
  }
  if (oauthClients.length > 0) {
    console.log(`Authorization server clients from OAUTH_CLIENTS: ${oauthClients.map((c) => c.id).join(", ")}`);
  }
}

/** Mounts the library on the root, before CORS and the route guard: it answers its own requests. */
export async function mountAuthorizationServer(app: FastifyInstance, auth: AuthRuntime): Promise<void> {
  await checkClients(auth);
  const base = new URL(auth.settings.publicUrl);
  const prefix = basePath(auth.settings.publicUrl);
  const handle = auth.oauth.provider.callback();
  const serve = (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse, path: string): void => {
    req.headers["x-forwarded-proto"] = base.protocol.slice(0, -1);
    req.headers["x-forwarded-host"] = base.host;
    req.url = path;
    req.originalUrl = `${prefix}/oauth${path}`;
    void handle(req, res);
  };
  await app.register(middie);
  app.use("/oauth", (req, res, next) => {
    const path = req.url ?? "/";
    if (OWN_ROUTES.test(path)) next();
    else serve(req, res, withScope(path));
  });
  app.use(METADATA, (req, res, next) => {
    const path = req.url ?? "/";
    if (path === "/" || path.startsWith("/?")) serve(req, res, METADATA + path.slice(1));
    else next();
  });
}

/** Routes mounted at `/oauth`: the sign-in and consent an authorization asks for. */
export const oauthRouter: FastifyPluginAsync = async (app) => {
  const auth = app.auth!;
  const { provider } = auth.oauth;
  const { publicUrl } = auth.settings;
  const origin = new URL(publicUrl).origin;
  const prefix = basePath(publicUrl);
  const callbackUrl = `${publicUrl}/oauth/callback`;
  const loginName = cookieNames(publicUrl).login;
  const loginPath = `${prefix}/oauth/callback`;
  const key = loginCookieKey(auth.settings.clientSecret);

  // The consent form's answer.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const show = (reply: FastifyReply, status: number, html: string) => reply.status(status).headers(PAGE_HEADERS).send(html);
  const expired = (reply: FastifyReply) =>
    show(reply, 400, messagePage("This authorization has expired", "Start again from the application."));
  const disabled = (reply: FastifyReply) =>
    show(reply, 403, messagePage("This account is disabled", "It gets no access until an administrator enables it again."));

  /** The request's interaction, or null when it is gone or is another one. */
  async function interactionOf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const interaction = await provider.interactionDetails(request.raw, reply.raw);
      return interaction.uid === (request.params as { uid: string }).uid ? interaction : null;
    } catch {
      return null;
    }
  }

  async function activePrincipal(id: string): Promise<Principal | null> {
    const principal = await auth.access.principal(id);
    return principal !== null && principal.status === "active" ? principal : null;
  }

  /** Ends the interaction: the browser returns to the library, which answers the client. */
  async function finish(request: FastifyRequest, reply: FastifyReply, result: InteractionResults) {
    let resume: string;
    try {
      resume = await provider.interactionResult(request.raw, reply.raw, result, { mergeWithLastSubmission: false });
    } catch {
      return expired(reply);
    }
    return reply.redirect(resume, 303);
  }

  app.get("/interaction/:uid", { schema: { hide: true } }, async (request, reply) => {
    const interaction = await interactionOf(request, reply);
    if (interaction === null) return expired(reply);
    const { params } = interaction;
    const accountId = interaction.result?.login?.accountId;
    if (accountId === undefined) {
      const { state, nonce, codeVerifier, url } = await auth.oidc.startLogin(callbackUrl);
      const login: AuthorizationLogin = { state, nonce, codeVerifier, uid: interaction.uid, exp: Date.now() + LOGIN_LIFETIME_MS };
      return reply
        .header("set-cookie", loginCookie(loginName, sealLogin(login, key), LOGIN_LIFETIME_MS / 1000, loginPath))
        .redirect(url.toString());
    }
    const principal = await activePrincipal(accountId);
    if (principal === null) return disabled(reply);
    // A metadata document this instance has not cached is fetched again; that may fail.
    const client = await provider.Client.find(String(params.client_id)).catch(() => undefined);
    const resource = resourceOf(String(params.resource), publicUrl);
    if (client === undefined || resource === null) return expired(reply);
    const consent = {
      person: principal.displayName,
      personDetail: principal.email ?? principal.username,
      clientName: client.clientName ?? client.clientId,
      clientId: client.clientId,
      redirectUri: String(params.redirect_uri),
      resource,
    };
    return show(reply, 200, consentPage(consent, `${prefix}/oauth/interaction/${interaction.uid}`));
  });

  app.post("/interaction/:uid", { schema: { hide: true } }, async (request, reply) => {
    if (request.headers.origin !== origin) {
      return show(reply, 403, messagePage("This answer was refused", "Answer on the consent page itself."));
    }
    const interaction = await interactionOf(request, reply);
    const login = interaction?.result?.login;
    if (interaction === null || login === undefined) return expired(reply);
    if ((await activePrincipal(login.accountId)) === null) return disabled(reply);
    const { decision } = (request.body ?? {}) as { decision?: unknown };
    if (decision !== "allow") {
      return finish(request, reply, { error: "access_denied", error_description: "The person denied access" });
    }
    const grant = new provider.Grant({ accountId: login.accountId, clientId: String(interaction.params.client_id) });
    grant.addResourceScope(String(interaction.params.resource), SCOPE);
    return finish(request, reply, { login, consent: { grantId: await grant.save() } });
  });

  app.get("/callback", { schema: { hide: true } }, async (request, reply) => {
    reply.header("set-cookie", clearedCookie(loginName, loginPath));
    const failed = () => show(reply, 400, messagePage("Sign-in failed", "Start again from the application."));
    const sealed = readCookie(request, loginName);
    const login = sealed === null ? null : openLogin<AuthorizationLogin>(sealed, key);
    const { state } = request.query as { state?: unknown };
    if (login === null || typeof login.uid !== "string" || typeof state !== "string" || state !== login.state) return failed();

    const raw = request.raw.url ?? "";
    const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
    let identified;
    try {
      identified = await auth.oidc.finishLogin(new URL(callbackUrl + search), login);
    } catch (error) {
      const { message, code } = error as { message?: string; code?: string };
      console.error(`Authorization sign-in failed at the provider${code ? ` (${code})` : ""}: ${message ?? String(error)}`);
      return failed();
    }
    const { issuer, subject } = identified;
    const principal = await auth.access.signIn(issuer, subject, profileOf(identified), isConfiguredAdmin(auth, issuer, subject));
    if (principal.status === "disabled") return disabled(reply);

    const interaction = await provider.Interaction.find(login.uid);
    if (interaction === undefined) return expired(reply);
    interaction.result = { login: { accountId: principal.id } };
    await interaction.persist();
    return reply.redirect(`${prefix}/oauth/interaction/${login.uid}`, 303);
  });
};
