/**
 * The retriever runtime routes: the list, chat, its threads and
 * retrieve, where the saved retriever is resolved on the server before the
 * stream opens, a request cannot carry a configuration, the stream keeps
 * its contract, a thread is started, continued or refused before the
 * stream opens, and retrieve answers one plain JSON body. Removed routes
 * are gone.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../../../src/core/exceptions.js";

const runtime = { ontologyKey: "one" };
const pipeline = vi.hoisted(() => ({
  loadRunnableRetriever: vi.fn(),
  chat: vi.fn(),
  retrieveQuestion: vi.fn(),
  requireLanguageModel: vi.fn(),
  requireRetrievers: vi.fn(),
  listRuntimeRetrievers: vi.fn(),
}));
vi.mock("../../../../src/core/ports.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getRuntimeStore: async () => runtime,
}));
vi.mock("../../../../src/runtime/assistants/retrievers/runtime.js", () => pipeline);

const BASE = "/api/ontologies/one/runtime/lenses/main";
const agent = { key: "find", config: { indices: [] } };
let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../../../src/app.js");
  app = await createApp();
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => {
  vi.clearAllMocks();
  pipeline.loadRunnableRetriever.mockResolvedValue(agent);
});

describe("retriever list route", () => {
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

describe("retriever chat route", () => {
  it("runs the saved retriever and keeps the stream contract", async () => {
    pipeline.chat.mockImplementationOnce(async (...args: unknown[]) => {
      const execution = args[3] as { onToolEvent(event: Record<string, unknown>): Promise<void> };
      await execution.onToolEvent({ type: "delta", text: "Answer" });
      return { reply: "Answer" };
    });
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload: { message: "Who?", diagnostics: true } });
    expect(response.headers["content-type"]).toBe("application/x-ndjson");
    const events = response.body.trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toEqual([
      { type: "thread", threadId: expect.any(String) },
      { type: "delta", text: "Answer" },
      { type: "final", reply: "Answer" },
    ]);
    expect(pipeline.loadRunnableRetriever).toHaveBeenCalledWith("main", "find", runtime);
    const [ran, message, thread, , diagnostics] = pipeline.chat.mock.calls[0]!;
    expect([ran, message, diagnostics]).toEqual([agent, "Who?", true]);
    expect(thread).toMatchObject({ threadId: events[0].threadId });
  });

  it("refuses a configuration, a history, a follow-up token, unknown fields and a message over 2,000 characters", async () => {
    for (const payload of [
      { message: "Who?", config: { indices: [] } },
      { message: "Who?", history: [] },
      { message: "Who?", turnToken: "t" },
      { message: "Who?", diagnostics: "yes" },
      { message: "x".repeat(2001) },
    ]) {
      const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(pipeline.chat).not.toHaveBeenCalled();
  });

  it("answers a retriever the lens cannot run with a plain 422 before streaming", async () => {
    pipeline.loadRunnableRetriever.mockRejectedValueOnce(new ValidationError("Retriever 'find' is invalid in this lens"));
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain("invalid in this lens");
    expect(pipeline.chat).not.toHaveBeenCalled();
  });

  it("without a language model answers FEATURE_DISABLED before reading the retriever or streaming", async () => {
    pipeline.requireLanguageModel.mockImplementationOnce(() => {
      throw new ValidationError("AI feature is disabled (AI_PROVIDER not configured)", { code: "FEATURE_DISABLED" });
    });
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/find/chat`, payload: { message: "Who?" } });
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json().error.details.code).toBe("FEATURE_DISABLED");
    expect(pipeline.loadRunnableRetriever).not.toHaveBeenCalled();
    expect(pipeline.chat).not.toHaveBeenCalled();
  });

  it("no longer serves the prototype's prepare, catalog or retriever routes", async () => {
    for (const [method, url] of [
      ["POST", `${BASE}/retrievers/find/prepare`],
      ["POST", `${BASE}/retrievers/find/chat`],
      ["GET", `${BASE}/ai/retriever/catalog`],
      ["GET", "/api/ontologies/one/model/lenses/main/retrievers"],
      ["POST", `${BASE}/retrievers/find/chat`],
      ["POST", `${BASE}/retrievers/find/retrieve`],
    ] as const) {
      const response = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
      expect(response.statusCode, url).toBe(404);
      // The router's own 404, not an unknown ontology or lens.
      expect(response.json().error.message).toBe("Not Found");
    }
  });
});

describe("retriever threads", () => {
  const chatUrl = (key: string) => `${BASE}/ai/assistants/retrievers/${key}/chat`;
  const started = async (key = "find") => {
    pipeline.chat.mockResolvedValueOnce({ reply: "Answer" });
    const response = await app.inject({ method: "POST", url: chatUrl(key), payload: { message: "Who?" } });
    return JSON.parse(response.body.split("\n")[0]!).threadId as string;
  };

  it("continues a thread by its id, and refuses an unknown or foreign one with THREAD_NOT_FOUND before streaming", async () => {
    const threadId = await started();
    pipeline.chat.mockResolvedValueOnce({ reply: "Again" });
    const again = await app.inject({ method: "POST", url: chatUrl("find"), payload: { message: "And?", threadId } });
    expect(JSON.parse(again.body.split("\n")[0]!)).toEqual({ type: "thread", threadId });
    for (const [key, id] of [["find", "no-such-thread"], ["_default", threadId]] as const) {
      const response = await app.inject({ method: "POST", url: chatUrl(key), payload: { message: "And?", threadId: id } });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.details).toEqual({ code: "THREAD_NOT_FOUND" });
    }
    expect(pipeline.chat).toHaveBeenCalledTimes(2);
  });

  it("refuses a message to a thread still running with THREAD_BUSY before streaming", async () => {
    const threadId = await started();
    let finish!: () => void;
    pipeline.chat.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ reply: "Done" }); }));
    const running = app.inject({ method: "POST", url: chatUrl("find"), payload: { message: "Slow", threadId } });
    await vi.waitFor(() => expect(pipeline.chat).toHaveBeenCalledTimes(2));
    const busy = await app.inject({ method: "POST", url: chatUrl("find"), payload: { message: "Meanwhile", threadId } });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toMatchObject({ code: "RESOURCE_CONFLICT", details: { code: "THREAD_BUSY" } });
    finish();
    expect((await running).body).toContain('"type":"final"');
    expect(pipeline.chat).toHaveBeenCalledTimes(2);
  });

  it("reads a thread without a language model, and refuses an unknown one with THREAD_NOT_FOUND", async () => {
    const threadId = await started();
    pipeline.requireLanguageModel.mockClear();
    const response = await app.inject({ method: "GET", url: `${BASE}/ai/assistants/retrievers/find/threads/${threadId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ threadId, messages: [] });
    expect(pipeline.requireRetrievers).toHaveBeenCalledWith("main", runtime);
    expect(pipeline.requireLanguageModel).not.toHaveBeenCalled();
    const missing = await app.inject({ method: "GET", url: `${BASE}/ai/assistants/retrievers/_default/threads/${threadId}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.details).toEqual({ code: "THREAD_NOT_FOUND" });
  });

  it("reading answers FEATURE_DISABLED on an adapter without search indices", async () => {
    pipeline.requireRetrievers.mockRejectedValueOnce(
      new ValidationError("Search indices are not supported by the active storage adapter", { code: "FEATURE_DISABLED" }),
    );
    const response = await app.inject({ method: "GET", url: `${BASE}/ai/assistants/retrievers/find/threads/any` });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.details).toEqual({ code: "FEATURE_DISABLED" });
  });
});

describe("retriever retrieve route", () => {
  const url = `${BASE}/ai/assistants/retrievers/find/retrieve`;

  it("runs the saved retriever once and answers its results as JSON", async () => {
    const body = { results: [], limitations: [], unsupportedReason: "No salaries." };
    pipeline.retrieveQuestion.mockResolvedValueOnce(body);
    const response = await app.inject({ method: "POST", url, payload: { query: "Salaries?" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(body);
    expect(pipeline.loadRunnableRetriever).toHaveBeenCalledWith("main", "find", runtime);
    expect(pipeline.retrieveQuestion.mock.calls[0]!.slice(0, 2)).toEqual([agent, "Salaries?"]);
    expect(pipeline.retrieveQuestion.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
  });

  it("serves the default retriever's key", async () => {
    pipeline.retrieveQuestion.mockResolvedValueOnce({ results: [], limitations: [] });
    const response = await app.inject({ method: "POST", url: `${BASE}/ai/assistants/retrievers/_default/retrieve`, payload: { query: "Who?" } });
    expect(response.statusCode).toBe(200);
    expect(pipeline.loadRunnableRetriever).toHaveBeenCalledWith("main", "_default", runtime);
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

  it("answers errors as chat does: invalid retriever, no language model", async () => {
    pipeline.loadRunnableRetriever.mockRejectedValueOnce(new ValidationError("Retriever 'find' is invalid in this lens", { errors: ["x"] }));
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
