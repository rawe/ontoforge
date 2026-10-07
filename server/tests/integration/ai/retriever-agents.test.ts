/**
 * Retriever agents with a real planner and answer model (spec §15, AI
 * row): the planner picks the index whose relation group holds the asked
 * fact, and a question about two relations is answered by fusing two
 * sub-queries or by a sub-query plus a filter. A second ontology replays
 * the follow-up sequences of the end-to-end run (person~default plus an
 * employment index, a city filter): a pronoun after a question that named
 * no person, and a reference to searched results. The suite's env has no
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
const F = "agent_ai_follow";
const F_MODEL = `/api/ontologies/${F}/model`;
const F_RUNTIME = `/api/ontologies/${F}/runtime/lenses/all`;

let app: FastifyInstance | null = null;
let skipReason: string | null = null;

async function post(url: string, payload: object, expected = 201): Promise<Row> {
  const res = await app!.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(expected);
  return res.json() as Row;
}

/** Ask the agent; the stream's events, checked for one terminal `final`. */
async function ask(
  message: string,
  history: Row[] = [],
  runtime = RUNTIME,
  agent = "people",
): Promise<{ reply: string; meta: Row }> {
  const res = await app!.inject({
    method: "POST",
    url: `${runtime}/retriever-agents/${agent}/chat`,
    payload: { message, history, diagnostics: true },
  });
  expect(res.statusCode, res.body).toBe(200);
  const events = res.body.trim().split("\n").map((line) => JSON.parse(line) as Row);
  expect(events.at(-1)?.type, JSON.stringify(events.at(-1))).toBe("final");
  const meta = Object.assign({}, ...events.filter((event) => event.type === "meta"));
  return { reply: events.at(-1)!.reply as string, meta };
}

