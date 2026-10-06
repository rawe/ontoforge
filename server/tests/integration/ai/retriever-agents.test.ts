/**
 * Retriever agents with a real planner and answer model (spec §15, AI
 * row): the planner picks the index whose relation group holds the asked
 * fact, and a question about two relations is answered by fusing two
 * sub-queries or by a sub-query plus a filter. The suite's env has no
 * embedding provider, so the indices search by keywords.
 *
 * Configuration comes from the suite's own env file (`env/test-ai.env`);
 * skips when the database or the configured model is unavailable —
 * see `support.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeAiModel, initAiModel } from "../../../src/core/ai.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { drainSearchWork } from "../../../src/runtime/indexing/worker.js";
import { wipeDatabase } from "../reset.js";
import { aiSuiteSkipReason } from "./support.js";

type Row = Record<string, any>;

const O = "agent_ai";
const MODEL = `/api/ontologies/${O}/model`;
const RUNTIME = `/api/ontologies/${O}/runtime/lenses/all`;

let app: FastifyInstance | null = null;
let skipReason: string | null = null;

async function post(url: string, payload: object, expected = 201): Promise<Row> {
  const res = await app!.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(expected);
  return res.json() as Row;
}

/** Ask the agent; the stream's events, checked for one terminal `final`. */
async function ask(message: string, history: Row[] = []): Promise<{ reply: string; meta: Row }> {
  const res = await app!.inject({
    method: "POST",
    url: `${RUNTIME}/retriever-agents/people/chat`,
    payload: { message, history, diagnostics: true },
  });
  expect(res.statusCode, res.body).toBe(200);
  const events = res.body.trim().split("\n").map((line) => JSON.parse(line) as Row);
  expect(events.at(-1)?.type, JSON.stringify(events.at(-1))).toBe("final");
  const meta = Object.assign({}, ...events.filter((event) => event.type === "meta"));
  return { reply: events.at(-1)!.reply as string, meta };
}

