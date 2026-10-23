/**
 * The Valkey thread store against the dev Valkey, in a logical database of
 * its own (`env/test-valkey.env`): the contract suite with real expiry, plus
 * what only Valkey can do to it — a flush or a restart under a running turn,
 * a full memory, a dropped connection, a misconfigured eviction policy.
 * Fails loudly when that Valkey is down, like the database suite.
 */

import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { Valkey } from "iovalkey";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { settings } from "../../../src/config.js";
import { StoreError } from "../../../src/core/exceptions.js";
import type { ThreadBinding, Turn } from "../../../src/runtime/threads/threadStore.js";
import { ValkeyThreadStore } from "../../../src/runtime/threads/valkeyThreadStore.js";
import { SUITE_LIFETIMES, threadStoreSuite } from "../../runtime/threads/threadStoreSuite.js";

/** The dev Valkey's container (`docker-compose.yml`); one test pauses and restarts it. */
const CONTAINER = "ontoforge-valkey-dev";
/** The logical database the suite owns: it flushes this one only. */
const DATABASE = "/15";
const BINDING: ThreadBinding = { ontologyKey: "fair", lensKey: "visitor", kind: "agents", assistantKey: "guide" };
const bytes = (text: string) => new Uint8Array(Buffer.from(text));

if (settings.THREAD_STORE !== "valkey" || settings.VALKEY_URL === null) {
  throw new Error("The Valkey suite runs with env/test-valkey.env (THREAD_STORE=valkey, VALKEY_URL)");
}
const url = settings.VALKEY_URL;
if (new URL(url).pathname !== DATABASE) {
  throw new Error(`The Valkey suite flushes its database: VALKEY_URL must name database ${DATABASE.slice(1)}`);
}

/** A plain client for what the store never does: flushing, configuring, inspecting. */
let admin: Valkey;

beforeAll(async () => {
  admin = new Valkey(url);
  await admin.ping();
});

afterAll(async () => {
  await admin.quit();
});

beforeEach(async () => {
  await admin.flushdb();
});

threadStoreSuite("valkey", async (lifetimes) => ({
  store: await ValkeyThreadStore.connect(url, lifetimes),
  advance: (ms) => sleep(ms),
}));

