/**
 * Metrics in Prometheus text format, served on a port of their own
 * (`METRICS_PORT`) — never on the client port, so no route there and no
 * access rule changes for them.
 *
 * One registry per process holds every metric. Requests are labelled by
 * route template, never by raw path or ontology, so the number of series
 * depends on the code alone (`docs/decisions.md#deployment`). A new metric
 * is defined here and registered on `registry`.
 */

import { createServer, type Server } from "node:http";

import type { FastifyInstance } from "fastify";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

export const registry = new Registry();

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
 * closed, so hijacked chat streams and MCP count as well, timed to their end.
 */
export function observeRequests(app: FastifyInstance): void {
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
}

/**
 * Listen on `port` and answer `GET /metrics` from the registry; anything
 * else answers 404. Also starts the process metrics (CPU, memory,
 * event-loop lag, garbage collection).
 */
export async function startMetricsServer(port: number): Promise<Server> {
  if (registry.getSingleMetric("process_cpu_seconds_total") === undefined) {
    collectDefaultMetrics({ register: registry });
  }
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url?.split("?")[0] !== "/metrics") {
      response.writeHead(404).end();
      return;
    }
    registry.metrics().then(
      (body) => response.writeHead(200, { "content-type": registry.contentType }).end(body),
      (error: unknown) => {
        console.error("Collecting metrics failed:", error);
        response.writeHead(500).end();
      },
    );
  });
  server.listen(port, "0.0.0.0");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}
