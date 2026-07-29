/**
 * Embedding-provider seam (`core/embedding` in the module layout).
 *
 * Session 08 supplies the real provider implementations and wires
 * `setEmbeddingProvider` into startup (`main.ts` step 3). Until then no
 * provider is ever configured and every consumer that gates on
 * `getEmbeddingProvider()` — chunk synchronization, entity embedding —
 * is a no-op, exactly like the Python reference with no
 * `EMBEDDING_PROVIDER` set. Tests inject a fake provider to exercise the
 * gated paths.
 */

export interface EmbeddingProvider {
  /** Vector width, needed for index DDL. */
  readonly dimensions: number;
  /** Embed one text. `null` means the provider produced no vector. */
  embed(text: string): Promise<number[] | null>;
}

let provider: EmbeddingProvider | null = null;

/** The active provider, or `null` when embeddings are disabled. */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  return provider;
}

/** Install (or clear) the active provider. Startup and tests only. */
export function setEmbeddingProvider(next: EmbeddingProvider | null): void {
  provider = next;
}
