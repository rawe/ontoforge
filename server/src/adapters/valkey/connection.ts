/**
 * The one Valkey connection that every shared-state aspect uses
 * (`docs/architecture.md#shared-state`). It connects and checks the Valkey
 * at boot and closes it at shutdown; each aspect's adapter receives the
 * client and runs its own scripts on it.
 *
 * Rules every aspect keeps: keys `ontoforge:<aspect>:{<id>}[:<part>]`, every
 * key written with an expiry, every check-then-write one script, script
 * names prefixed by the aspect.
 */

import { Valkey } from "iovalkey";

import { StoreError } from "../../core/exceptions.js";

export interface ValkeyScript {
  lua: string;
  numberOfKeys: number;
}

/** An aspect's scripts, names prefixed by the aspect (`threadCreate`, …). */
export type ValkeyScripts = Record<string, ValkeyScript>;

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

/** Logs a client or Valkey failure of `aspect` and returns the `StoreError` that replaces it. */
export function toStoreError(aspect: string, exc: unknown): StoreError {
  const error = new StoreError();
  error.cause = exc;
  console.error(`Storage failure ${error.errorId}: ${aspect}: ${exc instanceof Error ? exc.message : String(exc)}`);
  return error;
}

/** `INFO memory`'s eviction policy. */
function evictionPolicy(info: string): string | null {
  return /^maxmemory_policy:(\S+)/m.exec(info)?.[1] ?? null;
}

/**
 * Connects and checks the Valkey before the server uses it: reachable,
 * evicting nothing (`maxmemory-policy noeviction`), and able to run every
 * aspect's scripts (loaded here: a Valkey before 7.2, a Redis before 7 or a
 * service that restricts scripting refuses them). Two aspects naming the
 * same script throw. Any failure closes the client and throws, naming the
 * URL without its password.
 */
export async function connectValkey(url: string, aspects: ValkeyScripts[]): Promise<Valkey> {
  const scripts: ValkeyScripts = {};
  for (const aspect of aspects) {
    for (const [name, script] of Object.entries(aspect)) {
      if (name in scripts) throw new Error(`Two shared-state scripts are named '${name}'`);
      scripts[name] = script;
    }
  }
  const client = new Valkey(url, {
    lazyConnect: true,
    // Commands during a disconnect fail at once instead of queueing, and a
    // command in flight is never replayed: a replayed write could answer
    // for a change that was already stored.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });
  client.on("error", (error: Error) => console.error(`Shared state (${redactUrl(url)}): ${error.message}`));
  for (const [name, script] of Object.entries(scripts)) client.defineCommand(name, script);
  try {
    await client.connect();
    await client.ping();
    const policy = evictionPolicy(await client.info("memory"));
    if (policy !== "noeviction") {
      throw new Error(`maxmemory-policy must be noeviction, is ${policy ?? "unknown"}`);
    }
    for (const { lua } of Object.values(scripts)) await client.script("LOAD", lua);
  } catch (error) {
    client.disconnect();
    throw new Error(
      `Shared state Valkey at ${redactUrl(url)} is not usable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return client;
}

export async function closeValkey(client: Valkey): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
