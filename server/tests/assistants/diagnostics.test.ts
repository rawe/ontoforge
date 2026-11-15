/**
 * The recorder of a turn's steps: what a model step and a work step send,
 * with and without detail, a failed step, the turn's time, and silence
 * when the chat did not ask.
 */

import { describe, expect, it } from "vitest";

import { Diagnostics, type StreamEvent } from "../../src/assistants/index.js";

const time = { startMs: expect.any(Number), durationMs: expect.any(Number) };

function recorder() {
  const events: StreamEvent[] = [];
  return { events, diagnostics: new Diagnostics(async (event) => { events.push(event); }) };
}

describe("Diagnostics", () => {
  it("sends one entry per step as it ends, numbered in the order the steps started", async () => {
    const { events, diagnostics } = recorder();
    const first = diagnostics.model("plan");
    const second = diagnostics.model();
    await second.done({});
    await first.done({ usage: { input_tokens: 10, output_tokens: 2 }, finishReason: "stop" });
    await diagnostics.work("retrieve", async () => "found");
    expect(events).toEqual([
      { type: "diagnostics", steps: [{ index: 2, model: true, ...time }] },
      { type: "diagnostics", steps: [{ index: 1, name: "plan", model: true, ...time, usage: { input: 10, output: 2 }, finishReason: "stop" }] },
      { type: "diagnostics", steps: [{ index: 3, name: "retrieve", ...time }] },
    ]);
  });

  it("a step of either form may carry what it produced as text; without it, the entry has no detail", async () => {
    const { events, diagnostics } = recorder();
    const plan = JSON.stringify({ subQueries: [{ indices: ["person~default"], query: "Ada" }], unsupportedReason: null }, null, 2);
    await diagnostics.model("plan").done({}, plan);
    expect(await diagnostics.work("retrieve", async (step) => {
      step.detail = "3 entities";
      return 3;
    })).toBe(3);
    expect(events.flatMap((event) => event.steps)).toEqual([
      { index: 1, name: "plan", model: true, ...time, detail: plan },
      { index: 2, name: "retrieve", ...time, detail: "3 entities" },
    ]);
  });

  it("a step that threw is failed: no usage, no detail, and a work step's error goes on", async () => {
    const { events, diagnostics } = recorder();
    await diagnostics.model("answer").failed();
    await expect(diagnostics.work("walk", async (step) => {
      step.detail = "half way";
      throw new Error("lost");
    })).rejects.toThrow("lost");
    expect(events.flatMap((event) => event.steps)).toEqual([
      { index: 1, name: "answer", model: true, ...time, failed: true },
      { index: 2, name: "walk", ...time, failed: true },
    ]);
  });

  it("sends the turn's time on its own, and nothing at all when the chat did not ask", async () => {
    const { events, diagnostics } = recorder();
    await diagnostics.total();
    expect(events).toEqual([{ type: "diagnostics", durationMs: expect.any(Number) }]);

    const silent = new Diagnostics();
    await silent.model("plan").done({}, "{}");
    await silent.work("retrieve", async () => undefined);
    await silent.total();
  });
});
