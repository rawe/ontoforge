/**
 * Server entry point. Startup is ordered per `docs/architecture.md#startup`;
 * failure at any step prevents serving — no degraded boot.
 */

import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { createApp } from "./app.js";
import { settings } from "./config.js";
import { closeAiModel, initAiModel } from "./core/ai.js";
import { initDecisionModel } from "./core/decision.js";
import {
  closeEmbeddingProvider,
  getEmbeddingProvider,
  initEmbeddingProvider,
} from "./core/embedding.js";
import { closeStores, ensureSemanticIndexes, initStores } from "./core/ports.js";
import { startSearchWorker, stopSearchWorker } from "./runtime/indexing/worker.js";
import { MemoryThreadStore } from "./runtime/threads/memoryThreadStore.js";
import type { ThreadStore } from "./runtime/threads/threadStore.js";
import { ValkeyThreadStore } from "./runtime/threads/valkeyThreadStore.js";

/**
 * Run the ordered startup sequence and return the ready-to-listen app.
 *
 * 1. Connect storage, verify reachability, ensure constraints and indexes.
 *    Open the thread store; a Valkey must be reachable and evict nothing.
 * 2. Initialize the embedding provider, if configured.
 * 3. Initialize the language-model provider, if configured.
 * 4. If embeddings are enabled, reconcile vector index widths against the
 *    provider — every mismatch is WARNED about and nothing is repaired
 *    (`docs/decisions.md#deployment`); rebuild is where repair happens.
 * 5. Start the search worker — it reconciles every ontology's index
 *    generations, then builds entries from the queue in the background.
 * 6. Start both MCP servers (mounted inside `createApp`).
 *
 * The app closes the thread store when it closes; a failed boot closes it here.
 */
export async function startServer(): Promise<FastifyInstance> {
  await initStores();
  const threads = await openThreadStore();
  try {
    initEmbeddingProvider();
    initAiModel();
    initDecisionModel();
    const embeddingProvider = getEmbeddingProvider();
    if (embeddingProvider) {
      await ensureSemanticIndexes(embeddingProvider.dimensions);
    }
    await startSearchWorker();
    // Step 6: the MCP mounts are part of createApp.
    return await createApp(threads);
  } catch (error) {
    await threads.close();
    throw error;
  }
}

/** The thread store `THREAD_STORE` names, connected and checked. */
async function openThreadStore(): Promise<ThreadStore> {
  return settings.THREAD_STORE === "valkey"
    ? ValkeyThreadStore.connect(settings.VALKEY_URL!)
    : new MemoryThreadStore();
}

export async function shutdownServer(app: FastifyInstance): Promise<void> {
  await app.close();
  await stopSearchWorker();
  closeEmbeddingProvider();
  closeAiModel();
  await closeStores();
}

async function main(): Promise<void> {
  let app: FastifyInstance;
  try {
    app = await startServer();
    await app.listen({ port: settings.PORT, host: "0.0.0.0" });
  } catch (error) {
    console.error("Startup failed:", error);
    process.exit(1);
  }
  console.log(`OntoForge server listening on port ${settings.PORT}`);

  const stop = async () => {
    await shutdownServer(app);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
