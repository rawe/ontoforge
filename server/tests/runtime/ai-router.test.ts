/**
 * The agent routes over HTTP with a mocked store: the FEATURE_DISABLED
 * envelope (`details.code` alongside 422 VALIDATION_ERROR), the list
 * answering without a provider, the built-in default addressed by its key,
 * the chat stream, and chat on threads: starting, continuing, refusing an
 * unknown or busy thread, atomic turns, and reading a thread back.
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
    ["default chat", "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/assistants/agents/_default/chat", { message: "Hi" }],
    [
      "agent chat",
      "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/assistants/agents/my-agent/chat",
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
    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/assistants/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { key: "_default", name: "Default", description: null, builtIn: true },
      { key: "my-agent", name: "My Agent", description: "A custom agent", builtIn: false },
    ]);
  });
});

describe("removed routes", () => {
  it.each([
    ["POST", "/ai/chat"],
    ["GET", "/ai/agents"],
    ["POST", "/ai/agents/my-agent/chat"],
    ["POST", "/ai/agents/_default/chat"],
    ["POST", "/retriever-agents/find/chat"],
    ["POST", "/retriever-agents/find/retrieve"],
  ] as const)("%s %s answers 404", async (method, path) => {
    setAiModel(new FakeToolCallingModel([new AIMessage("Unused")]));
    const res = await app.inject({
      method,
      url: `/api/ontologies/test_ont/runtime/lenses/test_lens${path}`,
      ...(method === "POST" ? { payload: { message: "Hi" } } : {}),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("Not Found");
  });
});

describe("chat wire shape", () => {
  it("a zero-tool turn returns one NDJSON final event", async () => {
    setAiModel(new FakeToolCallingModel([new AIMessage("Hello!")]));
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/assistants/agents/_default/chat",
      payload: { message: "Hi" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.body.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { type: "thread", threadId: expect.any(String) },
      { type: "final", reply: "Hello!" },
    ]);
  });

  it("an empty message is rejected with 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/assistants/agents/_default/chat",
      payload: { message: "" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("unknown fields, a history among them, and a message over 2,000 characters are rejected with 422", async () => {
    setAiModel(new FakeToolCallingModel([new AIMessage("Unused")]));
    for (const payload of [
      { message: "Hi", history: [{ role: "user", content: "x" }] },
      { message: "Hi", turnToken: "t" },
      { message: "x".repeat(2001) },
      { message: "Hi", threadId: 42 },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/assistants/agents/_default/chat",
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
    }
  });
});

const chatPath = "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/assistants/agents";
const events = (body: string) => body.trim().split("\n").map((line) => JSON.parse(line));

/** A turn's events after the leading `thread` event. */
function turnEvents(body: string) {
  const [thread, ...rest] = events(body);
  expect(thread).toEqual({ type: "thread", threadId: expect.any(String) });
  return rest;
}

it("does not expose the removed decision-search endpoint", async () => {
  setAiModel(new FakeToolCallingModel([new AIMessage("Unused")]));
  const response = await app.inject({
    method: "POST", url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/decide", payload: { question: "Find something" },
  });
  expect(response.statusCode).toBe(404);
  expect(holder.store.getFullSchemaWithLensInclusions).not.toHaveBeenCalled();
});

