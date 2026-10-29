/**
 * Neighbours through a scoped lens, end to end against PostgreSQL: the
 * relation types the lens hides take no room in the page, so `limit`
 * counts visible neighbours only.
 *
 * The main fixture's `hr_view` shows person, company and works_for; it
 * hides the self-relation manages.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture, runtimePrefix } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const WIDE = runtimePrefix("test_ont", "test_lens");
const HR = runtimePrefix("test_ont", "hr_view");

let app: FastifyInstance;

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  await buildFixture(app);
});

async function created(url: string, payload: Row): Promise<string> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, res.body).toBe(201);
  return res.json()._id as string;
}

async function neighbourIds(base: string, entityId: string, query: string): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: `${base}/entities/person/${entityId}/neighbors?${query}` });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().neighbors as Row[]).map((n) => n.entity._id as string).sort();
}

describe("neighbours through a scoped lens", () => {
  it("hidden relations do not use up the limit", async () => {
    const alice = await created(`${WIDE}/entities/person`, { name: "Alice" });
    // Hidden first: three manages relations, more than the limit.
    for (const name of ["Bob", "Carol", "Dave"]) {
      const report = await created(`${WIDE}/entities/person`, { name });
      await created(`${WIDE}/relations/manages`, { fromEntityId: alice, toEntityId: report });
    }
    const companies: string[] = [];
    for (const name of ["Acme", "Globex"]) {
      const company = await created(`${WIDE}/entities/company`, { name });
      await created(`${WIDE}/relations/works_for`, { fromEntityId: alice, toEntityId: company });
      companies.push(company);
    }

    expect(await neighbourIds(HR, alice, "limit=2")).toEqual([...companies].sort());
    expect(await neighbourIds(HR, alice, "direction=outgoing&limit=3")).toEqual([...companies].sort());
    // A hidden type named outright reads nothing.
    expect(await neighbourIds(HR, alice, "relationTypeKey=manages")).toEqual([]);
    // The wide lens still pages over every relation type.
    expect(await neighbourIds(WIDE, alice, "limit=5")).toHaveLength(5);
  });
});
