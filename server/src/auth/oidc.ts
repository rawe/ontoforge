/**
 * The OpenID provider as this server sees it: the browser login it runs as a
 * confidential client (authorization code with PKCE, `openid-client`), and
 * the access tokens REST and MCP callers present (`jose`, keys from the
 * provider's JWKS).
 *
 * The issuer is one URL for everyone — tokens carry it and the browser
 * reaches it. A server that cannot reach that URL (a container) names a
 * back channel; every request this server makes to the issuer's URLs is
 * sent there instead, while the issuer it checks stays the public one.
 */

import { createRemoteJWKSet, customFetch as joseFetch, jwtVerify, type JWTPayload } from "jose";
import * as client from "openid-client";

import type { AuthSettings } from "../config.js";
import { ProviderUnavailableError } from "../core/exceptions.js";

/** The display claims of a signed-in person or service. */
export interface Identified {
  issuer: string;
  subject: string;
  displayName: string;
  email: string | null;
  username: string | null;
}

export interface LoginStart {
  state: string;
  nonce: string;
  codeVerifier: string;
  url: URL;
}

export interface Oidc {
  readonly issuer: string;
  /** The provider's login page for a new login, with fresh `state`, `nonce` and PKCE verifier. */
  startLogin(redirectUri: string): Promise<LoginStart>;
  /** Exchanges the callback's code and checks the ID token; throws on any mismatch. */
  finishLogin(callbackUrl: URL, checks: { state: string; nonce: string; codeVerifier: string }): Promise<Identified>;
  /** Where the browser ends its provider session, returning to `postLogoutRedirectUri`. */
  logoutUrl(postLogoutRedirectUri: string): string;
  /** The caller of an access token, or null when it is not one this server accepts.
   * Rejects with `ProviderUnavailableError` when the provider's keys cannot be fetched. */
  verifyAccessToken(token: string): Promise<Identified | null>;
}

/** Asymmetric signatures only: never `none`, never a shared secret. */
const ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"];

/** A fetch that sends what is addressed to the issuer's URL to the back channel instead. */
export function backchannelFetch(issuer: string, backchannel: string): typeof fetch {
  if (issuer === backchannel) return fetch;
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const target = url === issuer || url.startsWith(`${issuer}/`) ? backchannel + url.slice(issuer.length) : url;
    return input instanceof Request ? fetch(new Request(target, input), init) : fetch(target, init);
  };
}

function text(claims: JWTPayload, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value !== "" ? value : null;
}

function identified(claims: JWTPayload): Identified {
  const username = text(claims, "preferred_username");
  return {
    issuer: claims.iss!,
    subject: claims.sub!,
    displayName: text(claims, "name") ?? username ?? claims.sub!,
    email: text(claims, "email"),
    username,
  };
}

/** Discovers the provider (bounded) and keeps its configuration; a failure fails the boot. */
export async function connectOidc(auth: AuthSettings): Promise<Oidc> {
  const send = backchannelFetch(auth.issuer, auth.backchannelUrl);
  const insecure = new URL(auth.issuer).protocol === "http:";
  let config: client.Configuration;
  try {
    config = await client.discovery(
      new URL(auth.issuer),
      auth.clientId,
      { client_secret: auth.clientSecret },
      client.ClientSecretBasic(auth.clientSecret),
      {
        timeout: 10,
        [client.customFetch]: (url, options) => send(url, options as RequestInit),
        // Development issuers on http only; an https issuer never allows it.
        ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
      },
    );
  } catch (error) {
    throw new Error(
      `OpenID provider ${auth.issuer} is not usable${auth.backchannelUrl !== auth.issuer ? ` (through ${auth.backchannelUrl})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  config[client.customFetch] = (url, options) => send(url, options as RequestInit);
  const metadata = config.serverMetadata();
  if (!metadata.jwks_uri) throw new Error(`OpenID provider ${auth.issuer} publishes no jwks_uri`);
  const keys = createRemoteJWKSet(new URL(metadata.jwks_uri), {
    timeoutDuration: 5000,
    [joseFetch]: (url, options) => send(url, options as RequestInit),
  });

  return {
    issuer: auth.issuer,

    async startLogin(redirectUri) {
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: "openid profile email",
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return { state, nonce, codeVerifier, url };
    },

    async finishLogin(callbackUrl, checks) {
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error("The provider returned no ID token");
      return identified(claims as JWTPayload);
    },

    logoutUrl(postLogoutRedirectUri) {
      if (!metadata.end_session_endpoint) return postLogoutRedirectUri;
      return client
        .buildEndSessionUrl(config, { client_id: auth.clientId, post_logout_redirect_uri: postLogoutRedirectUri })
        .toString();
    },

    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: auth.issuer,
          audience: auth.audience,
          algorithms: ALGORITHMS,
          clockTolerance: 30,
          requiredClaims: ["exp", "sub", "iss"],
        });
        // Keycloak names its token kinds; an ID or refresh token is never an API credential.
        const kind = payload["typ"];
        if (kind !== undefined && kind !== "Bearer") return null;
        return identified(payload);
      } catch (error) {
        if (isTokenRejection(error)) return null;
        const { message, code, cause } = error as { message?: string; code?: string; cause?: { code?: string } };
        const reason = code ?? cause?.code;
        console.error(`Signing keys of ${auth.issuer} not available${reason ? ` (${reason})` : ""}: ${message ?? String(error)}`);
        throw new ProviderUnavailableError();
      }
    },
  };
}

/** Failures of fetching the provider's key set: the provider, not the token, failed. */
const PROVIDER_FAILURES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JOSE_GENERIC", "ERR_JWKS_INVALID"]);

/**
 * A token that is wrong, as opposed to a provider this server cannot reach.
 * Verification throws only jose's errors besides what fetching the key set
 * throws (a refused or failed connection), so anything else is the provider's.
 */
function isTokenRejection(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && code.startsWith("ERR_J") && !PROVIDER_FAILURES.has(code);
}
