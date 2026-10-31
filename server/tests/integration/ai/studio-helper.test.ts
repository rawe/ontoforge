/**
 * The Studio helper against the real database and the configured language
 * model: it answers a question about a small schema through the Studio
 * route, from the design alone, validates a lens with its tool, drafts
 * an agent for a lens into the open editor's draft, and proposes a schema
 * change whose check passes and which the person then applies.
 * Configuration and skips as in `ai.test.ts` (`support.ts`).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeAiModel, initAiModel } from "../../../src/core/ai.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { aiSuiteSkipReason } from "./support.js";

type Row = Record<string, any>;

const MODEL = "/api/ontologies/studio_ai/model";

let app: FastifyInstance | null = null;
let skipReason: string | null = null;

async function post(url: string, payload: object): Promise<Row> {
  const res = await app!.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBeLessThan(300);
  return res.json();
}

/** One Studio turn: its events, exactly one terminal `final`. */
async function ask(message: string, extra: object = {}): Promise<Row[]> {
  const res = await app!.inject({ method: "POST", url: `${MODEL}/ai/chat`, payload: { message, ...extra } });
  expect(res.statusCode, res.body).toBe(200);
  const events = res.body.trim().split("\n").map((line) => JSON.parse(line) as Row);
  expect(events.at(-1)?.type, res.body).toBe("final");
  return events;
}

beforeAll(async () => {
  try {
    await initStores();
  } catch {
    skipReason = "AI integration suite SKIPPED: the database is not reachable.";
    process.stderr.write(`\n${skipReason}\n\n`);
    return;
  }
  skipReason = await aiSuiteSkipReason();
  if (skipReason !== null) {
    process.stderr.write(`\n${skipReason}\n\n`);
    await closeStores();
    return;
  }
  await wipeDatabase();
  initAiModel();
  app = await createApp();
  await app.ready();

  await post("/api/ontologies", { key: "studio_ai" });
  await post(`${MODEL}/lenses`, { key: "everything", name: "Everything" });
  const lens = await post(`${MODEL}/lenses`, { key: "public", name: "Public" });
  await post(`${MODEL}/entity-types`, { key: "author", displayName: "Author", description: "A person who writes books" });
  await post(`${MODEL}/entity-types`, { key: "book", displayName: "Book" });
  await post(`${MODEL}/relation-types`, {
    key: "wrote", displayName: "Wrote", sourceEntityTypeKey: "author", targetEntityTypeKey: "book",
  });
  await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "book" });
  await post("/api/ontologies/studio_ai/runtime/lenses/everything/entities/author", { name: "Quentin Marlowe-Instance" });
}, 120_000);

afterAll(async () => {
  if (app !== null) {
    await app.close();
    await wipeDatabase();
    closeAiModel();
    await closeStores();
  }
});

describe("the Studio helper on a real model", () => {
  it("answers a question about the schema and validates a lens with its tool", async (ctx) => {
    if (app === null) {
      ctx.skip(skipReason?.split("\n")[0] ?? "AI suite unavailable");
      return;
    }
    const answer = await ask("Which relation type connects authors and books, and in which direction? Answer with its key.");
    const reply = String(answer.at(-1)!.reply);
    expect(reply).toContain("wrote");
    expect(reply).not.toContain("Quentin");

    const checked = await ask("Run the validation of the lens 'public' and tell me whether it is valid.");
    const calls = checked.filter((event) => event.type === "studio.tool_call");
    expect(calls.map((call) => call.tool)).toContain("validate_lens");
    expect(String(checked.at(-1)!.reply).toLowerCase()).toContain("valid");
  });

  it("proposes an entity type and a relation type; the check passes and applying it succeeds", async (ctx) => {
    if (app === null) {
      ctx.skip(skipReason?.split("\n")[0] ?? "AI suite unavailable");
      return;
    }
    const events = await ask(
      "Extend the schema: add an entity type 'publisher' (Publisher) and a relation type 'published_by' " +
      "(Published by) from book to publisher.",
    );
    const final = events.at(-1)!;
    expect(final.artifacts, JSON.stringify(events)).toHaveLength(1);
    const { proposal, check } = final.artifacts[0].value;
    expect(final.artifacts[0]).toMatchObject({ type: "proposal", version: 1 });
    expect(check.ok, JSON.stringify(check)).toBe(true);
    const ops = proposal.steps.map((step: Row) => `${step.op}:${step.key}`);
    expect(ops).toEqual(expect.arrayContaining(["create_entity_type:publisher", "create_relation_type:published_by"]));
    const types = async () => (await app!.inject({ method: "GET", url: `${MODEL}/entity-types` })).json().map((t: Row) => t.key);
    expect(await types()).not.toContain("publisher");

    const applied = await app!.inject({
      method: "POST", url: `${MODEL}/proposals/apply`, payload: { proposal, expected: check.baseRevision },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().created["entityTypes.publisher"]).toBeDefined();
    expect(await types()).toContain("publisher");
    const relations = (await app!.inject({ method: "GET", url: `${MODEL}/relation-types` })).json();
    expect(relations.find((r: Row) => r.key === "published_by")).toMatchObject({
      sourceEntityTypeKey: "book", targetEntityTypeKey: "publisher",
    });
  });

  it("drafts an agent for a lens into the open editor with fill_agent_draft", async (ctx) => {
    if (app === null) {
      ctx.skip(skipReason?.split("\n")[0] ?? "AI suite unavailable");
      return;
    }
    const draft = {
      target: { lensKey: "public", agentKey: null }, version: 5,
      fields: { name: "", description: "", systemPrompt: "", tools: null },
    };
    const events = await ask(
      "Draft this agent for me: a guide that answers questions about the books this lens shows. " +
      "Give it a name, a short description, instructions, and only the tools it needs.",
      { draft, focus: { kind: "lens", key: "public" } },
    );
    const fill = events.filter((event) => event.type === "studio.tool_call" && event.tool === "fill_agent_draft");
    expect(fill.length, JSON.stringify(events)).toBeGreaterThan(0);
    const results = events.filter((event) => event.type === "studio.tool_result" && fill.some((call) => call.callId === event.callId));
    const filled = results.map((event) => event.result).find((result) => result.error === undefined);
    expect(filled, JSON.stringify(results)).toBeDefined();
    expect(filled.target).toEqual({ lensKey: "public", agentKey: null });
    expect(filled.sourceVersion).toBe(5);
    expect(String(filled.fields.name ?? "")).not.toBe("");
    const agents = await app!.inject({ method: "GET", url: `${MODEL}/lenses/public/assistants/agents` });
    expect(agents.json()).toEqual([]);
  });
});
