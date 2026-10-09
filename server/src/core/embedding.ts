/**
 * Embedding provider seam and implementations (`core/embedding` in the
 * module layout).
 *
 * Two providers: `ollama` (native `/api/embed` on the Ollama host) and
 * `openai` (OpenAI-compatible `/embeddings` below the documented API base,
 * version included — works with OpenAI, Azure, OVHcloud, vLLM, LM Studio,
 * …). Both send a list of texts per request.
 *
 * Two ways to call them:
 * - `embed(text)` — one text; a failed call is LOGGED and yields `null`, and
 *   the caller proceeds without a vector — an embedding failure never fails
 *   a write (`docs/storage-adapters.md#keeping-search-data-current`).
 * - `embedBatch(texts)` — many texts, sent `EMBEDDING_BATCH_SIZE` per request
 *   with up to `EMBEDDING_CONCURRENCY` requests in flight; vectors come back
 *   in input order. A failed request THROWS, so a caller that retries can
 *   tell a failure from "no provider".
 *
 * With no `EMBEDDING_PROVIDER` configured, no provider is ever installed
 * and every consumer that gates on `getEmbeddingProvider()` — entity
 * embedding, semantic search, vector-index DDL — is a no-op; chunk
 * synchronization still writes chunks, without vectors. Tests inject a
 * fake provider to exercise the gated paths.
 */

import { settings } from "../config.js";

export interface EmbeddingProvider {
  /** Vector width, needed for index DDL. */
  readonly dimensions: number;
  /** Stable model identity — provider, model and width, e.g.
   * `ollama:bge-m3:1024`. Vectors with different ids are not comparable. */
  readonly modelId: string;
  /** Embed one text. `null` means the provider produced no vector. */
  embed(text: string, signal?: AbortSignal): Promise<number[] | null>;
  /** Embed many texts; one vector per text, in input order. Throws when a
   * request fails or answers with the wrong count or width. */
  embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

/** `fetch`-shaped dependency so unit tests can inject a fake transport. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** How `embedBatch` splits its texts into requests. */
export interface Batching {
  /** Texts per request. */
  batchSize: number;
  /** Requests in flight at once. */
  concurrency: number;
}

const REQUEST_TIMEOUT_MS = 30_000;

const NO_BATCHING: Batching = { batchSize: 1, concurrency: 1 };

/** Shared request plumbing; subclasses only speak their wire format. */
abstract class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  /** The URL every request is sent to: the base URL plus the provider's path. */
  readonly endpoint: string;

  constructor(
    providerName: string,
    path: string,
    protected readonly model: string,
    baseUrl: string,
    readonly dimensions: number,
    protected readonly fetchFn: FetchFn,
    private readonly batching: Batching,
  ) {
    this.endpoint = `${baseUrl.replace(/\/+$/, "")}${path}`;
    this.modelId = `${providerName}:${model}:${dimensions}`;
  }

  /** One HTTP call for `texts`; vectors in input order. Throws on failure. */
  protected abstract request(texts: string[], signal: AbortSignal): Promise<number[][]>;

  async embed(text: string, signal?: AbortSignal): Promise<number[] | null> {
    signal?.throwIfAborted();
    try {
      const [vector] = await this.request([text], withTimeout(signal));
      return vector ?? null;
    } catch (exc) {
      signal?.throwIfAborted();
      console.warn(`Embedding failed: ${errorMessage(exc)}`);
      return null;
    }
  }

  async embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted();
    const chunks: string[][] = [];
    for (let i = 0; i < texts.length; i += this.batching.batchSize) {
      chunks.push(texts.slice(i, i + this.batching.batchSize));
    }
    const results: number[][][] = new Array(chunks.length);
    // The first failure stops the remaining requests.
    const stop = new AbortController();
    const shared = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    const failures: unknown[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (failures.length === 0 && next < chunks.length) {
        const index = next++;
        const chunk = chunks[index]!;
        try {
          const vectors = await this.request(chunk, withTimeout(shared));
          this.check(vectors, chunk.length);
          results[index] = vectors;
        } catch (exc) {
          failures.push(exc);
          stop.abort();
        }
      }
    };
    const workers = Math.min(this.batching.concurrency, chunks.length);
    await Promise.all(Array.from({ length: workers }, worker));
    if (failures.length > 0) {
      signal?.throwIfAborted();
      throw new Error(`Embedding failed (${this.modelId}): ${errorMessage(failures[0])}`);
    }
    return results.flat();
  }

  private check(vectors: number[][], expected: number): void {
    if (vectors.length !== expected) {
      throw new Error(`expected ${expected} vectors, got ${vectors.length}`);
    }
    for (const vector of vectors) {
      if (vector.length !== this.dimensions) {
        throw new Error(
          `expected ${this.dimensions} dimensions, got ${vector.length} — check EMBEDDING_DIMENSIONS`,
        );
      }
    }
  }

  protected async post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const detail = await responseText(response);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response.json();
  }
}

