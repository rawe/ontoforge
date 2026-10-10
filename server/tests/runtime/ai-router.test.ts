/**
 * The AI routes over HTTP with a mocked store: the FEATURE_DISABLED
 * envelope (approved divergence #2: `details.code` alongside 422
 * VALIDATION_ERROR), the asymmetry that discovery answers without a
 * provider, and the chat stream.
 */

import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setAiModel } from "../../src/core/ai.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { NotFoundError, StoreError } from "../../src/core/exceptions.js";
import { FakeToolCallingModel, toolCallMessage } from "./aiHelpers.js";
import {
  createMockRuntimeStore,
  makeFullSchema,
  type MockRuntimeStore,
} from "./helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "test_lens" }));
  holder.store.getAiAgentConfigs.mockResolvedValue([
    {
      key: "my-agent",
      name: "My Agent",
      description: "A custom agent",
      systemPrompt: null,
      tools: null,
    },
  ]);
  invalidateLoadedSchemaCache();
});

afterEach(() => {
  setAiModel(null);
});

describe("FEATURE_DISABLED without a provider", () => {
  const cases: [string, string, Record<string, unknown>][] = [
    ["chat", "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/chat", { message: "Hi" }],
    [
      "agent chat",
      "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/agents/my-agent/chat",
      { message: "Hi" },
    ],
  ];

  for (const [name, url, payload] of cases) {
    it(`${name} answers 422 VALIDATION_ERROR with details.code FEATURE_DISABLED`, async () => {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "AI feature is disabled (AI_PROVIDER not configured)",
          details: { code: "FEATURE_DISABLED" },
        },
      });
    });
  }

  it("listing agents still works", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { key: "_default", name: "Knowledge Assistant", description: null },
      { key: "my-agent", name: "My Agent", description: "A custom agent" },
    ]);
  });
});

describe("chat wire shape", () => {
  it("a zero-tool turn returns one NDJSON final event", async () => {
    setAiModel(new FakeToolCallingModel([new AIMessage("Hello!")]));
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/chat",
      payload: { message: "Hi" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.body.trim().split("\n").map((line) => JSON.parse(line))).toEqual([{ type: "final", reply: "Hello!" }]);
  });

  it("an empty message is rejected with 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/chat",
      payload: { message: "" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("a history role outside user/assistant is rejected with 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/chat",
      payload: { message: "Hi", history: [{ role: "system", content: "x" }] },
    });
    expect(res.statusCode).toBe(422);
  });
});

const chatPath = "/api/ontologies/test_ont/runtime/lenses/test_lens/ai";
const events = (body: string) => body.trim().split("\n").map((line) => JSON.parse(line));

it("does not expose the removed decision-search endpoint", async () => {
  setAiModel(new FakeToolCallingModel([new AIMessage("Unused")]));
  const response = await app.inject({
    method: "POST", url: chatPath + "/decide", payload: { question: "Find something" },
  });
  expect(response.statusCode).toBe(404);
  expect(holder.store.getFullSchemaWithLensInclusions).not.toHaveBeenCalled();
});

