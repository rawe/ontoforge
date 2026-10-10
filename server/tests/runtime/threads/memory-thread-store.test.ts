/**
 * The in-memory thread store: the interface suite, plus the thread cap,
 * which binds the in-memory store only.
 */

import { describe, expect, it } from "vitest";

import { MemoryThreadStore, THREAD_CAP } from "../../../src/runtime/threads/memoryThreadStore.js";
import type { ThreadBinding } from "../../../src/runtime/threads/threadStore.js";
import { threadStoreSuite } from "./threadStoreSuite.js";

threadStoreSuite("in memory", (clock) => new MemoryThreadStore(clock));

const BINDING: ThreadBinding = { ontologyKey: "fair", lensKey: "visitor", kind: "agents", assistantKey: "guide" };

describe("in-memory thread cap", () => {
  it(`holds at most ${THREAD_CAP} threads, removing the one unused the longest`, async () => {
    let now = 0;
    const store = new MemoryThreadStore(() => now);
    const ids: string[] = [];
    for (let i = 0; i < THREAD_CAP; i++) {
      now += 1;
      ids.push((await store.create(BINDING)).threadId);
    }
    // The oldest thread takes a turn, so the second oldest is now unused the longest.
    now += 1;
    await store.acquire(ids[0]!);
    await store.release(ids[0]!);

    now += 1;
    const newest = await store.create(BINDING);

    expect(await store.find(ids[1]!, BINDING)).toBeNull();
    expect(await store.find(ids[0]!, BINDING)).not.toBeNull();
    expect(await store.find(ids[2]!, BINDING)).not.toBeNull();
    expect(await store.find(newest.threadId, BINDING)).not.toBeNull();
  });
});
