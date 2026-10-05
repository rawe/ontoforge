/**
 * The provider's batching path against the live Ollama model: `embedBatch`
 * splits the texts into requests and returns one full-width vector per
 * text, in input order — the same direction `embed` gives the text alone.
 * SKIPPED when Ollama or the model is unavailable.
 */

import { describe, expect, it } from "vitest";

import { settings } from "../../../src/config.js";
import { OllamaEmbeddingProvider } from "../../../src/core/embedding.js";
import { checkOllamaModel } from "./support.js";

const ollamaUp = await checkOllamaModel();

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(na * nb);
}

const TEXTS = [
  "Der CTO von ACME leitet die Technik.",
  "Advisor at Foo Ltd.",
  "Bananen sind gelb.",
  "The quarterly report is due on Friday.",
  "Ein Hund bellt im Garten.",
  "Graph databases store nodes and edges.",
  "Kaffee am Morgen.",
];

describe.skipIf(!ollamaUp)("embedBatch against the live provider (Ollama)", () => {
  it("returns one vector per text, full width, in input order", async () => {
    const provider = new OllamaEmbeddingProvider(
      settings.EMBEDDING_MODEL,
      settings.EMBEDDING_BASE_URL,
      settings.EMBEDDING_DIMENSIONS,
      fetch,
      { batchSize: 3, concurrency: 2 },
    );

    const vectors = await provider.embedBatch(TEXTS);

    expect(vectors).toHaveLength(TEXTS.length);
    for (const [i, text] of TEXTS.entries()) {
      expect(vectors[i]).toHaveLength(settings.EMBEDDING_DIMENSIONS);
      const single = await provider.embed(text);
      expect(single).not.toBeNull();
      // Same text, same direction: batching must not reorder or mix texts.
      expect(cosine(vectors[i]!, single!)).toBeGreaterThan(0.99);
      // ... and clearly not the neighbour's vector.
      const other = vectors[(i + 1) % TEXTS.length]!;
      expect(cosine(vectors[i]!, other)).toBeLessThan(0.95);
    }
  });
});
