/**
 * The default navigator with a real model: a two-hop question answered by
 * walking manages → works on, with the evidence streamed before the answer
 * and cited; and a follow-up on the same thread that starts from what the
 * first answer cited. The suite's env has no embedding provider, so
 * mentions resolve by keyword.
 *
 * Configuration comes from the suite's own env file (`env/test-ai.env`);
 * skips when the database or the configured model is unavailable — see
 * `support.ts`.
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

const O = "navigator_ai";
const MODEL = `/api/ontologies/${O}/model`;
const RUNTIME = `/api/ontologies/${O}/runtime/lenses/all`;

let app: FastifyInstance | null = null;
let skipReason: string | null = null;

async function post(url: string, payload: object): Promise<Row> {
  const res = await app!.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

/** Ask the default navigator; the stream's events, checked for the
 * contract's frame: `thread`, then `navigator.graph`, … `final`. */
async function ask(message: string, threadId?: string): Promise<{ reply: string; events: Row[]; threadId: string }> {
  const res = await app!.inject({
    method: "POST",
    url: `${RUNTIME}/ai/assistants/navigators/_default/chat`,
    payload: { message, ...(threadId ? { threadId } : {}) },
  });
  expect(res.statusCode, res.body).toBe(200);
  const events = res.body.trim().split("\n").map((line) => JSON.parse(line) as Row);
  expect(events[0]?.type).toBe("thread");
  if (threadId) expect(events[0]!.threadId).toBe(threadId);
  expect(events[1]?.type).toBe("navigator.graph");
  expect(events.at(-1)?.type, JSON.stringify(events.at(-1))).toBe("final");
  expect(events.at(-2)?.type).toBe("navigator.summary");
  return { reply: events.at(-1)!.reply as string, events, threadId: events[0]!.threadId as string };
}

/** The stored relations by id: type and endpoint entity ids. */
const relations = new Map<string, { type: string; from: string; to: string }>();

/** The sidebar as the client keeps it: cards upserted by ref. */
function sidebar(events: Row[]): Map<string, Row> {
  const cards = new Map<string, Row>();
  for (const event of events.filter((e) => e.type === "entities")) {
    for (const card of event.entities as Row[]) cards.set(card.ref as string, card);
  }
  return cards;
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
  await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person", description: "An employee." });
  await post(`${MODEL}/entity-types`, { key: "project", displayName: "Project", description: "A project people work on." });
  await post(`${MODEL}/entity-types`, { key: "skill", displayName: "Skill", description: "A technology a project requires." });
  for (const [key, displayName, from, to] of [
    ["manages", "Manages", "person", "person"],
    ["works_on", "Works on", "person", "project"],
    ["requires", "Requires", "project", "skill"],
  ] as const) {
    await post(`${MODEL}/relation-types`, { key, displayName, sourceEntityTypeKey: from, targetEntityTypeKey: to });
  }
  const ids: Record<string, string> = {};
  for (const [key, type, name] of [
    ["lena", "person", "Lena Vogt"],
    ["kira", "person", "Kira Novak"],
    ["omar", "person", "Omar Haddad"],
    ["paul", "person", "Paul Weber"],
    ["apollo", "project", "Apollo"],
    ["zeus", "project", "Zeus"],
    ["hermes", "project", "Hermes"],
    ["k8s", "skill", "Kubernetes"],
    ["python", "skill", "Python"],
    ["rust", "skill", "Rust"],
  ] as const) {
    ids[key] = (await post(`${RUNTIME}/entities/${type}`, { name }))._id;
  }
  const relate = async (type: string, from: string, to: string) => {
    const relation = await post(`${RUNTIME}/relations/${type}`, { fromEntityId: ids[from], toEntityId: ids[to] });
    relations.set(String(relation._id), { type, from: ids[from]!, to: ids[to]! });
  };
  await relate("manages", "lena", "kira");
  await relate("manages", "lena", "omar");
  await relate("works_on", "kira", "apollo");
  await relate("works_on", "omar", "zeus");
  // Paul is not Lena's report: Hermes must not be in the answer.
  await relate("works_on", "paul", "hermes");
  await relate("requires", "apollo", "k8s");
  await relate("requires", "zeus", "python");
  await relate("requires", "hermes", "rust");
  await drainSearchWork({ ontologyKey: O });
});

afterAll(async () => {
  if (app !== null) {
    await app.close();
    await wipeDatabase();
    closeAiModel();
    await closeStores();
  }
});

const ifAvailable = (name: string, fn: () => Promise<void>, turns = 1) =>
  it(name, async (ctx) => {
    if (app === null) {
      ctx.skip(skipReason?.split("\n")[0] ?? "AI suite unavailable");
      return;
    }
    await fn();
  }, turns * 180_000);

describe("navigator with a real model", () => {
  ifAvailable("answers a two-hop question from the walked evidence, citing it", async () => {
    const { reply, events } = await ask("Which projects do the people Lena Vogt manages work on?");
    const cards = sidebar(events);
    const byLabel = new Map([...cards.values()].map((card) => [card.label, card]));
    expect(byLabel.get("Lena Vogt")?.role).toBe("anchor");
    for (const project of ["Apollo", "Zeus"]) {
      expect(byLabel.get(project), project).toMatchObject({ evidence: true, role: "reached" });
      expect(reply).toContain(project);
    }
    expect(reply).not.toContain("Hermes");
    // Every step ran; the cards came before the first answer token.
    const done = events.filter((e) => e.type === "navigator.step" && e.status === "done").map((e) => e.id);
    expect(done).toEqual(expect.arrayContaining(["understand", "anchor", "walk", "focus", "answer"]));
    const firstDelta = events.findIndex((e) => e.type === "delta");
    expect(events.findIndex((e) => e.type === "entities")).toBeLessThan(firstDelta);
    expect(events.at(-2)).toMatchObject({ modelCalls: 2 });
    // Each link names the stored relation it stands for, directed as stored.
    const links = (events.filter((e) => e.type === "entities").at(-1)!.links as Row[]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(relations.get(link.id as string), JSON.stringify(link)).toEqual({
        type: link.type, from: cards.get(link.from as string)!.id, to: cards.get(link.to as string)!.id,
      });
    }
    // The answer cites evidence refs.
    const cited = [...reply.matchAll(/\[(E\d+)/g)].map((m) => m[1]!);
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every((ref) => cards.get(ref)?.evidence === true), reply).toBe(true);
  });

  ifAvailable("a follow-up on the thread starts from what the first answer cited", async () => {
    const first = await ask("Which projects do the people Lena Vogt manages work on?");
    const { reply, events } = await ask("Which skills do those projects require?", first.threadId);
    const cards = [...sidebar(events).values()];
    expect(cards.some((card) => card.role === "focus"), JSON.stringify(cards.map((c) => [c.label, c.role]))).toBe(true);
    expect(reply).toContain("Kubernetes");
    expect(reply).toContain("Python");
    expect(reply).not.toContain("Rust");

    const thread = await app!.inject({ method: "GET", url: `${RUNTIME}/ai/assistants/navigators/_default/threads/${first.threadId}` });
    expect((thread.json().messages as Row[]).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  }, 2);
});
