/**
 * Shared state: what every server must see alike but may lose, such as the
 * assistants' conversations (`docs/architecture.md#shared-state`). One
 * switch, `SHARED_STATE`, puts all of it in this process's memory (one
 * server only) or in one Valkey shared by every server; each aspect gets
 * its own narrow interface with an adapter for both.
 */

import { closeValkey, connectValkey } from "./adapters/valkey/connection.js";
import { THREAD_SCRIPTS, ValkeyThreadStore } from "./adapters/valkey/threadStore.js";
import { MemoryThreadStore } from "./runtime/threads/memoryThreadStore.js";
import type { ThreadStore } from "./runtime/threads/threadStore.js";

export interface SharedState {
  readonly threads: ThreadStore;
  /** Closes the one Valkey client; nothing to close in memory. */
  close(): Promise<void>;
}

export type SharedStateConfig = { kind: "memory" } | { kind: "valkey"; url: string };

/** Opens the shared state; a Valkey is connected and checked first (`connectValkey`). */
export async function openSharedState(config: SharedStateConfig): Promise<SharedState> {
  if (config.kind === "memory") {
    return { threads: new MemoryThreadStore(), close: async () => {} };
  }
  const client = await connectValkey(config.url, [THREAD_SCRIPTS]);
  return { threads: new ValkeyThreadStore(client), close: () => closeValkey(client) };
}
