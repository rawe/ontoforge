/**
 * The Valkey session store, shared by every server that names the same
 * Valkey, on the shared-state client (`connection.ts`).
 *
 *   ontoforge:session:{<sha256 of the id>}   hash data abs, PEXPIRE min(idle, abs - now)
 *
 * Valkey's clock alone decides expiry: `sessionCreate` stores the absolute
 * deadline from Valkey's `TIME`, and `sessionGet` moves the idle deadline
 * in the same step that reads, never past it.
 */

import type { Valkey } from "iovalkey";

import {
  digest,
  type Session,
  type SessionLifetimes,
  type SessionStore,
} from "../../auth/sessionStore.js";
import { toStoreError, type ValkeyScripts } from "./connection.js";

const NOW = `local t = redis.call('TIME') local now = t[1] * 1000 + math.floor(t[2] / 1000)`;

const LUA = {
  // ARGV: data, idleMs, absoluteMs
  sessionCreate: `#!lua
${NOW}
local abs = now + tonumber(ARGV[3])
redis.call('HSET', KEYS[1], 'data', ARGV[1], 'abs', abs)
redis.call('PEXPIRE', KEYS[1], math.min(tonumber(ARGV[2]), abs - now))
return 1`,
  // ARGV: idleMs
  sessionGet: `#!lua
${NOW}
local v = redis.call('HMGET', KEYS[1], 'data', 'abs')
if not v[1] then return false end
local left = tonumber(v[2]) - now
if left <= 0 then redis.call('DEL', KEYS[1]) return false end
redis.call('PEXPIRE', KEYS[1], math.min(tonumber(ARGV[1]), left))
return v[1]`,
};

/** The session scripts, as `connectValkey` defines and loads them. */
export const SESSION_SCRIPTS: ValkeyScripts = Object.fromEntries(
  Object.entries(LUA).map(([name, lua]) => [name, { lua, numberOfKeys: 1 }]),
);

interface SessionScripts {
  sessionCreate(key: string, ...args: (string | number)[]): Promise<number>;
  sessionGet(key: string, ...args: (string | number)[]): Promise<string | null>;
}

const sessionKey = (id: string) => `ontoforge:session:{${digest(id)}}`;

export class ValkeySessionStore implements SessionStore {
  private readonly scripts: SessionScripts;

  constructor(
    private readonly client: Valkey,
    private readonly lifetimes: SessionLifetimes,
  ) {
    this.scripts = client as unknown as SessionScripts;
  }

  async create(id: string, session: Session): Promise<void> {
    await this.call(() =>
      this.scripts.sessionCreate(sessionKey(id), JSON.stringify(session), this.lifetimes.idleMs, this.lifetimes.absoluteMs),
    );
  }

  async get(id: string): Promise<Session | null> {
    const value = await this.call(() => this.scripts.sessionGet(sessionKey(id), this.lifetimes.idleMs));
    return value === null ? null : (JSON.parse(value) as Session);
  }

  async delete(id: string): Promise<void> {
    await this.call(() => this.client.del(sessionKey(id)));
  }

  private async call<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      throw toStoreError("session store", error);
    }
  }
}
