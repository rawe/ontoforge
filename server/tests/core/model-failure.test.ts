/**
 * What a failed or cut-off model call becomes for a client, for every
 * provider alike, and which provider is asked to cache.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ContextOverflowError } from "@langchain/core/errors";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import { conversationCaching, cutOff, modelFailure } from "../../src/core/ai.js";
import { ModelError } from "../../src/core/exceptions.js";

/** An error shaped as a provider SDK raises it. */
const providerError = (message: string, fields: Record<string, unknown> = {}) => Object.assign(new Error(message), fields);

describe("modelFailure", () => {
  it.each([
    ["Anthropic's refusal", providerError("400 prompt is too long: 210000 tokens > 200000 maximum", { status: 400 })],
    ["OpenAI's code", providerError("400 This model's limit is 8192 tokens.", { status: 400, code: "context_length_exceeded" })],
    ["vLLM's words", providerError("This model's maximum context length is 8192 tokens. However, you requested 9000 tokens.", { status: 400 })],
    ["llama.cpp's words", providerError("the request exceeds the available context size, try increasing it", { status: 400 })],
    ["LangChain's own error", ContextOverflowError.fromError(new Error("too long"))],
  ])("names a full context window: %s", (_name, error) => {
    expect(modelFailure(error)).toMatchObject({ reason: "context_full", details: { code: "CONTEXT_FULL" } });
  });

  it.each([
    ["rate_limited", providerError("Too Many Requests", { status: 429 })],
    ["misconfigured", providerError("invalid x-api-key", { status: 401 })],
    ["misconfigured", providerError("model: no-such-model", { status: 404 })],
    ["unavailable", providerError("Overloaded", { status: 529 })],
    ["unavailable", providerError("Request timed out.", { name: "TimeoutError" })],
    ["unavailable", providerError("fetch failed", { cause: providerError("connect", { code: "ECONNREFUSED" }) })],
  ])("names %s", (reason, error) => {
    expect(modelFailure(error).reason).toBe(reason);
  });

  it("reads the reason through a wrapping error", () => {
    const wrapped = new Error("Middleware failed", { cause: providerError("Too Many Requests", { status: 429 }) });
    expect(modelFailure(wrapped).reason).toBe("rate_limited");
  });

  it("names no reason for a refusal that tells none: a plain 400 is not a full window", () => {
    const failure = modelFailure(providerError("400 messages: roles must alternate", { status: 400 }));
    expect(failure).toMatchObject({ reason: "failed", details: null });
    expect(failure.message).toBe("The language model failed; no automatic retry.");
  });

  it("keeps the provider's words out of the message, and the failure as its cause", () => {
    const error = providerError("secret upstream detail", { status: 503 });
    const failure = modelFailure(error);
    expect(failure.message).not.toContain("secret");
    expect(failure.cause).toBe(error);
  });

  it("passes a model error through unchanged", () => {
    const failure = new ModelError("context_full");
    expect(modelFailure(failure)).toBe(failure);
  });
});

describe("cutOff", () => {
  it("names an answer cut at the output limit, in either provider's words", () => {
    expect(cutOff({ finish_reason: "length" })?.reason).toBe("answer_cut_off");
    expect(cutOff({ stop_reason: "max_tokens" })?.reason).toBe("answer_cut_off");
  });

  it("names a context window filled while answering as full", () => {
    expect(cutOff({ stop_reason: "model_context_window_exceeded" })?.reason).toBe("context_full");
  });

  it("is nothing for a finished answer or a tool call", () => {
    for (const metadata of [{ finish_reason: "stop" }, { stop_reason: "end_turn" }, { stop_reason: "tool_use" }, {}, undefined]) {
      expect(cutOff(metadata)).toBeUndefined();
    }
  });
});

describe("conversationCaching", () => {
  it("asks Anthropic to cache, and sends an OpenAI-compatible endpoint nothing", () => {
    const anthropic = new ChatAnthropic({ model: "claude-haiku-5-5", apiKey: "fake-test-key" });
    const openai = new ChatOpenAI({ model: "any", apiKey: "fake-test-key" });
    expect(conversationCaching(anthropic)).toEqual({ cache_control: { type: "ephemeral" } });
    expect(conversationCaching(openai)).toEqual({});
  });
});
