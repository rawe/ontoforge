/**
 * What only the answer stream itself tells, run through the real provider
 * clients on a scripted HTTP stream: a provider's failure after the stream
 * has started — the HTTP status was 200, so only the error's own type or
 * code names the reason — an answer the model ended early, which each
 * client reports in its own place, and the usage of the whole call, which
 * each client reports in its own chunks.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";

import { Diagnostics } from "../../../../src/assistants/index.js";
import { streamAnswer } from "../../../../src/runtime/assistants/kit/model.js";

/** A fetch answering every request with one 200 event stream. */
const streaming = (body: string) => async () =>
  new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const ANTHROPIC_START =
  event("message_start", {
    type: "message_start",
    message: {
      id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 },
    },
  }) +
  event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
  event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Half an" } });

const anthropic = (body: string) => new ChatAnthropic({
  model: "claude-haiku-5-5", apiKey: "fake-test-key", maxRetries: 0, clientOptions: { fetch: streaming(body) },
});

const openai = (body: string) => new ChatOpenAI({
  model: "any", apiKey: "fake-test-key", maxRetries: 0, configuration: { fetch: streaming(body) },
});

const OPENAI_START = `data: ${JSON.stringify({
  id: "c1", object: "chat.completion.chunk", created: 1, model: "any",
  choices: [{ index: 0, delta: { role: "assistant", content: "Half an" }, finish_reason: null }],
})}\n\n`;

/** One streamed answer; `calls` are the model steps it sent. */
async function answer(model: ChatAnthropic | ChatOpenAI) {
  const deltas: string[] = [];
  const sent: Record<string, unknown>[] = [];
  const recorder = new Diagnostics(async (event) => { sent.push(event); });
  const failed = await streamAnswer(
    model, recorder.model("answer"), "Answer.", "Who?", new AbortController().signal, async (text) => { deltas.push(text); },
  ).catch((error: unknown) => error);
  const calls = sent.flatMap((event) => event.steps as Record<string, unknown>[]);
  return { deltas, failed, calls };
}

describe("a failure after the answer stream started", () => {
  it.each([
    ["overloaded_error", "unavailable"],
    ["api_error", "unavailable"],
    ["rate_limit_error", "rate_limited"],
  ])("names Anthropic's %s as %s", async (type, reason) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = ANTHROPIC_START + event("error", { type: "error", error: { type, message: "provider words" } });

    const { deltas, failed } = await answer(anthropic(body));

    expect(deltas).toEqual(["Half an"]);
    expect(failed).toMatchObject({ name: "ModelError", reason });
    expect((failed as Error).message).not.toContain("provider words");
  });

  it.each([
    [{ message: "provider words", type: "server_error", code: null }, "unavailable"],
    [{ message: "provider words", type: "requests", code: "rate_limit_exceeded" }, "rate_limited"],
    [{ message: "provider words", type: "invalid_request_error", code: "context_length_exceeded" }, "context_full"],
  ])("names the OpenAI protocol's %o as %s", async (error, reason) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = OPENAI_START + `data: ${JSON.stringify({ error })}\n\n`;

    const { failed } = await answer(openai(body));

    expect(failed).toMatchObject({ name: "ModelError", reason });
    expect((failed as Error).message).not.toContain("provider words");
  });
});

const chunk = (delta: unknown, finishReason: string | null) => `data: ${JSON.stringify({
  id: "c1", object: "chat.completion.chunk", created: 1, model: "any",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
})}\n\n`;

/** The usage chunk the OpenAI protocol sends last, after the finish reason. */
const OPENAI_USAGE = `data: ${JSON.stringify({
  id: "c1", object: "chat.completion.chunk", created: 1, model: "any", choices: [],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
})}\n\ndata: [DONE]\n\n`;

