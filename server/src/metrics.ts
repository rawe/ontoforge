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

import type { FastifyInstance } from "fastify";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

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

/** The label a request without a matching route counts under. */
export const UNMATCHED = "unmatched";

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
        status: String(reply.raw.statusCode),
      };
      httpRequests.inc(labels);
      end(labels);
    });
  });
  app.get("/metrics", { schema: { hide: true } }, async (_request, reply) =>
    reply.header("content-type", registry.contentType).send(await registry.metrics()),
  );
}
