import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { settings } from "../../src/config.js";

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => ({}),
  supportsKeywordRanking: async () => false,
  supportsSearchIndices: async () => false,
}));

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const configured = settings.PUBLIC_URL;
let app: FastifyInstance;

beforeAll(async () => { app = await (await import("../../src/app.js")).createApp(); await app.ready(); });
afterAll(async () => app.close());
afterEach(() => { settings.PUBLIC_URL = configured; });

describe("GET /api/server/info", () => {
  it("reports the package version and a null base URL when PUBLIC_URL is unset", async () => {
    settings.PUBLIC_URL = null;
    const res = await app.inject({ url: "/api/server/info" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ baseUrl: null, version });
  });

  it("reports PUBLIC_URL as the base URL without a trailing slash", async () => {
    settings.PUBLIC_URL = "https://api.example.com/";
    expect((await app.inject({ url: "/api/server/info" })).json().baseUrl).toBe("https://api.example.com");
  });
});