/** Retrieve with diagnostics; the plain JSON response. */
async function retrieveFrom(agent: string, question: string): Promise<Row> {
  const res = await app!.inject({
    method: "POST",
    url: `${RUNTIME}/retriever-agents/${agent}/retrieve`,
    payload: { question, diagnostics: true },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Row;
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

  // The end-to-end run's pairing traps: Ada is CTO at ACME and lives in
  // London; Bob works at ACME (and is CTO elsewhere) and lives in Berlin.
  await post("/api/ontologies", { key: F });
  await post(`${F_MODEL}/lenses`, { key: "all", name: "All" });
  await post(`${F_MODEL}/entity-types`, { key: "person", displayName: "Person", description: "A person." });
  await post(`${F_MODEL}/entity-types`, { key: "company", displayName: "Company", description: "A company." });
  await post(`${F_MODEL}/entity-types`, { key: "city", displayName: "City", description: "A city." });
  const employs = await post(`${F_MODEL}/relation-types`, {
    key: "works_for", displayName: "Works for", sourceEntityTypeKey: "person", targetEntityTypeKey: "company",
  });
  await post(`${F_MODEL}/relation-types/${employs.relationTypeId}/properties`, { key: "role", displayName: "Role", dataType: "string" });
  await post(`${F_MODEL}/relation-types`, {
    key: "lives_in", displayName: "Lives in", sourceEntityTypeKey: "person", targetEntityTypeKey: "city",
  });
  await post(`${F_MODEL}/search-indices`, {
    key: "person_employment",
    name: "People by employment",
    description: "People with each of their roles at a company, one entry per employment. Use for questions like \"who is CTO at ACME\".",
    entityType: "person",
    fields: ["name"],
    relations: [{ relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name"] }, label: "Employment" }],
  });
  const f: Record<string, string> = {};
  for (const [key, type, name] of [
    ["ada", "person", "Ada Lovelace"],
    ["bob", "person", "Bob Martin"],
    ["clara", "person", "Clara Schmidt"],
    ["ines", "person", "Ines Wagner"],
    ["frank", "person", "Frank Weber"],
    ["acme", "company", "ACME"],
    ["foo", "company", "Foo Labs"],
    ["schneider", "company", "Schneider & Partner"],
    ["berlin", "city", "Berlin"],
    ["london", "city", "London"],
    ["hamburg", "city", "Hamburg"],
    ["zurich", "city", "Zürich"],
  ] as const) {
    f[key] = (await post(`${F_RUNTIME}/entities/${type}`, { name }))._id;
  }
  const link = (type: string, from: string, to: string, props = {}) =>
    post(`${F_RUNTIME}/relations/${type}`, { fromEntityId: f[from], toEntityId: f[to], ...props });
  await link("works_for", "ada", "acme", { role: "CTO" });
  await link("works_for", "ada", "foo", { role: "Advisor" });
  await link("works_for", "bob", "foo", { role: "CTO" });
  await link("works_for", "bob", "acme", { role: "Software Engineer" });
  await link("works_for", "clara", "acme", { role: "Advisor" });
  await link("works_for", "ines", "acme", { role: "CFO" });
  await link("works_for", "frank", "schneider", { role: "Steuerberater" });
  await link("lives_in", "ada", "london");
  await link("lives_in", "bob", "berlin");
  await link("lives_in", "clara", "hamburg");
  await link("lives_in", "ines", "zurich");
  await link("lives_in", "frank", "berlin");
  await drainSearchWork({ ontologyKey: F });
  const followAgent = await app.inject({
    method: "PUT",
    url: `${F_MODEL}/lenses/all/retriever-agents/people`,
    payload: {
      name: "People",
      description: "Finds people by their jobs and homes.",
      configVersion: 2,
      config: {
        indices: [{ index: "person~default" }, { index: "person_employment" }],
        filters: [{ id: "city", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], field: "name" }],
        answerFields: { person: ["name"] },
      },
    },
  });
  expect(followAgent.statusCode, followAgent.body).toBe(201);
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

describe("follow-up sequences of the end-to-end run", () => {
  const queriesOf = (plan: Row) => JSON.stringify((plan.subQueries as Row[]).map((sub) => [sub.query, ...sub.variants]));

  ifAvailable("resolves 'his' to the person the latest answer named when the question named none", async () => {
    // q2 names no person; Bob exists only in its answer. Ada, of the earlier
    // exchange, fits "role there" (CTO at ACME) better — the trap.
    const { reply, meta } = await ask("And what is his role there?", [
      { role: "user", content: "Who is CTO at ACME?" },
      {
        role: "assistant",
        content:
          "Ada Lovelace is the CTO at ACME. Others at ACME are Clara Schmidt (Advisor), Ines Wagner (CFO) and " +
          "Bob Martin (Software Engineer); Bob Martin is CTO at Foo Labs, not at ACME.",
      },
      { role: "user", content: "Who works at ACME and lives in Berlin?" },
      { role: "assistant", content: "Bob Martin works at ACME and lives in Berlin." },
    ], F_RUNTIME);
    const queries = queriesOf(meta.plan);
    expect(meta.plan.subQueries.length, JSON.stringify(meta.plan)).toBeGreaterThan(0);
    expect(queries).toMatch(/bob/i);
    expect(queries).not.toMatch(/ada/i);
    expect(meta.results[0].label).toBe("Bob Martin");
    expect(reply).toMatch(/software engineer/i);
  });

  ifAvailable("restates a reference to searched results with the earlier constraint and the new one", async () => {
    // As in the end-to-end run, q5 searched by query and filter: its results
    // are candidates, not a verified list, so nothing is referable.
    const { reply, meta } = await ask("Which of these work at ACME?", [
      { role: "user", content: "List everyone who lives in Berlin." },
      { role: "assistant", content: "Bob Martin and Frank Weber live in Berlin." },
    ], F_RUNTIME);
    const subQueries = meta.plan.subQueries as Row[];
    expect(meta.plan.unsupportedReason ?? null, JSON.stringify(meta.plan)).toBeNull();
    expect(subQueries.length, JSON.stringify(meta.plan)).toBeGreaterThan(0);
    // Both constraints: Berlin as the city filter or its own sub-query, and ACME.
    const berlin = subQueries.some(
      (sub) =>
        sub.filters.some((filter: Row) => filter.id === "city" && /berlin/i.test(filter.value)) ||
        /berlin/i.test(JSON.stringify([sub.query, ...sub.variants])),
    );
    expect(berlin, JSON.stringify(meta.plan)).toBe(true);
    expect(queriesOf(meta.plan), JSON.stringify(meta.plan)).toMatch(/acme/i);
    expect((meta.results as Row[]).map((result) => result.label)).toContain("Bob Martin");
    expect(reply).toContain("Bob");
  });
});

describe("retrieve and the default agent with a real model", () => {
  ifAvailable("retrieve plans once and returns the found people in order, without an answer", async () => {
    const response = await retrieveFrom("people", "Who is CTO at ACME?");
    expect(response.diagnostics.modelIO.map((call: Row) => call.phase)).toEqual(["plan"]);
    expect(response.results[0]).toMatchObject({ label: "Ada Lovelace", entityType: "person" });
    expect(response.results[0].matched).toMatchObject({ index: "person_employment" });
    expect(Object.keys(response).sort()).toEqual(["diagnostics", "limitations", "results"]);
  });

  ifAvailable("the default agent finds people by a derived relation filter, proven", async () => {
    const response = await retrieveFrom("_default", "Which people live in Berlin?");
    const plan = JSON.stringify(response.diagnostics.plan);
    expect(plan).toContain("person.lives_in.outgoing");
    const people = (response.results as Row[]).filter((result) => result.entityType === "person");
    expect(people.map((result) => result.label).sort()).toEqual(["Ada Lovelace", "Bob Builder"]);
    for (const person of people) {
      expect(person.conditions).toContainEqual({
        filter: "person.lives_in.outgoing",
        value: expect.stringMatching(/^berlin$/i),
        text: expect.stringMatching(/^Lives in City Name: berlin$/i),
      });
    }
  });

  ifAvailable("the default agent answers in chat", async () => {
    const { reply, meta } = await ask("Which people live in Berlin?", [], RUNTIME, "_default");
    expect((meta.results as Row[]).map((result) => result.label)).toContain("Ada Lovelace");
    expect(reply).toMatch(/Ada/);
  });
});
