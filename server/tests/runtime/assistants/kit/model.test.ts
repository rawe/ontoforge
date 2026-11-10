/**
 * What only the answer stream itself tells, run through the real provider
 * clients on a scripted HTTP stream: a provider's failure after the stream
 * has started — the HTTP status was 200, so only the error's own type or
 * code names the reason — and an answer the model ended early, which each
 * client reports in its own place.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";

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

async function answer(model: ChatAnthropic | ChatOpenAI) {
  const deltas: string[] = [];
  const failed = await streamAnswer(model, "Answer.", "Who?", new AbortController().signal, async (text) => { deltas.push(text); })
    .catch((error: unknown) => error);
  return { deltas, failed };
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

  it.each([
    ["the OpenAI protocol's stop", () => openai(OPENAI_START + chunk({}, "stop") + OPENAI_USAGE)],
    ["Anthropic's end_turn", () => anthropic(ANTHROPIC_START + anthropicEnd("end_turn"))],
    // An endpoint that names no reason at all gives no ground to fail the turn.
    ["no reason at all", () => openai(OPENAI_START + "data: [DONE]\n\n")],
  ])("keeps a complete answer: %s", async (_name, model) => {
    const { deltas, failed } = await answer(model());

    expect(deltas).toEqual(["Half an"]);
    expect(failed).toMatchObject({ text: "Half an" });
  });
});
