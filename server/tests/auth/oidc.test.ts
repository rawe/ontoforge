/**
 * Access-token verification against a provider on a local port: a wrong
 * token is no caller, a provider whose keys cannot be fetched is
 * `ProviderUnavailableError` — never an unhandled error.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectOidc, type Oidc } from "../../src/auth/oidc.js";
import { ProviderUnavailableError } from "../../src/core/exceptions.js";
import { SETTINGS } from "./fakes.js";

/** How the provider answers for its key set. */
let keys: "serve" | "fail" | "refuse" = "serve";
let jwk: JWK;
let privateKey: CryptoKey;
let issuer: string;
let server: Server;

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
function connect(answer: typeof keys): Promise<Oidc> {
  keys = answer;
  return connectOidc({ ...SETTINGS, issuer, backchannelUrl: issuer });
}

function token(claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ typ: "Bearer", iss: issuer, sub: "sub-1", aud: SETTINGS.audience, scope: "profile ontoforge-api", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setExpirationTime("5m")
    .sign(privateKey);
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

  it("needs the API scope, in scope or scp", async () => {
    const oidc = await connect("serve");
    expect(await oidc.verifyAccessToken(await token({ scope: undefined }))).toBeNull();
    expect(await oidc.verifyAccessToken(await token({ scope: "openid profile" }))).toBeNull();
    expect(await oidc.verifyAccessToken(await token({ scope: "ontoforge-api-x" }))).toBeNull();
    expect(await oidc.verifyAccessToken(await token({ scope: undefined, scp: "ontoforge-api" }))).not.toBeNull();
    expect(await oidc.verifyAccessToken(await token({ scope: undefined, scp: ["read", "ontoforge-api"] }))).not.toBeNull();
  });

  it("takes no ID token, even one carrying the API audience and scope", async () => {
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
