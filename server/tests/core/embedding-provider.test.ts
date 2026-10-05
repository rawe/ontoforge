/**
 * Embedding provider abstraction — ported from
 * `backend/tests/test_embedding_provider.py`. Transport is a fake `fetch`;
 * no provider process is needed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSettings, settings } from "../../src/config.js";
import {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
  type FetchFn,
} from "../../src/core/embedding.js";

function okResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

function errorResponse(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

function requestBody(fetchFn: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  const [, init] = fetchFn.mock.calls[call] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

/** A 2-wide vector that names its text, so order is checkable. */
function vectorFor(text: string): number[] {
  return [Number(text.slice(1)), 0];
}

/** Fake Ollama `/api/embed`: one vector per input, in order. */
function ollamaFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const { input } = JSON.parse(init!.body as string) as { input: string[] };
    return okResponse({ embeddings: input.map(vectorFor) });
  });
}

/** Fake OpenAI `/v1/embeddings`: one item per input, `data` reversed. */
function openAIFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const { input } = JSON.parse(init!.body as string) as { input: string[] };
    const data = input.map((text, index) => ({ embedding: vectorFor(text), index }));
    return okResponse({ data: data.reverse() });
  });
}

const texts = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

const originalSettings = { ...settings };

afterEach(() => {
  Object.assign(settings, originalSettings);
  vi.restoreAllMocks();
});

