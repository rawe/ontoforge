/**
 * The Valkey thread store, shared by every server that names the same
 * Valkey. Valkey runs without persistence and with `noeviction`: a reset
 * loses every thread (clients recover through the not-found answer), and a
 * full Valkey refuses writes instead of dropping threads.
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

import { Valkey } from "iovalkey";

import { StoreError } from "../../core/exceptions.js";
import {
  checkStateSize,
  DEFAULT_LIFETIMES,
  sameBinding,
  type StoreLifetimes,
  type Thread,
  type ThreadBinding,
  type ThreadStore,
  type Turn,
} from "./threadStore.js";

// KEYS[1] = thread, KEYS[2] = turn.
const SCRIPTS = {
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

type Arg = string | number | Buffer;

/** The scripts as `defineCommand` installs them. */
interface ThreadScripts {
  threadCreate(thread: string, turn: string, ...args: Arg[]): Promise<number>;
  threadBeginBuffer(thread: string, turn: string, ...args: Arg[]): Promise<[number, (Buffer | null)?]>;
  threadRenew(thread: string, turn: string, ...args: Arg[]): Promise<number>;
  threadPublish(thread: string, turn: string, ...args: Arg[]): Promise<number>;
  threadRelease(thread: string, turn: string, ...args: Arg[]): Promise<number>;
}

const threadKey = (threadId: string) => `ontoforge:thread:{${threadId}}`;
const keys = (threadId: string): [string, string] => [threadKey(threadId), `${threadKey(threadId)}:turn`];

/** Logs a client or Valkey failure and returns the `StoreError` that replaces it. */
function toStoreError(exc: unknown): StoreError {
  const error = new StoreError();
  error.cause = exc;
  console.error(`Storage failure ${error.errorId}: thread store: ${exc instanceof Error ? exc.message : String(exc)}`);
  return error;
}

/** The URL as it may appear in a log or boot error: without its password. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<unparsable URL>";
  }
}

/** `INFO memory`'s eviction policy. */
function evictionPolicy(info: string): string | null {
  return /^maxmemory_policy:(\S+)/m.exec(info)?.[1] ?? null;
}

export class ValkeyThreadStore implements ThreadStore {
  private readonly scripts: ThreadScripts;

  private constructor(
    private readonly client: Valkey,
    private readonly lifetimes: StoreLifetimes,
  ) {
    this.scripts = client as unknown as ThreadScripts;
  }

  /**
   * Connects and checks the Valkey before the server uses it: reachable,
   * evicting nothing (`maxmemory-policy noeviction`), and able to run the
   * scripts (loaded here: a Valkey before 7.2, a Redis before 7 or a service
   * that restricts scripting refuses them). Any failure closes the client and
   * throws, naming the URL without its password.
   */
  static async connect(url: string, lifetimes: StoreLifetimes = DEFAULT_LIFETIMES): Promise<ValkeyThreadStore> {
    const client = new Valkey(url, {
      lazyConnect: true,
      // Commands during a disconnect fail at once instead of queueing, and a
      // command in flight is never replayed: a replayed publish would answer
      // "taken" for a turn that was stored.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      connectTimeout: 5000,
      commandTimeout: 5000,
    });
    client.on("error", (error: Error) => console.error(`Thread store (${redactUrl(url)}): ${error.message}`));
    for (const [name, lua] of Object.entries(SCRIPTS)) client.defineCommand(name, { lua, numberOfKeys: 2 });
    try {
      await client.connect();
      await client.ping();
      const policy = evictionPolicy(await client.info("memory"));
      if (policy !== "noeviction") {
        throw new Error(`maxmemory-policy must be noeviction, is ${policy ?? "unknown"}`);
      }
      for (const lua of Object.values(SCRIPTS)) await client.script("LOAD", lua);
    } catch (error) {
      client.disconnect();
      throw new Error(
        `Thread store Valkey at ${redactUrl(url)} is not usable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return new ValkeyThreadStore(client, lifetimes);
  }

  async create(binding: ThreadBinding): Promise<Thread> {
    const threadId = randomUUID();
    const { ontologyKey, lensKey, kind, assistantKey } = binding;
    const created = await this.call(() =>
      this.scripts.threadCreate(...keys(threadId), ontologyKey, lensKey, kind, assistantKey, this.lifetimes.idleMs),
    );
    if (created !== 1) throw toStoreError(new Error("A new thread id was already taken"));
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

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  private async call<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      throw toStoreError(error);
    }
  }
}
