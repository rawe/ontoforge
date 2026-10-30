/**
 * The runtime search catalog route: `GET /search-indices` returns the
 * lens's catalog. The service is stubbed.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  searchIndexCatalog: vi.fn(),
}));

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => ({ ontologyKey: "test_ont" }),
}));
vi.mock("../../src/runtime/service.js", async (original) => ({
  ...(await original<object>()),
  ...stubs,
}));

const RUNTIME = "/api/ontologies/test_ont/runtime/lenses/all";
let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  stubs.searchIndexCatalog.mockReset().mockResolvedValue([]);
});

describe("GET /search-indices", () => {
  it("returns the lens's catalog", async () => {
    stubs.searchIndexCatalog.mockResolvedValue([{ key: "person~default" }]);
    const res = await app.inject({ url: `${RUNTIME}/search-indices` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ key: "person~default" }]);
    expect(stubs.searchIndexCatalog).toHaveBeenCalledWith("all", expect.anything());
  });
});
