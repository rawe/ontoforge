/**
 * The thread store's contract suite. It speaks only the `ThreadStore`
 * interface, so every implementation runs it unchanged: call
 * `threadStoreSuite(name, factory)` from that implementation's test file.
 * The factory builds a store with the suite's short lifetimes and says how
 * time passes for it — a fake clock in memory, real waiting against Valkey —
 * so every margin below is 50 ms. Limits that bind one implementation only
 * are tested beside it.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { emptyCheckpoint, type Checkpoint } from "@langchain/langgraph-checkpoint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ValidationError } from "../../../src/core/exceptions.js";
import {
  THREAD_STATE_MAX_BYTES,
  type StoreLifetimes,
  type ThreadBinding,
  type ThreadStore,
  type Turn,
} from "../../../src/assistants/threads/threadStore.js";
import { threadValues, TurnSaver } from "../../../src/assistants/threads/turnSaver.js";

/** A store under test and how time passes for it. */
export interface StoreUnderTest {
  store: ThreadStore;
  advance(ms: number): Promise<void>;
  /** Releases what the store runs on, if anything. */
  close?(): Promise<void>;
}

export type ThreadStoreFactory = (lifetimes: StoreLifetimes) => Promise<StoreUnderTest>;

export const SUITE_LIFETIMES: StoreLifetimes = { idleMs: 400, leaseMs: 200 };
const { idleMs: IDLE, leaseMs: LEASE } = SUITE_LIFETIMES;
const MARGIN = 50;

const BINDING: ThreadBinding = { ontologyKey: "fair", lensKey: "visitor", kind: "agents", assistantKey: "guide", owner: null };

/** One completed `kindsGraph` turn ("Who is Ada?") as a stored state, in envelope version 1. */
const STORED_STATE = readFileSync(new URL("../../fixtures/thread-state-v1.json", import.meta.url), "utf8");

const bytes = (text: string) => new Uint8Array(Buffer.from(text));
const text = (state: Uint8Array | null | undefined) => (state ? Buffer.from(state).toString() : state);

function asTurn(turn: Turn | "busy" | null): Turn {
  expect(turn).toMatchObject({ threadId: expect.any(String), token: expect.any(String) });
  return turn as Turn;
}

/** The channels the three assistant kinds keep: agents' messages with tool
 * work, retrievers' `verified`, navigators' `carried` and `round`. */
const KindsState = Annotation.Root({
  ...MessagesAnnotation.spec,
  verified: Annotation<{ configHash: string; previous: unknown } | null>(),
  carried: Annotation<{ id: string; type: string; label: string }[]>(),
  round: Annotation<number>(),
});

function kindsGraph(checkpointer: TurnSaver) {
  return new StateGraph(KindsState)
    .addNode("answer", (state) => {
      const question = String(state.messages.at(-1)!.content);
      const call = { id: `call-${state.round ?? 0}`, name: "search", args: { q: question }, type: "tool_call" as const };
      return {
        messages: [
          new AIMessage({ content: "", tool_calls: [call] }),
          new ToolMessage({ content: '[{"id":"ada"}]', tool_call_id: call.id }),
          new AIMessage(`answer to ${question}`),
        ],
        verified: { configHash: "h1", previous: { complete: true, results: [{ entityType: "person", ids: ["ada"] }] } },
        carried: [{ id: "ada", type: "person", label: "Ada" }],
        round: (state.round ?? 0) + 1,
      };
    })
    .addEdge(START, "answer")
    .addEdge("answer", END)
    .compile({ checkpointer });
}

