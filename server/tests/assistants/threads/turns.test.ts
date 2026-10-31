/**
 * Turn arithmetic over a thread's messages: a turn starts at a user message
 * and carries the tool calls, results and reply that follow it.
 */

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { turnCount } from "../../../src/assistants/threads/turns.js";

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

describe("turnCount", () => {
  it("counts the user messages, tool work in between", () => {
    expect(turnCount(conversation(10))).toBe(10);
    expect(turnCount([])).toBe(0);
  });

  it("counts a running turn without a reply yet", () => {
    expect(turnCount([...conversation(2), new HumanMessage({ id: "h3", content: "question 3" })])).toBe(3);
  });
});
