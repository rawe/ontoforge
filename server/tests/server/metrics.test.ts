import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => ({}),
  supportsKeywordRanking: async () => false,
}));

const { observePool, ProviderCallMetrics, registry, timeProviderCall } = await import("../../src/metrics.js");

let app: FastifyInstance;
/** Resolved once `/test/slow` is entered; its handler then waits for `release`. */
let entered: Promise<void>;
let enter = (): void => {};
let release = (): void => {};

beforeAll(async () => {
  app = await (await import("../../src/app.js")).createApp();
  app.get("/test/slow", async () => {
    enter();
    await new Promise<void>((resolve) => (release = resolve));
    return { done: true };
  });
  await app.ready();
});
afterAll(async () => {
  release();
  await app.close();
});

/** The value of the request counter for these labels, 0 when it has none. */
async function requests(labels: Record<string, string>): Promise<number> {
  const metric = await registry.getSingleMetric("ontoforge_http_requests_total")!.get();
  const match = metric.values.find((value) =>
    Object.entries(labels).every(([name, wanted]) => value.labels[name] === wanted),
  );
  return match?.value ?? 0;
}

describe("request metrics", () => {
  it("count a request under its route template and status code", async () => {
    const before = await requests({ method: "GET", route: "/livez", status: "200" });
    await app.inject({ url: "/livez" });
    expect(await requests({ method: "GET", route: "/livez", status: "200" })).toBe(before + 1);
  });

  it("label a path parameter by its template, never by its value", async () => {
    await app.inject({ url: "/api/ontologies/some-ontology" });
    const metric = await registry.getSingleMetric("ontoforge_http_requests_total")!.get();
    const routes = metric.values.map((value) => value.labels.route);
    expect(routes).toContain("/api/ontologies/:ontologyKey");
    expect(routes.some((route) => String(route).includes("some-ontology"))).toBe(false);
  });

  it("count a request without a route as unmatched", async () => {
    const before = await requests({ route: "unmatched", status: "404" });
    await app.inject({ url: "/no/such/route" });
    expect(await requests({ route: "unmatched", status: "404" })).toBe(before + 1);
  });

  it("count a request whose client left before any response as aborted, never as 200", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    entered = new Promise((resolve) => (enter = resolve));
    const client = httpRequest({ port, path: "/test/slow" });
    client.on("error", () => {});
    client.end();
    await entered;
    client.destroy();
    for (let i = 0; i < 50 && (await requests({ route: "/test/slow" })) === 0; i++) await sleep(10);
    expect(await requests({ route: "/test/slow", status: "aborted" })).toBe(1);
    expect(await requests({ route: "/test/slow", status: "200" })).toBe(0);
  });
});

describe("GET /metrics", () => {
  it("serves the registry in Prometheus text format", async () => {
    await app.inject({ url: "/livez" });
    const res = await app.inject({ url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain('ontoforge_http_requests_total{method="GET",route="/livez",status="200"}');
    expect(res.body).toContain("ontoforge_http_request_duration_seconds_bucket");
    expect(res.body).toContain("nodejs_eventloop_lag_seconds");
  });

  it("is not part of the OpenAPI description", async () => {
    const spec = (await app.inject({ url: "/openapi.json" })).json();
    expect(Object.keys(spec.paths)).not.toContain("/metrics");
  });
});

/** The observation count of the provider histogram for these labels. */
async function providerCalls(labels: Record<string, string>): Promise<number> {
  const metric = await registry.getSingleMetric("ontoforge_provider_request_duration_seconds")!.get();
  const match = metric.values.find(
    (value) =>
      value.metricName === "ontoforge_provider_request_duration_seconds_count" &&
      Object.entries(labels).every(([name, wanted]) => value.labels[name] === wanted),
  );
  return match?.value ?? 0;
}

describe("provider metrics", () => {
  it("time a call by its outcome, and pass its result or error through", async () => {
    const ok = await providerCalls({ provider: "embedding", outcome: "ok" });
    const error = await providerCalls({ provider: "embedding", outcome: "error" });
    expect(await timeProviderCall("embedding", async () => 42)).toBe(42);
    await expect(timeProviderCall("embedding", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    expect(await providerCalls({ provider: "embedding", outcome: "ok" })).toBe(ok + 1);
    expect(await providerCalls({ provider: "embedding", outcome: "error" })).toBe(error + 1);
  });

  it("time a chat model call from its start to its end or error", async () => {
    const handler = new ProviderCallMetrics("ai");
    const ok = await providerCalls({ provider: "ai", outcome: "ok" });
    const error = await providerCalls({ provider: "ai", outcome: "error" });
    handler.handleChatModelStart({}, [], "run-1");
    handler.handleChatModelStart({}, [], "run-2");
    handler.handleLLMEnd({}, "run-1");
    handler.handleLLMError(new Error("down"), "run-2");
    handler.handleLLMEnd({}, "run-unknown");
    expect(await providerCalls({ provider: "ai", outcome: "ok" })).toBe(ok + 1);
    expect(await providerCalls({ provider: "ai", outcome: "error" })).toBe(error + 1);
  });
});

describe("pool metrics", () => {
  it("read a pool's counts at scrape time, and skip a closed one", async () => {
    let counts: { totalCount: number; idleCount: number; waitingCount: number } | null = {
      totalCount: 4,
      idleCount: 1,
      waitingCount: 2,
    };
    observePool("test", () => counts);
    const body = (await app.inject({ url: "/metrics" })).body;
    expect(body).toContain('ontoforge_db_pool_connections{pool="test",state="total"} 4');
    expect(body).toContain('ontoforge_db_pool_connections{pool="test",state="waiting"} 2');
    counts = { totalCount: 5, idleCount: 5, waitingCount: 0 };
    expect((await app.inject({ url: "/metrics" })).body).toContain(
      'ontoforge_db_pool_connections{pool="test",state="total"} 5',
    );
  });
});