for (const route of ["/chat", "/agents/my-agent/chat"]) {
  describe(`streaming lifecycle ${route}`, () => {
    it("correlates repeated tools and retains native results and invalid attempts", async () => {
      setAiModel(new FakeToolCallingModel([
        toolCallMessage("list_saved_queries", {}, "first"),
        toolCallMessage("list_saved_queries", {}, "second"),
        toolCallMessage("get_entity", { entity_type_key: 42 }, "invalid"),
        new AIMessage("Finished"),
      ]));
      const res = await app.inject({ method: "POST", url: chatPath + route, payload: { message: "Go" } });
      const stream = events(res.body);
      expect(stream.map((e) => e.type)).toEqual([
        "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "final",
      ]);
      expect(new Set(stream.filter((e) => e.type === "tool_call").map((e) => e.callId)).size).toBe(3);
      for (const i of [0, 2, 4]) expect(stream[i + 1].callId).toBe(stream[i].callId);
      expect(stream[1].result).toEqual([]);
      expect(stream[4].args).toEqual({ entity_type_key: 42 });
      expect(stream[5].result.error).toContain("Invalid arguments");
      expect(stream[6]).toEqual({ type: "final", reply: "Finished" });
    });

    it("keeps recoverable errors with their calls and terminates after a later storage failure", async () => {
      holder.store.getEntity.mockRejectedValueOnce(new NotFoundError("Entity missing"))
        .mockRejectedValueOnce(new StoreError("A storage operation failed", "trace-1"));
      setAiModel(new FakeToolCallingModel([
        toolCallMessage("list_saved_queries", {}),
        toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "missing" }, "missing"),
        toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "broken" }, "broken"),
        new AIMessage("Must not appear"),
      ]));
      const res = await app.inject({ method: "POST", url: chatPath + route, payload: { message: "Go" } });
      const stream = events(res.body);
      expect(stream.map((e) => e.type)).toEqual(["tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "error"]);
      expect(stream[1].result).toEqual([]);
      expect(stream[3].result).toEqual({ error: "Entity missing" });
      expect(stream[5]).toEqual({ type: "error", error: {
        code: "STORAGE_ERROR", message: "A storage operation failed", details: { errorId: "trace-1" },
      } });
    });
  });
}

function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function connectChat(route: string, signal?: AbortSignal) {
  const response = await fetch(app.listeningOrigin + chatPath + route, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Go" }), signal,
  });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  return {
    async next() {
      while (!buffer.includes("\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Unexpected EOF");
        buffer += chunk.value;
      }
      const end = buffer.indexOf("\n");
      const event = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      return event;
    },
    reader,
  };
}

for (const route of ["/chat", "/agents/my-agent/chat"]) {
  it(`delivers parallel results independently before the final answer: ${route}`, async () => {
    const slow = gate<Record<string, unknown>>();
    const final = gate();
    const model = new FakeToolCallingModel([
      new AIMessage({ content: "", tool_calls: [
        { name: "get_entity", args: { entity_type_key: "person", entity_id: "slow" }, id: "slow", type: "tool_call" },
        { name: "get_entity", args: { entity_type_key: "person", entity_id: "fast" }, id: "fast", type: "tool_call" },
      ] }), new AIMessage("Complete answer"),
    ]);
    model.beforeResponse = async (messages) => {
      if (messages.some((m) => m.getType() === "tool")) await final.promise;
    };
    holder.store.getEntity.mockImplementation(async (_type, id) => id === "slow" ? slow.promise : { _id: "fast", name: "Zoë", age: null });
    setAiModel(model);
    const client = await connectChat(route);
    try {
      const calls = [await client.next(), await client.next()];
      expect(calls.map((e) => e.type)).toEqual(["tool_call", "tool_call"]);
      const fast = await client.next();
      expect(fast).toEqual({ type: "tool_result", callId: calls.find((e) => e.args.entity_id === "fast").callId,
        result: { _id: "fast", name: "Zoë", age: null } });
      slow.resolve({ _id: "slow", name: "Later" });
      const later = await client.next();
      expect(later.type).toBe("tool_result");
      expect(later.result).toEqual({ _id: "slow", name: "Later" });
      final.resolve();
      expect(await client.next()).toEqual({ type: "final", reply: "Complete answer" });
      expect((await client.reader.read()).done).toBe(true);
    } finally {
      slow.resolve({ _id: "slow" }); final.resolve();
      await client.reader.cancel();
    }
  });

  it(`disconnect cancels the running model and prevents its later tool work: ${route}`, async () => {
    const entered = gate();
    const cancelled = gate();
    const release = gate();
    let providerSignal: AbortSignal | undefined;
    const model = new FakeToolCallingModel([
      toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "never" }),
      new AIMessage("Never"),
    ]);
    model.beforeResponse = async (_messages, signal) => {
      providerSignal = signal;
      signal!.addEventListener("abort", () => cancelled.resolve(), { once: true });
      entered.resolve();
      await release.promise;
    };
    setAiModel(model);
    const controller = new AbortController();
    const client = await connectChat(route, controller.signal);
    try {
      await entered.promise;
      controller.abort();
      await cancelled.promise;
      expect(providerSignal?.aborted).toBe(true);
      release.resolve();
      await expect(client.reader.read()).rejects.toThrow();
      // Drain model completion, then verify no requested storage work escaped cancellation.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(holder.store.getEntity).not.toHaveBeenCalled();
    } finally { release.resolve(); }
  });
}

