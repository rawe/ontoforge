/**
 * Embedding provider seam and implementations (`core/embedding` in the
 * module layout).
 *
 * Two providers: `ollama` (native embeddings endpoint) and `openai`
 * (OpenAI-compatible `/v1/embeddings` — works with OpenAI, Azure, vLLM,
 * LM Studio, …). A failed embedding call is LOGGED and yields `null`; the
 * caller proceeds without a vector — an embedding failure never fails a
 * write (`docs/capabilities/search.md#keeping-embeddings-current`).
 *
 * With no `EMBEDDING_PROVIDER` configured, no provider is ever installed
 * and every consumer that gates on `getEmbeddingProvider()` — chunk
 * synchronization, entity embedding, semantic search, vector-index DDL —
 * is a no-op. Tests inject a fake provider to exercise the gated paths.
 */

import { settings } from "../config.js";

export interface EmbeddingProvider {
  /** Vector width, needed for index DDL. */
  readonly dimensions: number;
  /** Embed one text. `null` means the provider produced no vector. */
  embed(text: string): Promise<number[] | null>;
}

/** `fetch`-shaped dependency so unit tests can inject a fake transport. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 30_000;

const DEFAULT_DIMENSIONS: Record<string, number> = {
  ollama: 768,
  openai: 1536,
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly model: string,
    baseUrl: string,
    readonly dimensions: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { embedding: number[] };
      return payload.embedding;
    } catch (exc) {
      console.warn(`Embedding failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      return null;
    }
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly model: string,
    baseUrl: string,
    private readonly apiKey: string,
    readonly dimensions: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ input: text, model: this.model }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { data: { embedding: number[] }[] };
      return payload.data[0]!.embedding;
    } catch (exc) {
      console.warn(`Embedding failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      return null;
    }
  }
}

function resolveDimensions(provider: string): number {
  if (settings.EMBEDDING_DIMENSIONS !== null) {
    return settings.EMBEDDING_DIMENSIONS;
  }
  const fallback = DEFAULT_DIMENSIONS[provider];
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`EMBEDDING_DIMENSIONS is required for provider '${provider}'`);
}

/** Build a provider from its name; throws on unknown names and missing
 * credentials — startup fails loudly rather than serving degraded. */
export function createEmbeddingProvider(
  provider: string,
  model: string,
  baseUrl: string,
  fetchFn: FetchFn = fetch,
): EmbeddingProvider {
  const dims = resolveDimensions(provider);
  if (provider === "ollama") {
    return new OllamaEmbeddingProvider(model, baseUrl, dims, fetchFn);
  }
  if (provider === "openai") {
    const apiKey = settings.EMBEDDING_API_KEY;
    if (!apiKey) {
      throw new Error("EMBEDDING_API_KEY is required for the openai provider");
    }
    return new OpenAIEmbeddingProvider(model, baseUrl, apiKey, dims, fetchFn);
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
  provider = createEmbeddingProvider(
    settings.EMBEDDING_PROVIDER,
    settings.EMBEDDING_MODEL,
    settings.EMBEDDING_BASE_URL,
  );
  console.info(
    `Embedding provider initialized: ${settings.EMBEDDING_PROVIDER} ` +
      `(${settings.EMBEDDING_MODEL}, ${provider.dimensions} dimensions)`,
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
