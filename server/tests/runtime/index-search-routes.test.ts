/**
 * The runtime index-search routes: `POST /search` checks the body's shape
 * (domain rules are the service's, by field) and hands it on; `GET
 * /search-indices` returns the lens's catalog. The services are stubbed.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  searchByIndices: vi.fn(),
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
  stubs.searchByIndices.mockReset().mockResolvedValue({ query: "x", mode: "keyword", hits: [] });
  stubs.searchIndexCatalog.mockReset().mockResolvedValue([]);
});

describe("POST /search", () => {
  it("hands the whole body to the index search", async () => {
    const body = {
      indices: ["person_employment"],
      query: "CTO ACME",
      mode: "hybrid",
      relations: ["works_for"],
      filters: { status: "active", "works_for:out.name": "ACME" },
      minScore: 0.6,
      limit: 5,
      fields: ["name"],
    };
    const res = await app.inject({ method: "POST", url: `${RUNTIME}/search`, payload: body });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ query: "x", mode: "keyword", hits: [] });
    expect(stubs.searchByIndices).toHaveBeenCalledWith("all", body, expect.anything());
  });

  it("refuses a body of the wrong shape with the validation envelope", async () => {
    for (const payload of [
      {},
      { query: "x", indices: "person_employment" },
      { query: "x", filters: { since: 2020 } },
      { query: "x", limit: "10" },
      // The body is closed: an unknown key is refused, not ignored.
      { query: "x", bogus: 1, type: "event" },
    ]) {
      const res = await app.inject({ method: "POST", url: `${RUNTIME}/search`, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
    expect(stubs.searchByIndices).not.toHaveBeenCalled();
  });
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
