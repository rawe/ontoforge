/**
 * The Valkey thread store, shared by every server that names the same
 * Valkey. It runs on the shared-state client (`connection.ts`); Valkey runs
 * without persistence and with `noeviction`: a reset loses every thread
 * (clients recover through the not-found answer), and a full Valkey refuses
 * writes instead of dropping threads.
 *
 * Per thread two keys, hash-tagged into one slot:
 *
 *   ontoforge:thread:{<id>}        hash ontologyKey lensKey kind assistantKey [state], PEXPIRE idle
 *   ontoforge:thread:{<id>}:turn   the running turn's owner token, PX lease
 *
 * Every deadline is relative, so Valkey's clock alone decides expiry. Each
 * write is one Lua script, so checks and writes are atomic. Only `create`
 * writes a new thread key; every write after `begin` compares the owner
 * token. Scripts without `allow-oom` are refused whole when Valkey is out of
 * memory; `renew` and `release` carry it, so a full store can still end turns.
 */

import { randomUUID } from "node:crypto";

import type { Valkey } from "iovalkey";

import {
  checkStateSize,
  DEFAULT_LIFETIMES,
  sameBinding,
  type StoreLifetimes,
  type Thread,
  type ThreadBinding,
  type ThreadStore,
  type Turn,
} from "../../runtime/threads/threadStore.js";
import { toStoreError, type ValkeyScripts } from "./connection.js";

// KEYS[1] = thread, KEYS[2] = turn.
const LUA = {
  // ARGV: ontologyKey, lensKey, kind, assistantKey, idleMs
  threadCreate: `#!lua
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'ontologyKey', ARGV[1], 'lensKey', ARGV[2], 'kind', ARGV[3], 'assistantKey', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1`,
  // ARGV: ontologyKey, lensKey, kind, assistantKey, token, idleMs, leaseMs
  threadBegin: `#!lua
local b = redis.call('HMGET', KEYS[1], 'ontologyKey', 'lensKey', 'kind', 'assistantKey')
if b[1] ~= ARGV[1] or b[2] ~= ARGV[2] or b[3] ~= ARGV[3] or b[4] ~= ARGV[4] then return {0} end
if not redis.call('SET', KEYS[2], ARGV[5], 'NX', 'PX', ARGV[7]) then return {1} end
redis.call('PEXPIRE', KEYS[1], ARGV[6])
return {2, redis.call('HGET', KEYS[1], 'state')}`,
  // ARGV: token, leaseMs
  threadRenew: `#!lua flags=allow-oom
if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1`,
  // ARGV: token, state, idleMs
  threadPublish: `#!lua
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 1 end
redis.call('HSET', KEYS[1], 'state', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('DEL', KEYS[2])
return 2`,
  // ARGV: token
  threadRelease: `#!lua flags=allow-oom
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 0`,
};

/** The thread scripts, as `connectValkey` defines and loads them. */
export const THREAD_SCRIPTS: ValkeyScripts = Object.fromEntries(
  Object.entries(LUA).map(([name, lua]) => [name, { lua, numberOfKeys: 2 }]),
);

type Arg = string | number | Buffer;

/** The scripts as `defineCommand` installs them on the client. */
interface ThreadScripts {
  threadCreate(thread: string, turn: string, ...args: Arg[]): Promise<number>;
  threadBeginBuffer(thread: string, turn: string, ...args: Arg[]): Promise<[number, (Buffer | null)?]>;
  threadRenew(thread: string, turn: string, ...args: Arg[]): Promise<number>;
  threadPublish(thread: string, turn: string, ...args: Arg[]): Promise<number>;
  threadRelease(thread: string, turn: string, ...args: Arg[]): Promise<number>;
}

const threadKey = (threadId: string) => `ontoforge:thread:{${threadId}}`;
const keys = (threadId: string): [string, string] => [threadKey(threadId), `${threadKey(threadId)}:turn`];

export class ValkeyThreadStore implements ThreadStore {
  private readonly scripts: ThreadScripts;

  constructor(
    private readonly client: Valkey,
    private readonly lifetimes: StoreLifetimes = DEFAULT_LIFETIMES,
  ) {
    this.scripts = client as unknown as ThreadScripts;
  }

  async create(binding: ThreadBinding): Promise<Thread> {
    const threadId = randomUUID();
    const { ontologyKey, lensKey, kind, assistantKey } = binding;
    const created = await this.call(() =>
      this.scripts.threadCreate(...keys(threadId), ontologyKey, lensKey, kind, assistantKey, this.lifetimes.idleMs),
    );
    if (created !== 1) throw toStoreError("thread store", new Error("A new thread id was already taken"));
    return { threadId, binding: { ontologyKey, lensKey, kind, assistantKey } };
  }

  async read(threadId: string, binding: ThreadBinding): Promise<{ state: Uint8Array | null } | null> {
    const fields = await this.call(() =>
      this.client.hmgetBuffer(threadKey(threadId), "ontologyKey", "lensKey", "kind", "assistantKey", "state"),
    );
    const [ontologyKey, lensKey, kind, assistantKey, state] = fields.map((field) => field ?? null);
    if (!ontologyKey || !lensKey || !kind || !assistantKey) return null;
    const stored = {
      ontologyKey: ontologyKey.toString(),
      lensKey: lensKey.toString(),
      kind: kind.toString(),
      assistantKey: assistantKey.toString(),
    };
    if (!sameBinding(stored, binding)) return null;
    return { state: state ? new Uint8Array(state) : null };
  }

  async begin(threadId: string, binding: ThreadBinding): Promise<Turn | "busy" | null> {
    const token = randomUUID();
    const { ontologyKey, lensKey, kind, assistantKey } = binding;
    const [outcome, state] = await this.call(() =>
      this.scripts.threadBeginBuffer(
        ...keys(threadId), ontologyKey, lensKey, kind, assistantKey, token, this.lifetimes.idleMs, this.lifetimes.leaseMs,
      ),
    );
    if (outcome === 0) return null;
    if (outcome === 1) return "busy";
    return { threadId, token, state: state ? new Uint8Array(state) : null };
  }

  async renew(turn: Turn): Promise<boolean> {
    return (await this.call(() => this.scripts.threadRenew(...keys(turn.threadId), turn.token, this.lifetimes.leaseMs))) === 1;
  }

  async publish(turn: Turn, state: Uint8Array): Promise<"published" | "taken" | "gone"> {
    checkStateSize(state);
    const outcome = await this.call(() =>
      this.scripts.threadPublish(...keys(turn.threadId), turn.token, Buffer.from(state), this.lifetimes.idleMs),
    );
    return outcome === 2 ? "published" : outcome === 1 ? "taken" : "gone";
  }

  async release(turn: Turn): Promise<void> {
    await this.call(() => this.scripts.threadRelease(...keys(turn.threadId), turn.token));
  }

  private async call<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      throw toStoreError("thread store", error);
    }
  }
}
