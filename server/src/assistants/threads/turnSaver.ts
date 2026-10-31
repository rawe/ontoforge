/**
 * The checkpoint saver one turn runs its graph on. It holds one thread,
 * seeded from the state the store published last, and is dumped back to
 * bytes when the turn completes (`threadStore.ts`). Nothing it holds is
 * visible to anyone else while the turn runs.
 *
 * Checkpoints, metadata and pending writes are held serialised with the
 * saver's serde (LangGraph's typed JSON: messages survive as message
 * classes). Per checkpoint namespace only the latest checkpoint and its
 * pending writes are kept. `dump` wraps them in a versioned JSON envelope:
 *
 *   { v: 1, checkpoints: { <ns>: { id, parentId, checkpoint: [type, b64], metadata: [type, b64] } },
 *     writes: { <ns>: { <checkpointId>: [[taskId, slot, channel, [type, b64]], …] } } }
 */

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

import { StoreError } from "../../core/exceptions.js";

/** The envelope version `dump` writes and `load` accepts. */
const ENVELOPE_VERSION = 1;

/** A serde result: type tag and bytes. Never mutated once stored. */
type Serialised = [string, Uint8Array];
type EncodedSerialised = [string, string];

interface StoredCheckpoint {
  id: string;
  parentId: string | undefined;
  checkpoint: Serialised;
  metadata: Serialised;
}

interface StoredWrite {
  taskId: string;
  slot: number;
  channel: string;
  value: Serialised;
}

interface Envelope {
  v: number;
  checkpoints: Record<string, { id: string; parentId?: string; checkpoint: EncodedSerialised; metadata: EncodedSerialised }>;
  writes: Record<string, Record<string, [string, number, string, EncodedSerialised][]>>;
}

const encode = ([type, bytes]: Serialised): EncodedSerialised => [type, Buffer.from(bytes).toString("base64")];
const decode = ([type, b64]: EncodedSerialised): Serialised => [type, new Uint8Array(Buffer.from(b64, "base64"))];

function unreadable(reason: string): StoreError {
  const error = new StoreError();
  console.error(`Storage failure ${error.errorId}: thread state unreadable: ${reason}`);
  return error;
}

function parseEnvelope(bytes: Uint8Array): Envelope {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(Buffer.from(bytes).toString("utf8")) as Envelope;
  } catch {
    throw unreadable("not JSON");
  }
  if (envelope?.v !== ENVELOPE_VERSION) throw unreadable(`unknown envelope version ${String(envelope?.v)}`);
  return envelope;
}

/**
 * LangGraph's checkpoint-saver contract over one thread. Keeps only the
 * latest checkpoint per namespace; another thread id reads as empty and
 * cannot be written.
 */
export class TurnSaver extends BaseCheckpointSaver {
  /** The latest checkpoint per namespace. */
  private checkpoints = new Map<string, StoredCheckpoint>();
  /** Pending writes per namespace, keyed by checkpoint id, then `taskId,slot`. */
  private writes = new Map<string, Map<string, Map<string, StoredWrite>>>();

  private constructor(readonly threadId: string) {
    super();
  }

  /** A saver for `threadId` holding `state`; empty for `null`. Throws StoreError for unreadable bytes. */
  static load(threadId: string, state: Uint8Array | null): TurnSaver {
    const saver = new TurnSaver(threadId);
    if (state === null) return saver;
    const envelope = parseEnvelope(state);
    for (const [ns, stored] of Object.entries(envelope.checkpoints)) {
      saver.checkpoints.set(ns, {
        id: stored.id,
        parentId: stored.parentId,
        checkpoint: decode(stored.checkpoint),
        metadata: decode(stored.metadata),
      });
    }
    for (const [ns, byCheckpoint] of Object.entries(envelope.writes)) {
      const loaded = new Map<string, Map<string, StoredWrite>>();
      for (const [checkpointId, writes] of Object.entries(byCheckpoint)) {
        loaded.set(checkpointId, new Map(writes.map(([taskId, slot, channel, value]) =>
          [`${taskId},${slot}`, { taskId, slot, channel, value: decode(value) }])));
      }
      saver.writes.set(ns, loaded);
    }
    return saver;
  }

