/**
 * The retriever-agent runtime routes: the list, and chat and retrieve,
 * where the saved agent is resolved on the server before the stream opens,
 * a request cannot carry a configuration, the stream keeps its contract,
 * and retrieve answers one plain JSON body. Removed routes are gone.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../../src/core/exceptions.js";

const runtime = { ontologyKey: "one" };
const pipeline = vi.hoisted(() => ({
  loadRunnableAgent: vi.fn(),
  chat: vi.fn(),
  retrieveQuestion: vi.fn(),
  requireLanguageModel: vi.fn(),
  listRuntimeRetrievers: vi.fn(),
}));
vi.mock("../../../src/core/ports.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getRuntimeStore: async () => runtime,
}));
vi.mock("../../../src/runtime/retrieverAgents/runtime.js", () => pipeline);

const BASE = "/api/ontologies/one/runtime/lenses/main";
const agent = { key: "find", config: { indices: [] } };
let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../../src/app.js");
  app = await createApp();
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => {
  vi.clearAllMocks();
  pipeline.loadRunnableAgent.mockResolvedValue(agent);
});

describe("retriever agent list route", () => {
  it("answers the list without a language model", async () => {
    const list = [
      { key: "_default", name: "Default", description: null, builtIn: true },
      { key: "find", name: "Find", description: null, builtIn: false },
    ];
    pipeline.listRuntimeRetrievers.mockResolvedValueOnce(list);
    const response = await app.inject({ method: "GET", url: `${BASE}/ai/assistants/retrievers` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(list);
    expect(pipeline.listRuntimeRetrievers).toHaveBeenCalledWith("main", runtime);
    expect(pipeline.requireLanguageModel).not.toHaveBeenCalled();
  });
});

describe("retriever agent chat route", () => {
  it("runs the saved agent and keeps the stream contract", async () => {
    pipeline.chat.mockImplementationOnce(async (...args: unknown[]) => {
      const execution = args[4] as { onToolEvent(event: Record<string, unknown>): Promise<void> };
      await execution.onToolEvent({ type: "delta", text: "Answer" });
      return { reply: "Answer" };
    });
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload: { message: "Who?", history: [] } });
    expect(response.headers["content-type"]).toBe("application/x-ndjson");
    expect(response.body.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { type: "delta", text: "Answer" },
      { type: "final", reply: "Answer" },
    ]);
    expect(pipeline.loadRunnableAgent).toHaveBeenCalledWith("main", "find", runtime);
    expect(pipeline.chat.mock.calls[0]!.slice(0, 4)).toEqual(["main", agent, "Who?", []]);
  });

  it("refuses a request that carries a configuration", async () => {
    const response = await app.inject({
      method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload: { message: "Who?", config: { indices: [] } },
    });
    expect(response.statusCode).toBe(422);
    expect(pipeline.chat).not.toHaveBeenCalled();
  });

  it("answers an agent the lens cannot run with a plain 422 before streaming", async () => {
    pipeline.loadRunnableAgent.mockRejectedValueOnce(new ValidationError("Retriever agent 'find' is invalid in this lens"));
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain("invalid in this lens");
    expect(pipeline.chat).not.toHaveBeenCalled();
  });

  it("without a language model answers FEATURE_DISABLED before reading the agent or streaming", async () => {
    pipeline.requireLanguageModel.mockImplementationOnce(() => {
      throw new ValidationError("AI feature is disabled (AI_PROVIDER not configured)", { code: "FEATURE_DISABLED" });
    });
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json().error.details.code).toBe("FEATURE_DISABLED");
    expect(pipeline.loadRunnableAgent).not.toHaveBeenCalled();
    expect(pipeline.chat).not.toHaveBeenCalled();
  });

  it("no longer serves the prototype's prepare, catalog or retriever routes", async () => {
    for (const [method, url] of [
      ["POST", `${BASE}/retrievers/find/prepare`],
      ["POST", `${BASE}/retrievers/find/chat`],
      ["GET", `${BASE}/ai/retriever/catalog`],
      ["GET", "/api/ontologies/one/model/lenses/main/retrievers"],
      ["POST", `${BASE}/retriever-agents/find/chat`],
      ["POST", `${BASE}/retriever-agents/find/retrieve`],
    ] as const) {
      const response = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
      expect(response.statusCode, url).toBe(404);
      // The router's own 404, not an unknown ontology or lens.
      expect(response.json().error.message).toBe("Not Found");
    }
  });
});

describe("retriever agent retrieve route", () => {
  const url = `${BASE}/ai/assistants/retrievers/find/retrieve`;

  it("runs the saved agent once and answers its results as JSON", async () => {
    const body = { results: [], limitations: [], unsupportedReason: "No salaries." };
    pipeline.retrieveQuestion.mockResolvedValueOnce(body);
    const response = await app.inject({ method: "POST", url, payload: { query: "Salaries?" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(body);
    expect(pipeline.loadRunnableAgent).toHaveBeenCalledWith("main", "find", runtime);
    expect(pipeline.retrieveQuestion.mock.calls[0]!.slice(0, 2)).toEqual([agent, "Salaries?"]);
    expect(pipeline.retrieveQuestion.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
  });

  it("serves the default agent's key", async () => {
    pipeline.retrieveQuestion.mockResolvedValueOnce({ results: [], limitations: [] });
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/_default/retrieve`, payload: { query: "Who?" } });
    expect(response.statusCode).toBe(200);
    expect(pipeline.loadRunnableAgent).toHaveBeenCalledWith("main", "_default", runtime);
  });

  it("rejects unknown fields, history, diagnostics and an empty or long query", async () => {
    for (const payload of [
      { query: "Who?", config: { indices: [] } },
      { query: "Who?", history: [] },
      { query: "Who?", turnToken: "t" },
      { query: "Who?", diagnostics: true },
      { question: "Who?" },
      { query: "" },
      { query: "x".repeat(2001) },
      {},
    ]) {
      const response = await app.inject({ method: "POST", url, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(pipeline.retrieveQuestion).not.toHaveBeenCalled();
  });

  it("answers errors as chat does: invalid agent, no language model", async () => {
    pipeline.loadRunnableAgent.mockRejectedValueOnce(new ValidationError("Retriever agent 'find' is invalid in this lens", { errors: ["x"] }));
    const invalid = await app.inject({ method: "POST", url, payload: { query: "Who?" } });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.details.errors).toEqual(["x"]);
    pipeline.requireLanguageModel.mockImplementationOnce(() => {
      throw new ValidationError("AI feature is disabled (AI_PROVIDER not configured)", { code: "FEATURE_DISABLED" });
    });
    const disabled = await app.inject({ method: "POST", url, payload: { query: "Who?" } });
    expect(disabled.json().error.details.code).toBe("FEATURE_DISABLED");
    expect(pipeline.retrieveQuestion).not.toHaveBeenCalled();
  });
});
