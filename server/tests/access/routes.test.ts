/**
 * The route table (`access/routes.ts`): every route the app registers —
 * with authentication off, and on with user management mounted — has a
 * need, and the needs follow the table of the design.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Need } from "../../src/access/caller.js";
import { needOf } from "../../src/access/routes.js";
import type { AuthRuntime } from "../../src/auth/runtime.js";

/** Every `METHOD url` each app registered, as its routes register. */
const registered = vi.hoisted(() => new WeakMap<object, string[]>());

vi.mock("fastify", async (original) => {
  const fastify = await original<typeof import("fastify")>();
  const collecting = ((options: object) => {
    const app = fastify.default(options);
    const routes: string[] = [];
    registered.set(app, routes);
    app.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) routes.push(`${method} ${route.url}`);
    });
    return app;
  }) as unknown as typeof fastify.default;
  return { ...fastify, default: collecting };
});

const { createApp } = await import("../../src/app.js");

function routesOf(app: FastifyInstance): string[] {
  return registered.get(app)!;
}

const FAKE_AUTH = {
  settings: {
    issuer: "http://issuer.test/realms/x",
    publicUrl: "http://localhost:8000",
    webClientUrl: "http://localhost:5173",
    clientSecret: "test-secret-test-secret-test-secret",
  },
  oidc: {},
  sessions: {},
  access: { close: async () => {} },
} as unknown as AuthRuntime;

