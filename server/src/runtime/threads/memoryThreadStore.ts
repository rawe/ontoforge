/**
 * The in-memory thread store. Threads live in this process only: a restart
 * loses them all, and clients recover through the not-found answer.
 *
 * Checkpoints are held serialised (the saver's serde), so nothing a caller
 * passes in or gets back is shared with the store. Per thread and checkpoint
 * namespace only the latest checkpoint and its pending writes are kept,
 * plus — while a turn runs — a copy of the state the turn started from.
 * Retention is applied on every read and write; no timer runs.
 */

import { randomUUID } from "node:crypto";

import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  WRITES_IDX_MAP,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

import { NotFoundError } from "../../core/exceptions.js";
import {
  THREAD_IDLE_LIFETIME_MS,
  type Clock,
  type Thread,
  type ThreadBinding,
  type ThreadStore,
} from "./threadStore.js";

/**
 * At most this many threads are held in memory; reaching it removes the
 * thread unused the longest. Bounds the process's memory use whatever the
 * number of conversations.
 */
export const THREAD_CAP = 100;

/** A serde result: type tag and bytes. Never mutated once stored. */
type Serialised = [string, Uint8Array];

interface StoredCheckpoint {
  id: string;
  parentId: string | undefined;
  checkpoint: Serialised;
  metadata: Serialised;
}

interface StoredWrite {
  taskId: string;
  channel: string;
  value: Serialised;
}

/** One thread's checkpoint state, per checkpoint namespace. */
interface ThreadState {
  /** The latest checkpoint per namespace. */
  checkpoints: Map<string, StoredCheckpoint>;
  /** Pending writes per namespace, keyed by checkpoint id, then `taskId,idx`. */
  writes: Map<string, Map<string, Map<string, StoredWrite>>>;
}

interface Entry {
  thread: Thread;
  locked: boolean;
  state: ThreadState;
  /** The state the running turn started from; `null` outside a turn. */
  turnStart: ThreadState | null;
}

function emptyState(): ThreadState {
  return { checkpoints: new Map(), writes: new Map() };
}

/** A structural copy; the serialised bytes are immutable and shared. */
function copyState(state: ThreadState): ThreadState {
  const writes = new Map<string, Map<string, Map<string, StoredWrite>>>();
  for (const [ns, byCheckpoint] of state.writes) {
    writes.set(ns, new Map([...byCheckpoint].map(([id, byTask]) => [id, new Map(byTask)])));
  }
  return { checkpoints: new Map(state.checkpoints), writes };
}

function sameBinding(a: ThreadBinding, b: ThreadBinding): boolean {
  return (
    a.ontologyKey === b.ontologyKey &&
    a.lensKey === b.lensKey &&
    a.kind === b.kind &&
    a.assistantKey === b.assistantKey
  );
}

function copyThread(thread: Thread): Thread {
  return { ...thread, binding: { ...thread.binding } };
}

/** The registry and every thread's state; shared by the store and its saver. */
class Threads {
  readonly entries = new Map<string, Entry>();

  constructor(readonly clock: Clock) {}

  /** Applies retention, then returns the live entry or `undefined`. */
  get(threadId: string | undefined): Entry | undefined {
    this.expire();
    return threadId === undefined ? undefined : this.entries.get(threadId);
  }

  /** Removes every thread idle for the lifetime, checkpoints and all. */
  expire(): void {
    const now = this.clock();
    for (const [threadId, entry] of this.entries) {
      if (now - entry.thread.lastUsedAt >= THREAD_IDLE_LIFETIME_MS) this.entries.delete(threadId);
    }
  }

  /** Removes the threads unused the longest until one more fits under the cap. */
  makeRoom(): void {
    while (this.entries.size >= THREAD_CAP) {
      let oldest: Entry | undefined;
      for (const entry of this.entries.values()) {
        if (!oldest || entry.thread.lastUsedAt < oldest.thread.lastUsedAt) oldest = entry;
      }
      this.entries.delete(oldest!.thread.threadId);
    }
  }
}

/**
 * LangGraph's checkpoint-saver contract over the store's threads. Keeps only
 * the latest checkpoint per thread and namespace; a thread must be
 * registered before a graph can write to it.
 */
class MemoryCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly threads: Threads) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = getCheckpointId(config);
    const state = this.threads.get(threadId)?.state;
    const stored = state?.checkpoints.get(ns);
    if (!state || !stored || (checkpointId && stored.id !== checkpointId)) return undefined;
    return this.tuple(threadId!, ns, stored, state);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { before, filter } = options ?? {};
    let limit = options?.limit;
    const threadId = config.configurable?.thread_id as string | undefined;
    const configNs = config.configurable?.checkpoint_ns as string | undefined;
    const configId = config.configurable?.checkpoint_id as string | undefined;
    const beforeId = before?.configurable?.checkpoint_id as string | undefined;
    this.threads.expire();
    const threadIds = threadId !== undefined ? [threadId] : [...this.threads.entries.keys()];
    for (const id of threadIds) {
      const state = this.threads.entries.get(id)?.state;
      if (!state) continue;
      for (const [ns, stored] of [...state.checkpoints]) {
        if (configNs !== undefined && ns !== configNs) continue;
        if (configId && stored.id !== configId) continue;
        if (beforeId && stored.id >= beforeId) continue;
        const tuple = await this.tuple(id, ns, stored, state);
        const metadata = tuple.metadata as Record<string, unknown>;
        if (filter && !Object.entries(filter).every(([key, value]) => metadata[key] === value)) continue;
        if (limit !== undefined) {
          if (limit <= 0) return;
          limit -= 1;
        }
        yield tuple;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const [serialisedCheckpoint, serialisedMetadata] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    const entry = this.threads.get(threadId);
    if (!entry) throw new NotFoundError("Thread not found");
    entry.state.checkpoints.set(ns, {
      id: checkpoint.id,
      parentId: config.configurable?.checkpoint_id as string | undefined,
      checkpoint: serialisedCheckpoint,
      metadata: serialisedMetadata,
    });
    // Only the latest checkpoint is kept, so only its pending writes are.
    const byCheckpoint = entry.state.writes.get(ns);
    for (const id of byCheckpoint?.keys() ?? []) {
      if (id !== checkpoint.id) byCheckpoint!.delete(id);
    }
    return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (checkpointId === undefined) throw new Error("Pending writes need a checkpoint_id");
    const values = await Promise.all(writes.map(([, value]) => this.serde.dumpsTyped(value)));
    const entry = this.threads.get(threadId);
    if (!entry) throw new NotFoundError("Thread not found");
    let byCheckpoint = entry.state.writes.get(ns);
    if (!byCheckpoint) entry.state.writes.set(ns, (byCheckpoint = new Map()));
    let byTask = byCheckpoint.get(checkpointId);
    if (!byTask) byCheckpoint.set(checkpointId, (byTask = new Map()));
    writes.forEach(([channel], idx) => {
      // Special channels (error, interrupt, …) take fixed negative slots and
      // may be overwritten; regular writes are written once.
      const slot = WRITES_IDX_MAP[channel] ?? idx;
      const key = `${taskId},${slot}`;
      if (slot >= 0 && byTask!.has(key)) return;
      byTask!.set(key, { taskId, channel, value: values[idx]! });
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    const entry = this.threads.get(threadId);
    if (entry) entry.state = emptyState();
  }

  private async tuple(
    threadId: string,
    ns: string,
    stored: StoredCheckpoint,
    state: ThreadState,
  ): Promise<CheckpointTuple> {
    const writes = [...(state.writes.get(ns)?.get(stored.id)?.values() ?? [])];
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      writes.map(
        async ({ taskId, channel, value }): Promise<CheckpointPendingWrite> => [
          taskId,
          channel,
          await this.serde.loadsTyped(...value),
        ],
      ),
    );
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: stored.id } },
      checkpoint: (await this.serde.loadsTyped(...stored.checkpoint)) as Checkpoint,
      metadata: (await this.serde.loadsTyped(...stored.metadata)) as CheckpointMetadata,
      pendingWrites,
    };
    if (stored.parentId !== undefined) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: stored.parentId },
      };
    }
    return tuple;
  }
}

/** The thread store held in this process's memory. */
export class MemoryThreadStore implements ThreadStore {
  readonly checkpointer: BaseCheckpointSaver;
  private readonly threads: Threads;

  constructor(clock: Clock = Date.now) {
    this.threads = new Threads(clock);
    this.checkpointer = new MemoryCheckpointSaver(this.threads);
  }

  async create(binding: ThreadBinding): Promise<Thread> {
    this.threads.expire();
    this.threads.makeRoom();
    const now = this.threads.clock();
    const thread: Thread = {
      threadId: randomUUID(),
      binding: {
        ontologyKey: binding.ontologyKey,
        lensKey: binding.lensKey,
        kind: binding.kind,
        assistantKey: binding.assistantKey,
      },
      createdAt: now,
      lastUsedAt: now,
    };
    this.threads.entries.set(thread.threadId, { thread, locked: false, state: emptyState(), turnStart: null });
    return copyThread(thread);
  }

  async find(threadId: string, binding: ThreadBinding): Promise<Thread | null> {
    const entry = this.threads.get(threadId);
    return entry && sameBinding(entry.thread.binding, binding) ? copyThread(entry.thread) : null;
  }

  async acquire(threadId: string): Promise<boolean> {
    const entry = this.threads.get(threadId);
    if (!entry) throw new NotFoundError("Thread not found");
    if (entry.locked) return false;
    entry.locked = true;
    entry.thread.lastUsedAt = this.threads.clock();
    return true;
  }

  async release(threadId: string): Promise<void> {
    const entry = this.threads.get(threadId);
    if (!entry) return;
    entry.locked = false;
    entry.thread.lastUsedAt = this.threads.clock();
  }

  async beginTurn(threadId: string): Promise<void> {
    const entry = this.threads.get(threadId);
    if (!entry) throw new NotFoundError("Thread not found");
    entry.turnStart = copyState(entry.state);
  }

  async commitTurn(threadId: string): Promise<void> {
    const entry = this.threads.get(threadId);
    if (entry) entry.turnStart = null;
  }

  async rollbackTurn(threadId: string): Promise<void> {
    const entry = this.threads.get(threadId);
    if (!entry?.turnStart) return;
    entry.state = entry.turnStart;
    entry.turnStart = null;
  }

  async values(threadId: string): Promise<Record<string, unknown> | null> {
    const entry = this.threads.get(threadId);
    if (!entry) return null;
    const stored = entry.state.checkpoints.get("");
    if (!stored) return {};
    // Deserialised from the stored bytes: a fresh copy every time.
    const checkpoint = (await this.checkpointer.serde.loadsTyped(...stored.checkpoint)) as Checkpoint;
    return checkpoint.channel_values;
  }
}