export function threadStoreSuite(name: string, factory: ThreadStoreFactory): void {
  describe(`thread store: ${name}`, () => {
    let store: ThreadStore;
    let advance: (ms: number) => Promise<void>;
    let close: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      ({ store, advance, close } = await factory(SUITE_LIFETIMES));
    });

    afterEach(async () => {
      await close?.();
    });

    /** A thread with one completed turn that left `state`. */
    async function threadWith(state: string): Promise<string> {
      const { threadId } = await store.create(BINDING);
      expect(await store.publish(asTurn(await store.begin(threadId, BINDING)), bytes(state))).toBe("published");
      return threadId;
    }

    const stateOf = async (threadId: string) => text((await store.read(threadId, BINDING))?.state);

    describe("registry and binding", () => {
      it("creates a thread with a fresh id and its binding", async () => {
        const a = await store.create(BINDING);
        const b = await store.create(BINDING);
        expect(a.threadId).not.toBe(b.threadId);
        expect(a.binding).toEqual(BINDING);
      });

      it("reads a new thread as having no state", async () => {
        const { threadId } = await store.create(BINDING);
        expect(await store.read(threadId, BINDING)).toEqual({ state: null });
      });

      it("answers null for an unknown thread", async () => {
        expect(await store.read("no-such-thread", BINDING)).toBeNull();
        expect(await store.begin("no-such-thread", BINDING)).toBeNull();
      });

      it("finds a thread only through its own assistant", async () => {
        const threadId = await threadWith("one");
        for (const other of [
          { ...BINDING, ontologyKey: "other" },
          { ...BINDING, lensKey: "other" },
          { ...BINDING, kind: "retrievers" },
          { ...BINDING, assistantKey: "other" },
        ]) {
          expect(await store.read(threadId, other)).toBeNull();
          expect(await store.begin(threadId, other)).toBeNull();
        }
        // The refused begins took no lease.
        expect(asTurn(await store.begin(threadId, BINDING)).state).toEqual(bytes("one"));
      });

      it("finds a thread only as its owner", async () => {
        const owned = { ...BINDING, owner: "principal-a" };
        const { threadId } = await store.create(owned);
        expect(await store.read(threadId, owned)).toEqual({ state: null });
        for (const other of [BINDING, { ...BINDING, owner: "principal-b" }]) {
          expect(await store.read(threadId, other)).toBeNull();
          expect(await store.begin(threadId, other)).toBeNull();
        }
        const { threadId: open } = await store.create(BINDING);
        expect(await store.read(open, owned)).toBeNull();
        expect(await store.begin(open, owned)).toBeNull();
        expect(asTurn(await store.begin(threadId, owned)).state).toBeNull();
      });

      it("keeps threads apart", async () => {
        const a = await threadWith("for a");
        const { threadId: b } = await store.create(BINDING);
        expect(await stateOf(b)).toBeNull();
        expect(asTurn(await store.begin(b, BINDING)).state).toBeNull();
        expect(await store.begin(a, BINDING)).not.toBe("busy");
      });
    });

    describe("turns", () => {
      it("hands the last published state to the next turn", async () => {
        const threadId = await threadWith("one");
        const turn = asTurn(await store.begin(threadId, BINDING));
        expect(text(turn.state)).toBe("one");
        expect(await store.publish(turn, bytes("two"))).toBe("published");
        expect(text(asTurn(await store.begin(threadId, BINDING)).state)).toBe("two");
      });

      it("refuses a second turn while one runs, never queued", async () => {
        const { threadId } = await store.create(BINDING);
        asTurn(await store.begin(threadId, BINDING));
        expect(await store.begin(threadId, BINDING)).toBe("busy");
      });

      it("gives every turn a new token", async () => {
        const { threadId } = await store.create(BINDING);
        const first = asTurn(await store.begin(threadId, BINDING));
        await store.release(first);
        const second = asTurn(await store.begin(threadId, BINDING));
        expect(second.token).not.toBe(first.token);
      });

      it("publishing stores the state and ends the turn", async () => {
        const { threadId } = await store.create(BINDING);
        expect(await store.publish(asTurn(await store.begin(threadId, BINDING)), bytes("one"))).toBe("published");
        expect(await stateOf(threadId)).toBe("one");
        expect(await store.begin(threadId, BINDING)).not.toBe("busy");
      });

      it("a released (failed or cancelled) turn leaves the previous state and ends the turn", async () => {
        const threadId = await threadWith("one");
        await store.release(asTurn(await store.begin(threadId, BINDING)));
        expect(await stateOf(threadId)).toBe("one");
        expect(text(asTurn(await store.begin(threadId, BINDING)).state)).toBe("one");
      });

      it("reads during a turn show the last published state", async () => {
        const threadId = await threadWith("one");
        const turn = asTurn(await store.begin(threadId, BINDING));
        expect(await stateOf(threadId)).toBe("one");
        await store.publish(turn, bytes("two"));
        expect(await stateOf(threadId)).toBe("two");
      });

      it("a thread whose first turn failed reads as having no state", async () => {
        const { threadId } = await store.create(BINDING);
        await store.release(asTurn(await store.begin(threadId, BINDING)));
        expect(await store.read(threadId, BINDING)).toEqual({ state: null });
      });

      it("round-trips state byte for byte and hands out copies", async () => {
        const state = new Uint8Array(256).map((_, i) => i);
        const { threadId } = await store.create(BINDING);
        await store.publish(asTurn(await store.begin(threadId, BINDING)), state);
        state[0] = 99;
        const read = (await store.read(threadId, BINDING))!.state!;
        expect([...read]).toEqual([...new Uint8Array(256).map((_, i) => i)]);
        read[1] = 99;
        const turn = asTurn(await store.begin(threadId, BINDING));
        expect(turn.state![0]).toBe(0);
        expect(turn.state![1]).toBe(1);
      });
    });

    describe("ownership", () => {
      it("renewing keeps a turn past its lease", async () => {
        const { threadId } = await store.create(BINDING);
        const turn = asTurn(await store.begin(threadId, BINDING));
        for (let i = 0; i < 3; i++) {
          await advance(LEASE - MARGIN * 2);
          expect(await store.renew(turn)).toBe(true);
        }
        expect(await store.begin(threadId, BINDING)).toBe("busy");
        expect(await store.publish(turn, bytes("late"))).toBe("published");
      });

      it("an expired lease lets a new turn begin", async () => {
        const { threadId } = await store.create(BINDING);
        asTurn(await store.begin(threadId, BINDING));
        await advance(LEASE + MARGIN);
        asTurn(await store.begin(threadId, BINDING));
      });

      it("a stale owner can neither publish, renew nor release; the new owner is untouched", async () => {
        const threadId = await threadWith("one");
        const stale = asTurn(await store.begin(threadId, BINDING));
        await advance(LEASE + MARGIN);
        const current = asTurn(await store.begin(threadId, BINDING));

        expect(await store.publish(stale, bytes("stale"))).toBe("taken");
        expect(await store.renew(stale)).toBe(false);
        await store.release(stale);

        expect(await stateOf(threadId)).toBe("one");
        expect(await store.begin(threadId, BINDING)).toBe("busy");
        expect(await store.publish(current, bytes("two"))).toBe("published");
        expect(await stateOf(threadId)).toBe("two");
      });

      it("a lease that ran out without a successor is taken too", async () => {
        const threadId = await threadWith("one");
        const turn = asTurn(await store.begin(threadId, BINDING));
        await advance(LEASE + MARGIN);
        expect(await store.renew(turn)).toBe(false);
        expect(await store.publish(turn, bytes("late"))).toBe("taken");
        expect(await stateOf(threadId)).toBe("one");
      });

      it("a turn publishes once", async () => {
        const { threadId } = await store.create(BINDING);
        const turn = asTurn(await store.begin(threadId, BINDING));
        expect(await store.publish(turn, bytes("one"))).toBe("published");
        expect(await store.publish(turn, bytes("again"))).toBe("taken");
        expect(await stateOf(threadId)).toBe("one");
      });
    });

    describe("activity", () => {
      it("an untouched thread expires one idle lifetime after it was created", async () => {
        const { threadId } = await store.create(BINDING);
        await advance(IDLE - MARGIN);
        expect(await store.read(threadId, BINDING)).not.toBeNull();
        await advance(MARGIN * 2);
        expect(await store.read(threadId, BINDING)).toBeNull();
      });

      it("an accepted message renews the deadline", async () => {
        const { threadId } = await store.create(BINDING);
        await advance(IDLE - MARGIN * 2);
        await store.release(asTurn(await store.begin(threadId, BINDING)));
        await advance(IDLE - MARGIN * 2);
        expect(await store.read(threadId, BINDING)).not.toBeNull();
      });

      it("a completed turn renews the deadline", async () => {
        const { threadId } = await store.create(BINDING);
        const turn = asTurn(await store.begin(threadId, BINDING));
        await advance(LEASE - MARGIN * 2);
        expect(await store.renew(turn)).toBe(true);
        await advance(LEASE - MARGIN * 2);
        await store.publish(turn, bytes("one"));
        // Past the deadline `begin` set; within the one `publish` set.
        await advance(IDLE - LEASE + MARGIN * 2);
        expect(await stateOf(threadId)).toBe("one");
      });

      it("reads, renewals and releases do not renew the deadline", async () => {
        const { threadId } = await store.create(BINDING);
        await advance(IDLE - LEASE);
        const turn = asTurn(await store.begin(threadId, BINDING));
        await advance(LEASE - MARGIN * 2);
        expect(await store.renew(turn)).toBe(true);
        expect(await store.read(threadId, BINDING)).not.toBeNull();
        await store.release(turn);
        await advance(IDLE - LEASE + MARGIN * 3);
        expect(await store.read(threadId, BINDING)).toBeNull();
      });
    });

    describe("no resurrection", () => {
      it("publishing to an expired thread is gone and recreates nothing", async () => {
        const { threadId } = await store.create(BINDING);
        const turn = asTurn(await store.begin(threadId, BINDING));
        await advance(IDLE + MARGIN);
        expect(await store.publish(turn, bytes("late"))).toBe("gone");
        expect(await store.read(threadId, BINDING)).toBeNull();
        expect(await store.begin(threadId, BINDING)).toBeNull();
      });

      it("renewing or releasing a turn of an expired thread recreates nothing", async () => {
        const { threadId } = await store.create(BINDING);
        const turn = asTurn(await store.begin(threadId, BINDING));
        await advance(IDLE + MARGIN);
        expect(await store.renew(turn)).toBe(false);
        await store.release(turn);
        expect(await store.read(threadId, BINDING)).toBeNull();
        expect(await store.begin(threadId, BINDING)).toBeNull();
      });
    });

    describe("limits", () => {
      it(`refuses a state over ${THREAD_STATE_MAX_BYTES} bytes, keeping the previous state and the lease`, async () => {
        const threadId = await threadWith("one");
        const turn = asTurn(await store.begin(threadId, BINDING));
        await expect(store.publish(turn, new Uint8Array(THREAD_STATE_MAX_BYTES + 1))).rejects.toThrow(ValidationError);
        expect(await stateOf(threadId)).toBe("one");
        expect(await store.begin(threadId, BINDING)).toBe("busy");
        expect(await store.publish(turn, new Uint8Array(THREAD_STATE_MAX_BYTES))).toBe("published");
      });
    });

    describe("typed state", () => {
      it("carries every assistant kind's channels across turns as their classes", async () => {
        const { threadId } = await store.create(BINDING);
        for (const question of ["Who is Ada?", "And her team?"]) {
          // Each turn starts from the store's bytes, as on another server.
          const turn = asTurn(await store.begin(threadId, BINDING));
          const saver = TurnSaver.load(threadId, turn.state);
          await kindsGraph(saver).invoke({ messages: [new HumanMessage(question)] }, { configurable: { thread_id: threadId } });
          expect(await store.publish(turn, saver.dump())).toBe("published");
        }

        const values = await threadValues((await store.read(threadId, BINDING))!.state);
        const messages = values.messages as BaseMessage[];
        expect(messages.map((m) => m.getType())).toEqual(["human", "ai", "tool", "ai", "human", "ai", "tool", "ai"]);
        expect(AIMessage.isInstance(messages[1])).toBe(true);
        expect((messages[1] as AIMessage).tool_calls).toEqual([
          { id: "call-0", name: "search", args: { q: "Who is Ada?" }, type: "tool_call" },
        ]);
        expect(ToolMessage.isInstance(messages[2])).toBe(true);
        expect((messages[2] as ToolMessage).tool_call_id).toBe("call-0");
        expect(messages.at(-1)!.text).toBe("answer to And her team?");
        expect(values.verified).toEqual({ configHash: "h1", previous: { complete: true, results: [{ entityType: "person", ids: ["ada"] }] } });
        expect(values.carried).toEqual([{ id: "ada", type: "person", label: "Ada" }]);
        expect(values.round).toBe(2);
      });

      it("continues a stored state as a later turn", async () => {
        const threadId = await threadWith(STORED_STATE);
        const turn = asTurn(await store.begin(threadId, BINDING));
        const saver = TurnSaver.load(threadId, turn.state);
        await kindsGraph(saver).invoke({ messages: [new HumanMessage("And her team?")] }, { configurable: { thread_id: threadId } });
        expect(await store.publish(turn, saver.dump())).toBe("published");

        const values = await threadValues((await store.read(threadId, BINDING))!.state);
        const messages = values.messages as BaseMessage[];
        expect(messages.map((m) => m.getType())).toEqual(["human", "ai", "tool", "ai", "human", "ai", "tool", "ai"]);
        expect(messages.map((m) => m.text).filter((t, i) => i % 4 !== 1 && i % 4 !== 2)).toEqual([
          "Who is Ada?", "answer to Who is Ada?", "And her team?", "answer to And her team?",
        ]);
        expect(values.carried).toEqual([{ id: "ada", type: "person", label: "Ada" }]);
        expect(values.round).toBe(2);
      });

      it("carries every checkpoint namespace and its pending writes", async () => {
        const { threadId } = await store.create(BINDING);
        const turn = asTurn(await store.begin(threadId, BINDING));
        const saver = TurnSaver.load(threadId, turn.state);
        const checkpoint: Checkpoint = { ...emptyCheckpoint(), id: randomUUID() };
        checkpoint.channel_values = { messages: [new HumanMessage("hi")] };
        for (const ns of ["", "child:1"]) {
          const config = await saver.put({ configurable: { thread_id: threadId, checkpoint_ns: ns } }, checkpoint, { source: "loop", step: 1, parents: {} }, {});
          await saver.putWrites(config, [["messages", [new AIMessage("pending")]], ["__error__", { message: "boom" }]], "task-1");
        }
        await store.publish(turn, saver.dump());

        const loaded = TurnSaver.load(threadId, asTurn(await store.begin(threadId, BINDING)).state);
        for (const ns of ["", "child:1"]) {
          const tuple = await loaded.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: ns } });
          expect(tuple?.checkpoint.id).toBe(checkpoint.id);
          expect(HumanMessage.isInstance((tuple!.checkpoint.channel_values.messages as BaseMessage[])[0])).toBe(true);
          expect(tuple!.metadata).toEqual({ source: "loop", step: 1, parents: {} });
          const writes = tuple!.pendingWrites!;
          expect(writes.map(([task, channel]) => [task, channel])).toEqual([["task-1", "messages"], ["task-1", "__error__"]]);
          expect(AIMessage.isInstance((writes[0]![2] as BaseMessage[])[0])).toBe(true);
          expect(writes[1]![2]).toEqual({ message: "boom" });
        }
      });
    });
  });
}
