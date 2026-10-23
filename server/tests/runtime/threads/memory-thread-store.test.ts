/**
 * The in-memory thread store: the contract suite on a fake clock, plus what
 * binds the in-memory store only — the default lifetime to the millisecond
 * and its byte bound.
 */

import { describe, expect, it } from "vitest";

import { StoreError } from "../../../src/core/exceptions.js";
import { MemoryThreadStore } from "../../../src/runtime/threads/memoryThreadStore.js";
import { THREAD_IDLE_LIFETIME_MS, TURN_LEASE_MS, type ThreadBinding, type Turn } from "../../../src/runtime/threads/threadStore.js";
import { threadStoreSuite } from "./threadStoreSuite.js";

threadStoreSuite("in memory", async (lifetimes) => {
  let now = 1_000_000;
  return { store: new MemoryThreadStore({ clock: () => now, lifetimes }), advance: async (ms) => { now += ms; } };
});

const BINDING: ThreadBinding = { ontologyKey: "fair", lensKey: "visitor", kind: "agents", assistantKey: "guide" };

describe("in-memory thread store", () => {
  it("expires a thread exactly one idle lifetime after its last activity, a lease exactly one lease after its renewal", async () => {
    let now = 0;
    const store = new MemoryThreadStore({ clock: () => now });
    const { threadId } = await store.create(BINDING);
    now += THREAD_IDLE_LIFETIME_MS - 1;
    const turn = (await store.begin(threadId, BINDING)) as Turn;
    now += TURN_LEASE_MS - 1;
    expect(await store.begin(threadId, BINDING)).toBe("busy");
    now += 1;
    expect(await store.renew(turn)).toBe(false);
    now += THREAD_IDLE_LIFETIME_MS - TURN_LEASE_MS - 1;
    expect(await store.read(threadId, BINDING)).not.toBeNull();
    now += 1;
    expect(await store.read(threadId, BINDING)).toBeNull();
  });

  it("refuses to create or publish beyond its bytes, removing no valid thread", async () => {
    const store = new MemoryThreadStore({ maxBytes: 4 * 1024 });
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await store.create(BINDING)).threadId);
    await expect(store.create(BINDING)).rejects.toThrow(StoreError);

    const turn = (await store.begin(ids[0]!, BINDING)) as Turn;
    await expect(store.publish(turn, new Uint8Array(2 * 1024))).rejects.toThrow(StoreError);
    // The refused publish kept the previous state and the lease.
    expect(await store.read(ids[0]!, BINDING)).toEqual({ state: null });
    expect(await store.publish(turn, new Uint8Array(1024))).toBe("published");
    for (const id of ids) expect(await store.read(id, BINDING)).not.toBeNull();
  });

  it("frees the bytes of expired threads", async () => {
    let now = 0;
    const store = new MemoryThreadStore({ clock: () => now, maxBytes: 2 * 1024 });
    await store.create(BINDING);
    await store.create(BINDING);
    await expect(store.create(BINDING)).rejects.toThrow(StoreError);
    now += THREAD_IDLE_LIFETIME_MS;
    await store.create(BINDING);
    await store.create(BINDING);
  });
});