for (const route of ["/_default/chat", "/my-agent/chat"]) {
  describe(`streaming lifecycle ${route}`, () => {
    it("correlates repeated tools and retains native results and invalid attempts", async () => {
      setAiModel(new FakeToolCallingModel([
        toolCallMessage("list_saved_queries", {}, "first"),
        toolCallMessage("list_saved_queries", {}, "second"),
        toolCallMessage("get_entity", { entity_type_key: 42 }, "invalid"),
        new AIMessage("Finished"),
      ]));
      const res = await app.inject({ method: "POST", url: chatPath + route, payload: { message: "Go" } });
      const stream = turnEvents(res.body);
      expect(stream.map((e) => e.type)).toEqual([
        "agent.tool_call", "agent.tool_result", "agent.tool_call", "agent.tool_result", "agent.tool_call", "agent.tool_result", "final",
      ]);
      expect(new Set(stream.filter((e) => e.type === "agent.tool_call").map((e) => e.callId)).size).toBe(3);
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
      const stream = turnEvents(res.body);
      expect(stream.map((e) => e.type)).toEqual(["agent.tool_call", "agent.tool_result", "agent.tool_call", "agent.tool_result", "agent.tool_call", "error"]);
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

/** Opens a chat stream and reads its leading `thread` event. */
async function connectChat(route: string, signal?: AbortSignal, body: Record<string, unknown> = { message: "Go" }) {
  const response = await fetch(app.listeningOrigin + chatPath + route, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal,
  });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const next = async () => {
    while (!buffer.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("Unexpected EOF");
      buffer += chunk.value;
    }
    const end = buffer.indexOf("\n");
    const event = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    return event;
  };
  const thread = await next();
  expect(thread.type).toBe("thread");
  return { next, reader, threadId: thread.threadId as string };
}

for (const route of ["/_default/chat", "/my-agent/chat"]) {
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
      expect(calls.map((e) => e.type)).toEqual(["agent.tool_call", "agent.tool_call"]);
      const fast = await client.next();
      expect(fast).toEqual({ type: "agent.tool_result", callId: calls.find((e) => e.args.entity_id === "fast").callId,
        result: { _id: "fast", name: "Zoë", age: null } });
      slow.resolve({ _id: "slow", name: "Later" });
      const later = await client.next();
      expect(later.type).toBe("agent.tool_result");
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
  const ghost = await app.inject({ method: "POST", url: chatPath + "/ghost/chat", payload: { message: "Hi" } });
  expect(ghost.statusCode).toBe(404);
  expect(ghost.json().error.code).toBe("RESOURCE_NOT_FOUND");
  holder.store.getFullSchemaWithLensInclusions.mockRejectedValue(new NotFoundError("Lens missing"));
  invalidateLoadedSchemaCache();
  const lens = await app.inject({ method: "POST", url: chatPath + "/_default/chat", payload: { message: "Hi" } });
  expect(lens.statusCode).toBe(404);
  expect(lens.json()).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Lens missing" } });
});

it("unexpected failures never expose raw exceptions, but are logged", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  holder.store.getEntity.mockRejectedValue(new Error("secret provider details"));
  setAiModel(new FakeToolCallingModel([toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "broken" })]));
  const response = await app.inject({ method: "POST", url: chatPath + "/_default/chat", payload: { message: "Hi" } });
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
  const client = await connectChat("/_default/chat", controller.signal);
  expect((await client.next()).type).toBe("agent.tool_call");
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
  const res = await app.inject({ method: "POST", url: chatPath + "/_default/chat", payload: { message: "Schema" } });
  const stream = turnEvents(res.body);
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
  const res = await app.inject({ method: "POST", url: chatPath + "/_default/chat", payload: { message: "Go" } });
  const stream = turnEvents(res.body);
  expect(stream.map((event) => event.type)).toEqual(["agent.tool_call", "error"]);
  expect(stream[1].error).toEqual({ code: "VALIDATION_ERROR", message: "Chat stream exceeded its buffer limit" });
});

