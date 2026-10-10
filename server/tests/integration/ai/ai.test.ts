/**
 * AI runtime endpoints against the real docker-compose database and the
 * configured language model, ported from `backend/tests/integration/test_ai.py` plus
 * the session-11 additions: chat with a restricted agent whose trace shows
 * only allowlisted tools, and an A2A task round-trip against the default and
 * a named agent.
 *
 * Configuration comes from the suite's own env file (`env/test-ai.env` via
 * the npm script), never `server/.env`. Skips when the database is down or
 * the configured model is unreachable — see `support.ts` for the reasons.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeAiModel, initAiModel } from "../../../src/core/ai.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { aiSuiteSkipReason } from "./support.js";
import { defineEntityProperty } from "../fixture.js";

type Row = Record<string, unknown>;

let app: FastifyInstance | null = null;
let available = false;
let skipReason: string | null = null;

// Vitest intercepts `console.*` and drops it for a file whose tests all skip,
// so the reason would never reach the terminal. Writing to stderr directly
// bypasses the interception and keeps the explanation visible — the whole
// point of the skip messages.
function reportSkip(reason: string): void {
  skipReason = reason;
  process.stderr.write(`\n${reason}\n\n`);
}

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
    if (res.headers["content-type"]?.includes("application/x-ndjson")) {
      const events = res.body.trim().split("\n").map((line) => JSON.parse(line) as Row);
      expect(events.filter((event) => ["final", "error"].includes(String(event.type)))).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("final");
      body = { events };
    } else body = res.json() as Row;
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
    reportSkip(
      "AI integration suite SKIPPED: the database is not reachable.\n" +
        "  Start it with: docker compose up -d",
    );
    return;
  }
  const reason = await aiSuiteSkipReason();
  if (reason !== null) {
    reportSkip(reason);
    await closeStores();
    return;
  }
  available = true;

  await wipeDatabase();
  initAiModel();
  app = await createApp();
  await app.ready();

  // Schema: person/company/works_for, seeded, in an unscoped lens.
  await post("/api/ontologies", { key: "test_ont" });
  await post("/api/ontologies/test_ont/model/lenses", {
    key: "ai_test",
    name: "AI Test",
    description: "Integration test lens for AI endpoints",
  });

  const person = await post("/api/ontologies/test_ont/model/entity-types", {
    key: "person",
    displayName: "Person",
  });
  for (const prop of [
    { key: "name", displayName: "Name", dataType: "string", required: true },
    { key: "age", displayName: "Age", dataType: "integer", required: false },
    { key: "location", displayName: "Location", dataType: "string", required: false },
  ]) {
    await defineEntityProperty(app!, "test_ont", person.entityTypeId as string, prop);
  }

  const company = await post("/api/ontologies/test_ont/model/entity-types", {
    key: "company",
    displayName: "Company",
  });
  await defineEntityProperty(app!, "test_ont", company.entityTypeId as string, {
    key: "name",
    displayName: "Name",
    dataType: "string",
    required: true,
  });

  await post("/api/ontologies/test_ont/model/relation-types", {
    key: "works_for",
    displayName: "Works For",
    sourceEntityTypeKey: "person",
    targetEntityTypeKey: "company",
  });

  // A restricted agent for the trace scenario.
  const res = await app.inject({
    method: "PUT",
    url: "/api/ontologies/test_ont/model/lenses/ai_test/ai-agents/analyst",
    payload: {
      name: "Analyst",
      description: "Answers only via OQL queries",
      tools: ["execute_query"],
    },
  });
  expect(res.statusCode, res.body).toBe(201);

  // Seed instance data.
  await post("/api/ontologies/test_ont/runtime/lenses/ai_test/entities/company", { name: "Acme Corp" });
  await post("/api/ontologies/test_ont/runtime/lenses/ai_test/entities/company", { name: "TechStart GmbH" });
  await post("/api/ontologies/test_ont/runtime/lenses/ai_test/entities/person", {
    name: "Alice",
    age: 30,
    location: "Berlin",
  });
  await post("/api/ontologies/test_ont/runtime/lenses/ai_test/entities/person", {
    name: "Bob",
    age: 25,
    location: "Munich",
  });
}, 120_000);

afterAll(async () => {
  if (app !== null) {
    await app.close();
    await wipeDatabase();
    closeAiModel();
    await closeStores();
  }
});

const ifAvailable = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!available) {
      // The note lands in Vitest's summary; the full reason went to stderr.
      ctx.skip(skipReason?.split("\n")[0] ?? "AI suite unavailable");
      return;
    }
    await fn();
  });

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

describe("features", () => {
  ifAvailable("reports ai enabled", async () => {
    const { statusCode, body } = await inject("GET", "/api/server/features");
    expect(statusCode).toBe(200);
    expect(body.ai).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AI Chat (conversational Q&A with tools)
// ---------------------------------------------------------------------------

describe("POST /ai/chat", () => {
  ifAvailable("returns one complete final reply", async () => {
    const { statusCode, body } = await inject("POST", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/chat", {
      message: "How many companies are in the database?",
    });
    expect(statusCode).toBe(200);
    expect(typeof (body.events as Row[]).at(-1)!.reply).toBe("string");
    expect(((body.events as Row[]).at(-1)!.reply as string).length).toBeGreaterThan(0);
    expect((body.events as Row[]).at(-1)).not.toHaveProperty("toolCalls");
  });

  ifAvailable("always includes tool activity", async () => {
    const { statusCode, body } = await inject("POST", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/chat", {
      message: "List all persons",
    });
    expect(statusCode).toBe(200);
    expect((body.events as Row[]).at(-1)).toHaveProperty("reply");
    expect(Array.isArray(body.events)).toBe(true);
    for (const call of (body.events as Row[]).filter((event) => event.type === "tool_call")) {
      expect(call).toHaveProperty("tool");
      expect(call).toHaveProperty("args");
    }
  });

  ifAvailable("accepts caller-supplied history", async () => {
    const { statusCode, body } = await inject("POST", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/chat", {
      message: "And how old is she?",
      history: [
        { role: "user", content: "How many persons are there?" },
        { role: "assistant", content: "There are 2 persons: Alice and Bob." },
      ],
    });
    expect(statusCode).toBe(200);
    expect(typeof (body.events as Row[]).at(-1)!.reply).toBe("string");
  });

  ifAvailable("rejects an empty message", async () => {
    const { statusCode } = await inject("POST", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/chat", {
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
    const { statusCode, body } = await inject("GET", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/agents");
    expect(statusCode).toBe(200);
    const agents = body as unknown as Row[];
    const keys = agents.map((a) => a.key);
    expect(keys).toContain("_default");
    expect(keys).toContain("analyst");
  });

  ifAvailable("a restricted agent's trace shows only allowlisted tools", async () => {
    const { statusCode, body } = await inject(
      "POST",
      "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/agents/analyst/chat",
      {
        message: "How many persons are stored? Answer using your tools.",
        },
    );
    expect(statusCode).toBe(200);
    expect(typeof (body.events as Row[]).at(-1)!.reply).toBe("string");
    const calls = (body.events as Row[]).filter((event) => event.type === "tool_call");
    expect(Array.isArray(calls)).toBe(true);
    for (const call of calls) {
      expect(call.tool).toBe("execute_query");
    }
  });

  ifAvailable("chat with an unknown agent answers 404", async () => {
    const { statusCode } = await inject("POST", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/agents/ghost/chat", {
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
    const def = await inject("GET", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/.well-known/agent.json");
    expect(def.statusCode).toBe(200);
    expect(def.body.name).toBe("Knowledge Assistant");
    expect(def.body.url as string).toContain("/api/ontologies/test_ont/runtime/lenses/ai_test/ai/a2a");
    expect((def.body.capabilities as Row).streaming).toBe(false);
    expect(def.body.skills as Row[]).toHaveLength(1);

    const named = await inject(
      "GET",
      "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/agents/analyst/.well-known/agent.json",
    );
    expect(named.statusCode).toBe(200);
    expect(named.body.name).toBe("Analyst");
    expect(named.body.url as string).toContain("/api/ontologies/test_ont/runtime/lenses/ai_test/ai/agents/analyst/a2a");
  });

  ifAvailable("task round-trip against the default agent", async () => {
    const { statusCode, body } = await inject("POST", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/a2a", {
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
      "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/agents/analyst/a2a",
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
    const { statusCode, body } = await inject("POST", "/api/ontologies/test_ont/runtime/lenses/ai_test/ai/a2a", {
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/stream",
      params: {},
    });
    expect(statusCode).toBe(200);
    expect((body.error as Row).code).toBe(-32601);
  });
});
