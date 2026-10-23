/**
 * The Valkey session store against the dev Valkey in the suite's own
 * logical database: the contract suite with real expiry, two servers'
 * clients sharing it, and every key it leaves expiring.
 */

import { setTimeout as sleep } from "node:timers/promises";

import type { Valkey } from "iovalkey";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeValkey, connectValkey } from "../../../src/adapters/valkey/connection.js";
import { SESSION_SCRIPTS, ValkeySessionStore } from "../../../src/adapters/valkey/sessionStore.js";
import { THREAD_SCRIPTS } from "../../../src/adapters/valkey/threadStore.js";
import type { SessionLifetimes } from "../../../src/auth/sessionStore.js";
import { sessionStoreSuite, SUITE_SESSION_LIFETIMES } from "../../auth/sessionStoreSuite.js";
import { expectEveryKeyExpiring, openAdmin, url } from "./support.js";

async function connect(lifetimes: SessionLifetimes) {
  const client = await connectValkey(url, [THREAD_SCRIPTS, SESSION_SCRIPTS]);
  return { store: new ValkeySessionStore(client, lifetimes), close: () => closeValkey(client) };
}

let admin: Valkey;

beforeAll(async () => {
  admin = await openAdmin();
});

afterAll(async () => {
  await admin.quit();
});

beforeEach(async () => {
  await admin.flushdb();
});

afterEach(async () => {
  await expectEveryKeyExpiring(admin);
});

sessionStoreSuite("valkey", async (lifetimes) => ({ ...(await connect(lifetimes)), advance: (ms) => sleep(ms) }));

describe("valkey session store", () => {
  it("serves a session created through one server's client to another's", async () => {
    const a = await connect(SUITE_SESSION_LIFETIMES);
    const b = await connect(SUITE_SESSION_LIFETIMES);
    await a.store.create("sid", { principalId: "p" });
    expect(await b.store.get("sid")).toMatchObject({ principalId: "p" });
    await a.close();
    await b.close();
  });

  it("keys by digest: no session id appears in a key", async () => {
    const { store, close } = await connect(SUITE_SESSION_LIFETIMES);
    await store.create("secret-session-id", { principalId: "p" });
    const keys = await admin.keys("ontoforge:*");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ontoforge:session:\{[0-9a-f]{64}\}$/);
    await close();
  });
});
