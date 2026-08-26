/**
 * AI runtime endpoints against the real docker-compose Neo4j and a local
 * Ollama model, ported from `backend/tests/integration/test_ai.py` plus
 * the session-11 additions: ask over seeded data (OQL present, rows
 * non-empty), extract proposals shaped to the schema, extract-and-persist,
 * chat with a restricted agent whose trace shows only allowlisted tools,
 * and an A2A task round-trip against the default and a named agent.
 *
 * Skips when the database or the Ollama model is unavailable.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaAiModel, disableAiProvider, enableOllamaAiProvider } from "./support.js";

type Row = Record<string, unknown>;

let app: FastifyInstance | null = null;
let available = false;

async function checkDatabase(): Promise<boolean> {
  try {
    await initStores();
    return true;
  } catch {
    return false;
  }
}

async function inject(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Row,
): Promise<{ statusCode: number; body: Row }> {
  const res = await app!.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
  let body: Row = {};
  if (res.body !== "") {
    body = res.json() as Row;
  }
  return { statusCode: res.statusCode, body };
}

async function post(url: string, payload: Row, expected = 201): Promise<Row> {
  const res = await app!.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(expected);
  return res.json() as Row;
}

beforeAll(async () => {
  if (!(await checkDatabase())) {
    console.warn("Database not available — skipping AI integration tests");
    return;
  }
  if (!(await checkOllamaAiModel())) {
    console.warn("Ollama or the AI model not available — skipping AI integration tests");
    await closeStores();
    return;
  }
  available = true;

  await wipeDatabase();
  enableOllamaAiProvider();
  app = await createApp();
  await app.ready();

  // Schema: person/company/works_for, seeded, in an unscoped lens.
  await post("/api/model/ontologies", {
    key: "ai_test",
    name: "AI Test",
    description: "Integration test ontology for AI endpoints",
  });

  const person = await post("/api/model/entity-types", {
    key: "person",
    displayName: "Person",
  });
  for (const prop of [
    { key: "name", displayName: "Name", dataType: "string", required: true },
    { key: "age", displayName: "Age", dataType: "integer", required: false },
    { key: "location", displayName: "Location", dataType: "string", required: false },
  ]) {
    await post(`/api/model/entity-types/${person.entityTypeId as string}/properties`, prop);
  }

  const company = await post("/api/model/entity-types", {
    key: "company",
    displayName: "Company",
  });
  await post(`/api/model/entity-types/${company.entityTypeId as string}/properties`, {
    key: "name",
    displayName: "Name",
    dataType: "string",
    required: true,
  });

  await post("/api/model/relation-types", {
    key: "works_for",
    displayName: "Works For",
    sourceEntityTypeKey: "person",
    targetEntityTypeKey: "company",
  });

  // A restricted agent for the trace scenario.
  const res = await app.inject({
    method: "PUT",
    url: "/api/model/ontologies/ai_test/ai-agents/analyst",
    payload: {
      name: "Analyst",
      description: "Answers only via OQL queries",
      tools: ["execute_query"],
    },
  });
  expect(res.statusCode, res.body).toBe(201);

  // Seed instance data.
  await post("/api/runtime/ai_test/entities/company", { name: "Acme Corp" });
  await post("/api/runtime/ai_test/entities/company", { name: "TechStart GmbH" });
  await post("/api/runtime/ai_test/entities/person", {
    name: "Alice",
    age: 30,
    location: "Berlin",
  });
  await post("/api/runtime/ai_test/entities/person", {
    name: "Bob",
    age: 25,
    location: "Munich",
  });
}, 120_000);

afterAll(async () => {
  if (app !== null) {
    await app.close();
    await wipeDatabase();
    disableAiProvider();
    await closeStores();
  }
});

const ifAvailable = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    await fn();
  });

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

describe("features", () => {
  ifAvailable("reports ai enabled", async () => {
    const { statusCode, body } = await inject("GET", "/api/runtime/features");
    expect(statusCode).toBe(200);
    expect(body.ai).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AI Query (NL → OQL)
// ---------------------------------------------------------------------------

describe("POST /ai/query", () => {
  ifAvailable("answers a question over seeded data with OQL and rows", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/query", {
      question: "How many persons are there? Use the execute_query tool.",
    });
    expect(statusCode).toBe(200);
    expect(typeof body.answer).toBe("string");
    expect((body.answer as string).length).toBeGreaterThan(0);
    // Session-11 spec: the generated OQL and the raw rows must be present.
    expect(typeof body.query).toBe("string");
    expect((body.query as string).toUpperCase()).toContain("MATCH");
    const results = body.results as Row;
    expect(results).toHaveProperty("columns");
    expect(results).toHaveProperty("results");
    expect((results.results as Row[]).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("cypher");
  });

  ifAvailable("rejects an empty question", async () => {
    const { statusCode } = await inject("POST", "/api/runtime/ai_test/ai/query", {
      question: "",
    });
    expect(statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AI Extract (text → structured entities)
// ---------------------------------------------------------------------------

describe("POST /ai/extract", () => {
  ifAvailable("returns proposals shaped to the schema without writing", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/extract", {
      text: "Charlie is 28 years old and lives in Hamburg. He works at DataFlow Inc.",
    });
    expect(statusCode).toBe(200);
    const entities = body.entities as Row[];
    expect(entities.length).toBeGreaterThanOrEqual(1);
    expect(body.created).toBe(false);
    const typeKeys = entities.map((e) => e.entityTypeKey as string);
    expect(typeKeys.some((k) => ["person", "company"].includes(k))).toBe(true);
    for (const entity of entities) {
      expect(entity).toHaveProperty("properties");
    }
  });

  ifAvailable("honours the entity-type hint list", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/extract", {
      text: "Eve works at GlobalTech.",
      entityTypes: ["person"],
    });
    expect(statusCode).toBe(200);
    expect((body.entities as Row[]).length).toBeGreaterThanOrEqual(1);
  });

  ifAvailable("persists on request and reports it", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/extract", {
      text: "Dave is 35 years old.",
      entityTypes: ["person"],
      create: true,
    });
    expect(statusCode).toBe(200);
    expect(body.created).toBe(true);

    const list = await inject("GET", "/api/runtime/ai_test/entities/person?q=Dave");
    expect(list.statusCode).toBe(200);
    const items = list.body.items as Row[];
    expect(items.some((item) => String(item.name ?? "").includes("Dave"))).toBe(true);
  });

  ifAvailable("rejects empty text", async () => {
    const { statusCode } = await inject("POST", "/api/runtime/ai_test/ai/extract", {
      text: "",
    });
    expect(statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AI Chat (conversational Q&A with tools)
// ---------------------------------------------------------------------------

describe("POST /ai/chat", () => {
  ifAvailable("returns a reply; toolCalls stays null without the trace flag", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/chat", {
      message: "How many companies are in the database?",
    });
    expect(statusCode).toBe(200);
    expect(typeof body.reply).toBe("string");
    expect((body.reply as string).length).toBeGreaterThan(0);
    expect(body.toolCalls ?? null).toBeNull();
  });

  ifAvailable("returns the tool-call trace on request", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/chat", {
      message: "List all persons",
      includeToolCalls: true,
    });
    expect(statusCode).toBe(200);
    expect(body).toHaveProperty("reply");
    expect(Array.isArray(body.toolCalls)).toBe(true);
    for (const call of body.toolCalls as Row[]) {
      expect(call).toHaveProperty("tool");
      expect(call).toHaveProperty("args");
    }
  });

  ifAvailable("accepts caller-supplied history", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/chat", {
      message: "And how old is she?",
      history: [
        { role: "user", content: "How many persons are there?" },
        { role: "assistant", content: "There are 2 persons: Alice and Bob." },
      ],
    });
    expect(statusCode).toBe(200);
    expect(typeof body.reply).toBe("string");
  });

  ifAvailable("rejects an empty message", async () => {
    const { statusCode } = await inject("POST", "/api/runtime/ai_test/ai/chat", {
      message: "",
    });
    expect(statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Agents: discovery and restricted chat
// ---------------------------------------------------------------------------

describe("agents", () => {
  ifAvailable("lists the default agent alongside the configured one", async () => {
    const { statusCode, body } = await inject("GET", "/api/runtime/ai_test/ai/agents");
    expect(statusCode).toBe(200);
    const agents = body as unknown as Row[];
    const keys = agents.map((a) => a.key);
    expect(keys).toContain("_default");
    expect(keys).toContain("analyst");
  });

  ifAvailable("a restricted agent's trace shows only allowlisted tools", async () => {
    const { statusCode, body } = await inject(
      "POST",
      "/api/runtime/ai_test/ai/agents/analyst/chat",
      {
        message: "How many persons are stored? Answer using your tools.",
        includeToolCalls: true,
      },
    );
    expect(statusCode).toBe(200);
    expect(typeof body.reply).toBe("string");
    const calls = body.toolCalls as Row[];
    expect(Array.isArray(calls)).toBe(true);
    for (const call of calls) {
      expect(call.tool).toBe("execute_query");
    }
  });

  ifAvailable("chat with an unknown agent answers 404", async () => {
    const { statusCode } = await inject("POST", "/api/runtime/ai_test/ai/agents/ghost/chat", {
      message: "Hi",
    });
    expect(statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// A2A: cards and task round-trips
// ---------------------------------------------------------------------------

describe("A2A", () => {
  ifAvailable("serves the default card and a named card", async () => {
    const def = await inject("GET", "/api/runtime/ai_test/ai/.well-known/agent.json");
    expect(def.statusCode).toBe(200);
    expect(def.body.name).toBe("Knowledge Assistant");
    expect(def.body.url as string).toContain("/api/runtime/ai_test/ai/a2a");
    expect((def.body.capabilities as Row).streaming).toBe(false);
    expect(def.body.skills as Row[]).toHaveLength(1);

    const named = await inject(
      "GET",
      "/api/runtime/ai_test/ai/agents/analyst/.well-known/agent.json",
    );
    expect(named.statusCode).toBe(200);
    expect(named.body.name).toBe("Analyst");
    expect(named.body.url as string).toContain("/api/runtime/ai_test/ai/agents/analyst/a2a");
  });

  ifAvailable("task round-trip against the default agent", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/a2a", {
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/send",
      params: {
        id: "task-1",
        message: { parts: [{ type: "text", text: "How many persons are there?" }] },
      },
    });
    expect(statusCode).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    const result = body.result as Row;
    expect(result.id).toBe("task-1");
    expect((result.status as Row).state).toBe("completed");
    const artifacts = result.artifacts as Row[];
    expect(artifacts).toHaveLength(1);
    const parts = artifacts[0]!.parts as Row[];
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("text");
    expect((parts[0]!.text as string).length).toBeGreaterThan(0);
  });

  ifAvailable("task round-trip against a named agent", async () => {
    const { statusCode, body } = await inject(
      "POST",
      "/api/runtime/ai_test/ai/agents/analyst/a2a",
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/send",
        params: {
          message: { parts: [{ type: "text", text: "How many companies are there?" }] },
        },
      },
    );
    expect(statusCode).toBe(200);
    const result = body.result as Row;
    expect((result.status as Row).state).toBe("completed");
    expect(typeof result.id).toBe("string");
  });

  ifAvailable("an unsupported method answers JSON-RPC method-not-found", async () => {
    const { statusCode, body } = await inject("POST", "/api/runtime/ai_test/ai/a2a", {
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/stream",
      params: {},
    });
    expect(statusCode).toBe(200);
    expect((body.error as Row).code).toBe(-32601);
  });
});