describe("OllamaEmbeddingProvider", () => {
  it("successful embed returns the vector and calls /api/embed", async () => {
    const fetchFn = vi.fn(async () => okResponse({ embeddings: [[0.1, 0.2, 0.3]] }));
    const provider = new OllamaEmbeddingProvider(
      "bge-m3",
      "http://localhost:11434",
      1024,
      fetchFn as FetchFn,
    );

    const result = await provider.embed("hello world");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/embed");
    expect(requestBody(fetchFn, 0)).toEqual({ model: "bge-m3", input: ["hello world"] });
  });

  it("network error returns null (graceful degradation) and logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error("Connection refused");
    });
    const provider = new OllamaEmbeddingProvider(
      "bge-m3",
      "http://localhost:11434",
      1024,
      fetchFn as FetchFn,
    );

    expect(await provider.embed("hello world")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Embedding failed"));
  });

  it("HTTP error status returns null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => errorResponse(500));
    const provider = new OllamaEmbeddingProvider(
      "bge-m3",
      "http://localhost:11434",
      1024,
      fetchFn as FetchFn,
    );

    expect(await provider.embed("test")).toBeNull();
  });

  it("reports the configured dimensions and its model id", () => {
    const provider = new OllamaEmbeddingProvider("bge-m3", "http://localhost:11434", 1024);
    expect(provider.dimensions).toBe(1024);
    expect(provider.modelId).toBe("ollama:bge-m3:1024");
  });

  it("embedBatch sends the texts as one /api/embed input list", async () => {
    const fetchFn = ollamaFetch();
    const provider = new OllamaEmbeddingProvider(
      "bge-m3",
      "http://localhost:11434/",
      2,
      fetchFn as FetchFn,
      { batchSize: 16, concurrency: 1 },
    );

    expect(await provider.embedBatch(texts(3))).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe("http://localhost:11434/api/embed");
    expect(requestBody(fetchFn, 0)).toEqual({ model: "bge-m3", input: ["t0", "t1", "t2"] });
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
    expect(requestBody(fetchFn, 0)).toEqual({
      input: ["hello world"],
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

  it("reports the configured dimensions and its model id", () => {
    const provider = new OpenAIEmbeddingProvider("bge-m3", "https://api.example.com", "k", 1024);
    expect(provider.dimensions).toBe(1024);
    expect(provider.modelId).toBe("openai:bge-m3:1024");
  });

  it("embedBatch maps data[].index back to input order", async () => {
    const fetchFn = openAIFetch();
    const provider = new OpenAIEmbeddingProvider(
      "bge-m3",
      "https://api.example.com",
      "k",
      2,
      fetchFn as FetchFn,
      { batchSize: 16, concurrency: 1 },
    );

    expect(await provider.embedBatch(texts(4))).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(requestBody(fetchFn, 0)).toEqual({ input: ["t0", "t1", "t2", "t3"], model: "bge-m3" });
  });

  it("embedBatch rejects an answer that misses an input", async () => {
    const fetchFn = vi.fn(async () =>
      okResponse({ data: [{ embedding: [1, 0], index: 0 }, { embedding: [1, 0], index: 0 }] }),
    );
    const provider = new OpenAIEmbeddingProvider(
      "bge-m3",
      "https://api.example.com",
      "k",
      2,
      fetchFn as FetchFn,
      { batchSize: 2, concurrency: 1 },
    );

    await expect(provider.embedBatch(["a", "b"])).rejects.toThrow(/no vector for input 1/);
  });

  it("embedBatch rejects an answer with the wrong count", async () => {
    const fetchFn = vi.fn(async () => okResponse({ data: [{ embedding: [1, 0], index: 0 }] }));
    const provider = new OpenAIEmbeddingProvider(
      "bge-m3",
      "https://api.example.com",
      "k",
      2,
      fetchFn as FetchFn,
      { batchSize: 2, concurrency: 1 },
    );

    await expect(provider.embedBatch(["a", "b"])).rejects.toThrow(/expected 2 vectors, got 1/);
  });
});

describe("embedBatch", () => {
  it("returns nothing and calls nothing for no texts", async () => {
    const fetchFn = ollamaFetch();
    const provider = new OllamaEmbeddingProvider("m", "http://o", 2, fetchFn as FetchFn);
    expect(await provider.embedBatch([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("chunks the texts by batch size and keeps input order", async () => {
    const fetchFn = ollamaFetch();
    const provider = new OllamaEmbeddingProvider("m", "http://o", 2, fetchFn as FetchFn, {
      batchSize: 3,
      concurrency: 1,
    });

    const vectors = await provider.embedBatch(texts(7));

    expect(vectors.map((v) => v[0])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(fetchFn.mock.calls.map((_, i) => requestBody(fetchFn, i).input)).toEqual([
      ["t0", "t1", "t2"],
      ["t3", "t4", "t5"],
      ["t6"],
    ]);
  });

  it("defaults to one text per request", async () => {
    const fetchFn = ollamaFetch();
    const provider = new OllamaEmbeddingProvider("m", "http://o", 2, fetchFn as FetchFn);
    await provider.embedBatch(texts(3));
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("keeps at most `concurrency` requests in flight and order despite completion order", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const { input } = JSON.parse(init!.body as string) as { input: string[] };
      // Later chunks answer sooner, so completion order differs from input order.
      const delay = 20 - Number(input[0]!.slice(1));
      await new Promise((resolve) => setTimeout(resolve, delay));
      inFlight -= 1;
      return okResponse({ embeddings: input.map(vectorFor) });
    });
    const provider = new OllamaEmbeddingProvider("m", "http://o", 2, fetchFn as FetchFn, {
      batchSize: 2,
      concurrency: 3,
    });

    const vectors = await provider.embedBatch(texts(12));

    expect(fetchFn).toHaveBeenCalledTimes(6);
    expect(peak).toBe(3);
    expect(vectors.map((v) => v[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("throws on an HTTP error with status, body and model id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => errorResponse(429, "rate limited"));
    const provider = new OllamaEmbeddingProvider("bge-m3", "http://o", 2, fetchFn as FetchFn);

    await expect(provider.embedBatch(["a"])).rejects.toThrow(
      "Embedding failed (ollama:bge-m3:2): HTTP 429: rate limited",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("throws on a transport error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("Connection refused");
    });
    const provider = new OpenAIEmbeddingProvider("m", "http://o", "k", 2, fetchFn as FetchFn);

    await expect(provider.embedBatch(["a"])).rejects.toThrow(/Connection refused/);
  });

  it("throws when a vector has the wrong width", async () => {
    const fetchFn = vi.fn(async () => okResponse({ embeddings: [[1, 2, 3]] }));
    const provider = new OllamaEmbeddingProvider("m", "http://o", 2, fetchFn as FetchFn);

    await expect(provider.embedBatch(["a"])).rejects.toThrow(
      /expected 2 dimensions, got 3/,
    );
  });

  it("stops sending further requests after the first failure", async () => {
    const fetchFn = vi.fn(async () => errorResponse(500));
    const provider = new OllamaEmbeddingProvider("m", "http://o", 2, fetchFn as FetchFn, {
      batchSize: 1,
      concurrency: 1,
    });

    await expect(provider.embedBatch(texts(5))).rejects.toThrow(/HTTP 500/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rethrows the caller's abort rather than a provider error", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort(new Error("caller gave up"));
      init!.signal!.throwIfAborted();
      return okResponse({ embeddings: [[1, 0]] });
    });
    const provider = new OllamaEmbeddingProvider("m", "http://o", 2, fetchFn as FetchFn);

    await expect(provider.embedBatch(["a"], controller.signal)).rejects.toThrow(
      "caller gave up",
    );
  });
});

describe("createEmbeddingProvider factory", () => {
  const defaults = loadSettings({});

  it("creates an OllamaEmbeddingProvider for 'ollama' with the default width", () => {
    settings.EMBEDDING_DIMENSIONS = defaults.EMBEDDING_DIMENSIONS;
    const provider = createEmbeddingProvider("ollama", "bge-m3", "http://localhost:11434");
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.dimensions).toBe(1024);
    expect(provider.modelId).toBe("ollama:bge-m3:1024");
  });

  it("creates an OpenAIEmbeddingProvider for 'openai' with the default width", () => {
    settings.EMBEDDING_DIMENSIONS = defaults.EMBEDDING_DIMENSIONS;
    settings.EMBEDDING_API_KEY = "sk-test";
    const provider = createEmbeddingProvider("openai", "bge-m3", "https://api.example.com");
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.dimensions).toBe(1024);
    expect(provider.modelId).toBe("openai:bge-m3:1024");
  });

  it("requires EMBEDDING_API_KEY for the openai provider", () => {
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
    expect(provider.modelId).toBe("openai:text-embedding-3-large:3072");
  });

  it("applies EMBEDDING_BATCH_SIZE and EMBEDDING_CONCURRENCY", async () => {
    settings.EMBEDDING_DIMENSIONS = 2;
    settings.EMBEDDING_BATCH_SIZE = 4;
    settings.EMBEDDING_CONCURRENCY = 2;
    const fetchFn = ollamaFetch();
    const provider = createEmbeddingProvider("ollama", "m", "http://o", fetchFn as FetchFn);

    await provider.embedBatch(texts(10));

    expect(fetchFn.mock.calls.map((_, i) => (requestBody(fetchFn, i).input as string[]).length))
      .toEqual([4, 4, 2]);
  });

  it("rejects an unknown provider name", () => {
    expect(() => createEmbeddingProvider("unknown", "model", "http://localhost")).toThrow(
      /Unknown embedding provider/,
    );
  });
});
