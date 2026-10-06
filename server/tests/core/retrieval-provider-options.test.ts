import { describe, expect, it, vi } from "vitest";
import { ChatOpenAI } from "@langchain/openai";
import { createAiModel } from "../../src/core/ai.js";
import { OllamaEmbeddingProvider, OpenAIEmbeddingProvider } from "../../src/core/embedding.js";

describe("retrieval prototype provider options", () => {
  it("makes one transport attempt on a retryable chat failure", async () => {
    const model = createAiModel("ollama", "fake", "http://fake.invalid", { maxRetries: 0 }) as ChatOpenAI;
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: { message: "test failure", type: "server_error" } }), { status: 500, headers: { "content-type": "application/json" } }));
    model.completions.clientConfig.fetch = fetchFn;
    await expect(model.invoke("test")).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(model.clientConfig.maxRetries).toBe(0);
  });
  for (const providerName of ["ollama", "openai"] as const) {
    it(`cancels an active ${providerName} embedding transport`, async () => {
      const controller = new AbortController();
      const fetchFn = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        controller.abort(new DOMException("Stopped", "AbortError"));
      }));
      const provider = providerName === "ollama" ? new OllamaEmbeddingProvider("fake", "http://fake.invalid", 3, fetchFn) : new OpenAIEmbeddingProvider("fake", "http://fake.invalid", "fake-test-key", 3, fetchFn);
      await expect(provider.embed("test", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
    it(`does not send a pre-aborted ${providerName} request`, async () => {
      const fetchFn = vi.fn();
      const provider = providerName === "ollama" ? new OllamaEmbeddingProvider("fake", "http://fake.invalid", 3, fetchFn) : new OpenAIEmbeddingProvider("fake", "http://fake.invalid", "fake-test-key", 3, fetchFn);
      await expect(provider.embed("test", AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  }
});