describe("chat on threads", () => {
  const threadUrl = (agent: string, threadId: string) => `${chatPath}/${agent}/threads/${threadId}`;
  const chat = (agent: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `${chatPath}/${agent}/chat`, payload });
  const read = async (agent: string, threadId: string) => app.inject({ method: "GET", url: threadUrl(agent, threadId) });

  it("a message without a thread id starts a thread; one with its id continues it", async () => {
    const model = new FakeToolCallingModel([new AIMessage("Alice is here."), new AIMessage("She is 30.")]);
    setAiModel(model);
    const first = events((await chat("_default", { message: "Who is here?" })).body);
    const threadId = first[0].threadId as string;
    const second = events((await chat("_default", { message: "How old is she?", threadId })).body);
    expect(second).toEqual([{ type: "thread", threadId }, { type: "final", reply: "She is 30." }]);
    expect(model.calls[1]!.map((m) => String(m.content)).slice(1)).toEqual(["Who is here?", "Alice is here.", "How old is she?"]);
    // A message without an id always starts another thread.
    const other = events((await chat("_default", { message: "Hi" })).body);
    expect(other[0].threadId).not.toBe(threadId);
  });

  it("an unknown thread, or one of another assistant, answers THREAD_NOT_FOUND before the stream opens", async () => {
    const model = new FakeToolCallingModel([new AIMessage("Hello!")]);
    setAiModel(model);
    const threadId = events((await chat("_default", { message: "Hi" })).body)[0].threadId as string;
    for (const [agent, id] of [["_default", "no-such-thread"], ["my-agent", threadId]] as const) {
      const res = await chat(agent, { message: "Again", threadId: id });
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.json()).toEqual({ error: {
        code: "RESOURCE_NOT_FOUND", message: "Thread not found or expired; start a new conversation.",
        details: { code: "THREAD_NOT_FOUND" },
      } });
    }
    expect(model.calls).toHaveLength(1);
  });

  it("a message to a thread still running answers THREAD_BUSY before the stream opens, never queued", async () => {
    const entered = gate();
    const release = gate();
    const model = new FakeToolCallingModel([new AIMessage("First"), new AIMessage("Second")]);
    model.beforeResponse = async () => {
      if (model.calls.length === 0) {
        entered.resolve();
        await release.promise;
      }
    };
    setAiModel(model);
    const client = await connectChat("/_default/chat");
    try {
      await entered.promise;
      const busy = await chat("_default", { message: "Meanwhile", threadId: client.threadId });
      expect(busy.statusCode).toBe(409);
      expect(busy.json()).toEqual({ error: {
        code: "RESOURCE_CONFLICT", message: "A message to this thread is still being answered; wait for it to finish.",
        details: { code: "THREAD_BUSY" },
      } });
      release.resolve();
      expect(await client.next()).toEqual({ type: "final", reply: "First" });
    } finally {
      release.resolve();
      await client.reader.cancel();
    }
    // The refused message left nothing; the thread takes the next one.
    const next = await chat("_default", { message: "Now", threadId: client.threadId });
    expect(events(next.body).at(-1)).toEqual({ type: "final", reply: "Second" });
    expect(model.calls).toHaveLength(2);
  });

  it("a turn cancelled by disconnect leaves nothing in its thread", async () => {
    const entered = gate();
    const cancelled = gate();
    const release = gate();
    const model = new FakeToolCallingModel([
      new AIMessage("Alice is here."),
      toolCallMessage("list_saved_queries", {}),
      new AIMessage("Never"),
      new AIMessage("Still here."),
    ]);
    // The cancelled turn's second model call, after its tool work, hangs
    // until the server has seen the disconnect.
    model.beforeResponse = async (_messages, signal) => {
      if (model.calls.length === 2) {
        signal!.addEventListener("abort", () => cancelled.resolve(), { once: true });
        entered.resolve();
        await release.promise;
      }
    };
    setAiModel(model);
    const threadId = events((await chat("_default", { message: "Who is here?" })).body)[0].threadId as string;
    const controller = new AbortController();
    const client = await connectChat("/_default/chat", controller.signal, { message: "Cancel me", threadId });
    await entered.promise;
    controller.abort();
    await expect(client.reader.read()).rejects.toThrow();
    await cancelled.promise;
    release.resolve();
    await vi.waitFor(async () => {
      expect((await read("_default", threadId)).json().messages).toEqual([
        { role: "user", content: "Who is here?" },
        { role: "assistant", content: "Alice is here." },
      ]);
    });
    // Its lock is released too: the thread takes the next message.
    await vi.waitFor(async () => {
      const res = await chat("_default", { message: "Anyone?", threadId });
      expect(res.statusCode).toBe(200);
    });
  });

  it("a failed turn leaves nothing in its thread", async () => {
    holder.store.getEntity.mockRejectedValue(new StoreError("A storage operation failed", "trace-2"));
    setAiModel(new FakeToolCallingModel([
      new AIMessage("Alice is here."),
      toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "broken" }),
      new AIMessage("Never"),
    ]));
    const threadId = events((await chat("_default", { message: "Who is here?" })).body)[0].threadId as string;
    const failed = events((await chat("_default", { message: "Fetch her", threadId })).body);
    expect(failed.at(-1)!.type).toBe("error");
    expect((await read("_default", threadId)).json().messages).toEqual([
      { role: "user", content: "Who is here?" },
      { role: "assistant", content: "Alice is here." },
    ]);
  });

  it("reads a thread back as its user and assistant texts, without tool payloads or a provider", async () => {
    setAiModel(new FakeToolCallingModel([
      toolCallMessage("list_saved_queries", {}),
      new AIMessage("There are none."),
    ]));
    const threadId = events((await chat("my-agent", { message: "Any saved queries?" })).body)[0].threadId as string;
    setAiModel(null);
    const res = await read("my-agent", threadId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      threadId,
      messages: [
        { role: "user", content: "Any saved queries?" },
        { role: "assistant", content: "There are none." },
      ],
    });
    for (const [agent, id] of [["my-agent", "no-such-thread"], ["_default", threadId]] as const) {
      const missing = await read(agent, id);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.details).toEqual({ code: "THREAD_NOT_FOUND" });
    }
  });
});