export class OllamaEmbeddingProvider extends HttpEmbeddingProvider {
  constructor(
    model: string,
    baseUrl: string,
    dimensions: number,
    fetchFn: FetchFn = fetch,
    batching: Batching = NO_BATCHING,
  ) {
    super("ollama", "/api/embed", model, baseUrl, dimensions, fetchFn, batching);
  }

  protected async request(texts: string[], signal: AbortSignal): Promise<number[][]> {
    const payload = (await this.post(
      this.endpoint,
      {},
      { model: this.model, input: texts },
      signal,
    )) as { embeddings?: number[][] };
    if (!Array.isArray(payload.embeddings)) {
      throw new Error("response has no embeddings");
    }
    return payload.embeddings;
  }
}

export class OpenAIEmbeddingProvider extends HttpEmbeddingProvider {
  constructor(
    model: string,
    baseUrl: string,
    private readonly apiKey: string,
    dimensions: number,
    fetchFn: FetchFn = fetch,
    batching: Batching = NO_BATCHING,
  ) {
    super("openai", "/embeddings", model, baseUrl, dimensions, fetchFn, batching);
  }

  protected async request(texts: string[], signal: AbortSignal): Promise<number[][]> {
    const payload = (await this.post(
      this.endpoint,
      { authorization: `Bearer ${this.apiKey}` },
      { input: texts, model: this.model },
      signal,
    )) as { data?: { embedding: number[]; index: number }[] };
    if (!Array.isArray(payload.data)) {
      throw new Error("response has no data");
    }
    // `data[].index` is the input position; the order of `data` is not
    // promised.
    const vectors: (number[] | undefined)[] = Array.from({ length: texts.length }, () => undefined);
    for (const item of payload.data) {
      if (!Number.isInteger(item.index) || item.index < 0 || item.index >= texts.length) {
        throw new Error(`response index out of range: ${item.index}`);
      }
      vectors[item.index] = item.embedding;
    }
    if (payload.data.length !== texts.length) {
      throw new Error(`expected ${texts.length} vectors, got ${payload.data.length}`);
    }
    const missing = vectors.findIndex((v) => v === undefined);
    if (missing >= 0) {
      throw new Error(`response has no vector for input ${missing}`);
    }
    return vectors as number[][];
  }
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function errorMessage(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

/** The start of an error response body, for the error message. */
async function responseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, 300);
  } catch {
    return "";
  }
}

/** Build a provider from its name; throws on unknown names and missing
 * credentials — startup fails loudly rather than serving degraded. */
export function createEmbeddingProvider(
  provider: string,
  model: string,
  baseUrl: string,
  fetchFn: FetchFn = fetch,
): EmbeddingProvider & { readonly endpoint: string } {
  const dims = settings.EMBEDDING_DIMENSIONS;
  const batching: Batching = {
    batchSize: settings.EMBEDDING_BATCH_SIZE,
    concurrency: settings.EMBEDDING_CONCURRENCY,
  };
  if (provider === "ollama") {
    return new OllamaEmbeddingProvider(model, baseUrl, dims, fetchFn, batching);
  }
  if (provider === "openai") {
    const apiKey = settings.EMBEDDING_API_KEY;
    if (!apiKey) {
      throw new Error("EMBEDDING_API_KEY is required for the openai provider");
    }
    return new OpenAIEmbeddingProvider(model, baseUrl, apiKey, dims, fetchFn, batching);
  }
  throw new Error(`Unknown embedding provider: '${provider}'`);
}

let provider: EmbeddingProvider | null = null;

/** Startup step 3: install the configured provider, or none. */
export function initEmbeddingProvider(): void {
  if (!settings.EMBEDDING_PROVIDER) {
    console.info("EMBEDDING_PROVIDER not set — semantic search disabled");
    return;
  }
  const created = createEmbeddingProvider(
    settings.EMBEDDING_PROVIDER,
    settings.EMBEDDING_MODEL,
    settings.EMBEDDING_BASE_URL,
  );
  provider = created;
  console.info(
    `Embedding provider initialized: ${created.modelId} ` +
      `(via ${created.endpoint}, batch size ${settings.EMBEDDING_BATCH_SIZE}, concurrency ${settings.EMBEDDING_CONCURRENCY})`,
  );
}

export function closeEmbeddingProvider(): void {
  provider = null;
}

/** The active provider, or `null` when embeddings are disabled. */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  return provider;
}

/** Install (or clear) the active provider. Startup and tests only. */
export function setEmbeddingProvider(next: EmbeddingProvider | null): void {
  provider = next;
}
