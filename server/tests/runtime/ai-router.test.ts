/**
 * The AI routes over HTTP with a mocked store: card URL derivation
 * (PUBLIC_URL, forwarded headers, fallback), the JSON-RPC error cases of
 * the A2A task endpoint, the FEATURE_DISABLED envelope (approved
 * divergence #2: `details.code` alongside 422 VALIDATION_ERROR), and the
 * asymmetry that discovery and cards answer without a provider.
 */

import type { FastifyInstance } from "fastify";
import { AIMessage } from "@langchain/core/messages";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { settings } from "../../src/config.js";
import { setAiModel } from "../../src/core/ai.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { FakeToolCallingModel } from "./aiHelpers.js";
import {
  createMockRuntimeStore,
  makeFullSchema,
  type MockRuntimeStore,
} from "./helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getLegacyModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
  getLegacyRuntimeStore: async () => holder.store,
}));

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
  holder.store = createMockRuntimeStore();
  holder.store.getFullSchema.mockResolvedValue(makeFullSchema({ lensKey: "test_lens" }));
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
  settings.PUBLIC_URL = null;
});

describe("FEATURE_DISABLED without a provider", () => {
  const cases: [string, string, Record<string, unknown>][] = [
    ["query", "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/query", { question: "How many?" }],
    ["extract", "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/extract", { text: "Some text" }],
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

  it("a valid A2A task without a provider is rejected the same way", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/a2a",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/send",
        params: { message: { parts: [{ type: "text", text: "Hello" }] } },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toEqual({ code: "FEATURE_DISABLED" });
  });

  it("listing agents still works", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { key: "_default", name: "Knowledge Assistant", description: null },
      { key: "my-agent", name: "My Agent", description: "A custom agent" },
    ]);
  });

  it("serving cards still works", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/.well-known/agent.json",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Knowledge Assistant");
  });
});

describe("card URL derivation", () => {
  it("uses PUBLIC_URL when configured, trailing slash stripped", async () => {
    settings.PUBLIC_URL = "https://onto.example.com/";
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/.well-known/agent.json",
    });
    expect(res.json().url).toBe("https://onto.example.com/api/ontologies/test_ont/runtime/lenses/test_lens/ai/a2a");
  });

  it("falls back to forwarded proto + host headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/agents/my-agent/.well-known/agent.json",
      headers: { "x-forwarded-proto": "https", host: "proxy.example.com" },
    });
    expect(res.json().url).toBe(
      "https://proxy.example.com/api/ontologies/test_ont/runtime/lenses/test_lens/ai/agents/my-agent/a2a",
    );
  });

  it("without forwarding headers, uses the request scheme and host", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/.well-known/agent.json",
      headers: { host: "localhost:8000" },
    });
    expect(res.json().url).toBe("http://localhost:8000/api/ontologies/test_ont/runtime/lenses/test_lens/ai/a2a");
  });

  it("an unknown agent's card answers 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/agents/ghost/.well-known/agent.json",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });
});

describe("A2A JSON-RPC error cases", () => {
  it("an unsupported method answers JSON-RPC method-not-found, not an HTTP error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/a2a",
      payload: { jsonrpc: "2.0", id: 7, method: "tasks/stream", params: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "Method not found: tasks/stream" },
    });
  });

  it("a message with no text parts answers invalid-params", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/a2a",
      payload: {
        jsonrpc: "2.0",
        id: "abc",
        method: "tasks/send",
        params: { message: { parts: [{ type: "image", url: "x" }] } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jsonrpc: "2.0",
      id: "abc",
      error: { code: -32602, message: "No text message found in request" },
    });
  });

  it("a task against an unknown agent answers 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/agents/ghost/a2a",
      payload: { jsonrpc: "2.0", id: 1, method: "tasks/send", params: {} },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a completed task echoes the task id and carries one text artifact", async () => {
    setAiModel(new FakeToolCallingModel([new AIMessage("The answer.")]));
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/a2a",
      payload: {
        jsonrpc: "2.0",
        id: 42,
        method: "tasks/send",
        params: {
          id: "task-9",
          message: { parts: [{ type: "text", text: "Hello " }, { type: "text", text: "graph" }] },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: {
        id: "task-9",
        status: { state: "completed" },
        artifacts: [{ parts: [{ type: "text", text: "The answer." }] }],
      },
    });
  });

  it("generates a task id when the request names none", async () => {
    setAiModel(new FakeToolCallingModel([new AIMessage("Done.")]));
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/a2a",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/send",
        params: { message: { parts: [{ type: "text", text: "Hi" }] } },
      },
    });
    const taskId = res.json().result.id;
    expect(typeof taskId).toBe("string");
    expect(taskId.length).toBeGreaterThan(0);
  });
});

describe("chat wire shape", () => {
  it("toolCalls is null when the trace is not requested", async () => {
    setAiModel(new FakeToolCallingModel([new AIMessage("Hello!")]));
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/test_lens/ai/chat",
      payload: { message: "Hi" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: "Hello!", toolCalls: null });
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