/** How Anthropic ends a message: the stop reason, then the stop. */
const anthropicEnd = (stopReason: string) =>
  event("content_block_stop", { type: "content_block_stop", index: 0 }) +
  event("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 2 } }) +
  event("message_stop", { type: "message_stop" });

describe("an answer the model ended early", () => {
  it.each([
    ["on a chunk of its own, before the usage chunk", OPENAI_START + chunk({}, "length") + OPENAI_USAGE, ["Half an"]],
    ["on the chunk of the last text", OPENAI_START + chunk({ content: " answer" }, "length") + "data: [DONE]\n\n", ["Half an", " answer"]],
    ["before any text", chunk({ role: "assistant", content: "" }, null) + chunk({}, "length") + OPENAI_USAGE, []],
  ])("fails as cut off when the OpenAI protocol names the output limit %s", async (_where, body, streamed) => {
    const { deltas, failed } = await answer(openai(body));

    expect(deltas).toEqual(streamed);
    expect(failed).toMatchObject({ name: "ModelError", reason: "answer_cut_off", details: { code: "ANSWER_CUT_OFF" } });
  });

  it.each([
    ["max_tokens", "answer_cut_off"],
    ["model_context_window_exceeded", "context_full"],
  ])("fails when Anthropic stops the answer with %s, as %s", async (stopReason, reason) => {
    const { deltas, failed } = await answer(anthropic(ANTHROPIC_START + anthropicEnd(stopReason)));

    expect(deltas).toEqual(["Half an"]);
    expect(failed).toMatchObject({ name: "ModelError", reason });
  });

  it("logs no provider failure for it: the call itself succeeded", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warned.mockClear();

    await answer(openai(OPENAI_START + chunk({}, "length") + OPENAI_USAGE));

    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });

  it("stays a cancellation when the request is cancelled while its last text is handed on", async () => {
    const controller = new AbortController();
    const model = openai(OPENAI_START + chunk({ content: " answer" }, "length") + "data: [DONE]\n\n");

    const failed = await streamAnswer(model, new Diagnostics().model(), "Answer.", "Who?", controller.signal, async (text) => {
      if (text !== " answer") return;
      // The client reads the rest of the stream meanwhile; then the request is cancelled.
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
    }).catch((error: unknown) => error);

    expect(failed).not.toMatchObject({ name: "ModelError" });
    expect(failed).toMatchObject({ name: "AbortError" });
  });

  it.each([
    ["the OpenAI protocol's stop", () => openai(OPENAI_START + chunk({}, "stop") + OPENAI_USAGE)],
    ["Anthropic's end_turn", () => anthropic(ANTHROPIC_START + anthropicEnd("end_turn"))],
    // An endpoint that names no reason at all gives no ground to fail the turn.
    ["no reason at all", () => openai(OPENAI_START + "data: [DONE]\n\n")],
  ])("keeps a complete answer: %s", async (_name, model) => {
    const { deltas, failed } = await answer(model());

    expect(deltas).toEqual(["Half an"]);
    expect(failed).toBe("Half an");
  });
});

describe("the model call of a streamed answer", () => {
  it("carries the whole call's usage from Anthropic, which reports the input first and the output last", async () => {
    const start = event("message_start", {
      type: "message_start",
      message: {
        id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 410, output_tokens: 1, cache_read_input_tokens: 4800, cache_creation_input_tokens: 0 },
      },
    });
    const body = start +
      event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
      event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Ada." } }) +
      event("content_block_stop", { type: "content_block_stop", index: 0 }) +
      event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 312 } }) +
      event("message_stop", { type: "message_stop" });

    const { calls } = await answer(anthropic(body));

    // Input from the first chunk (its cached parts included); the output is the
    // last chunk's running total, not the first chunk's count added to it.
    expect(calls).toEqual([{
      index: 1, name: "answer", model: true, startMs: expect.any(Number), durationMs: expect.any(Number),
      usage: { input: 5210, output: 312, cacheRead: 4800, cacheWrite: 0 }, finishReason: "end_turn",
    }]);
  });

  it("carries the whole call's usage from the OpenAI protocol, which reports it once, last", async () => {
    const { calls } = await answer(openai(OPENAI_START + chunk({}, "stop") + OPENAI_USAGE));

    expect(calls).toEqual([{
      index: 1, name: "answer", model: true, startMs: expect.any(Number), durationMs: expect.any(Number), usage: { input: 5, output: 2 }, finishReason: "stop",
    }]);
  });

  it("keeps the usage and finish reason of an answer refused as cut off", async () => {
    const { failed, calls } = await answer(openai(OPENAI_START + chunk({}, "length") + OPENAI_USAGE));

    expect(failed).toMatchObject({ reason: "answer_cut_off" });
    expect(calls).toEqual([{
      index: 1, name: "answer", model: true, startMs: expect.any(Number), durationMs: expect.any(Number), usage: { input: 5, output: 2 }, finishReason: "length",
    }]);
  });

  it("lists a call that failed, without usage", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = OPENAI_START + `data: ${JSON.stringify({ error: { message: "provider words", type: "server_error", code: null } })}\n\n`;

    const { calls } = await answer(openai(body));

    expect(calls).toEqual([{ index: 1, name: "answer", model: true, startMs: expect.any(Number), durationMs: expect.any(Number), failed: true }]);
  });
});
