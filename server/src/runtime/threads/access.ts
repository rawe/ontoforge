/**
 * How a chat reaches its thread (`docs/capabilities/threads.md`): a
 * message starts or continues one before the stream opens, and a thread
 * is read back as its user and assistant texts. Both refuse a thread that
 * is unknown, expired or bound to another assistant alike, so a client
 * learns nothing about threads it cannot use.
 */

import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import { ConflictError, NotFoundError } from "../../core/exceptions.js";
import type { ThreadBinding, ThreadStore, Turn } from "./threadStore.js";
import { threadValues } from "./turnSaver.js";

/** One message of a thread read back. */
export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
}

export function threadNotFound(): NotFoundError {
  return new NotFoundError("Thread not found or expired; start a new conversation.", { code: "THREAD_NOT_FOUND" });
}

export function threadBusy(): ConflictError {
  return new ConflictError("A message to this thread is still being answered; wait for it to finish.", {
    code: "THREAD_BUSY",
  });
}

/**
 * The turn a chat message runs: on a new thread bound to the assistant
 * without an id, else on the given one. Refused for an unknown, expired or
 * foreign thread (THREAD_NOT_FOUND) and for one a turn still runs on
 * (THREAD_BUSY) — never queued. The caller publishes or releases the turn.
 */
export async function openThread(
  threads: ThreadStore,
  binding: ThreadBinding,
  threadId: string | undefined,
): Promise<Turn> {
  const id = threadId ?? (await threads.create(binding)).threadId;
  const turn = await threads.begin(id, binding);
  // A thread just created can only be gone if it expired in between.
  if (turn === null) throw threadNotFound();
  if (turn === "busy") throw threadBusy();
  return turn;
}

/**
 * A thread's user and assistant texts in order, as of its last completed
 * turn — the user's messages and the assistant's replies, never tool calls
 * or their results. Reading does not count as use.
 */
export async function readThread(
  threads: ThreadStore,
  binding: ThreadBinding,
  threadId: string,
): Promise<{ threadId: string; messages: ThreadMessage[] }> {
  const read = await threads.read(threadId, binding);
  if (read === null) throw threadNotFound();
  const values = await threadValues(read.state);
  const messages = ((values.messages as BaseMessage[] | undefined) ?? []).flatMap((message): ThreadMessage[] => {
    if (message.getType() === "human") return [{ role: "user", content: message.text }];
    // An assistant message that calls tools is tool work, not a reply.
    if (AIMessage.isInstance(message) && !message.tool_calls?.length) {
      return [{ role: "assistant", content: message.text }];
    }
    return [];
  });
  return { threadId, messages };
}
