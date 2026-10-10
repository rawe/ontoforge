/**
 * Turn arithmetic over a thread's messages: a turn starts at a user message
 * and carries the tool calls, results and reply that follow it.
 */

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { TURNS_THE_MODEL_SEES } from "../../../src/runtime/threads/threadStore.js";
import { lastTurns, trimTurns } from "../../../src/runtime/threads/turns.js";

/** `count` turns, each a question, a tool call, its result and a reply. */
function conversation(count: number): BaseMessage[] {
  const messages: BaseMessage[] = [];
  for (let i = 1; i <= count; i++) {
    messages.push(
      new HumanMessage({ id: `h${i}`, content: `question ${i}` }),
      new AIMessage({ id: `c${i}`, content: "", tool_calls: [{ id: `t${i}`, name: "search", args: {} }] }),
      new ToolMessage({ id: `r${i}`, content: "result", tool_call_id: `t${i}` }),
      new AIMessage({ id: `a${i}`, content: `answer ${i}` }),
    );
  }
  return messages;
}

describe("lastTurns", () => {
  it(`gives the model the last ${TURNS_THE_MODEL_SEES} turns, tool work included`, () => {
    const seen = lastTurns(conversation(10), TURNS_THE_MODEL_SEES);
    expect(seen).toHaveLength(TURNS_THE_MODEL_SEES * 4);
    expect(seen[0]!.content).toBe("question 3");
    expect(seen.at(-1)!.content).toBe("answer 10");
  });

  it("keeps everything when there are fewer turns", () => {
    expect(lastTurns(conversation(3), TURNS_THE_MODEL_SEES)).toHaveLength(12);
  });

  it("counts a running turn without a reply yet", () => {
    const messages = [...conversation(2), new HumanMessage({ id: "h3", content: "question 3" })];
    expect(lastTurns(messages, 2).map((m) => m.id)).toEqual(["h2", "c2", "r2", "a2", "h3"]);
  });
});

describe("trimTurns", () => {
  it("removes every message of the turns beyond the cap", () => {
    const removals = trimTurns(conversation(4), 2);
    expect(removals.map((m) => m.id)).toEqual(["h1", "c1", "r1", "a1", "h2", "c2", "r2", "a2"]);
  });

  it("removes nothing under the cap", () => {
    expect(trimTurns(conversation(2), 2)).toEqual([]);
  });
});
