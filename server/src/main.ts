/**
 * Server entry point. Startup is ordered per `docs/architecture.md#startup`;
 * failure at any step prevents serving — no degraded boot.
 */

import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { openAccessStore } from "./adapters/postgres/accessStore.js";
import type { AccessStore } from "./access/store.js";
import { createApp } from "./app.js";
import { connectOidc } from "./auth/oidc.js";
import { authSettings, settings } from "./config.js";
import { closeAiModel, initAiModel } from "./core/ai.js";
import { initDecisionModel } from "./core/decision.js";
import {
  closeEmbeddingProvider,
  getEmbeddingProvider,
  initEmbeddingProvider,
} from "./core/embedding.js";
import { closeStores, ensureSemanticIndexes, initStores } from "./core/ports.js";
import { startSearchWorker, stopSearchWorker } from "./runtime/indexing/worker.js";
import { openSharedState } from "./sharedState.js";

/**
 * Run the ordered startup sequence and return the ready-to-listen app.
 *
 * 1. Connect storage, verify reachability, ensure constraints and indexes.
 *    Open the shared state; a Valkey must be reachable and evict nothing.
 *    With authentication on, open the access database (creating and
 *    upgrading it) and discover the OpenID provider; either failing fails
 *    the boot. With it off, neither is touched.
 * 2. Initialize the embedding provider, if configured.
 * 3. Initialize the language-model provider, if configured.
 * 4. If embeddings are enabled, reconcile vector index widths against the
 *    provider — every mismatch is WARNED about and nothing is repaired
 *    (`docs/decisions.md#deployment`); rebuild is where repair happens.
 * 5. Start the search worker — it reconciles every ontology's index
 *    generations, then builds entries from the queue in the background.
 * 6. Start both MCP servers (mounted inside `createApp`).
 *
 * The app closes the shared state and the access store when it closes; a
 * failed boot closes them here.
 */
export async function startServer(): Promise<FastifyInstance> {
  await initStores();
  const auth = authSettings(settings);
  const shared = await openSharedState({
    ...(settings.SHARED_STATE === "valkey" ? { kind: "valkey", url: settings.VALKEY_URL! } : { kind: "memory" }),
    sessionIdleMs: settings.AUTH_SESSION_IDLE_SECONDS * 1000,
  });
  let access: AccessStore | null = null;
  try {
    if (auth !== null) {
      access = await openAccessStore(auth.accessDbUri, settings.DB_USER, settings.DB_PASSWORD);
    }
    initEmbeddingProvider();
    initAiModel();
    initDecisionModel();
    const embeddingProvider = getEmbeddingProvider();
    if (embeddingProvider) {
      await ensureSemanticIndexes(embeddingProvider.dimensions);
    }
    await startSearchWorker();
    const runtime =
      auth !== null && access !== null
        ? { settings: auth, oidc: await connectOidc(auth), access, sessions: shared.sessions }
        : null;
    // Step 6: the MCP mounts are part of createApp.
    return await createApp(shared, runtime);
  } catch (error) {
    await access?.close();
    await shared.close();
    throw error;
  }
}

/** After the drain deadline: how long cut chat streams get to roll back and
 * release their turns. */
const UNWIND_MS = 2_000;
/** What the hard exit allows beyond the drain deadline. */
const CLEANUP_MS = 10_000;

const shutdowns = new WeakMap<FastifyInstance, Promise<void>>();

export interface ShutdownOptions {
  /** How long running work may take before it is cut. */
  drainMs?: number;
  /** Told each stage as it starts, so a stall can be named. */
  onStage?: (stage: string) => void;
}

/**
 * Drain and close the server, once: a repeated call joins the first.
 *
 * 1. Draining: `/readyz` answers 503 and every response closes its
 *    connection.
 * 2. No new connections; idle ones close. Running requests and chat streams
 *    go on. The search worker stops alongside.
 * 3. Wait until no work runs, at most `drainMs`. Then cut every connection:
 *    a cut chat stream aborts its turn, which is rolled back and released
 *    (`chatStream.ts`); wait for that at most `UNWIND_MS`.
 * 4. Close the app — its shared state with it — the worker, the providers
 *    and the stores, in that order: none closes while work could use it.
 */
export function shutdownServer(app: FastifyInstance, options: ShutdownOptions = {}): Promise<void> {
  let shutdown = shutdowns.get(app);
  if (shutdown === undefined) {
    shutdown = drainAndClose(app, options);
    shutdowns.set(app, shutdown);
  }
  return shutdown;
}

async function drainAndClose(
  app: FastifyInstance,
  { drainMs = settings.SHUTDOWN_DRAIN_SECONDS * 1000, onStage = () => {} }: ShutdownOptions,
): Promise<void> {
  const { lifecycle, server } = app;
  onStage("drain");
  lifecycle.drain();
  server.close();
  server.closeIdleConnections();
  const worker = stopSearchWorker().catch((error: unknown) => {
    console.error("Stopping the search worker failed:", error);
  });
  if (!(await lifecycle.settled(drainMs))) {
    onStage("unwind");
    server.closeAllConnections();
    if (!(await lifecycle.settled(UNWIND_MS))) {
      console.warn("Shutdown: requests still running after their connections were cut");
    }
  }
  onStage("app");
  await app.close();
  onStage("search worker");
  await worker;
  onStage("providers");
  closeEmbeddingProvider();
  closeAiModel();
  onStage("stores");
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

  // Every signal joins the one shutdown; the first arms the hard exit.
  let stage: string | null = null;
  const stop = (signal: string) => {
    if (stage !== null) return;
    stage = "drain";
    const drainMs = settings.SHUTDOWN_DRAIN_SECONDS * 1000;
    console.log(`${signal}: draining for at most ${settings.SHUTDOWN_DRAIN_SECONDS} s`);
    setTimeout(() => {
      console.error(`Shutdown stalled at stage '${stage}'; exiting`);
      process.exit(1);
    }, drainMs + CLEANUP_MS).unref();
    shutdownServer(app, { drainMs, onStage: (next) => (stage = next) }).then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(`Shutdown failed at stage '${stage}':`, error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
