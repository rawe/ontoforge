/**
 * The thread store: the one seam for server-held assistant conversations
 * (`docs/architecture.md#thread-store`). Routes talk only to this
 * interface; the implementations are `memoryThreadStore.ts` (one process)
 * and `valkeyThreadStore.ts` (shared by any number of servers).
 *
 * The store holds one opaque byte string per thread: its state after the
 * last completed turn. A turn never writes into the store while it runs —
 * it runs its graph on a local `TurnSaver` seeded from that state and
 * publishes the saver's bytes once, when it completes:
 *
 *   begin (lease + state) → TurnSaver.load → graph run, renew as heartbeat
 *     → publish (stores, ends the lease) on success | release on cancel or failure
 *
 * So reads during a turn show the last completed turn, a failed turn
 * leaves the previous state, and every write after `begin` is checked
 * against the turn's owner token: an owner that lost its lease can no
 * longer touch the thread.
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import { ValidationError } from "../../core/exceptions.js";

/**
 * A thread expires this long after its last activity — an accepted message
 * or a completed turn. Long enough to come back to a conversation the next
 * day; abandoned conversations still go.
 */
export const THREAD_IDLE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A running turn's lease: an owner that died blocks its thread at most this long. */
export const TURN_LEASE_MS = 30_000;

/** A running turn renews its lease this often: three renewals per lease. */
export const TURN_HEARTBEAT_MS = 10_000;

/** The most bytes one thread's published state may take — the chat stream's buffer cap. */
export const THREAD_STATE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * At most this many turns stay in a thread's state; older ones are removed.
 * Bounds what one thread stores, and is what a thread read back shows — about
 * the 50 messages a chat view keeps.
 */
export const TURNS_PER_THREAD = 25;

/**
 * The model sees the last this many turns, for every assistant kind. Enough
 * to resolve references to recent questions and results ("these", "the
 * second one") while keeping model input small.
 */
export const TURNS_THE_MODEL_SEES = 8;

/** What a thread belongs to. Continuing it through another assistant is refused. */
export interface ThreadBinding {
  ontologyKey: string;
  lensKey: string;
  /** The assistant kind as the routes name it. */
  kind: string;
  assistantKey: string;
}

/** A thread's registry entry. */
export interface Thread {
  threadId: string;
  binding: ThreadBinding;
}

/** A running turn: its owner token, never reused, and the state it started from. */
export interface Turn {
  threadId: string;
  token: string;
  /** The last published state; `null` before the first completed turn. */
  state: Uint8Array | null;
}

/** What a graph run needs of its thread: the id and the saver to run on. */
export interface GraphThread {
  checkpointer: BaseCheckpointSaver;
  threadId: string;
}

/** The store's clock, injectable so expiry is testable without waiting. */
export type Clock = () => number;

/** A store's lifetimes; tests shorten them, servers use the defaults above. */
export interface StoreLifetimes {
  idleMs: number;
  leaseMs: number;
}

export const DEFAULT_LIFETIMES: StoreLifetimes = { idleMs: THREAD_IDLE_LIFETIME_MS, leaseMs: TURN_LEASE_MS };

export interface ThreadStore {
  /** Registers a new thread with a random, unguessable id; no state, no turn. Counts as activity. */
  create(binding: ThreadBinding): Promise<Thread>;

  /**
   * The last published state (`state: null` before the first completed
   * turn), or `null` when the thread is unknown, expired or bound to another
   * assistant. Not activity.
   */
  read(threadId: string, binding: ThreadBinding): Promise<{ state: Uint8Array | null } | null>;

  /**
   * An accepted message: takes the thread's lease with a fresh token and
   * renews its idle deadline. `"busy"` while a live lease exists — never
   * queued; `null` when unknown, expired or bound to another assistant.
   */
  begin(threadId: string, binding: ThreadBinding): Promise<Turn | "busy" | null>;

  /** Heartbeat: extends the lease, never the idle deadline. `false` = no longer the owner. */
  renew(turn: Turn): Promise<boolean>;

  /**
   * A completed turn: stores `state`, renews the idle deadline and ends the
   * lease, in one step — only while the thread exists and `turn` still owns
   * it. Never recreates a thread. Throws ValidationError over
   * `THREAD_STATE_MAX_BYTES`, leaving state and lease as they were.
   */
  publish(turn: Turn, state: Uint8Array): Promise<"published" | "taken" | "gone">;

  /** Ends the lease if `turn` still owns it; never touches state or deadline. */
  release(turn: Turn): Promise<void>;

  close(): Promise<void>;
}

/** Refuses a state over `THREAD_STATE_MAX_BYTES`; both adapters check it before writing. */
export function checkStateSize(state: Uint8Array): void {
  if (state.byteLength > THREAD_STATE_MAX_BYTES) {
    throw new ValidationError("Conversation too large; start a new one.");
  }
}

export function sameBinding(a: ThreadBinding, b: ThreadBinding): boolean {
  return (
    a.ontologyKey === b.ontologyKey &&
    a.lensKey === b.lensKey &&
    a.kind === b.kind &&
    a.assistantKey === b.assistantKey
  );
}
