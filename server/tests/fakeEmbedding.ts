/**
 * A deterministic fake embedding provider for tests: each text maps to a
 * unit vector derived from its SHA-256, so equal texts get equal vectors
 * and nothing calls out. It records what it embeds and can be made to fail.
 */

import { createHash } from "node:crypto";

import type { EmbeddingProvider } from "../src/core/embedding.js";

export interface FakeEmbeddingProvider extends EmbeddingProvider {
  /** Texts embedded by `embedBatch` (the search pipeline) so far; the
   * legacy one-text `embed` is not recorded. */
  readonly embedded: string[];
  /** `embedBatch` calls so far. */
  batchCalls: number;
  /** When set, `embedBatch` throws this message and `embed` yields null. */
  failWith: string | null;
}

/** The vector the fake provider gives a text. */
export function fakeVector(text: string, dimensions: number): number[] {
  const digest = createHash("sha256").update(text).digest();
  const vector = Array.from({ length: dimensions }, (_, i) => digest[i % digest.length]! - 127.5);
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

export function fakeEmbeddingProvider(
  options: { dimensions?: number; model?: string } = {},
): FakeEmbeddingProvider {
  const dimensions = options.dimensions ?? 8;
  const provider: FakeEmbeddingProvider = {
    dimensions,
    modelId: `fake:${options.model ?? "hash"}:${dimensions}`,
    embedded: [],
    batchCalls: 0,
    failWith: null,
    async embed(text) {
      if (provider.failWith !== null) return null;
      return fakeVector(text, dimensions);
    },
    async embedBatch(texts) {
      provider.batchCalls += 1;
      if (provider.failWith !== null) throw new Error(provider.failWith);
      provider.embedded.push(...texts);
      return texts.map((text) => fakeVector(text, dimensions));
    },
  };
  return provider;
}
