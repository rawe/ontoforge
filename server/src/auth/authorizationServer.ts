/**
 * The OAuth authorization server for clients acting for a person — MCP
 * clients and the deployment's own tools. It is `oidc-provider`, configured
 * here; its routes are mounted by `oauthRouter.ts`, the sign-in and consent
 * it asks for are served there too.
 *
 * What it issues: authorization codes (PKCE S256, public clients only),
 * opaque access tokens bound to exactly one resource (`resources.ts`), and
 * rotating refresh tokens, each with the library's lifetime. Nothing else:
 * no ID tokens, no client credentials, no device flow, no client
 * registration. A client is known by its client ID metadata document
 * (CIMD) or by an entry in `OAUTH_CLIENTS`.
 *
 * Every sign-in runs at the configured identity provider, and every
 * authorization asks for consent: the policy below requests both each
 * time. The library's own session serves one authorization and ends with
 * it; the provider's single sign-on is what makes the next one quick.
 *
 * All state lives in the access database (`OAuthRecords`), keyed by a
 * digest of the library's id — a token or code is never stored itself —
 * so any server instance serves any step. The keys (cookie signing, the
 * signing key the library requires though nothing it signs is used) are
 * derived from the client secret: the same on every instance, with nothing
 * to create or share.
 */

import { createPrivateKey, hkdfSync } from "node:crypto";

import Provider, { errors, interactionPolicy, type Adapter, type AdapterPayload, type JWK } from "oidc-provider";

import type { AccessStore } from "../access/store.js";
import type { AuthSettings } from "../config.js";
import { errorPage, PAGE_HEADERS } from "./oauthPages.js";
import { resourceOf, SCOPE } from "./resources.js";
import { digest } from "./sessionStore.js";

export interface AuthorizationServer {
  provider: Provider;
  /** The principal an access token of this server acts for, when it was issued for `resource`; else null. */
  verifyAccessToken(token: string, resource: string): Promise<string | null>;
}

/** The library's adapter over the access database: ids digested, the id itself never stored. */
function adapterOf(access: AccessStore): (model: string) => Adapter {
  const records = access.oauth;
  return (model) => ({
    async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
      const { jti: _, ...stored } = payload;
      await records.upsert(model, digest(id), stored, payload.grantId ?? null, expiresIn);
    },
    async find(id: string) {
      const stored = await records.find(model, digest(id));
      return stored === null ? undefined : ({ ...stored, jti: id } as AdapterPayload);
    },
    async consume(id: string) {
      // A code or refresh token used twice at the same moment: only the first wins.
      if (!(await records.consume(model, digest(id)))) throw new errors.InvalidGrant(`${model} already used`);
    },
    async destroy(id: string) {
      await records.destroy(model, digest(id));
    },
    async revokeByGrantId(grantId: string) {
      await records.revokeByGrantId(model, grantId);
    },
    // The library looks these up for device codes, and for sessions that bind tokens or outlive
    // their authorization: none exist here.
    async findByUserCode() {
      throw new Error("findByUserCode is not used by this server");
    },
    async findByUid() {
      throw new Error("findByUid is not used by this server");
    },
  });
}

/** 32 bytes of key material for `purpose`, from the client secret. */
function derived(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), `ontoforge authorization server ${purpose}`, 32));
}

/** The PKCS #8 encoding of an Ed25519 private key up to its 32-byte seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function signingKey(seed: Buffer): JWK {
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  return key.export({ format: "jwk" }) as JWK;
}

/** The authorization endpoint, below the mount (`oauthRouter.ts`). */
export const AUTHORIZE = "/authorize";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const { Check, Prompt } = interactionPolicy;

/** Sign-in and consent at every authorization, never taken from an earlier one. */
const POLICY = [
  new Prompt(
    { name: "login", requestable: true },
    new Check("every_authorization", "Every authorization signs the person in", (ctx) => ctx.oidc.result?.login === undefined),
  ),
  new Prompt(
    { name: "consent", requestable: true },
    new Check("every_authorization", "Every authorization asks for consent", (ctx) => ctx.oidc.result?.consent === undefined),
  ),
];

