/**
 * The in-memory thread store. Threads live in this process only, so it
 * serves one server process: a restart loses them all, and clients recover
 * through the not-found answer.
 *
 * It keeps the store contract exactly as the Valkey adapter does: states
 * are copied in and out, every write after `begin` is checked against the
 * turn's token, and a missing thread is never recreated. Expiry is applied
 * on every call; no timer runs. Activity moves a thread to the end of the
 * map, so the map is ordered by deadline and expiry stops at the first
 * live thread. Its memory is bounded by `maxBytes`: a
 * `create` or `publish` that would exceed it is refused, and no valid
 * thread is ever removed to make room — the analogue of Valkey's
 * `noeviction`.
 */

import { randomUUID } from "node:crypto";

import { StoreError } from "../../core/exceptions.js";
import {
  checkStateSize,
  DEFAULT_LIFETIMES,
  sameBinding,
  type Clock,
  type StoreLifetimes,
  type Thread,
  type ThreadBinding,
  type ThreadStore,
  type Turn,
} from "./threadStore.js";

/** The most bytes the store holds by default, over all threads. */
export const MEMORY_STORE_MAX_BYTES = 256 * 1024 * 1024;

/** Every thread counts at least this many bytes, so empty threads are bounded too. */
const MIN_THREAD_BYTES = 1024;

interface Entry {
  binding: ThreadBinding;
  state: Uint8Array | null;
  /** Expires at this time unless renewed by activity. */
  deadline: number;
  lease: { token: string; until: number } | null;
}

const entryBytes = (state: Uint8Array | null) => Math.max(MIN_THREAD_BYTES, state?.byteLength ?? 0);

export interface MemoryThreadStoreOptions {
  clock?: Clock;
  lifetimes?: StoreLifetimes;
  maxBytes?: number;
}

/** The thread store held in this process's memory. */
export class MemoryThreadStore implements ThreadStore {
  private readonly entries = new Map<string, Entry>();
  private readonly clock: Clock;
  private readonly lifetimes: StoreLifetimes;
  private readonly maxBytes: number;
  private bytes = 0;

  constructor({ clock = Date.now, lifetimes = DEFAULT_LIFETIMES, maxBytes = MEMORY_STORE_MAX_BYTES }: MemoryThreadStoreOptions = {}) {
    this.clock = clock;
    this.lifetimes = lifetimes;
    this.maxBytes = maxBytes;
  }

  async create(binding: ThreadBinding): Promise<Thread> {
    this.expire();
    this.reserve(entryBytes(null));
    const threadId = randomUUID();
    const copy = { ...binding };
    this.touch(threadId, { binding: copy, state: null, deadline: 0, lease: null });
    return { threadId, binding: { ...copy } };
  }

  async read(threadId: string, binding: ThreadBinding): Promise<{ state: Uint8Array | null } | null> {
    const entry = this.live(threadId, binding);
    return entry ? { state: entry.state?.slice() ?? null } : null;
  }

  async begin(threadId: string, binding: ThreadBinding): Promise<Turn | "busy" | null> {
    const entry = this.live(threadId, binding);
    if (!entry) return null;
    const now = this.clock();
    if (entry.lease && entry.lease.until > now) return "busy";
    const token = randomUUID();
    entry.lease = { token, until: now + this.lifetimes.leaseMs };
    this.touch(threadId, entry);
    return { threadId, token, state: entry.state?.slice() ?? null };
  }

  async renew(turn: Turn): Promise<boolean> {
    const entry = this.owned(turn);
    if (!entry) return false;
    entry.lease!.until = this.clock() + this.lifetimes.leaseMs;
    return true;
  }

  async publish(turn: Turn, state: Uint8Array): Promise<"published" | "taken" | "gone"> {
    checkStateSize(state);
    this.expire();
    const entry = this.entries.get(turn.threadId);
    if (!entry) return "gone";
    if (!this.owned(turn)) return "taken";
    const before = entryBytes(entry.state);
    this.reserve(entryBytes(state) - before);
    entry.state = state.slice();
    entry.lease = null;
    this.touch(turn.threadId, entry);
    return "published";
  }

  async release(turn: Turn): Promise<void> {
    const entry = this.owned(turn);
    if (entry) entry.lease = null;
  }

  async close(): Promise<void> {}

  /** Renews a thread's idle deadline and moves it to the end of the map. */
  private touch(threadId: string, entry: Entry): void {
    entry.deadline = this.clock() + this.lifetimes.idleMs;
    this.entries.delete(threadId);
    this.entries.set(threadId, entry);
  }

  /** Removes every thread past its idle deadline, freeing its bytes: the
   * oldest first, up to the first that is live. */
  private expire(): void {
    const now = this.clock();
    for (const [threadId, entry] of this.entries) {
      if (entry.deadline > now) break;
      this.entries.delete(threadId);
      this.bytes -= entryBytes(entry.state);
    }
  }

  /** Accounts `delta` more bytes, or refuses when they would not fit. */
  private reserve(delta: number): void {
    if (this.bytes + delta > this.maxBytes) {
      const error = new StoreError("Thread store is full");
      console.error(`Storage failure ${error.errorId}: thread store is full (${this.maxBytes} bytes)`);
      throw error;
    }
    this.bytes += delta;
  }

  private live(threadId: string, binding: ThreadBinding): Entry | undefined {
    this.expire();
    const entry = this.entries.get(threadId);
    return entry && sameBinding(entry.binding, binding) ? entry : undefined;
  }

  /** The turn's thread while `turn` holds its live lease. */
  private owned(turn: Turn): Entry | undefined {
    this.expire();
    const entry = this.entries.get(turn.threadId);
    const lease = entry?.lease;
    return lease && lease.token === turn.token && lease.until > this.clock() ? entry : undefined;
  }
}
