/**
 * Turn arithmetic over a thread's messages. A turn starts at a user
 * (human) message and runs up to the next one, so it carries the
 * assistant's tool calls, their results and its reply. A thread holds at
 * most `TURNS_PER_THREAD` of them (`access.ts`).
 */

import type { BaseMessage } from "@langchain/core/messages";

/** How many turns the messages hold. */
export function turnCount(messages: BaseMessage[]): number {
  return messages.filter((message) => message.getType() === "human").length;
}
