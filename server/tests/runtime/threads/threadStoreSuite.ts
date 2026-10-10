/**
 * The thread store's interface suite. It speaks only the `ThreadStore`
 * interface, so every implementation runs it unchanged: call
 * `threadStoreSuite(name, factory)` from that implementation's test file.
 * The factory receives the clock the store must read, so expiry is tested
 * without waiting. Limits that bind one implementation only (the in-memory
 * thread cap) are tested beside it.
 */

import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { beforeEach, describe, expect, it } from "vitest";

import {
  THREAD_IDLE_LIFETIME_MS,
  TURNS_PER_THREAD,
  type Clock,
  type ThreadBinding,
  type ThreadStore,
} from "../../../src/runtime/threads/threadStore.js";
import { trimTurns } from "../../../src/runtime/threads/turns.js";

export type ThreadStoreFactory = (clock: Clock) => ThreadStore | Promise<ThreadStore>;

const BINDING: ThreadBinding = {
  ontologyKey: "fair",
  lensKey: "visitor",
  kind: "agents",
  assistantKey: "guide",
};

/**
 * A two-step chat graph on the store's checkpointer: `reply` answers and
 * trims the thread to `TURNS_PER_THREAD` turns, `tidy` is a second step so
 * every turn writes several checkpoints. A message "fail" makes `tidy`
 * throw after `reply` has written its part.
 */
function chatGraph(store: ThreadStore) {
  return new StateGraph(MessagesAnnotation)
    .addNode("reply", (state) => {
      const last = state.messages.at(-1)!;
      const reply = new AIMessage(`echo ${String(last.content)}`);
      return { messages: [reply, ...trimTurns([...state.messages, reply])] };
    })
    .addNode("tidy", (state) => {
      if (state.messages.some((m) => m.content === "fail")) throw new Error("turn failed");
      return {};
    })
    .addEdge(START, "reply")
    .addEdge("reply", "tidy")
    .addEdge("tidy", END)
    .compile({ checkpointer: store.checkpointer });
}

function contents(messages: unknown): unknown[] {
  return (messages as BaseMessage[]).map((m) => m.content);
}

