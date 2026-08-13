/**
 * Shared support for the embedding integration suite: Ollama availability
 * probing (the suite SKIPS when the provider or model is absent),
 * per-file provider enablement via `settings` mutation (config is read at
 * process start, so tests mutate and restore), and vector-index helpers
 * for the drift scenarios.
 */

import { settings } from "../../../src/config.js";
import {
  closeEmbeddingProvider,
  getEmbeddingProvider,
  initEmbeddingProvider,
  setEmbeddingProvider,
  type EmbeddingProvider,
} from "../../../src/core/embedding.js";
import { getDriver } from "../../../src/adapters/neo4j/driver.js";
import { runSession } from "../../../src/adapters/neo4j/errors.js";
import * as ddl from "../../../src/adapters/neo4j/ddl.js";

export const EMBEDDING_MODEL = "nomic-embed-text";

/** True when Ollama answers at its default port with the model pulled. */
export async function checkOllamaModel(): Promise<boolean> {
  try {
    const res = await fetch(`${settings.EMBEDDING_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return false;
    }
    const payload = (await res.json()) as { models?: { name: string }[] };
    return (payload.models ?? []).some(
      (m) => m.name === EMBEDDING_MODEL || m.name.startsWith(`${EMBEDDING_MODEL}:`),
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
      embed: async (text: string) => {
        counter.calls += 1;
        return real.embed(text);
      },
    },
  };
  setEmbeddingProvider(counter.provider);
  return counter;
}

/** The width an existing vector index is configured for, or null. */
export async function indexDimensions(indexName: string): Promise<number | null> {
  return ddl.existingVectorIndexDimensions(getDriver(), indexName);
}

/** Wait until a vector index reports ONLINE. */
export async function waitForIndexOnline(indexName: string, timeoutMs = 15_000): Promise<void> {
  const driver = getDriver();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await runSession(driver, async (session) => {
      const result = await session.run(
        "SHOW VECTOR INDEXES YIELD name, state WHERE name = $name RETURN state",
        { name: indexName },
      );
      return result.records[0]?.get("state") as string | undefined;
    });
    if (state === "ONLINE") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Index ${indexName} did not come online within ${timeoutMs}ms`);
}

/** Drop and recreate one of the two drifting indexes at a given width. */
export async function rebuildIndexAt(indexName: string, dimensions: number): Promise<void> {
  const driver = getDriver();
  await runSession(driver, async (session) => {
    await session.run(`DROP INDEX ${indexName} IF EXISTS`);
  });
  if (indexName === ddl.ENTITY_VECTOR_INDEX_NAME) {
    await ddl.ensureEntityVectorIndex(driver, dimensions);
  } else {
    await ddl.createVectorIndex(driver, indexName.replace(/_embedding$/, ""), dimensions);
  }
  await waitForIndexOnline(indexName);
}
