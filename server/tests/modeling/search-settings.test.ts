/**
 * Search settings over a mocked store: the keyword language set (validated,
 * canonical order) and the managed-index switches, both reconciled after a
 * change; an adapter without search indices answers FEATURE_DISABLED.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchSettings } from "../../src/core/ports.js";
import { createMockModelingStore, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getRuntimeStore: async () => ({}),
}));

const reconcile = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../src/runtime/indexing/generations.js", () => ({
  reconcileSearchGenerations: reconcile,
}));

const URL = "/api/ontologies/onto/model/search-settings";

/** A search-index store holding one managed and one custom index. */
function withSearchIndices(initial: SearchSettings) {
  let settings = initial;
  const indices = {
    ontologyKey: "onto",
    getSearchSettings: vi.fn(async () => settings),
    setSearchSettings: vi.fn(async (next: SearchSettings) => (settings = next)),
    listIndices: vi.fn(async () => [
      { key: "person~default", kind: "default" },
      { key: "note~body", kind: "passage" },
      { key: "people", kind: "custom" },
    ]),
  };
  (holder.store as unknown as { searchIndices: () => unknown }).searchIndices = () => indices;
  return indices;
}

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
  holder.store = createMockModelingStore();
  reconcile.mockClear();
});

describe("search settings", () => {
  it("reads the language set and the switched-off managed indices in key order", async () => {
    withSearchIndices({
      keywordLanguages: ["german", "english"],
      disabledDefaults: { "person~default": true, "note~body": true, "x~gone": false },
    });
    const res = await app.inject({ url: URL });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      keywordLanguages: ["german", "english"],
      disabledIndices: ["note~body", "person~default"],
    });
  });

  it("stores a language set in canonical order, keeps the switches and reconciles", async () => {
    const indices = withSearchIndices({
      keywordLanguages: ["english"],
      disabledDefaults: { "person~default": true },
    });
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { keywordLanguages: ["english", "german"] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      keywordLanguages: ["german", "english"],
      disabledIndices: ["person~default"],
    });
    expect(indices.setSearchSettings).toHaveBeenCalledWith({
      keywordLanguages: ["german", "english"],
      disabledDefaults: { "person~default": true },
    });
    expect(reconcile).toHaveBeenCalledWith("onto");
  });

  it("switches exactly the named managed indices off and keeps the languages", async () => {
    const indices = withSearchIndices({
      keywordLanguages: ["german"],
      disabledDefaults: { "person~default": true },
    });
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { disabledIndices: ["note~body"] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ keywordLanguages: ["german"], disabledIndices: ["note~body"] });
    expect(indices.setSearchSettings).toHaveBeenCalledWith({
      keywordLanguages: ["german"],
      disabledDefaults: { "note~body": true },
    });
  });

  it("rejects an invalid language set and writes nothing", async () => {
    const indices = withSearchIndices({ keywordLanguages: ["english"], disabledDefaults: {} });
    for (const keywordLanguages of [[], ["french"], ["german", "german"], "german"]) {
      const res = await app.inject({ method: "PUT", url: URL, payload: { keywordLanguages } });
      expect(res.statusCode, JSON.stringify(keywordLanguages)).toBe(422);
    }
    expect(indices.setSearchSettings).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("rejects switching an index that is not managed, by position, and writes nothing", async () => {
    const indices = withSearchIndices({ keywordLanguages: ["english"], disabledDefaults: {} });
    const res = await app.inject({
      method: "PUT",
      url: URL,
      payload: { keywordLanguages: ["german"], disabledIndices: ["person~default", "people", "nope"] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({
      "disabledIndices.1": "'people' is not a managed search index",
      "disabledIndices.2": "'nope' is not a managed search index",
    });
    expect(indices.setSearchSettings).not.toHaveBeenCalled();
  });

  it("an adapter without search indices answers FEATURE_DISABLED", async () => {
    for (const request of [
      { url: URL },
      { method: "PUT" as const, url: URL, payload: { keywordLanguages: ["german"] } },
    ]) {
      const res = await app.inject(request);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.code).toBe("FEATURE_DISABLED");
    }
  });
});
