/**
 * Access-token verification against a provider on a local port: a wrong
 * token is no caller, a provider whose keys cannot be fetched is
 * `ProviderUnavailableError` — never an unhandled error. Also the subject
 * claim the browser sign-in reads from the ID token.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { backchannelFetch, connectOidc, type Oidc } from "../../src/auth/oidc.js";
import type { AuthSettings } from "../../src/config.js";
import { ProviderUnavailableError } from "../../src/core/exceptions.js";
import { SETTINGS } from "./fakes.js";

/** How the provider answers for its key set. */
let keys: "serve" | "fail" | "refuse" = "serve";
let jwk: JWK;
let privateKey: CryptoKey;
let issuer: string;
let server: Server;
/** The claims of the ID token the provider's token endpoint answers with. */
let idTokenClaims: Record<string, unknown> = {};

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/realms/x/.well-known/openid-configuration") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        // A refused key set lives on a port nobody listens on.
        jwks_uri: keys === "refuse" ? "http://127.0.0.1:1/certs" : `${issuer}/certs`,
      });
    }
    if (req.url === "/realms/x/certs") return keys === "serve" ? send(200, { keys: [jwk] }) : send(503, {});
    if (req.url === "/realms/x/token") {
      return void sign({ iss: issuer, aud: SETTINGS.clientId, iat: Math.floor(Date.now() / 1000), ...idTokenClaims }).then((idToken) =>
        send(200, { access_token: "a", token_type: "Bearer", id_token: idToken }),
      );
    }
    send(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/x`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

/** A new connection, its key set not cached yet. */
function connect(answer: typeof keys, settings: Partial<AuthSettings> = {}): Promise<Oidc> {
  keys = answer;
  return connectOidc({ ...SETTINGS, issuer, backchannelUrl: issuer, ...settings });
}

function sign(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setExpirationTime("5m").sign(privateKey);
}

function token(claims: Record<string, unknown> = {}): Promise<string> {
  return sign({ typ: "Bearer", iss: issuer, sub: "sub-1", aud: SETTINGS.audience, scope: "profile", ...claims });
}

describe("verifying an access token", () => {
  it("names the caller of a valid token", async () => {
    const oidc = await connect("serve");
    expect(await oidc.verifyAccessToken(await token())).toMatchObject({ issuer, subject: "sub-1" });
  });

  it("accepts no wrong token", async () => {
    const oidc = await connect("serve");
    expect(await oidc.verifyAccessToken("junk")).toBeNull();
    expect(await oidc.verifyAccessToken(await token({ aud: "someone-else" }))).toBeNull();
    expect(await oidc.verifyAccessToken(await token({ typ: "Refresh" }))).toBeNull();
  });

  it("needs no scope: the audience binds a token to this server", async () => {
    const oidc = await connect("serve");
    expect(await oidc.verifyAccessToken(await token({ scope: undefined }))).not.toBeNull();
    expect(await oidc.verifyAccessToken(await token({ scope: undefined, roles: ["reader"] }))).not.toBeNull();
  });

  it("accepts no token at all without a configured audience", async () => {
    const oidc = await connect("serve", { audience: null });
    expect(await oidc.verifyAccessToken(await token())).toBeNull();
    expect(await oidc.verifyAccessToken(await token({ aud: undefined }))).toBeNull();
  });

  it("reads the subject from the configured claim and rejects a token without it", async () => {
    const oidc = await connect("serve", { subjectClaim: "oid" });
    expect(await oidc.verifyAccessToken(await token({ oid: "object-1" }))).toMatchObject({ subject: "object-1" });
    expect(await oidc.verifyAccessToken(await token())).toBeNull();
    expect(await oidc.verifyAccessToken(await token({ sub: undefined }))).toBeNull();
    expect(await (await connect("serve")).verifyAccessToken(await token({ sub: undefined, oid: "object-1" }))).toBeNull();
  });

  it("takes no ID token, even one carrying the API audience", async () => {
    const oidc = await connect("serve");
    expect(await oidc.verifyAccessToken(await token({ typ: undefined, nonce: "n-1" }))).toBeNull();
  });

  it("fails as an unavailable provider when the key set cannot be fetched", async () => {
    const oidc = await connect("refuse");
    await expect(oidc.verifyAccessToken(await token())).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("fails as an unavailable provider when the key set answers an error", async () => {
    const oidc = await connect("fail");
    await expect(oidc.verifyAccessToken(await token())).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe("finishing a browser sign-in", () => {
  const checks = { state: "s-1", nonce: "n-1", codeVerifier: "v".repeat(43) };
  const callback = () => new URL("http://localhost:5173/api/auth/callback?code=c-1&state=s-1");

  it("reads the subject from the configured claim of the ID token", async () => {
    idTokenClaims = { sub: "pairwise-1", oid: "object-1", nonce: "n-1" };
    expect(await (await connect("serve")).finishLogin(callback(), checks)).toMatchObject({ subject: "pairwise-1" });
    expect(await (await connect("serve", { subjectClaim: "oid" })).finishLogin(callback(), checks)).toMatchObject({
      subject: "object-1",
    });
  });

  it("fails when the ID token lacks the configured claim", async () => {
    idTokenClaims = { sub: "pairwise-1", nonce: "n-1" };
    const oidc = await connect("serve", { subjectClaim: "oid" });
    await expect(oidc.finishLogin(callback(), checks)).rejects.toThrow(/no 'oid' claim/);
  });
});

describe("the back channel", () => {
  it("takes what is addressed to an issuer ending in a slash", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      sent.push(url);
      return Promise.resolve(new Response("{}"));
    });
    try {
      const send = backchannelFetch("https://login.example.com/", "http://keycloak:8080");
      await send("https://login.example.com/.well-known/openid-configuration");
      await send("https://other.example.com/certs");
      expect(sent).toEqual(["http://keycloak:8080/.well-known/openid-configuration", "https://other.example.com/certs"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
