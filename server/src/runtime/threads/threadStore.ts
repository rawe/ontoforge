/**
 * The thread store: the one seam for server-held assistant conversations
 * (`docs/architecture.md#thread-store`). Graphs and routes talk only to
 * this interface; the in-memory implementation is `memoryThreadStore.ts`.
 *
 * The interface assumes nothing about where threads live: every operation
 * is async, values go in and out as serialisable copies, and the run lock
 * and expiry are operations of the store. A second implementation (e.g.
 * PostgreSQL) must pass the same suite.
 *
 * A turn runs in this order:
 *
 *   acquire → beginTurn → graph run (checkpointer, `thread_id`)
 *     → commitTurn on success | rollbackTurn on cancel or failure
 *   → release (always)
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

/**
 * A thread expires this long after its last turn. Long enough to come back
 * to a conversation within a working session; short enough that abandoned
 * conversations do not pile up.
 */
export const THREAD_IDLE_LIFETIME_MS = 2 * 60 * 60 * 1000;

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

/** A thread's registry entry. Times are epoch milliseconds. */
export interface Thread {
  threadId: string;
  binding: ThreadBinding;
  createdAt: number;
  /** Start or end of the last turn; expiry counts from it. */
  lastUsedAt: number;
}

/** What a graph run needs of its thread: the id and the saver to run on. */
export interface GraphThread {
  checkpointer: BaseCheckpointSaver;
  threadId: string;
}

/** The store's clock, injectable so expiry is testable without waiting. */
export type Clock = () => number;

export interface ThreadStore {
  /**
   * The checkpoint saver graphs compile with. A run names its thread in
   * `configurable.thread_id`. It keeps only the latest checkpoint per
   * thread; writing to an unknown or expired thread throws.
   */
  readonly checkpointer: BaseCheckpointSaver;

  /** Registers a new thread with a random, unguessable id. */
  create(binding: ThreadBinding): Promise<Thread>;

  /**
   * The thread, or `null` when it is unknown, expired, or bound to another
   * assistant. Reading does not count as use.
   */
  find(threadId: string, binding: ThreadBinding): Promise<Thread | null>;

  /**
   * Takes the thread's run lock and marks the thread used. `false` when a
   * run already holds it — never queued. Throws for an unknown thread.
   */
  acquire(threadId: string): Promise<boolean>;

  /** Releases the run lock and marks the thread used. No-op for an unknown thread. */
  release(threadId: string): Promise<void>;

  /** Remembers the thread's current checkpoint as the state before this turn. */
  beginTurn(threadId: string): Promise<void>;

  /** The turn succeeded: forgets the remembered checkpoint. */
  commitTurn(threadId: string): Promise<void>;

  /**
   * The turn was cancelled or failed: returns the thread to the remembered
   * checkpoint, discarding everything the turn wrote.
   */
  rollbackTurn(threadId: string): Promise<void>;

  /**
   * The graph state of the thread's latest checkpoint (channel values), or
   * `null` for an unknown or expired thread. Reading does not count as use.
   */
  values(threadId: string): Promise<Record<string, unknown> | null>;
}
