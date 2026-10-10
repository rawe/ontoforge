/**
 * How a chat reaches its thread (`docs/capabilities/threads.md`): a
 * message starts or continues one before the stream opens, and a thread
 * is read back as its user and assistant texts. Both refuse a thread that
 * is unknown, expired or bound to another assistant alike, so a client
 * learns nothing about threads it cannot use.
 */

import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import { ConflictError, NotFoundError } from "../../core/exceptions.js";
import type { ThreadBinding, ThreadStore } from "./threadStore.js";

/** One message of a thread read back. */
export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
}

function threadNotFound(): NotFoundError {
  return new NotFoundError("Thread not found or expired; start a new conversation.", { code: "THREAD_NOT_FOUND" });
}

/**
 * The thread a chat message runs on, its run lock taken: a new thread
 * bound to the assistant without an id, else the given one. Refused for an
 * unknown, expired or foreign thread (THREAD_NOT_FOUND) and for one a run
 * still holds (THREAD_BUSY) — never queued. The caller releases the lock.
 */
export async function openThread(
  threads: ThreadStore,
  binding: ThreadBinding,
  threadId: string | undefined,
): Promise<string> {
  if (threadId === undefined) {
    const created = await threads.create(binding);
    await threads.acquire(created.threadId);
    return created.threadId;
  }
  if ((await threads.find(threadId, binding)) === null) throw threadNotFound();
  let acquired: boolean;
  try {
    acquired = await threads.acquire(threadId);
  } catch (error) {
    // Expired or evicted since it was found.
    if (error instanceof NotFoundError) throw threadNotFound();
    throw error;
  }
  if (!acquired) {
    throw new ConflictError("A message to this thread is still being answered; wait for it to finish.", {
      code: "THREAD_BUSY",
    });
  }
  return threadId;
}

/**
 * A thread's user and assistant texts in order — the user's messages and
 * the assistant's replies, never tool calls or their results. Reading does
 * not count as use.
 */
export async function readThread(
  threads: ThreadStore,
  binding: ThreadBinding,
  threadId: string,
): Promise<{ threadId: string; messages: ThreadMessage[] }> {
  const values = (await threads.find(threadId, binding)) === null ? null : await threads.values(threadId);
  if (values === null) throw threadNotFound();
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
