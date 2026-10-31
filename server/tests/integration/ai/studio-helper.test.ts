/**
 * The Studio helper against the real database and the configured language
 * model: it answers a question about a small schema through the Studio
 * route, from the design alone, and validates a lens with its tool.
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
async function ask(message: string): Promise<Row[]> {
  const res = await app!.inject({ method: "POST", url: `${MODEL}/ai/chat`, payload: { message } });
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
});