describe("valkey thread store", () => {
  let store: ValkeyThreadStore;
  const opened: ValkeyThreadStore[] = [];

  async function open(): Promise<ValkeyThreadStore> {
    const opening = await ValkeyThreadStore.connect(url, SUITE_LIFETIMES);
    opened.push(opening);
    return opening;
  }

  beforeEach(async () => {
    store = await open();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(opened.splice(0).map((each) => each.close()));
  });

  /** Every key the store holds, each with its remaining time to live. */
  async function ttls(): Promise<Record<string, number>> {
    const keys = await admin.keys("*");
    return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await admin.pttl(key)] as const)));
  }

  async function infoField(field: string): Promise<string> {
    return new RegExp(`^${field}:(\\S+)`, "m").exec(await admin.info("memory"))![1]!;
  }

  it("gives every key a time to live after every operation", async () => {
    const expectAllExpiring = async (count: number) => {
      const all = await ttls();
      expect(Object.keys(all)).toHaveLength(count);
      for (const ttl of Object.values(all)) expect(ttl).toBeGreaterThan(0);
    };
    const { threadId } = await store.create(BINDING);
    await expectAllExpiring(1);
    const turn = (await store.begin(threadId, BINDING)) as Turn;
    await expectAllExpiring(2);
    await store.renew(turn);
    await expectAllExpiring(2);
    await store.publish(turn, bytes("one"));
    await expectAllExpiring(1);
    await store.release((await store.begin(threadId, BINDING)) as Turn);
    await expectAllExpiring(1);
  });

  it("a flush under a running turn: publish is gone, renew and release refused, nothing reappears", async () => {
    const { threadId } = await store.create(BINDING);
    const turn = (await store.begin(threadId, BINDING)) as Turn;
    await admin.flushdb();
    expect(await store.publish(turn, bytes("late"))).toBe("gone");
    expect(await store.renew(turn)).toBe(false);
    await store.release(turn);
    expect(await admin.dbsize()).toBe(0);
    expect(await store.read(threadId, BINDING)).toBeNull();
    expect(await store.begin(threadId, BINDING)).toBeNull();
    expect(await admin.dbsize()).toBe(0);
  });

  it("a full Valkey refuses new threads, turns and publishes whole, and still ends turns", async () => {
    const { threadId } = await store.create(BINDING);
    let turn = (await store.begin(threadId, BINDING)) as Turn;
    await store.publish(turn, bytes("one"));
    turn = (await store.begin(threadId, BINDING)) as Turn;
    const maxmemory = await infoField("maxmemory");
    await admin.config("SET", "maxmemory", String(Math.floor(Number(await infoField("used_memory")) / 2)));
    try {
      await expect(store.publish(turn, bytes("two"))).rejects.toThrow(StoreError);
      await expect(store.create(BINDING)).rejects.toThrow(StoreError);
      expect(await store.read(threadId, BINDING)).toEqual({ state: bytes("one") });
      expect(await store.renew(turn)).toBe(true);
      await store.release(turn);
      await expect(store.begin(threadId, BINDING)).rejects.toThrow(StoreError);
    } finally {
      await admin.config("SET", "maxmemory", maxmemory);
    }
    expect(await store.publish((await store.begin(threadId, BINDING)) as Turn, bytes("two"))).toBe("published");
  });

  it("two servers share threads: a turn on one is busy on the other, its state read there", async () => {
    const other = await open();
    const { threadId } = await store.create(BINDING);
    const turn = (await store.begin(threadId, BINDING)) as Turn;
    expect(await other.begin(threadId, BINDING)).toBe("busy");
    await store.publish(turn, bytes("from one"));
    const next = (await other.begin(threadId, BINDING)) as Turn;
    expect(next.state).toEqual(bytes("from one"));
    await other.publish(next, bytes("from the other"));
    expect(await store.read(threadId, BINDING)).toEqual({ state: bytes("from the other") });
  });

  it("a command on a dropped connection fails as a storage error; the client reconnects", async () => {
    const { threadId } = await store.create(BINDING);
    // The suite's own connections only: those on its database, but this one.
    const own = String(await admin.client("ID"));
    const list = String(await admin.client("LIST"));
    for (const [, id] of list.matchAll(/^id=(\d+) .* db=15 /gm)) {
      if (id !== own) await admin.client("KILL", "ID", id!);
    }
    await expect(store.read(threadId, BINDING)).rejects.toThrow(StoreError);
    await vi.waitFor(async () => expect(await store.read(threadId, BINDING)).toEqual({ state: null }), { timeout: 5000 });
  });

  it("an unresponsive Valkey times out as a storage error; after a restart every thread is gone", async () => {
    const { threadId } = await store.create(BINDING);
    const turn = (await store.begin(threadId, BINDING)) as Turn;
    execFileSync("docker", ["pause", CONTAINER]);
    try {
      await expect(store.read(threadId, BINDING)).rejects.toThrow(StoreError);
    } finally {
      execFileSync("docker", ["unpause", CONTAINER]);
    }
    execFileSync("docker", ["restart", "-t", "0", CONTAINER]);
    // Until the client is back, every call fails as a storage error; none
    // falls back to anything.
    await vi.waitFor(async () => {
      try {
        expect(await store.read(threadId, BINDING)).toBeNull();
      } catch (error) {
        expect(error).toBeInstanceOf(StoreError);
        throw error;
      }
    }, { timeout: 15_000, interval: 200 });
    expect(await store.publish(turn, bytes("late"))).toBe("gone");
    expect(await store.begin(threadId, BINDING)).toBeNull();
    // The scripts load again after the restart.
    const fresh = await store.create(BINDING);
    expect(await store.publish((await store.begin(fresh.threadId, BINDING)) as Turn, bytes("one"))).toBe("published");
    await vi.waitFor(() => admin.ping(), { timeout: 5000 });
  }, 60_000);

  it("refuses to connect to a Valkey that evicts, cannot run the scripts or cannot be reached, without leaking the password", async () => {
    await admin.config("SET", "maxmemory-policy", "allkeys-lru");
    try {
      await expect(ValkeyThreadStore.connect(url)).rejects.toThrow(/maxmemory-policy must be noeviction, is allkeys-lru/);
    } finally {
      await admin.config("SET", "maxmemory-policy", "noeviction");
    }
    // A Valkey that may not run scripts (as some managed services restrict them).
    await admin.acl("SETUSER", "noscripts", "on", ">secret", "~*", "+@all", "-@scripting");
    try {
      const target = new URL(url);
      target.username = "noscripts";
      target.password = "secret";
      const restricted = ValkeyThreadStore.connect(target.toString());
      await expect(restricted).rejects.toThrow(/is not usable: .*NOPERM/);
      await expect(restricted).rejects.not.toThrow(/secret/);
    } finally {
      await admin.acl("DELUSER", "noscripts");
    }
    const unreachable = ValkeyThreadStore.connect("redis://user:secret@127.0.0.1:1");
    await expect(unreachable).rejects.toThrow(/Valkey at redis:\/\/user:\*\*\*@127\.0\.0\.1:1/);
    await expect(unreachable).rejects.not.toThrow(/secret/);
  });
});
