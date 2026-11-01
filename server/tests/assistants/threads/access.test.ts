/**
 * How a chat reaches its thread: a full thread refuses the next message
 * before any turn runs, and a thread reads back the person's own words.
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { ConflictError } from "../../../src/core/exceptions.js";
import { openThread, readThread } from "../../../src/assistants/threads/access.js";
import { MemoryThreadStore } from "../../../src/assistants/threads/memoryThreadStore.js";
import { TURNS_PER_THREAD, type ThreadBinding } from "../../../src/assistants/threads/threadStore.js";
import { TurnSaver } from "../../../src/assistants/threads/turnSaver.js";

const BINDING: ThreadBinding = { ontologyKey: "fair", lensKey: "visitor", kind: "agents", assistantKey: "guide", owner: null };

/** One completed turn of `message`, as a chat runs and publishes it. */
async function chat(threads: MemoryThreadStore, threadId: string | undefined, message: HumanMessage): Promise<string> {
  const turn = await openThread(threads, BINDING, threadId);
  const saver = TurnSaver.load(turn.threadId, turn.state);
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("reply", () => ({ messages: [new AIMessage("ok")] }))
    .addEdge(START, "reply").addEdge("reply", END)
    .compile({ checkpointer: saver });
  await graph.invoke({ messages: [message] }, { configurable: { thread_id: turn.threadId } });
  await threads.publish(turn, saver.dump());
  return turn.threadId;
}

describe("thread access", () => {
  it(`refuses a message beyond ${TURNS_PER_THREAD} turns, and frees the thread for reading`, async () => {
    const threads = new MemoryThreadStore();
    let threadId: string | undefined;
    for (let i = 1; i <= TURNS_PER_THREAD; i++) threadId = await chat(threads, threadId, new HumanMessage(`q${i}`));

    const refused = await openThread(threads, BINDING, threadId).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).details).toEqual({ code: "THREAD_FULL" });
    // The refusal took no lease: the thread is not busy, and reads back whole.
    const again = await openThread(threads, BINDING, threadId).catch((error: unknown) => error);
    expect((again as ConflictError).details).toEqual({ code: "THREAD_FULL" });
    const { messages } = await readThread(threads, BINDING, threadId!);
    expect(messages).toHaveLength(2 * TURNS_PER_THREAD);
  });

  it("reads back the person's own words, not the context sent with them", async () => {
    const threads = new MemoryThreadStore();
    const sent = new HumanMessage({ content: "<context>…</context>\n\nWhat is this?", additional_kwargs: { personText: "What is this?" } });
    const threadId = await chat(threads, undefined, sent);
    const { messages } = await readThread(threads, BINDING, threadId);
    expect(messages).toEqual([{ role: "user", content: "What is this?" }, { role: "assistant", content: "ok" }]);
  });
});
