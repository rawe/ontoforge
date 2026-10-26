/**
 * Metrics in Prometheus text format at `/metrics`, beside the probes on the
 * client port. Like the probes it is for the platform, not for clients: the
 * ingress keeps it internal (`docs/interfaces.md#exposure`).
 *
 * One registry per process holds every metric. Requests are labelled by
 * route template, never by raw path or ontology, so the number of series
 * depends on the code alone. A new metric is defined here and registered
 * on `registry`.
 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { FastifyInstance } from "fastify";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

export const registry = new Registry();

// Process metrics: CPU, memory, event-loop lag, garbage collection.
collectDefaultMetrics({ register: registry });

const httpRequests = new Counter({
  name: "ontoforge_http_requests_total",
  help: "HTTP requests answered, by method, route template and status code.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

const httpDuration = new Histogram({
  name: "ontoforge_http_request_duration_seconds",
  help: "Time from request to closed response, by method, route template and status code.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const dbPoolConnections = new Gauge({
  name: "ontoforge_db_pool_connections",
  help: "Database pool connections by pool and state: total open, idle, and requests waiting for one.",
  labelNames: ["pool", "state"] as const,
  registers: [registry],
  collect() {
    for (const [name, read] of pools) {
      const pool = read();
      if (pool === null) continue;
      this.set({ pool: name, state: "total" }, pool.totalCount);
      this.set({ pool: name, state: "idle" }, pool.idleCount);
      this.set({ pool: name, state: "waiting" }, pool.waitingCount);
    }
  },
});

const searchQueueItems = new Gauge({
  name: "ontoforge_search_queue_items",
  help: "Search queue items of every ontology, pending or failed for good, as of this server's last full worker pass.",
  labelNames: ["state"] as const,
  registers: [registry],
});

const searchItems = new Counter({
  name: "ontoforge_search_items_total",
  help: "Search queue items this server's worker processed, by outcome.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

const searchEntries = new Counter({
  name: "ontoforge_search_entries_total",
  help: "Search entries this server's worker wrote, by representation.",
  labelNames: ["representation"] as const,
  registers: [registry],
});

const providerDuration = new Histogram({
  name: "ontoforge_provider_request_duration_seconds",
  help: "Calls to an external model provider, by provider and outcome.",
  labelNames: ["provider", "outcome"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

/** The connection counts a database pool reports. */
export interface PoolCounts {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/** Every pool reported, by name; `null` while that pool is closed. */
const pools = new Map<string, () => PoolCounts | null>();

/** Report the pool `read` returns under `name`, read at every scrape. */
export function observePool(name: string, read: () => PoolCounts | null): void {
  pools.set(name, read);
}

/** The search queue as one full worker pass saw it. */
export function recordSearchQueue(pending: number, failed: number): void {
  searchQueueItems.set({ state: "pending" }, pending);
  searchQueueItems.set({ state: "failed" }, failed);
}

export function countSearchItems(outcome: "completed" | "failed" | "released", count: number): void {
  if (count > 0) searchItems.inc({ outcome }, count);
}

export function countSearchEntries(representation: string, count: number): void {
  if (count > 0) searchEntries.inc({ representation }, count);
}

/** The external model providers whose calls are timed. */
export type Provider = "embedding" | "ai" | "decision";

/** Time `call` as one request to `provider`; a throw counts as an error. */
export async function timeProviderCall<T>(provider: Provider, call: () => Promise<T>): Promise<T> {
  const end = providerDuration.startTimer({ provider });
  try {
    const result = await call();
    end({ outcome: "ok" });
    return result;
  } catch (exc) {
    end({ outcome: "error" });
    throw exc;
  }
}

/** Times every call of a LangChain chat model, streamed ones to their end. */
export class ProviderCallMetrics extends BaseCallbackHandler {
  name = "ontoforge-provider-metrics";
  private readonly running = new Map<string, (labels: { outcome: string }) => void>();

  constructor(private readonly provider: Provider) {
    super();
  }

  override handleChatModelStart(_llm: unknown, _messages: unknown, runId: string): void {
    this.running.set(runId, providerDuration.startTimer({ provider: this.provider }));
  }

  override handleLLMEnd(_output: unknown, runId: string): void {
    this.running.get(runId)?.({ outcome: "ok" });
    this.running.delete(runId);
  }

  override handleLLMError(_error: unknown, runId: string): void {
    this.running.get(runId)?.({ outcome: "error" });
    this.running.delete(runId);
  }
}

/** The label a request without a matching route counts under. */
export const UNMATCHED = "unmatched";

/** The status of a request whose connection closed before any response was sent. */
export const ABORTED = "aborted";

/**
 * Count and time every request of `app` until its response closes —
 * closed, so hijacked chat streams and MCP count as well, timed to their
 * end — and serve the registry at `GET /metrics`.
 */
export function serveMetrics(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const end = httpDuration.startTimer();
    reply.raw.once("close", () => {
      const labels = {
        method: request.method,
        route: request.routeOptions.url ?? UNMATCHED,
        // Before headers are sent, `statusCode` is only Node's default 200.
        status: reply.raw.headersSent ? String(reply.raw.statusCode) : ABORTED,
      };
      httpRequests.inc(labels);
      end(labels);
    });
  });
  app.get("/metrics", { schema: { hide: true } }, async (_request, reply) =>
    reply.header("content-type", registry.contentType).send(await registry.metrics()),
  );
}
