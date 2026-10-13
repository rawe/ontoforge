/**
 * The navigator routes over mocked stores: the runtime list, chat (refused
 * before the stream when there is no model, the navigator is unknown or
 * invalid in its lens; otherwise the stream keeps the contract), its
 * threads — and modeling CRUD with validation reported on every read.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../../../src/core/exceptions.js";
import { invalidateLoadedSchemaCache } from "../../../../src/runtime/schemaCache.js";
import { createMockModelingStore, type MockModelingStore } from "../../../modeling/helpers.js";
import { createMockRuntimeStore, makeFullSchema, NOW, type MockRuntimeStore } from "../../helpers.js";

const stores = vi.hoisted(() => ({ runtime: null as unknown, modeling: null as unknown }));
const model = vi.hoisted(() => ({ requireLanguageModel: vi.fn() }));
const run = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/core/ports.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getRuntimeStore: async () => stores.runtime,
  getModelingStore: async () => stores.modeling,
}));
vi.mock("../../../../src/runtime/assistants/kit/model.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  requireLanguageModel: model.requireLanguageModel,
}));
vi.mock("../../../../src/runtime/assistants/navigators/index.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  run,
}));

import {
  NAVIGATOR_DEFAULT_DESCRIPTION,
  NAVIGATOR_TOPOLOGY,
  type NavigatorTurn,
} from "../../../../src/runtime/assistants/navigators/index.js";

const RUNTIME = "/api/ontologies/one/runtime/lenses/main/ai/assistants/navigators";
const MODEL = "/api/ontologies/one/model/lenses/main/assistants/navigators";
const DEFAULTS = { hops: 2, relationTypes: null, anchorTypes: null, maxEntities: 40, instructions: null };
const record = (key: string, config: unknown, extra: Record<string, unknown> = {}) => ({
  navigatorId: `id-${key}`, key, name: key[0]!.toUpperCase() + key.slice(1), description: null,
  configVersion: 1, config, createdAt: NOW, updatedAt: NOW, ...extra,
});

let app: FastifyInstance;
let runtime: MockRuntimeStore;
let modeling: MockModelingStore;

beforeAll(async () => {
  const { createApp } = await import("../../../../src/app.js");
  app = await createApp();
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => {
  vi.clearAllMocks();
  invalidateLoadedSchemaCache();
  runtime = createMockRuntimeStore("one");
  runtime.getFullSchemaWithLensInclusions.mockImplementation(async (lensKey: string) =>
    lensKey === "main" ? makeFullSchema({ lensKey: "main" }) : null);
  modeling = createMockModelingStore();
  modeling.getLensByKey.mockImplementation(async (key: string) => (key === "main" ? { lensId: "lens-1", key } : null));
  // Modeling's navigators are the runtime's: one store per ontology.
  (modeling as unknown as { navigatorStore: unknown }).navigatorStore = runtime.navigatorStore;
  modeling.navigators.mockReturnValue(runtime.navigatorStore);
  stores.runtime = runtime;
  stores.modeling = modeling;
  run.mockImplementation(async (turn: NavigatorTurn) => {
    await turn.trace.delta("Answer");
    return "Answer";
  });
});

const lines = (body: string) => body.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

describe("runtime list", () => {
  it("names the default first, built in, then the stored navigators — no model needed", async () => {
    runtime.navigatorStore.listNavigators.mockResolvedValue([record("walker", { hops: 9 })]);
    const response = await app.inject({ method: "GET", url: RUNTIME });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { key: "_default", name: "Default", description: NAVIGATOR_DEFAULT_DESCRIPTION, builtIn: true },
      { key: "walker", name: "Walker", description: null, builtIn: false },
    ]);
    expect(model.requireLanguageModel).not.toHaveBeenCalled();
  });

  it("an unknown lens is not found; an unknown assistant kind has no route", async () => {
    expect((await app.inject({ method: "GET", url: RUNTIME.replace("/main/", "/nope/") })).statusCode).toBe(404);
    const unknown = await app.inject({ method: "GET", url: RUNTIME.replace("navigators", "analysts") });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.message).toBe("Not Found");
  });
});

describe("runtime chat", () => {
  it("without a language model answers FEATURE_DISABLED before reading anything", async () => {
    model.requireLanguageModel.mockImplementationOnce(() => {
      throw new ValidationError("AI feature is disabled (AI_PROVIDER not configured)", { code: "FEATURE_DISABLED" });
    });
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/walker/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json().error.details.code).toBe("FEATURE_DISABLED");
    expect(runtime.getFullSchemaWithLensInclusions).not.toHaveBeenCalled();
    expect(runtime.navigatorStore.getNavigator).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("the unit environment has no model: the real check refuses", async () => {
    model.requireLanguageModel.mockImplementationOnce(
      (await vi.importActual<typeof import("../../../../src/runtime/assistants/kit/model.js")>(
        "../../../../src/runtime/assistants/kit/model.js",
      )).requireLanguageModel,
    );
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/_default/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.code).toBe("FEATURE_DISABLED");
  });

  it("an unknown navigator is not found before the stream", async () => {
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/ghost/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe("Navigator 'ghost' not found");
    expect(run).not.toHaveBeenCalled();
  });

  it("a stored navigator the lens can no longer run answers 422 with every error before the stream", async () => {
    runtime.navigatorStore.getNavigator.mockResolvedValue(record("walker", { relationTypes: ["ghost"], anchorTypes: ["robot"] }));
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/walker/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json().error.details.errors).toEqual([
      "relationTypes: the lens shows no relation type 'ghost'",
      "anchorTypes: the lens shows no entity type 'robot'",
    ]);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the stored navigator and keeps the stream contract: thread, graph, …, final", async () => {
    runtime.navigatorStore.getNavigator.mockResolvedValue(record("walker", { hops: 3 }));
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/walker/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/x-ndjson");
    const events = lines(response.body);
    expect(events).toEqual([
      { type: "thread", threadId: expect.any(String) },
      { type: "navigator.graph", ...NAVIGATOR_TOPOLOGY },
      { type: "delta", text: "Answer" },
      { type: "final", reply: "Answer" },
    ]);
    const turn = run.mock.calls[0]![0] as NavigatorTurn;
    expect([turn.key, turn.config, turn.lensKey, turn.message]).toEqual(["walker", { ...DEFAULTS, hops: 3 }, "main", "Who?"]);
    expect(turn.thread.threadId).toBe(events[0]!.threadId);
    expect(runtime.navigatorStore.getNavigator).toHaveBeenCalledWith("lens-1", "walker");
  });

  it("runs the built-in default without reading the store", async () => {
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/_default/chat`, payload: { message: "Who?" } });
    expect(lines(response.body).at(-1)).toEqual({ type: "final", reply: "Answer" });
    expect((run.mock.calls[0]![0] as NavigatorTurn).config).toEqual(DEFAULTS);
    expect(runtime.navigatorStore.getNavigator).not.toHaveBeenCalled();
  });

  it("refuses a configuration, unknown fields, an empty message and one over 2,000 characters", async () => {
    for (const payload of [
      { message: "Who?", config: { hops: 3 } },
      { message: "Who?", history: [] },
      { message: "" },
      { message: "x".repeat(2001) },
      {},
    ]) {
      const response = await app.inject({ method: "POST", url: `${RUNTIME}/_default/chat`, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("a failing turn ends the stream with an error event", async () => {
    run.mockRejectedValueOnce(new ValidationError("The language model failed while answering; no automatic retry."));
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/_default/chat`, payload: { message: "Who?" } });
    const events = lines(response.body);
    expect(events[0]).toMatchObject({ type: "thread" });
    expect(events.at(-1)).toMatchObject({ type: "error", error: { message: "The language model failed while answering; no automatic retry." } });
  });
});

describe("runtime threads", () => {
  const started = async (key = "_default") => {
    const response = await app.inject({ method: "POST", url: `${RUNTIME}/${key}/chat`, payload: { message: "Who?" } });
    return lines(response.body)[0]!.threadId as string;
  };

  it("continues a thread by its id; refuses an unknown one or another navigator's", async () => {
    const threadId = await started();
    const again = await app.inject({ method: "POST", url: `${RUNTIME}/_default/chat`, payload: { message: "And?", threadId } });
    expect(lines(again.body)[0]).toEqual({ type: "thread", threadId });
    runtime.navigatorStore.getNavigator.mockResolvedValue(record("walker", {}));
    for (const [key, id] of [["_default", "no-such-thread"], ["walker", threadId]] as const) {
      const response = await app.inject({ method: "POST", url: `${RUNTIME}/${key}/chat`, payload: { message: "And?", threadId: id } });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.details).toEqual({ code: "THREAD_NOT_FOUND" });
    }
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses a message to a thread still running with THREAD_BUSY", async () => {
    const threadId = await started();
    let finish!: () => void;
    run.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve("Done"); }));
    const running = app.inject({ method: "POST", url: `${RUNTIME}/_default/chat`, payload: { message: "Slow", threadId } });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    const busy = await app.inject({ method: "POST", url: `${RUNTIME}/_default/chat`, payload: { message: "Meanwhile", threadId } });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.details).toEqual({ code: "THREAD_BUSY" });
    finish();
    expect((await running).body).toContain('"type":"final"');
  });

  it("reads a thread without a language model, refusing an unknown one", async () => {
    const threadId = await started();
    model.requireLanguageModel.mockClear();
    const response = await app.inject({ method: "GET", url: `${RUNTIME}/_default/threads/${threadId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ threadId, messages: [] });
    expect(model.requireLanguageModel).not.toHaveBeenCalled();
    const missing = await app.inject({ method: "GET", url: `${RUNTIME}/_default/threads/nope` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.details).toEqual({ code: "THREAD_NOT_FOUND" });
  });
});

describe("modeling CRUD", () => {
  const write = (config: unknown = {}, extra: Record<string, unknown> = {}) =>
    ({ name: "Walker", description: "Walks", configVersion: 1, config, ...extra });

  it("PUT creates (201) with the configuration parsed and stored as version 1", async () => {
    runtime.navigatorStore.saveNavigator.mockImplementation(async (_lensId: string, navigator: Record<string, unknown>) =>
      [{ ...navigator, createdAt: NOW, updatedAt: NOW }, true]);
    const response = await app.inject({ method: "PUT", url: `${MODEL}/walker`, payload: write({ hops: 1, relationTypes: ["works_for"] }) });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toEqual({
      key: "walker",
      name: "Walker",
      description: "Walks",
      configVersion: 1,
      config: { ...DEFAULTS, hops: 1, relationTypes: ["works_for"] },
      lensKey: "main",
      validation: { valid: true, errors: [], warnings: [] },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const [lensId, saved, createOnly] = runtime.navigatorStore.saveNavigator.mock.calls[0]!;
    expect([lensId, createOnly]).toEqual(["lens-1", false]);
    expect(saved).toMatchObject({ key: "walker", configVersion: 1, config: { ...DEFAULTS, hops: 1, relationTypes: ["works_for"] } });
  });

  it("PUT replaces (200)", async () => {
    runtime.navigatorStore.saveNavigator.mockImplementation(async (_lensId: string, navigator: Record<string, unknown>) =>
      [{ ...navigator, createdAt: NOW, updatedAt: NOW }, false]);
    const response = await app.inject({ method: "PUT", url: `${MODEL}/walker`, payload: write() });
    expect(response.statusCode).toBe(200);
    expect(response.json().description).toBe("Walks");
  });

  it("PUT refuses an invalid configuration with every error and writes nothing", async () => {
    for (const [config, configVersion, errors] of [
      [{ relationTypes: ["ghost", "works_for", "works_for"], anchorTypes: ["robot"] }, 1, [
        "relationTypes: the lens shows no relation type 'ghost'",
        "relationTypes: 'works_for' is listed more than once",
        "anchorTypes: the lens shows no entity type 'robot'",
      ]],
      [{}, 2, ["Configuration version 2 is not supported; this release runs version 1"]],
    ] as const) {
      const response = await app.inject({ method: "PUT", url: `${MODEL}/walker`, payload: write(config, { configVersion }) });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.details.errors).toEqual(errors);
      expect(response.json().error.message).toBe(`Invalid navigator configuration: ${errors.join("; ")}`);
    }
    const shape = await app.inject({ method: "PUT", url: `${MODEL}/walker`, payload: write({ hops: 4, maxEntities: 100 }) });
    expect(shape.statusCode).toBe(422);
    expect(shape.json().error.details.errors).toHaveLength(2);
    expect(runtime.navigatorStore.saveNavigator).not.toHaveBeenCalled();
  });

  it("PUT refuses the built-in key, a leading underscore and malformed keys", async () => {
    for (const key of ["_default", "_mine", "Walker", "1walker", "x".repeat(65)]) {
      const response = await app.inject({ method: "PUT", url: `${MODEL}/${key}`, payload: write() });
      expect(response.statusCode, key).toBe(422);
      expect(response.json().error.message, key).toContain(`Invalid navigator key '${key}'`);
    }
    expect((await app.inject({ method: "PUT", url: `${MODEL}/${"x".repeat(64)}`, payload: write() })).statusCode).not.toBe(422);
  });

  it("PUT refuses unknown fields, a missing or long name", async () => {
    for (const payload of [
      write({}, { extra: true }),
      { description: null, configVersion: 1, config: {} },
      write({}, { name: "" }),
      write({}, { name: "n".repeat(201) }),
      write({}, { description: "d".repeat(4001) }),
      write({}, { configVersion: 1.5 }),
    ]) {
      const response = await app.inject({ method: "PUT", url: `${MODEL}/walker`, payload });
      expect(response.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(422);
    }
    expect(runtime.navigatorStore.saveNavigator).not.toHaveBeenCalled();
  });

  it("GET reports validation on every read: a stored navigator the lens cannot run stays readable", async () => {
    runtime.navigatorStore.listNavigators.mockResolvedValue([
      record("broken", { relationTypes: ["ghost"] }),
      record("old", { hops: 2 }, { configVersion: 7 }),
      record("walker", { hops: 2 }),
    ]);
    const list = await app.inject({ method: "GET", url: MODEL });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((n: { key: string; validation: unknown }) => [n.key, n.validation])).toEqual([
      ["broken", { valid: false, errors: ["relationTypes: the lens shows no relation type 'ghost'"], warnings: [] }],
      ["old", { valid: false, errors: ["Configuration version 7 is not supported; this release runs version 1"], warnings: [] }],
      ["walker", { valid: true, errors: [], warnings: [] }],
    ]);
    // Kept as stored.
    expect(list.json()[1].config).toEqual({ hops: 2 });

    runtime.navigatorStore.getNavigator.mockResolvedValueOnce(record("broken", { relationTypes: ["ghost"] }));
    const one = await app.inject({ method: "GET", url: `${MODEL}/broken` });
    expect(one.json()).toMatchObject({ key: "broken", lensKey: "main", validation: { valid: false } });
    expect((await app.inject({ method: "GET", url: `${MODEL}/ghost` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: MODEL.replace("/main/", "/nope/") })).statusCode).toBe(404);
  });

  it("DELETE answers 204, or 404 for an unknown navigator or lens", async () => {
    runtime.navigatorStore.deleteNavigator.mockResolvedValueOnce(true);
    expect((await app.inject({ method: "DELETE", url: `${MODEL}/walker` })).statusCode).toBe(204);
    expect(runtime.navigatorStore.deleteNavigator).toHaveBeenCalledWith("lens-1", "walker");
    const missing = await app.inject({ method: "DELETE", url: `${MODEL}/walker` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.message).toBe("Navigator 'walker' not found");
    expect((await app.inject({ method: "DELETE", url: `${MODEL.replace("/main/", "/nope/")}/walker` })).statusCode).toBe(404);
  });
});