beforeAll(async () => {
  try {
    await initStores();
  } catch {
    skipReason = "AI integration suite SKIPPED: the database is not reachable.";
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

  await post("/api/ontologies", { key: O });
  await post(`${MODEL}/lenses`, { key: "all", name: "All" });
  const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person", description: "A person." });
  await post(`${MODEL}/entity-types/${person.entityTypeId}/properties`, { key: "email", displayName: "Email", dataType: "string" });
  await post(`${MODEL}/entity-types`, { key: "company", displayName: "Company", description: "A company." });
  await post(`${MODEL}/entity-types`, { key: "city", displayName: "City", description: "A city." });
  const worksFor = await post(`${MODEL}/relation-types`, {
    key: "works_for", displayName: "Works for", sourceEntityTypeKey: "person", targetEntityTypeKey: "company",
  });
  await post(`${MODEL}/relation-types/${worksFor.relationTypeId}/properties`, { key: "role", displayName: "Role", dataType: "string" });
  await post(`${MODEL}/relation-types`, {
    key: "lives_in", displayName: "Lives in", sourceEntityTypeKey: "person", targetEntityTypeKey: "city",
  });
  await post(`${MODEL}/search-indices`, {
    key: "person_employment",
    name: "People by employment",
    description: "People with their role at each company they work for. Use for questions about jobs, roles and employers.",
    entityType: "person",
    fields: ["name"],
    relations: [{ relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name"] }, label: "Employment" }],
  });
  await post(`${MODEL}/search-indices`, {
    key: "person_home",
    name: "People by home city",
    description: "People with the city they live in. Use for questions about where people live.",
    entityType: "person",
    fields: ["name"],
    relations: [{ relationType: "lives_in", direction: "outgoing", fields: [], target: { city: ["name"] }, label: "Home" }],
  });

  const ids: Record<string, string> = {};
  for (const [key, type, props] of [
    ["ada", "person", { name: "Ada Lovelace", email: "ada@acme.test" }],
    ["bob", "person", { name: "Bob Builder", email: "bob@foo.test" }],
    ["eve", "person", { name: "Eve Example", email: "eve@acme.test" }],
    ["acme", "company", { name: "ACME" }],
    ["foo", "company", { name: "Foo Industries" }],
    ["berlin", "city", { name: "Berlin" }],
    ["hamburg", "city", { name: "Hamburg" }],
  ] as const) {
    ids[key] = (await post(`${RUNTIME}/entities/${type}`, props))._id;
  }
  const relate = (type: string, from: string, to: string, props = {}) =>
    post(`${RUNTIME}/relations/${type}`, { fromEntityId: ids[from], toEntityId: ids[to], ...props });
  await relate("works_for", "ada", "acme", { role: "CTO" });
  await relate("works_for", "bob", "foo", { role: "CTO" });
  await relate("works_for", "eve", "acme", { role: "Engineer" });
  await relate("lives_in", "ada", "berlin");
  await relate("lives_in", "bob", "berlin");
  await relate("lives_in", "eve", "hamburg");
  await drainSearchWork({ ontologyKey: O });

  const saved = await app.inject({
    method: "PUT",
    url: `${MODEL}/lenses/all/retriever-agents/people`,
    payload: {
      name: "People",
      description: "Finds people by their jobs and homes.",
      configVersion: 2,
      config: {
        indices: [{ index: "person~default" }, { index: "person_employment" }, { index: "person_home" }],
        filters: [{ id: "city", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], field: "name" }],
        answerFields: { person: ["name", "email"] },
      },
    },
  });
  expect(saved.statusCode, saved.body).toBe(201);
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
    if (app === null) {
      ctx.skip(skipReason?.split("\n")[0] ?? "AI suite unavailable");
      return;
    }
    await fn();
  });

describe("retriever agent with a real model", () => {
  ifAvailable("answers who is CTO at ACME through the employment index", async () => {
    const { reply, meta } = await ask("Who is CTO at ACME?");
    const subQueries = meta.plan.subQueries as Row[];
    expect(subQueries.some((sub) => sub.indices.includes("person_employment")), JSON.stringify(subQueries)).toBe(true);
    // Ada's employment entry (CTO, ACME) matches best.
    expect(meta.results[0]).toMatchObject({ label: "Ada Lovelace", matched: { index: "person_employment" } });
    expect(reply).toContain("Ada");
  });

  ifAvailable("answers a two-relation question by fusing sub-queries or by a filter", async () => {
    const { reply, meta } = await ask("Who works at ACME and lives in Berlin?");
    const subQueries = meta.plan.subQueries as Row[];
    // Both relations are covered: a sub-query on each, or one plus the city filter.
    const touches = (relation: string, index: string) =>
      subQueries.some((sub) => sub.relations.includes(relation) || sub.indices.includes(index));
    const filtered = subQueries.some((sub) => sub.filters.some((filter: Row) => filter.id === "city"));
    expect(touches("works_for", "person_employment"), JSON.stringify(subQueries)).toBe(true);
    expect(touches("lives_in", "person_home") || filtered, JSON.stringify(subQueries)).toBe(true);
    // Found by both relations, Ada ranks first.
    expect(meta.results[0].label).toBe("Ada Lovelace");
    expect(reply).toContain("Ada");
  });

  ifAvailable("resolves a follow-up's pronoun to the person asked about last", async () => {
    const { meta } = await ask("And where does he work?", [
      { role: "user", content: "Where does Ada Lovelace live?" },
      { role: "assistant", content: "Ada Lovelace lives in Berlin." },
      { role: "user", content: "Where does Bob Builder live?" },
      { role: "assistant", content: "Bob Builder lives in Berlin." },
    ]);
    const queries = JSON.stringify((meta.plan.subQueries as Row[]).map((sub) => [sub.query, ...sub.variants]));
    expect(queries).toMatch(/bob/i);
    expect(queries).not.toMatch(/ada/i);
    expect(meta.results[0].label).toBe("Bob Builder");
  });

  ifAvailable("restates a reference to earlier results it cannot use as a fresh search", async () => {
    // A searched turn is no verified exact list: previousVerifiedResults is null.
    const { meta } = await ask("Which of these work at ACME?", [
      { role: "user", content: "Who lives in Berlin?" },
      { role: "assistant", content: "Ada Lovelace and Bob Builder live in Berlin." },
    ]);
    expect(meta.plan.unsupportedReason ?? null, JSON.stringify(meta.plan)).toBeNull();
    expect((meta.plan.subQueries as Row[]).length, JSON.stringify(meta.plan)).toBeGreaterThan(0);
    // Ada works at ACME and lives in Berlin; Eve works at ACME but lives in Hamburg.
    expect(meta.results[0].label).toBe("Ada Lovelace");
  });
});
