/**
 * Threads for graph-runtime tests: each runs on its own turn saver, as a
 * chat turn does, and its state reads back as the store would hand it out.
 */

import { randomUUID } from "node:crypto";

import type { GraphThread } from "../../../src/assistants/threads/threadStore.js";
import { threadValues, TurnSaver } from "../../../src/assistants/threads/turnSaver.js";

export function newGraphThread(): GraphThread {
  const threadId = randomUUID();
  return { checkpointer: TurnSaver.load(threadId, null), threadId };
}

/** The thread's graph state after the turns run on it, read from its dumped bytes. */
export async function graphValues(thread: GraphThread): Promise<Record<string, unknown>> {
  return threadValues((thread.checkpointer as TurnSaver).dump());
}
