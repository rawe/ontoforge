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

const { registry } = await import("../../src/metrics.js");

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
