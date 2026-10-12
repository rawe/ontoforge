/**
 * The live trace every kind of the seam streams: the topology first, a
 * step `running` then `done` / `failed` with duration, summary and round,
 * skips, entities, the answer as shared deltas, and the summary with the
 * model calls — all prefixed with the kind's event noun.
 */

import { describe, expect, it } from "vitest";

import type { StreamEvent } from "../../../../src/runtime/chatStream.js";
import { Trace } from "../../../../src/runtime/assistants/kit/trace.js";

function trace(signal = new AbortController().signal) {
  const events: StreamEvent[] = [];
  return { events, trace: new Trace("navigator", async (event) => { events.push(event); }, signal) };
}

describe("Trace", () => {
  it("announces the topology under the kind's event noun", async () => {
    const { events, trace: t } = trace();
    await t.graph({ steps: [{ id: "a", label: "A", description: "Does a", model: false }], edges: [{ from: "a", to: "a", label: "again" }] });
    expect(events).toEqual([{
      type: "navigator.graph",
      steps: [{ id: "a", label: "A", description: "Does a", model: false }],
      edges: [{ from: "a", to: "a", label: "again" }],
    }]);
  });

  it("a step runs, then is done with its duration and summary; a repeat counts its round", async () => {
    const { events, trace: t } = trace();
    const result = await t.step("walk", async (report) => {
      report.summary = "Hop 1: 3 entities";
      return 42;
    });
    expect(result).toBe(42);
    await t.step("walk", async () => undefined);
    expect(events).toEqual([
      { type: "navigator.step", id: "walk", status: "running", round: 1 },
      { type: "navigator.step", id: "walk", status: "done", round: 1, durationMs: expect.any(Number), summary: "Hop 1: 3 entities" },
      { type: "navigator.step", id: "walk", status: "running", round: 2 },
      // No summary set: none sent.
      { type: "navigator.step", id: "walk", status: "done", round: 2, durationMs: expect.any(Number) },
    ]);
    expect(Object.keys(t.timings)).toEqual(["walk"]);
  });

  it("a step that throws is failed and the error goes on", async () => {
    const { events, trace: t } = trace();
    await expect(t.step("understand", async (report) => {
      report.summary = "half way";
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(events).toEqual([
      { type: "navigator.step", id: "understand", status: "running", round: 1 },
      { type: "navigator.step", id: "understand", status: "failed", round: 1, durationMs: expect.any(Number), summary: "half way" },
    ]);
  });

  it("a skipped step has a summary and a round, no duration", async () => {
    const { events, trace: t } = trace();
    await t.skip("walk", "Nothing to walk from");
    await t.skip("walk", "Still nothing");
    expect(events).toEqual([
      { type: "navigator.step", id: "walk", status: "skipped", round: 1, summary: "Nothing to walk from" },
      { type: "navigator.step", id: "walk", status: "skipped", round: 2, summary: "Still nothing" },
    ]);
  });

  it("entities, deltas and the summary with model calls, counts and timings", async () => {
    const { events, trace: t } = trace();
    await t.step("answer", async () => undefined);
    t.modelCalls += 2;
    const card = { ref: "E1", id: "x", type: "person", typeName: "Person", label: "Lena", role: "anchor" as const, hop: 0, reason: "r", fields: [], evidence: true };
    await t.entities([card], [{ id: "r1", from: "E1", to: "E1", type: "manages", label: "manages" }]);
    await t.delta("Hi");
    await t.summary({ entities: 1, evidence: 1, hops: 0 });
    expect(events.slice(2)).toEqual([
      { type: "navigator.entities", entities: [card], links: [{ id: "r1", from: "E1", to: "E1", type: "manages", label: "manages" }] },
      { type: "delta", text: "Hi" },
      {
        type: "navigator.summary",
        modelCalls: 2,
        durationMs: expect.any(Number),
        entities: 1,
        evidence: 1,
        hops: 0,
        timings: { answer: expect.any(Number) },
      },
    ]);
  });

  it("a cancelled turn starts no step, and a step cancelled while running reports nothing more", async () => {
    const controller = new AbortController();
    const { events, trace: t } = trace(controller.signal);
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
