/**
 * AI agent configuration modeling endpoints over a mocked store, including
 * the allowlist assertions: an unknown tool name is rejected and the error
 * names the exact ten-name grantable set.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_AGENT_TOOLS } from "../../src/runtime/toolNames.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

const holder: { store: MockModelingStore } = { store: createMockModelingStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getLegacyModelingStore: async () => holder.store,
  getRuntimeStore: async () => ({}),
  getLegacyRuntimeStore: async () => ({}),
}));

const MOCK_LENS = {
  lensId: "lens-1",
  key: "test_lens",
  name: "Test",
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const MOCK_AGENT = {
  agentConfigId: "ac-1",
  key: "my-agent",
  name: "My Agent",
  description: "test desc",
  systemPrompt: "You are helpful",
  tools: ["get_schema"],
  createdAt: NOW,
  updatedAt: NOW,
};

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
});

describe("list", () => {
  it("answers an empty list", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.listAiAgents.mockResolvedValue([]);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns the full agent wire shape", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.listAiAgents.mockResolvedValue([MOCK_AGENT]);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    const agent = body[0]!;
    expect(agent.key).toBe("my-agent");
    expect(agent.name).toBe("My Agent");
    expect(agent.description).toBe("test desc");
    expect(agent.systemPrompt).toBe("You are helpful");
    expect(agent.tools).toEqual(["get_schema"]);
    expect(agent).toHaveProperty("createdAt");
    expect(agent).toHaveProperty("updatedAt");
  });

  it("an unknown lens key answers 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/onto/model/lenses/nonexistent/ai-agents",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("upsert", () => {
  it("create answers 201", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertAiAgent.mockResolvedValue([MOCK_AGENT, true]);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/my-agent",
      payload: {
        name: "My Agent",
        description: "test desc",
        systemPrompt: "You are helpful",
        tools: ["get_schema"],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toBe("my-agent");
    expect(body.name).toBe("My Agent");
  });

  it("replace answers 200", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertAiAgent.mockResolvedValue([MOCK_AGENT, false]);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/my-agent",
      payload: { name: "My Agent" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("my-agent");
  });

  it("an unknown lens key answers 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/nonexistent/ai-agents/my-agent",
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("delete", () => {
  it("answers 204", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.deleteAiAgent.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/my-agent",
    });
    expect(res.statusCode).toBe(204);
  });

  it("an unknown agent key answers 404", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.deleteAiAgent.mockResolvedValue(false);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("key validation", () => {
  it("a key violating ^[a-z][a-z0-9_-]*$ is rejected 422", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/INVALID",
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("^[a-z][a-z0-9_-]*$");
  });

  it("hyphens ARE allowed, unlike type keys", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertAiAgent.mockResolvedValue([MOCK_AGENT, true]);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/my-agent",
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(201);
  });

  // The cap is 64 characters, uniformly on every key kind.
  it("a key longer than 64 characters is rejected 422 naming the cap", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await app.inject({
      method: "PUT",
      url: `/api/ontologies/onto/model/lenses/test_lens/ai-agents/${"k".repeat(65)}`,
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("64");
    expect(holder.store.upsertAiAgent).not.toHaveBeenCalled();
  });

  it("a key of exactly 64 characters is accepted", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertAiAgent.mockResolvedValue([
      { ...MOCK_AGENT, key: "k".repeat(64) },
      true,
    ]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/ontologies/onto/model/lenses/test_lens/ai-agents/${"k".repeat(64)}`,
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("the reserved '_default' key is rejected 422", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/_default",
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("tool allowlist validation", () => {
  it("an unknown tool name is rejected and the error names the valid set", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/my-agent",
      payload: { name: "Test", tools: ["nonexistent_tool"] },
    });
    expect(res.statusCode).toBe(422);
    const message = res.json().error.message as string;
    expect(message).toContain("Unknown tool(s): ['nonexistent_tool']");
    for (const tool of VALID_AGENT_TOOLS) {
      expect(message).toContain(`'${tool}'`);
    }
    expect(holder.store.upsertAiAgent).not.toHaveBeenCalled();
  });

  it("every write tool and the non-grantable reads are OUTSIDE the set", () => {
    // The set is exactly ten names; being read-only is not sufficient.
    expect(VALID_AGENT_TOOLS.size).toBe(10);
    for (const excluded of [
      "get_document",
      "get_relation",
      "create_entity",
      "update_entity",
      "delete_entity",
      "create_relation",
      "update_relation",
      "delete_relation",
      "edit_document",
      "write_document",
    ]) {
      expect(VALID_AGENT_TOOLS.has(excluded), excluded).toBe(false);
    }
  });

  it("a valid tool name is accepted", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertAiAgent.mockResolvedValue([MOCK_AGENT, true]);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/my-agent",
      payload: { name: "Test", tools: ["get_schema"] },
    });
    expect(res.statusCode).toBe(201);
  });

  it("tools=null means 'all available tools' and is accepted", async () => {
    holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
    holder.store.upsertAiAgent.mockResolvedValue([{ ...MOCK_AGENT, tools: null }, true]);
    const res = await app.inject({
      method: "PUT",
      url: "/api/ontologies/onto/model/lenses/test_lens/ai-agents/my-agent",
      payload: { name: "Test", tools: null },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().tools).toBeNull();
  });
});

describe("cascading delete", () => {
  it("deleting the lens deletes its agents (handled by the store)", async () => {
    holder.store.deleteLens.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: "/api/ontologies/onto/model/lenses/lens-1" });
    expect(res.statusCode).toBe(204);
  });
});
