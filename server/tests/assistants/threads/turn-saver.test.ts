/**
 * The saver a turn runs its graph on: a graph continues across dump and
 * load into a fresh saver, as a follow-up on another server does; only the
 * latest checkpoint is kept; the turn cap holds; unreadable bytes fail as a
 * storage error, never as an empty thread; a turn's artifacts stay with its
 * reply until the turn leaves the thread.
 */

import { AIMessage, HumanMessage, RemoveMessage, type BaseMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { StoreError } from "../../../src/core/exceptions.js";
import { threadArtifacts, threadValues, TurnSaver } from "../../../src/assistants/threads/turnSaver.js";
import type { Artifact } from "../../../src/assistants/threads/threadStore.js";
/** Turns the test graph keeps: it removes older ones, so the saver's removals are exercised. */
const KEPT = 3;

/** A two-step chat graph: `reply` answers and removes the turns beyond
 * `KEPT`, `tidy` is a second step so every turn writes several checkpoints. */
function chatGraph(checkpointer: TurnSaver) {
  return new StateGraph(MessagesAnnotation)
    .addNode("reply", (state) => {
      const reply = new AIMessage(`echo ${String(state.messages.at(-1)!.content)}`);
      const beyond = state.messages.length + 1 - KEPT * 2;
      const removed = state.messages.slice(0, Math.max(0, beyond)).map((m) => new RemoveMessage({ id: m.id! }));
      return { messages: [reply, ...removed] };
    })
    .addNode("tidy", () => ({}))
    .addEdge(START, "reply")
    .addEdge("reply", "tidy")
    .addEdge("tidy", END)
    .compile({ checkpointer });
}

/** One turn as the chat stream runs it: load, run, keep its artifacts, dump. */
async function turn(state: Uint8Array | null, message: string, artifacts: Artifact[] = []): Promise<Uint8Array> {
  const saver = TurnSaver.load("t1", state);
  await chatGraph(saver).invoke({ messages: [new HumanMessage(message)] }, { configurable: { thread_id: "t1" } });
  await saver.keepArtifacts(artifacts);
  return saver.dump();
}

/** Each kept artifact's value, by the text of the reply it belongs to. */
async function artifactsByReply(state: Uint8Array): Promise<Record<string, unknown[]>> {
  const messages = (await threadValues(state)).messages as BaseMessage[];
  return Object.fromEntries(Object.entries(threadArtifacts(state)).map(([id, artifacts]) =>
    [String(messages.find((m) => m.id === id)!.content), artifacts.map((a) => a.value)]));
}

const artifact = (value: unknown): Artifact => ({ type: "proposal", version: 1, value });

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

  it("keeps what the graph removes out of the thread", async () => {
    let state: Uint8Array | null = null;
    for (let i = 1; i <= KEPT + 2; i++) state = await turn(state, `turn ${i}`);
    const messages = contents(await threadValues(state));
    expect(messages).toHaveLength(KEPT * 2);
    expect(messages[0]).toBe("turn 3");
  });

  it("holds one thread: another reads as empty and cannot be written", async () => {
    const saver = TurnSaver.load("t1", await turn(null, "one"));
    expect(await saver.getTuple({ configurable: { thread_id: "t2" } })).toBeUndefined();
    await expect(chatGraph(saver).invoke({ messages: [new HumanMessage("x")] }, { configurable: { thread_id: "t2" } }))
      .rejects.toThrow("another thread");
  });

  it("keeps a turn's artifacts with its reply, and only while the turn is in the thread", async () => {
    let state = await turn(null, "one", [artifact("a1")]);
    state = await turn(state, "two");
    state = await turn(state, "three", [artifact("a3"), artifact("a3b")]);
    expect(await artifactsByReply(state)).toEqual({ "echo one": ["a1"], "echo three": ["a3", "a3b"] });
    for (let i = 4; i <= KEPT + 1; i++) state = await turn(state, `turn ${i}`);
    expect(await artifactsByReply(state)).toEqual({ "echo three": ["a3", "a3b"] });
  });

  it("writes no artifacts field for a thread whose turns left none", async () => {
    const state = await turn(await turn(null, "one"), "two");
    expect(Object.keys(JSON.parse(Buffer.from(state).toString("utf8")))).toEqual(["v", "checkpoints", "writes"]);
    expect(threadArtifacts(state)).toEqual({});
    expect(threadArtifacts(null)).toEqual({});
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
