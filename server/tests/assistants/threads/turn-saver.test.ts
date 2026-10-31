/**
 * The saver a turn runs its graph on: a graph continues across dump and
 * load into a fresh saver, as a follow-up on another server does; only the
 * latest checkpoint is kept; the turn cap holds; unreadable bytes fail as a
 * storage error, never as an empty thread.
 */

import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { StoreError } from "../../../src/core/exceptions.js";
import { TURNS_PER_THREAD } from "../../../src/assistants/threads/threadStore.js";
import { threadValues, TurnSaver } from "../../../src/assistants/threads/turnSaver.js";
import { trimTurns } from "../../../src/assistants/threads/turns.js";

/** A two-step chat graph: `reply` answers and trims the thread to
 * `TURNS_PER_THREAD` turns, `tidy` is a second step so every turn writes
 * several checkpoints. */
function chatGraph(checkpointer: TurnSaver) {
  return new StateGraph(MessagesAnnotation)
    .addNode("reply", (state) => {
      const reply = new AIMessage(`echo ${String(state.messages.at(-1)!.content)}`);
      return { messages: [reply, ...trimTurns([...state.messages, reply])] };
    })
    .addNode("tidy", () => ({}))
    .addEdge(START, "reply")
    .addEdge("reply", "tidy")
    .addEdge("tidy", END)
    .compile({ checkpointer });
}

/** One turn as the chat stream runs it: load, run, dump. */
async function turn(state: Uint8Array | null, message: string): Promise<Uint8Array> {
  const saver = TurnSaver.load("t1", state);
  await chatGraph(saver).invoke({ messages: [new HumanMessage(message)] }, { configurable: { thread_id: "t1" } });
  return saver.dump();
}

const contents = (values: Record<string, unknown>) => (values.messages as BaseMessage[]).map((m) => m.content);

describe("turn saver", () => {
  it("continues a thread across dump and load into a fresh saver", async () => {
    const state = await turn(await turn(null, "one"), "two");
    expect(contents(await threadValues(state))).toEqual(["one", "echo one", "two", "echo two"]);
  });

  it("keeps only the latest checkpoint", async () => {
    const saver = TurnSaver.load("t1", await turn(await turn(null, "one"), "two"));
    const tuples = [];
    for await (const tuple of saver.list({ configurable: { thread_id: "t1" } })) tuples.push(tuple);
    expect(tuples).toHaveLength(1);
    expect(await saver.getTuple(tuples[0]!.config)).toBeDefined();
  });

  it(`keeps the last ${TURNS_PER_THREAD} turns`, async () => {
    let state: Uint8Array | null = null;
    for (let i = 1; i <= TURNS_PER_THREAD + 2; i++) state = await turn(state, `turn ${i}`);
    const messages = contents(await threadValues(state));
    expect(messages).toHaveLength(TURNS_PER_THREAD * 2);
    expect(messages[0]).toBe("turn 3");
  });

  it("holds one thread: another reads as empty and cannot be written", async () => {
    const saver = TurnSaver.load("t1", await turn(null, "one"));
    expect(await saver.getTuple({ configurable: { thread_id: "t2" } })).toBeUndefined();
    await expect(chatGraph(saver).invoke({ messages: [new HumanMessage("x")] }, { configurable: { thread_id: "t2" } }))
      .rejects.toThrow("another thread");
  });

  it("reads no state as an empty thread", async () => {
    expect(await threadValues(null)).toEqual({});
    expect(await threadValues(TurnSaver.load("t1", null).dump())).toEqual({});
  });

  it("refuses an unknown envelope version or bytes that are no envelope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown = new Uint8Array(Buffer.from(JSON.stringify({ v: 2, checkpoints: {}, writes: {} })));
    for (const state of [unknown, new Uint8Array([1, 2, 3])]) {
      expect(() => TurnSaver.load("t1", state)).toThrow(StoreError);
      await expect(threadValues(state)).rejects.toThrow(StoreError);
    }
    vi.restoreAllMocks();
  });
});