it("unknown lens and agent are ordinary pre-stream JSON errors", async () => {
  setAiModel(new FakeToolCallingModel([new AIMessage("No")]));
  const ghost = await app.inject({ method: "POST", url: chatPath + "/agents/ghost/chat", payload: { message: "Hi" } });
  expect(ghost.statusCode).toBe(404);
  expect(ghost.json().error.code).toBe("RESOURCE_NOT_FOUND");
  holder.store.getFullSchemaWithLensInclusions.mockRejectedValue(new NotFoundError("Lens missing"));
  invalidateLoadedSchemaCache();
  const lens = await app.inject({ method: "POST", url: chatPath + "/chat", payload: { message: "Hi" } });
  expect(lens.statusCode).toBe(404);
  expect(lens.json()).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Lens missing" } });
});

it("unexpected failures never expose raw exceptions, but are logged", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  holder.store.getEntity.mockRejectedValue(new Error("secret provider details"));
  setAiModel(new FakeToolCallingModel([toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "broken" })]));
  const response = await app.inject({ method: "POST", url: chatPath + "/chat", payload: { message: "Hi" } });
  expect(events(response.body).at(-1)).toEqual({ type: "error", error: { code: "INTERNAL_ERROR", message: "Internal Server Error" } });
  expect(response.body).not.toContain("secret");
  expect(logged).toHaveBeenCalledWith("Chat stream failed:", expect.objectContaining({ message: "secret provider details" }));
  logged.mockRestore();
});

it("disconnect during storage work prevents a follow-up model call and handles late completion", async () => {
  const entered = gate();
  const cancelled = gate();
  const observeClose = (_req: unknown, res: import("node:http").ServerResponse) => {
    res.once("close", () => cancelled.resolve());
  };
  app.server.once("request", observeClose);
  const release = gate<Record<string, unknown>>();
  holder.store.getEntity.mockImplementation(async () => { entered.resolve(); return release.promise; });
  const model = new FakeToolCallingModel([
    toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "slow" }),
    toolCallMessage("list_saved_queries", {}, "later"),
    new AIMessage("Never"),
  ]);
  const laterModel = vi.fn();
  model.beforeResponse = async (messages) => {
    if (messages.some((message) => message.getType() === "tool")) laterModel();
  };
  setAiModel(model);
  const controller = new AbortController();
  const client = await connectChat("/chat", controller.signal);
  expect((await client.next()).type).toBe("tool_call");
  await entered.promise;
  controller.abort();
  await expect(client.reader.read()).rejects.toThrow();
  await cancelled.promise;
  release.resolve({ _id: "slow", name: "Late" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(laterModel).not.toHaveBeenCalled();
});

it("delivers a root string result without JSON double encoding", async () => {
  setAiModel(new FakeToolCallingModel([
    toolCallMessage("get_schema", {}), new AIMessage("Schema ready"),
  ]));
  const res = await app.inject({ method: "POST", url: chatPath + "/chat", payload: { message: "Schema" } });
  const stream = events(res.body);
  expect(stream[1].result).toMatch(/^Lens: HR View/);
  expect(stream[1].result).toContain("\nEntity types:\n");
  expect(stream.at(-1)).toEqual({ type: "final", reply: "Schema ready" });
});

it("terminates an oversized result with one public error instead of buffering it", async () => {
  holder.store.getEntity.mockResolvedValue({ _id: "huge", name: "x".repeat(8 * 1024 * 1024) });
  setAiModel(new FakeToolCallingModel([
    toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "huge" }),
    new AIMessage("Must not appear"),
  ]));
  const res = await app.inject({ method: "POST", url: chatPath + "/chat", payload: { message: "Go" } });
  const stream = events(res.body);
  expect(stream.map((event) => event.type)).toEqual(["tool_call", "error"]);
  expect(stream[1].error).toEqual({ code: "VALIDATION_ERROR", message: "Chat stream exceeded its buffer limit" });
});