  /** The saver's whole state as bytes for the store. */
  dump(): Uint8Array {
    const envelope: Envelope = { v: ENVELOPE_VERSION, checkpoints: {}, writes: {} };
    for (const [ns, stored] of this.checkpoints) {
      envelope.checkpoints[ns] = {
        id: stored.id,
        ...(stored.parentId === undefined ? {} : { parentId: stored.parentId }),
        checkpoint: encode(stored.checkpoint),
        metadata: encode(stored.metadata),
      };
    }
    for (const [ns, byCheckpoint] of this.writes) {
      envelope.writes[ns] = {};
      for (const [checkpointId, byTask] of byCheckpoint) {
        envelope.writes[ns][checkpointId] = [...byTask.values()].map(
          ({ taskId, slot, channel, value }) => [taskId, slot, channel, encode(value)],
        );
      }
    }
    return new Uint8Array(Buffer.from(JSON.stringify(envelope), "utf8"));
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = getCheckpointId(config);
    const stored = threadId === this.threadId ? this.checkpoints.get(ns) : undefined;
    if (!stored || (checkpointId && stored.id !== checkpointId)) return undefined;
    return this.tuple(ns, stored);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { before, filter } = options ?? {};
    let limit = options?.limit;
    const threadId = config.configurable?.thread_id as string | undefined;
    const configNs = config.configurable?.checkpoint_ns as string | undefined;
    const configId = config.configurable?.checkpoint_id as string | undefined;
    const beforeId = before?.configurable?.checkpoint_id as string | undefined;
    if (threadId !== undefined && threadId !== this.threadId) return;
    for (const [ns, stored] of [...this.checkpoints]) {
      if (configNs !== undefined && ns !== configNs) continue;
      if (configId && stored.id !== configId) continue;
      if (beforeId && stored.id >= beforeId) continue;
      const tuple = await this.tuple(ns, stored);
      const metadata = tuple.metadata as Record<string, unknown>;
      if (filter && !Object.entries(filter).every(([key, value]) => metadata[key] === value)) continue;
      if (limit !== undefined) {
        if (limit <= 0) return;
        limit -= 1;
      }
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    this.ownThread(config);
    const [serialisedCheckpoint, serialisedMetadata] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    this.checkpoints.set(ns, {
      id: checkpoint.id,
      parentId: config.configurable?.checkpoint_id as string | undefined,
      checkpoint: serialisedCheckpoint,
      metadata: serialisedMetadata,
    });
    // Only the latest checkpoint is kept, so only its pending writes are.
    const byCheckpoint = this.writes.get(ns);
    for (const id of byCheckpoint?.keys() ?? []) {
      if (id !== checkpoint.id) byCheckpoint!.delete(id);
    }
    return { configurable: { thread_id: this.threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (checkpointId === undefined) throw new Error("Pending writes need a checkpoint_id");
    this.ownThread(config);
    const values = await Promise.all(writes.map(([, value]) => this.serde.dumpsTyped(value)));
    let byCheckpoint = this.writes.get(ns);
    if (!byCheckpoint) this.writes.set(ns, (byCheckpoint = new Map()));
    let byTask = byCheckpoint.get(checkpointId);
    if (!byTask) byCheckpoint.set(checkpointId, (byTask = new Map()));
    writes.forEach(([channel], idx) => {
      // Special channels (error, interrupt, …) take fixed negative slots and
      // may be overwritten; regular writes are written once.
      const slot = WRITES_IDX_MAP[channel] ?? idx;
      const key = `${taskId},${slot}`;
      if (slot >= 0 && byTask!.has(key)) return;
      byTask!.set(key, { taskId, slot, channel, value: values[idx]! });
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    if (threadId !== this.threadId) return;
    this.checkpoints = new Map();
    this.writes = new Map();
  }

  private ownThread(config: RunnableConfig): void {
    if (config.configurable?.thread_id !== this.threadId) {
      throw new Error("This saver holds another thread");
    }
  }

  private async tuple(ns: string, stored: StoredCheckpoint): Promise<CheckpointTuple> {
    const writes = [...(this.writes.get(ns)?.get(stored.id)?.values() ?? [])];
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      writes.map(
        async ({ taskId, channel, value }): Promise<CheckpointPendingWrite> => [
          taskId,
          channel,
          await this.serde.loadsTyped(...value),
        ],
      ),
    );
    const config = { thread_id: this.threadId, checkpoint_ns: ns };
    const tuple: CheckpointTuple = {
      config: { configurable: { ...config, checkpoint_id: stored.id } },
      checkpoint: (await this.serde.loadsTyped(...stored.checkpoint)) as Checkpoint,
      metadata: (await this.serde.loadsTyped(...stored.metadata)) as CheckpointMetadata,
      pendingWrites,
    };
    if (stored.parentId !== undefined) {
      tuple.parentConfig = { configurable: { ...config, checkpoint_id: stored.parentId } };
    }
    return tuple;
  }
}

/**
 * The graph state (channel values) of a published state's root checkpoint;
 * `{}` before the first completed turn. A fresh copy every time.
 */
export async function threadValues(state: Uint8Array | null): Promise<Record<string, unknown>> {
  if (state === null) return {};
  const root = parseEnvelope(state).checkpoints[""];
  if (!root) return {};
  const saver = TurnSaver.load("", null);
  const checkpoint = (await saver.serde.loadsTyped(...decode(root.checkpoint))) as Checkpoint;
  return checkpoint.channel_values;
}
