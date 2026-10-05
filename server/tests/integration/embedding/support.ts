/**
 * Shared support for the embedding integration suite: Ollama availability
 * probing (the suite SKIPS when the provider or model is absent) and
 * per-file provider enablement via `settings` mutation (config is read at
 * process start, so tests mutate and restore).
 *
 * The Neo4j vector-index helpers for the drift scenarios live in
 * `neo4j/support.ts`.
 */

import { settings } from "../../../src/config.js";
import {
  closeEmbeddingProvider,
  getEmbeddingProvider,
  initEmbeddingProvider,
  setEmbeddingProvider,
  type EmbeddingProvider,
} from "../../../src/core/embedding.js";

/** True when Ollama answers at the configured base URL with the
 * configured `EMBEDDING_MODEL` pulled. */
export async function checkOllamaModel(): Promise<boolean> {
  const model = settings.EMBEDDING_MODEL;
  try {
    const res = await fetch(`${settings.EMBEDDING_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return false;
    }
    const payload = (await res.json()) as { models?: { name: string }[] };
    return (payload.models ?? []).some(
      (m) => m.name === model || m.name.startsWith(`${model}:`),
    );
  } catch {
    return false;
  }
}

let originalProvider: string | null = null;

/** Enable the ollama provider for this test file. Pair with `disableProvider`. */
export function enableOllamaProvider(): void {
  originalProvider = settings.EMBEDDING_PROVIDER;
  settings.EMBEDDING_PROVIDER = "ollama";
  initEmbeddingProvider();
}

/** Restore the no-provider state for the suites that follow. */
export function disableProvider(): void {
  closeEmbeddingProvider();
  settings.EMBEDDING_PROVIDER = originalProvider;
}

/** Wrap the active provider so `embed` calls are counted (chunk-reuse
 * assertions). Returns the counter; `setEmbeddingProvider` restores. */
export function countEmbedCalls(): { calls: number; provider: EmbeddingProvider } {
  const real = getEmbeddingProvider();
  if (!real) {
    throw new Error("No embedding provider active");
  }
  const counter = {
    calls: 0,
    provider: {
      dimensions: real.dimensions,
      modelId: real.modelId,
      embed: async (text: string) => {
        counter.calls += 1;
        return real.embed(text);
      },
      embedBatch: async (texts: string[]) => {
        counter.calls += texts.length;
        return real.embedBatch(texts);
      },
    } satisfies EmbeddingProvider,
  };
  setEmbeddingProvider(counter.provider);
  return counter;
}
