/**
 * Server entry point. Startup is ordered per `docs/architecture.md#startup`;
 * failure at any step prevents serving — no degraded boot.
 */

import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { createApp } from "./app.js";
import { settings } from "./config.js";
import { closeAiModel, initAiModel } from "./core/ai.js";
import {
  closeEmbeddingProvider,
  getEmbeddingProvider,
  initEmbeddingProvider,
} from "./core/embedding.js";
import {
  closeStores,
  ensureSemanticIndexes,
  getModelingStore,
  getOntologyRegistry,
  initStores,
} from "./core/ports.js";

/**
 * Name any stored type whose key is now reserved, walking the registry
 * — the check runs per ontology, and a server with zero ontologies has
 * nothing to check.
 *
 * Such types can only predate the reserved-key check. They are left in
 * place — renaming a type key is destructive and is the operator's call —
 * but without this warning their only symptom is an unexplained 500 from
 * the modeling API once instance data exists under them.
 */
export async function warnAboutReservedTypeKeysInUse(): Promise<void> {
  for (const ontology of await getOntologyRegistry().listOntologies()) {
    const ontologyKey = ontology["key"] as string;
    const store = await getModelingStore(ontologyKey);
    const collisions = await store.findReservedTypeKeysInUse();
    for (const collision of collisions) {
      console.warn(
        `Stored ${collision.kind} '${collision.key}' in ontology ` +
          `'${ontologyKey}' uses a reserved key. It predates the ` +
          "reserved-key check and can corrupt schema reads once instance " +
          "data exists under it. Export its data, delete the type, and " +
          "recreate it under a different key.",
      );
    }
  }
}

/**
 * Run the ordered startup sequence and return the ready-to-listen app.
 *
 * 1. Connect storage, verify reachability, ensure constraints and indexes.
 * 2. Report any stored type key that the adapter now reserves.
 * 3. Initialize the embedding provider, if configured.
 * 4. Initialize the language-model provider, if configured.
 * 5. If embeddings are enabled, reconcile vector index widths against the
 *    provider — every mismatch is WARNED about and nothing is repaired
 *    (`docs/decisions.md#behaviour`); rebuild is where repair happens.
 * 6. Start both MCP servers (mounted inside `createApp`).
 */
export async function startServer(): Promise<FastifyInstance> {
  await initStores();
  await warnAboutReservedTypeKeysInUse();
  initEmbeddingProvider();
  initAiModel();
  const embeddingProvider = getEmbeddingProvider();
  if (embeddingProvider) {
    await ensureSemanticIndexes(embeddingProvider.dimensions);
  }
  // Step 6: the MCP mounts are part of createApp.
  return createApp();
}

export async function shutdownServer(app: FastifyInstance): Promise<void> {
  await app.close();
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
