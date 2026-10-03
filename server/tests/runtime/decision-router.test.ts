import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { settings } from "../../src/config.js";
import { setDecisionModel } from "../../src/core/decision.js";
import { NotFoundError } from "../../src/core/exceptions.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeFullSchema } from "./helpers.js";

const holder = { store: createMockRuntimeStore() };
vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async (key: string) => {
    if (key === "missing") throw new NotFoundError("Ontology not found");
    return holder.store;
  },
  supportsKeywordRanking: async () => false,
}));
const decide = vi.fn(async () => ({ identity: { type: "choice" as const, choice: "same",
  probabilities: { same: 0.8, different: 0.1, insufficient: 0.1 }, confidence: 0.8 } }));
const url = "/api/ontologies/test_ont/runtime/lenses/test_lens/decisions/compare-entities";
const payload = { entityTypeKey: "person", left: { name: "Jane" }, right: { name: "Jane Doe" } };
let app: FastifyInstance;
beforeAll(async () => { app = await (await import("../../src/app.js")).createApp(); await app.ready(); });
afterAll(async () => app.close());
beforeEach(() => {
  holder.store = createMockRuntimeStore();
  holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "test_lens" }));
  invalidateLoadedSchemaCache();
  decide.mockClear();
  setDecisionModel({ decide });
});
afterEach(() => { setDecisionModel(null); });

describe("identity REST surface", () => {
  it("works and advertises its own capability with AI and embeddings disabled", async () => {
    expect(settings.AI_PROVIDER).toBeNull();
    expect(settings.EMBEDDING_PROVIDER).toBeNull();
    const features = (await app.inject({ url: "/api/server/features" })).json();
    expect(features).toMatchObject({ ai: false, semanticSearch: false, entityIdentityComparison: true });
    const result = await app.inject({ method: "POST", url, payload });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ decision: "same", probabilities: { same: 0.8, different: 0.1, insufficient: 0.1 },
      confidence: 0.8, truncatedFields: [] });
  });

  it("advertises disabled and returns the existing FEATURE_DISABLED envelope", async () => {
    setDecisionModel(null);
    expect((await app.inject({ url: "/api/server/features" })).json().entityIdentityComparison).toBe(false);
    const result = await app.inject({ method: "POST", url, payload });
    expect(result.statusCode).toBe(422);
    expect(result.json().error).toMatchObject({ code: "VALIDATION_ERROR", details: { code: "FEATURE_DISABLED" } });
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload, left: { name: [] } },
    { ...payload, right: { name: {} } },
    { ...payload, left: "snapshot" },
    { ...payload, leftId: "ent-1" },
    { left: {}, right: {} },
  ])("rejects invalid shapes and IDs rather than silently changing context", async (body) => {
    const result = await app.inject({ method: "POST", url, payload: body });
    expect(result.statusCode).toBe(422);
    expect(result.json().error.code).toBe("VALIDATION_ERROR");
    expect(decide).not.toHaveBeenCalled();
  });

  it("returns ordinary not-found semantics for unknown ontology and lens", async () => {
    let result = await app.inject({ method: "POST", url: url.replace("test_ont", "missing"), payload });
    expect(result.statusCode).toBe(404);
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(null);
    invalidateLoadedSchemaCache();
    result = await app.inject({ method: "POST", url, payload });
    expect(result.statusCode).toBe(404);
    expect(result.json().error.code).toBe("RESOURCE_NOT_FOUND");
    expect(decide).not.toHaveBeenCalled();
  });

  it("keeps provider error details out of the public response", async () => {
    decide.mockRejectedValueOnce(new Error("provider-private detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await app.inject({ method: "POST", url, payload });
      expect(result.statusCode).toBe(500);
      expect(result.body).toBe("Internal Server Error");
      expect(result.body).not.toContain("provider-private");
      expect(decide).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
});