describe("every registered route has a need", () => {
  let off: FastifyInstance;
  let on: FastifyInstance;

  beforeAll(async () => {
    off = await createApp();
    on = await createApp(undefined, FAKE_AUTH);
    await Promise.all([off.ready(), on.ready()]);
  });

  afterAll(async () => {
    await Promise.all([off.close(), on.close()]);
  });

  it("with authentication off and on", () => {
    const offRoutes = routesOf(off);
    const onRoutes = routesOf(on);
    expect(offRoutes.length).toBeGreaterThan(200);
    // Authentication on registers every route of off, and user management.
    expect(offRoutes.filter((route) => !onRoutes.includes(route))).toEqual([]);
    expect(onRoutes).toContain("GET /api/users");
    expect(onRoutes).toContain("GET /api/ontologies/:ontologyKey/access");
    const missing = onRoutes.filter((route) => {
      const [method, url] = route.split(" ") as [string, string];
      return needOf(method, url) === undefined;
    });
    expect(missing).toEqual([]);
  });

  it("counts per kind of need (authentication on)", () => {
    const counts: Record<string, number> = {};
    for (const route of routesOf(on)) {
      const [method, url] = route.split(" ") as [string, string];
      if (method === "HEAD") continue;
      const need = needOf(method, url)!;
      const kind = need.kind === "lens" ? `lens:${need.operation}${need.orAdmin ? "+admin" : ""}` : need.kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    expect(counts).toEqual({
      public: 19,
      "signed-in": 1,
      platform: 1,
      "user-admin": 7,
      "ontology-member": 2,
      "ontology-admin": 62,
      "lens:read+admin": 14,
      "lens:read": 74,
      "lens:stage": 18,
      "lens:commit": 2,
      "lens:write": 20,
    });
  });
});

describe("needOf", () => {
  const O = "/api/ontologies/:ontologyKey";
  const L = `${O}/runtime/lenses/:lensKey`;
  const M = `${L}/rulesets/:rulesetKey`;
  const read: Need = { kind: "lens", operation: "read" };
  const design: Need = { kind: "lens", operation: "read", orAdmin: true };

  it.each([
    ["GET", "/livez", { kind: "public" }],
    ["GET", "/metrics", { kind: "public" }],
    ["GET", "/docs/static/index.html", { kind: "public" }],
    ["OPTIONS", "*", { kind: "public" }],
    ["GET", "/api/server/info", { kind: "public" }],
    ["GET", "/api/auth/me", { kind: "public" }],
    ["POST", "/api/auth/logout", { kind: "public" }],
    ["GET", "/.well-known/oauth-protected-resource/*", { kind: "public" }],
    ["GET", "/api/ontologies", { kind: "signed-in" }],
    ["HEAD", "/api/ontologies", { kind: "signed-in" }],
    ["POST", "/api/ontologies", { kind: "platform", role: "ontology_creator" }],
    ["GET", O, { kind: "ontology-member" }],
    ["PATCH", O, { kind: "ontology-admin" }],
    ["DELETE", O, { kind: "ontology-admin" }],
    ["GET", `${O}/access`, { kind: "user-admin" }],
    ["GET", "/api/users", { kind: "user-admin" }],
    ["DELETE", "/api/users/:userId/assignments/:assignmentId", { kind: "user-admin" }],
    ["GET", `${O}/model/lenses`, { kind: "ontology-member" }],
    ["POST", `${O}/model/lenses`, { kind: "ontology-admin" }],
    ["GET", `${O}/model/lenses/:lensId`, design],
    ["PUT", `${O}/model/lenses/:lensId`, { kind: "ontology-admin" }],
    ["GET", `${O}/model/lenses/:lensId/includes/entity-types`, design],
    ["POST", `${O}/model/lenses/:lensId/includes/entity-types`, { kind: "ontology-admin" }],
    ["GET", `${O}/model/lenses/:lensKey/assistants/retrievers`, design],
    ["GET", `${O}/model/lenses/:lensKey/saved-queries`, design],
    ["PUT", `${O}/model/lenses/:lensKey/saved-queries/:queryKey`, { kind: "ontology-admin" }],
    ["GET", `${O}/model/entity-types`, { kind: "ontology-admin" }],
    ["GET", `${O}/model/export`, { kind: "ontology-admin" }],
    ["GET", `${O}/runtime/rulesets/`, design],
    ["GET", `${O}/runtime/rulesets/:rulesetKey`, design],
    ["PUT", `${O}/runtime/rulesets/:rulesetKey`, { kind: "ontology-admin" }],
    ["GET", `${L}/entities/:entityTypeKey`, read],
    ["POST", `${L}/entities/:entityTypeKey`, { kind: "lens", operation: "write" }],
    ["POST", `${L}/search/entities`, read],
    ["POST", `${L}/query`, read],
    ["POST", `${L}/changesets/`, { kind: "lens", operation: "stage" }],
    ["POST", `${L}/changesets/:changesetId/commit`, { kind: "lens", operation: "commit" }],
    ["POST", `${L}/ai/assistants/agents/:assistantKey/chat`, read],
    ["POST", `${L}/ai/assistants/retrievers/:assistantKey/retrieve`, read],
    ["GET", `${L}/ai/assistants/navigators/:assistantKey/threads/:threadId`, read],
    ["POST", `${L}/decisions/compare-entities`, read],
    ["GET", `${M}/`, read],
    ["PATCH", `${M}/entities/:entityTypeKey/:entityId`, { kind: "lens", operation: "write" }],
    ["POST", `${M}/changesets/:changesetId/commit`, { kind: "lens", operation: "commit" }],
    ["POST", "/mcp/ontologies/:ontologyKey/model", { kind: "ontology-admin" }],
    ["POST", "/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey", read],
    ["DELETE", "/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey/rulesets/:rulesetKey", read],
  ] as [string, string, Need][])("%s %s", (method, url, need) => {
    expect(needOf(method, url)).toEqual(need);
  });

  it.each([
    ["GET", "/"],
    ["GET", "/api/nope"],
    ["PUT", "/api/ontologies"],
    ["PUT", "/api/ontologies/:ontologyKey"],
    ["GET", `${L}/nope`],
    ["PUT", `${L}/entities/:entityTypeKey`],
    ["GET", `${L}/`],
    ["GET", "/mcp/nope"],
  ])("%s %s has none", (method, url) => {
    expect(needOf(method, url)).toBeUndefined();
  });
});
