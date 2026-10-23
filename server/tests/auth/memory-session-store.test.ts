/**
 * The in-memory session store: the contract suite on a fake clock, plus its
 * bound — a full store drops what expired and then refuses, never a live entry.
 */

import { describe, expect, it } from "vitest";

import { MemorySessionStore } from "../../src/auth/sessionStore.js";
import { StoreError } from "../../src/core/exceptions.js";
import { sessionStoreSuite, SUITE_SESSION_LIFETIMES } from "./sessionStoreSuite.js";

sessionStoreSuite("in memory", async (lifetimes) => {
  let now = 1_000_000;
  return { store: new MemorySessionStore(lifetimes, () => now), advance: async (ms) => { now += ms; } };
});

const SESSION = { principalId: "p", issuer: "i", subject: "s", idToken: null };

describe("in-memory session store", () => {
  it("refuses beyond its bound once nothing has expired, and makes room from expired entries", async () => {
    let now = 0;
    const store = new MemorySessionStore(SUITE_SESSION_LIFETIMES, () => now, 2);
    await store.create("a", SESSION);
    await store.startLogin("s", { codeVerifier: "v", nonce: "n", returnTo: "/" });
    await expect(store.create("b", SESSION)).rejects.toBeInstanceOf(StoreError);
    expect(await store.get("a")).toEqual(SESSION);
    now += SUITE_SESSION_LIFETIMES.idleMs + 1;
    await store.create("b", SESSION);
    expect(await store.get("b")).toEqual(SESSION);
  });

  it("keeps no session id or state as it is", async () => {
    const store = new MemorySessionStore(SUITE_SESSION_LIFETIMES);
    await store.create("secret-session-id", SESSION);
    await store.startLogin("secret-state", { codeVerifier: "v", nonce: "n", returnTo: "/" });
    const keys = [...(store as unknown as { sessions: Map<string, unknown> }).sessions.keys(), ...(store as unknown as { logins: Map<string, unknown> }).logins.keys()];
    expect(keys.join()).not.toMatch(/secret/);
  });
});