export function threadStoreSuite(name: string, factory: ThreadStoreFactory): void {
  describe(`thread store: ${name}`, () => {
    let now: number;
    let store: ThreadStore;

    beforeEach(async () => {
      now = 1_000_000;
      store = await factory(() => now);
    });

    /** One complete turn the way a route runs it. */
    async function turn(threadId: string, message: string): Promise<void> {
      expect(await store.acquire(threadId)).toBe(true);
      try {
        await store.beginTurn(threadId);
        try {
          await chatGraph(store).invoke(
            { messages: [new HumanMessage(message)] },
            { configurable: { thread_id: threadId } },
          );
          await store.commitTurn(threadId);
        } catch (error) {
          await store.rollbackTurn(threadId);
          throw error;
        }
      } finally {
        await store.release(threadId);
      }
    }

    describe("registry and binding", () => {
      it("creates a thread with a fresh id, its binding and times", async () => {
        const a = await store.create(BINDING);
        const b = await store.create(BINDING);
        expect(a.threadId).not.toBe(b.threadId);
        expect(a.binding).toEqual(BINDING);
        expect(a.createdAt).toBe(now);
        expect(a.lastUsedAt).toBe(now);
      });

      it("finds a thread only through its own assistant", async () => {
        const { threadId } = await store.create(BINDING);
        expect((await store.find(threadId, BINDING))?.threadId).toBe(threadId);
        for (const other of [
          { ...BINDING, ontologyKey: "other" },
          { ...BINDING, lensKey: "other" },
          { ...BINDING, kind: "retrievers" },
          { ...BINDING, assistantKey: "other" },
        ]) {
          expect(await store.find(threadId, other)).toBeNull();
        }
      });

      it("answers null for an unknown thread", async () => {
        expect(await store.find("no-such-thread", BINDING)).toBeNull();
        expect(await store.values("no-such-thread")).toBeNull();
      });

      it("hands out copies, never its own values", async () => {
        const binding = { ...BINDING };
        const created = await store.create(binding);
        binding.assistantKey = "changed";
        created.binding.lensKey = "changed";
        created.lastUsedAt = 0;
        const found = await store.find(created.threadId, BINDING);
        expect(found?.binding).toEqual(BINDING);
        expect(found?.lastUsedAt).toBe(now);
      });
    });

    describe("expiry", () => {
      it("removes a thread two hours after its last turn", async () => {
        const { threadId } = await store.create(BINDING);
        await turn(threadId, "hello");
        now += THREAD_IDLE_LIFETIME_MS - 1;
        expect(await store.find(threadId, BINDING)).not.toBeNull();
        now += 1;
        expect(await store.find(threadId, BINDING)).toBeNull();
        expect(await store.values(threadId)).toBeNull();
        expect(await store.checkpointer.getTuple({ configurable: { thread_id: threadId } })).toBeUndefined();
      });

      it("counts from the last turn; reading is not use", async () => {
        const { threadId } = await store.create(BINDING);
        now += THREAD_IDLE_LIFETIME_MS - 1;
        await turn(threadId, "hello");
        now += THREAD_IDLE_LIFETIME_MS - 1;
        await store.find(threadId, BINDING);
        await store.values(threadId);
        now += 1;
        expect(await store.find(threadId, BINDING)).toBeNull();
      });

      it("refuses checkpoint writes to an expired thread", async () => {
        const { threadId } = await store.create(BINDING);
        now += THREAD_IDLE_LIFETIME_MS;
        await expect(
          chatGraph(store).invoke(
            { messages: [new HumanMessage("hello")] },
            { configurable: { thread_id: threadId } },
          ),
        ).rejects.toThrow();
      });
    });

    describe("run lock", () => {
      it("lets one run hold a thread at a time", async () => {
        const { threadId } = await store.create(BINDING);
        expect(await store.acquire(threadId)).toBe(true);
        expect(await store.acquire(threadId)).toBe(false);
        await store.release(threadId);
        expect(await store.acquire(threadId)).toBe(true);
      });

      it("locks threads independently", async () => {
        const a = await store.create(BINDING);
        const b = await store.create(BINDING);
        expect(await store.acquire(a.threadId)).toBe(true);
        expect(await store.acquire(b.threadId)).toBe(true);
      });

      it("refuses to lock an unknown thread", async () => {
        await expect(store.acquire("no-such-thread")).rejects.toThrow();
      });
    });

    describe("checkpoints", () => {
      it("continues a thread from its latest checkpoint", async () => {
        const { threadId } = await store.create(BINDING);
        await turn(threadId, "one");
        await turn(threadId, "two");
        const values = await store.values(threadId);
        expect(contents(values?.messages)).toEqual(["one", "echo one", "two", "echo two"]);
      });

      it("round-trips a checkpoint through put and getTuple", async () => {
        const { threadId } = await store.create(BINDING);
        await turn(threadId, "one");
        const tuple = await store.checkpointer.getTuple({ configurable: { thread_id: threadId } });
        expect(contents(tuple?.checkpoint.channel_values.messages)).toEqual(["one", "echo one"]);
        expect(tuple?.config.configurable?.thread_id).toBe(threadId);
        const byId = await store.checkpointer.getTuple(tuple!.config);
        expect(byId?.checkpoint.id).toBe(tuple?.checkpoint.id);
      });

      it("keeps only the latest checkpoint", async () => {
        const { threadId } = await store.create(BINDING);
        await turn(threadId, "one");
        await turn(threadId, "two");
        const tuples = [];
        for await (const tuple of store.checkpointer.list({ configurable: { thread_id: threadId } })) {
          tuples.push(tuple);
        }
        expect(tuples).toHaveLength(1);
      });

      it("hands out state as a copy", async () => {
        const { threadId } = await store.create(BINDING);
        await turn(threadId, "one");
        const values = await store.values(threadId);
        (values!.messages as BaseMessage[]).length = 0;
        expect(contents((await store.values(threadId))?.messages)).toEqual(["one", "echo one"]);
      });

      it("keeps threads apart", async () => {
        const a = await store.create(BINDING);
        const b = await store.create(BINDING);
        await turn(a.threadId, "for a");
        expect(await store.values(b.threadId)).toEqual({});
      });
    });

    describe("atomic turns", () => {
      it("returns a failed turn's thread to its state before the turn", async () => {
        const { threadId } = await store.create(BINDING);
        await turn(threadId, "one");
        const before = await store.values(threadId);

        await store.acquire(threadId);
        await store.beginTurn(threadId);
        await expect(
          chatGraph(store).invoke(
            { messages: [new HumanMessage("fail")] },
            { configurable: { thread_id: threadId } },
          ),
        ).rejects.toThrow("turn failed");
        // The failed turn wrote checkpoints before it threw.
        expect(contents((await store.values(threadId))?.messages)).toContain("fail");
        await store.rollbackTurn(threadId);
        await store.release(threadId);

        expect(contents((await store.values(threadId))?.messages)).toEqual(contents(before?.messages));
        await turn(threadId, "two");
        expect(contents((await store.values(threadId))?.messages)).toEqual([
          "one",
          "echo one",
          "two",
          "echo two",
        ]);
      });

      it("returns a thread whose first turn failed to empty", async () => {
        const { threadId } = await store.create(BINDING);
        await expect(turn(threadId, "fail")).rejects.toThrow("turn failed");
        expect(await store.values(threadId)).toEqual({});
        await turn(threadId, "one");
        expect(contents((await store.values(threadId))?.messages)).toEqual(["one", "echo one"]);
      });

      it("keeps a committed turn", async () => {
        const { threadId } = await store.create(BINDING);
        await turn(threadId, "one");
        await store.rollbackTurn(threadId);
        expect(contents((await store.values(threadId))?.messages)).toEqual(["one", "echo one"]);
      });
    });

    describe("turn cap", () => {
      it(`keeps the last ${TURNS_PER_THREAD} turns in a thread's state`, async () => {
        const { threadId } = await store.create(BINDING);
        for (let i = 1; i <= TURNS_PER_THREAD + 2; i++) await turn(threadId, `turn ${i}`);
        const messages = contents((await store.values(threadId))?.messages);
        expect(messages).toHaveLength(TURNS_PER_THREAD * 2);
        expect(messages[0]).toBe("turn 3");
        expect(messages.at(-1)).toBe(`echo turn ${TURNS_PER_THREAD + 2}`);
      });
    });
  });
}
