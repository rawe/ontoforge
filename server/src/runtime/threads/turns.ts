/**
 * Turn arithmetic over a thread's messages. A turn starts at a user
 * (human) message and runs up to the next one, so it carries the
 * assistant's tool calls, their results and its reply. Graphs use these to
 * apply `TURNS_THE_MODEL_SEES` to model input and `TURNS_PER_THREAD` to
 * their stored state.
 */

import { RemoveMessage, type BaseMessage } from "@langchain/core/messages";

import { TURNS_PER_THREAD } from "./threadStore.js";

/** Index of the first message of the last `turns` turns; 0 when there are fewer. */
function lastTurnsStart(messages: BaseMessage[], turns: number): number {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.getType() === "human" && ++seen === turns) return i;
  }
  return 0;
}

/** The messages of the last `turns` turns, in order. */
export function lastTurns(messages: BaseMessage[], turns: number): BaseMessage[] {
  return messages.slice(lastTurnsStart(messages, turns));
}

/**
 * Removals that cut a messages channel to its last `turns` turns — an
 * update for the messages reducer. Stored messages always carry an id.
 */
export function trimTurns(messages: BaseMessage[], turns = TURNS_PER_THREAD): RemoveMessage[] {
  return messages
    .slice(0, lastTurnsStart(messages, turns))
    .map((message) => new RemoveMessage({ id: message.id! }));
}
