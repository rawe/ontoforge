/**
 * Shared state: what every server must see alike but may lose, such as the
 * assistants' conversations and the browser sessions
 * (`docs/architecture.md#shared-state`). One switch, `SHARED_STATE`, puts
 * all of it in this process's memory (one server only) or in one Valkey
 * shared by every server; each aspect gets its own narrow interface with
 * an adapter for both.
 */

import { closeValkey, connectValkey } from "./adapters/valkey/connection.js";
import { SESSION_SCRIPTS, ValkeySessionStore } from "./adapters/valkey/sessionStore.js";
import { THREAD_SCRIPTS, ValkeyThreadStore } from "./adapters/valkey/threadStore.js";
import {
  LOGIN_LIFETIME_MS,
  MemorySessionStore,
  SESSION_ABSOLUTE_LIFETIME_MS,
  type SessionLifetimes,
  type SessionStore,
} from "./auth/sessionStore.js";
import { MemoryThreadStore } from "./runtime/threads/memoryThreadStore.js";
import type { ThreadStore } from "./runtime/threads/threadStore.js";

export interface SharedState {
  readonly threads: ThreadStore;
  readonly sessions: SessionStore;
  /** Closes the one Valkey client; nothing to close in memory. */
  close(): Promise<void>;
}

export type SharedStateConfig = ({ kind: "memory" } | { kind: "valkey"; url: string }) & {
  /** How long a browser session lasts unused; 8 hours unless set. */
  sessionIdleMs?: number;
};

/** Opens the shared state; a Valkey is connected and checked first (`connectValkey`). */
export async function openSharedState(config: SharedStateConfig): Promise<SharedState> {
  const lifetimes: SessionLifetimes = {
    loginMs: LOGIN_LIFETIME_MS,
    idleMs: config.sessionIdleMs ?? 8 * 60 * 60 * 1000,
    absoluteMs: SESSION_ABSOLUTE_LIFETIME_MS,
  };
  if (config.kind === "memory") {
    return { threads: new MemoryThreadStore(), sessions: new MemorySessionStore(lifetimes), close: async () => {} };
  }
  const client = await connectValkey(config.url, [THREAD_SCRIPTS, SESSION_SCRIPTS]);
  return {
    threads: new ValkeyThreadStore(client),
    sessions: new ValkeySessionStore(client, lifetimes),
    close: () => closeValkey(client),
  };
}
