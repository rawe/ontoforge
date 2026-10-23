import { describe, expect, it } from "vitest";

import { LOGIN_LIFETIME_MS, loginCookieKey, openLogin, sealLogin, type LoginTransaction } from "../../src/auth/loginCookie.js";

const NOW = 1_800_000_000_000;
const TRANSACTION: LoginTransaction = {
  state: "s",
  nonce: "n",
  codeVerifier: "v",
  returnTo: "/studio?x=1",
  exp: NOW + LOGIN_LIFETIME_MS,
};

describe("the login cookie", () => {
  const key = loginCookieKey("client secret");

  it("opens what the same secret sealed, on any server", () => {
    const sealed = sealLogin(TRANSACTION, key);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("verifier");
    expect(openLogin(sealed, loginCookieKey("client secret"), NOW)).toEqual(TRANSACTION);
  });

  it("seals the same transaction differently each time", () => {
    expect(sealLogin(TRANSACTION, key)).not.toBe(sealLogin(TRANSACTION, key));
  });

  it("refuses a tampered value", () => {
    const raw = Buffer.from(sealLogin(TRANSACTION, key), "base64url");
    for (const index of [0, 12, raw.length - 1]) {
      const tampered = Buffer.from(raw);
      tampered[index] = tampered[index]! ^ 1;
      expect(openLogin(tampered.toString("base64url"), key, NOW), `byte ${index}`).toBeNull();
    }
    expect(openLogin("", key, NOW)).toBeNull();
    expect(openLogin("not-a-cookie", key, NOW)).toBeNull();
  });

  it("refuses a value sealed with another secret", () => {
    expect(openLogin(sealLogin(TRANSACTION, loginCookieKey("other secret")), key, NOW)).toBeNull();
  });

  it("refuses an expired transaction", () => {
    const sealed = sealLogin(TRANSACTION, key);
    expect(openLogin(sealed, key, TRANSACTION.exp - 1)).not.toBeNull();
    expect(openLogin(sealed, key, TRANSACTION.exp)).toBeNull();
  });
});
