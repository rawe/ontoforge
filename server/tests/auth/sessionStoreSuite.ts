/**
 * The session store's contract suite. It speaks only the `SessionStore`
 * interface, so every implementation runs it unchanged: a fake clock in
 * memory, real waiting against Valkey. Margins are 60 ms.
 */

import { describe, expect, it } from "vitest";

import type { Session, SessionLifetimes, SessionStore } from "../../src/auth/sessionStore.js";

export interface SessionStoreUnderTest {
  store: SessionStore;
  advance(ms: number): Promise<void>;
  close?(): Promise<void>;
}

export const SUITE_SESSION_LIFETIMES: SessionLifetimes = { loginMs: 300, idleMs: 400, absoluteMs: 1000 };
const { loginMs: LOGIN, idleMs: IDLE, absoluteMs: ABSOLUTE } = SUITE_SESSION_LIFETIMES;
const MARGIN = 60;

const SESSION: Session = { principalId: "p-1", issuer: "http://issuer", subject: "s-1", idToken: "id.token.value" };
const LOGIN_TX = { codeVerifier: "verifier", nonce: "nonce", returnTo: "/o/x" };

export function sessionStoreSuite(
  name: string,
  factory: (lifetimes: SessionLifetimes) => Promise<SessionStoreUnderTest>,
): void {
  describe(`session store contract (${name})`, () => {
    async function open(): Promise<SessionStoreUnderTest> {
      return factory(SUITE_SESSION_LIFETIMES);
    }

    it("hands a login transaction out exactly once", async () => {
      const { store, close } = await open();
      await store.startLogin("state-1", LOGIN_TX);
      const [first, second] = await Promise.all([store.takeLogin("state-1"), store.takeLogin("state-1")]);
      expect([first, second].filter((v) => v !== null)).toEqual([LOGIN_TX]);
      expect(await store.takeLogin("state-1")).toBeNull();
      expect(await store.takeLogin("never")).toBeNull();
      await close?.();
    });

    it("expires a login transaction", async () => {
      const { store, advance, close } = await open();
      await store.startLogin("state-2", LOGIN_TX);
      await advance(LOGIN + MARGIN);
      expect(await store.takeLogin("state-2")).toBeNull();
      await close?.();
    });

    it("keeps a session, deletes it, and knows no other id", async () => {
      const { store, close } = await open();
      await store.create("sid-1", SESSION);
      expect(await store.get("sid-1")).toEqual(SESSION);
      expect(await store.get("sid-2")).toBeNull();
      await store.delete("sid-1");
      expect(await store.get("sid-1")).toBeNull();
      await store.delete("sid-1");
      await close?.();
    });

    it("expires an unused session after the idle lifetime, and use moves that deadline", async () => {
      const { store, advance, close } = await open();
      await store.create("sid-3", SESSION);
      await store.create("sid-4", SESSION);
      await advance(IDLE - MARGIN * 2);
      expect(await store.get("sid-3")).toEqual(SESSION);
      await advance(MARGIN * 3);
      expect(await store.get("sid-4")).toBeNull();
      expect(await store.get("sid-3")).toEqual(SESSION);
      await close?.();
    });

    it("ends a session at its absolute lifetime however often it is used", async () => {
      const { store, advance, close } = await open();
      await store.create("sid-5", SESSION);
      let elapsed = 0;
      while (elapsed + IDLE / 2 < ABSOLUTE - MARGIN) {
        await advance(IDLE / 2);
        elapsed += IDLE / 2;
        expect(await store.get("sid-5")).toEqual(SESSION);
      }
      await advance(ABSOLUTE - elapsed + MARGIN);
      expect(await store.get("sid-5")).toBeNull();
      await close?.();
    });
  });
}