export function createAuthorizationServer(settings: AuthSettings, access: AccessStore): AuthorizationServer {
  const { publicUrl, oauthClientHosts } = settings;
  const publicHost = new URL(publicUrl).hostname;
  const provider = new Provider(publicUrl, {
    adapter: adapterOf(access),
    clients: settings.oauthClients.map((client) => ({
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
    })),
    clientDefaults: {
      // Native, unless a client's metadata document says otherwise: a loopback redirect then
      // matches whatever port the tool listens on (RFC 8252), and http is loopback only.
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      id_token_signed_response_alg: "EdDSA",
    },
    clientAuthMethods: ["none"],
    responseTypes: ["code"],
    scopes: [SCOPE],
    features: {
      devInteractions: { enabled: false },
      dPoP: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      userinfo: { enabled: false },
      resourceIndicators: {
        enabled: true,
        async defaultResource(_ctx, _client, oneOf) {
          if (oneOf) return oneOf;
          throw new errors.InvalidTarget("a resource indicator is required");
        },
        async getResourceServerInfo(ctx, indicator) {
          if (Array.isArray(ctx.oidc.params?.resource)) {
            throw new errors.InvalidTarget("only one resource indicator per authorization");
          }
          if (resourceOf(indicator, publicUrl) === null) throw new errors.InvalidTarget();
          return { scope: SCOPE, accessTokenFormat: "opaque" };
        },
      },
      clientIdMetadataDocument: {
        enabled: true,
        ack: "draft-03",
        async allowFetch(_ctx, clientId) {
          const host = new URL(clientId).hostname;
          if (host === publicHost) return false;
          return oauthClientHosts === null || oauthClientHosts.includes(host);
        },
      },
    },
    interactions: {
      policy: POLICY,
      url: (_ctx, interaction) => `${new URL(publicUrl).pathname.replace(/\/$/, "")}/oauth/interaction/${interaction.uid}`,
    },
    async findAccount(_ctx, id) {
      // A disabled or removed principal gets no token, not even by refresh.
      const principal = await access.principal(id);
      if (principal === null || principal.status !== "active") return undefined;
      return { accountId: id, claims: async () => ({ sub: id }) };
    },
    // A refresh token whenever the client may use one, without an offline_access scope.
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    // Tokens outlive the library's session, which ends with the authorization.
    expiresWithSession: async () => false,
    // Every client is public: the token endpoint answers any origin, never with credentials.
    clientBasedCORS: () => true,
    // The library's lifetimes, stated: the grant bounds a refresh token chain to 14 days. A
    // session is removed when its authorization ends; a minute bounds one that is not.
    ttl: { AccessToken: HOUR, RefreshToken: 14 * DAY, Grant: 14 * DAY, Interaction: HOUR, Session: 60 },
    cookies: { keys: [derived(settings.clientSecret, "cookies").toString("base64url")] },
    jwks: { keys: [signingKey(derived(settings.clientSecret, "signing key"))] },
    routes: { authorization: AUTHORIZE, token: "/token", jwks: "/jwks" },
    async renderError(ctx, out) {
      ctx.set(PAGE_HEADERS);
      ctx.body = errorPage(out.error_description ?? out.error ?? "The request could not be processed");
    },
  });
  // Its URLs come from PUBLIC_URL: the mount sets the forwarded headers from it (`oauthRouter.ts`).
  provider.proxy = true;
  // No sign-in of its own outlives the authorization it served.
  provider.use(async (ctx, next) => {
    await next();
    if (ctx.oidc?.route === "resume") await ctx.oidc.session?.destroy();
  });

  return {
    provider,
    async verifyAccessToken(token, resource) {
      const accessToken = await provider.AccessToken.find(token);
      if (accessToken === undefined || accessToken.aud !== resource || accessToken.accountId === undefined) return null;
      return accessToken.accountId;
    },
  };
}
