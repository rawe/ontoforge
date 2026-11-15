/**
 * The live trace of a fixed pipeline: the topology first (without which
 * step calls the model), a step `running` then `done` / `failed` with
 * summary and round, skips, entities, the answer as shared deltas — all
 * prefixed with the assistant's event noun; and, when asked, each step
 * that ran as a diagnostics step: a work step, unless the step calls the
 * model and its model call is the step.
 */

import { describe, expect, it } from "vitest";

import { Diagnostics, type StreamEvent } from "../../../../src/assistants/index.js";
import { Trace } from "../../../../src/runtime/assistants/kit/trace.js";

function trace(signal = new AbortController().signal) {
  const events: StreamEvent[] = [];
  const push = async (event: StreamEvent) => { events.push(event); };
  return { events, trace: new Trace("navigator", push, signal, new Diagnostics(push)) };
}

const TOPOLOGY = {
  steps: [
    { id: "understand", label: "Understand", description: "Reads", model: true },
    { id: "walk", label: "Walk", description: "Walks", model: false },
  ],
  edges: [{ from: "walk", to: "walk", label: "again" }],
};

const time = { startMs: expect.any(Number), durationMs: expect.any(Number) };

describe("Trace", () => {
  it("announces the topology under the event noun, without which step calls the model", async () => {
    const { events, trace: t } = trace();
    await t.graph(TOPOLOGY);
    expect(events).toEqual([{
      type: "navigator.graph",
      steps: [
        { id: "understand", label: "Understand", description: "Reads" },
        { id: "walk", label: "Walk", description: "Walks" },
      ],
      edges: [{ from: "walk", to: "walk", label: "again" }],
    }]);
  });

  it("a step runs, then is done with its summary and no time; a repeat counts its round and is a step of its own", async () => {
    const { events, trace: t } = trace();
    await t.graph(TOPOLOGY);
    const result = await t.step("walk", async (report) => {
      report.summary = "Hop 1: 3 entities";
      return 42;
    });
    expect(result).toBe(42);
    await t.step("walk", async () => undefined);
    expect(events.slice(1)).toEqual([
      { type: "navigator.step", id: "walk", status: "running", round: 1 },
      { type: "diagnostics", steps: [{ index: 1, name: "walk", ...time }] },
      { type: "navigator.step", id: "walk", status: "done", round: 1, summary: "Hop 1: 3 entities" },
      { type: "navigator.step", id: "walk", status: "running", round: 2 },
      { type: "diagnostics", steps: [{ index: 2, name: "walk", ...time }] },
      // No summary set: none sent.
      { type: "navigator.step", id: "walk", status: "done", round: 2 },
    ]);
  });

  it("a step that calls the model is recorded by its model call only", async () => {
    const { events, trace: t } = trace();
    await t.graph(TOPOLOGY);
    await t.step("understand", () => t.diagnostics.model("understand").done({}, "Looking for Person"));
    expect(events.slice(1)).toEqual([
      { type: "navigator.step", id: "understand", status: "running", round: 1 },
      { type: "diagnostics", steps: [{ index: 1, name: "understand", model: true, ...time, detail: "Looking for Person" }] },
      { type: "navigator.step", id: "understand", status: "done", round: 1 },
    ]);
  });

  it("a step that throws is failed, its work step too, and the error goes on", async () => {
    const { events, trace: t } = trace();
    await t.graph(TOPOLOGY);
    await expect(t.step("walk", async (report) => {
      report.summary = "half way";
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(events.slice(1)).toEqual([
      { type: "navigator.step", id: "walk", status: "running", round: 1 },
      { type: "diagnostics", steps: [{ index: 1, name: "walk", ...time, failed: true }] },
      { type: "navigator.step", id: "walk", status: "failed", round: 1, summary: "half way" },
    ]);
  });

  it("a skipped step has a summary and a round, and is no diagnostics step", async () => {
    const { events, trace: t } = trace();
    await t.skip("walk", "Nothing to walk from");
    await t.skip("walk", "Still nothing");
    expect(events).toEqual([
      { type: "navigator.step", id: "walk", status: "skipped", round: 1, summary: "Nothing to walk from" },
      { type: "navigator.step", id: "walk", status: "skipped", round: 2, summary: "Still nothing" },
    ]);
  });

  it("entities and deltas", async () => {
    const { events, trace: t } = trace();
    const card = { ref: "E1", id: "x", type: "person", typeName: "Person", label: "Lena", role: "anchor" as const, hop: 0, reason: "r", fields: [], evidence: true };
    await t.entities([card], [{ id: "r1", from: "E1", to: "E1", type: "manages", label: "manages" }]);
    await t.delta("Hi");
    expect(events).toEqual([
      { type: "entities", entities: [card], links: [{ id: "r1", from: "E1", to: "E1", type: "manages", label: "manages" }] },
      { type: "delta", text: "Hi" },
    ]);
  });

  it("a cancelled turn starts no step, and a step cancelled while running reports nothing more", async () => {
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    const t = new Trace("navigator", async (event) => { events.push(event); }, controller.signal);
    await expect(t.step("walk", async () => {
      controller.abort();
      throw new Error("aborted");
    })).rejects.toThrow("aborted");
    expect(events).toEqual([{ type: "navigator.step", id: "walk", status: "running", round: 1 }]);
    await expect(t.step("focus", async () => 1)).rejects.toBeDefined();
    await expect(t.skip("focus", "x")).rejects.toBeDefined();
    expect(events).toHaveLength(1);
  });
});
