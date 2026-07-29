/**
 * Embedding provider abstraction — ported from
 * `backend/tests/test_embedding_provider.py`. Transport is a fake `fetch`;
 * no provider process is needed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { settings } from "../../src/config.js";
import {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
  type FetchFn,
} from "../../src/core/embedding.js";

function okResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

const originalDimensions = settings.EMBEDDING_DIMENSIONS;
const originalApiKey = settings.EMBEDDING_API_KEY;

afterEach(() => {
  settings.EMBEDDING_DIMENSIONS = originalDimensions;
  settings.EMBEDDING_API_KEY = originalApiKey;
  vi.restoreAllMocks();
});

describe("OllamaEmbeddingProvider", () => {
  it("successful embed returns the vector and calls the native endpoint", async () => {
    const fetchFn = vi.fn(async () => okResponse({ embedding: [0.1, 0.2, 0.3] }));
    const provider = new OllamaEmbeddingProvider(
      "nomic-embed-text",
      "http://localhost:11434",
      768,
      fetchFn as FetchFn,
    );

    const result = await provider.embed("hello world");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/embeddings");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "nomic-embed-text",
      prompt: "hello world",
    });
  });

  it("network error returns null (graceful degradation) and logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error("Connection refused");
    });
    const provider = new OllamaEmbeddingProvider(
      "nomic-embed-text",
      "http://localhost:11434",
      768,
      fetchFn as FetchFn,
    );

    expect(await provider.embed("hello world")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Embedding failed"));
  });

  it("HTTP error status returns null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => errorResponse(500));
    const provider = new OllamaEmbeddingProvider(
      "nomic-embed-text",
      "http://localhost:11434",
      768,
      fetchFn as FetchFn,
    );

    expect(await provider.embed("test")).toBeNull();
  });

  it("reports the configured dimensions", () => {
    const provider = new OllamaEmbeddingProvider("m", "http://localhost:11434", 768);
    expect(provider.dimensions).toBe(768);
  });
});

describe("OpenAIEmbeddingProvider", () => {
  it("successful embed returns the vector and sends the bearer token", async () => {
    const fetchFn = vi.fn(async () =>
      okResponse({
        data: [{ embedding: [0.4, 0.5, 0.6], index: 0 }],
        model: "text-embedding-3-small",
      }),
    );
    const provider = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      "https://api.openai.com",
      "sk-test-key",
      1536,
      fetchFn as FetchFn,
    );

    const result = await provider.embed("hello world");

    expect(result).toEqual([0.4, 0.5, 0.6]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-key");
    expect(JSON.parse(init.body as string)).toEqual({
      input: "hello world",
      model: "text-embedding-3-small",
    });
  });

  it("network error returns null (graceful degradation)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error("Connection refused");
    });
    const provider = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      "https://api.openai.com",
      "sk-test-key",
      1536,
      fetchFn as FetchFn,
    );

    expect(await provider.embed("hello world")).toBeNull();
  });

  it("reports the configured dimensions", () => {
    const provider = new OpenAIEmbeddingProvider("m", "https://api.openai.com", "k", 1536);
    expect(provider.dimensions).toBe(1536);
  });
});

describe("createEmbeddingProvider factory", () => {
  it("creates an OllamaEmbeddingProvider for 'ollama' with the default width", () => {
    settings.EMBEDDING_DIMENSIONS = null;
    const provider = createEmbeddingProvider("ollama", "nomic-embed-text", "http://localhost:11434");
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.dimensions).toBe(768);
  });

  it("creates an OpenAIEmbeddingProvider for 'openai' with the default width", () => {
    settings.EMBEDDING_DIMENSIONS = null;
    settings.EMBEDDING_API_KEY = "sk-test";
    const provider = createEmbeddingProvider(
      "openai",
      "text-embedding-3-small",
      "https://api.openai.com",
    );
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.dimensions).toBe(1536);
  });

  it("requires EMBEDDING_API_KEY for the openai provider", () => {
    settings.EMBEDDING_DIMENSIONS = null;
    settings.EMBEDDING_API_KEY = null;
    expect(() =>
      createEmbeddingProvider("openai", "text-embedding-3-small", "https://api.openai.com"),
    ).toThrow(/EMBEDDING_API_KEY is required/);
  });

  it("uses EMBEDDING_DIMENSIONS when set", () => {
    settings.EMBEDDING_DIMENSIONS = 3072;
    settings.EMBEDDING_API_KEY = "sk-test";
    const provider = createEmbeddingProvider(
      "openai",
      "text-embedding-3-large",
      "https://api.openai.com",
    );
    expect(provider.dimensions).toBe(3072);
  });

  it("rejects an unknown provider name", () => {
    settings.EMBEDDING_DIMENSIONS = 768;
    expect(() => createEmbeddingProvider("unknown", "model", "http://localhost")).toThrow(
      /Unknown embedding provider/,
    );
  });
});
