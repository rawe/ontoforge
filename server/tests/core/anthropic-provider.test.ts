import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";

import { settings } from "../../src/config.js";
import { anthropicReasoning, closeAiModel, createAiModel, initAiModel } from "../../src/core/ai.js";
import { createEmbeddingProvider } from "../../src/core/embedding.js";

const saved = {
  provider: settings.AI_PROVIDER, model: settings.AI_MODEL, key: settings.AI_API_KEY,
  effort: settings.AI_REASONING_EFFORT,
};

afterEach(() => {
  settings.AI_PROVIDER = saved.provider;
  settings.AI_MODEL = saved.model;
  settings.AI_API_KEY = saved.key;
  settings.AI_REASONING_EFFORT = saved.effort;
  closeAiModel();
  vi.restoreAllMocks();
});

function anthropic(effort: string | null): ChatAnthropic {
  settings.AI_API_KEY = "fake-test-key";
  settings.AI_REASONING_EFFORT = effort;
  return createAiModel("anthropic", "claude-haiku-5-5", "https://api.anthropic.com", { maxRetries: 0 }) as ChatAnthropic;
}

describe("anthropic chat provider", () => {
  it("speaks Anthropic's own API at the configured host", () => {
    const model = anthropic(null);
    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.apiUrl).toBe("https://api.anthropic.com");
    // The retriever never retries a model call; LangChain's caller owns retries.
    expect((model as unknown as { caller: { maxRetries: number } }).caller.maxRetries).toBe(0);
  });

  it("requires an API key", () => {
    settings.AI_API_KEY = null;
    expect(() => createAiModel("anthropic", "claude-haiku-5-5", "https://api.anthropic.com")).toThrow(
      /AI_API_KEY is required for the anthropic provider/,
    );
  });

  it("sets an output limit that leaves room for thinking", () => {
    expect(anthropic(null).invocationParams().max_tokens).toBe(16_384);
  });

  it("sends no thinking settings when the effort is unset", () => {
    const params = anthropic(null).invocationParams();
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toBeUndefined();
  });

  it("maps a graded effort to adaptive thinking at that effort", () => {
    for (const effort of ["low", "medium", "high"]) {
      const params = anthropic(effort).invocationParams();
      expect(params.thinking).toEqual({ type: "adaptive" });
      expect(params.output_config).toEqual({ effort });
    }
  });

  it("maps none to thinking switched off", () => {
    expect(anthropicReasoning("claude-haiku-5-5", "none")).toEqual({ thinking: { type: "disabled" } });
    expect(anthropic("none").invocationParams().thinking).toEqual({ type: "disabled" });
  });

  it("runs a model that keeps thinking at the lowest effort for none, and warns at startup", () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1"]) {
      expect(anthropicReasoning(model, "none")).toEqual({ thinking: { type: "adaptive" }, outputConfig: { effort: "low" } });
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    settings.AI_PROVIDER = "anthropic";
    settings.AI_MODEL = "claude-opus-5-5";
    settings.AI_API_KEY = "fake-test-key";
    settings.AI_REASONING_EFFORT = "none";
    initAiModel();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/claude-opus-5-5 does not run without thinking.*effort low/));
  });

  it("keeps a graded effort as set on every model", () => {
    expect(anthropicReasoning("claude-opus-5-5", "high")).toEqual({ thinking: { type: "adaptive" }, outputConfig: { effort: "high" } });
  });

  it("merges a per-call output format with the configured effort", () => {
    const schema = { type: "object", additionalProperties: false, required: [], properties: {} };
    const params = anthropic("low").invocationParams({ outputConfig: { format: { type: "json_schema", schema } } });
    expect(params.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema } });
  });
});

describe("anthropic as an embedding provider", () => {
  it("is refused: Anthropic offers no embeddings API", () => {
    expect(() => createEmbeddingProvider("anthropic", "bge-m3", "https://api.anthropic.com")).toThrow(
      /Anthropic offers no embeddings API/,
    );
  });
});
