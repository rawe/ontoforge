/**
 * Bulk staging against PostgreSQL: a staging request that lists its calls
 * (in order, whole or not at all, faults by item index), the put of an
 * entity by identity and of a relation of a one-per-pair type by its pair,
 * and the configurable limits.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture, modelPrefix, runtimePrefix, type FixtureIds } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const MODEL = modelPrefix("test_ont");
const LENS = runtimePrefix("test_ont", "test_lens");

let app: FastifyInstance;
let fixture: FixtureIds;

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
  fixture = await buildFixture(app);
  for (const id of [fixture.personId, fixture.companyId]) {
    const res = await call("PUT", `${MODEL}/entity-types/${id}`, { identityProperties: ["name"] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  invalidateLoadedSchemaCache();
});

async function call(method: string, url: string, payload?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload: payload as Row }) });
  return { status: res.statusCode, body: res.body === "" ? {} : res.json() };
}

async function start(): Promise<string> {
  const res = await call("POST", `${LENS}/changesets`);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function stage(cs: string, writes: Row[]): Promise<Row[]> {
  const res = await call("POST", `${LENS}/changesets/${cs}/writes`, writes);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row[];
}

async function commit(cs: string): Promise<void> {
  const res = await call("POST", `${LENS}/changesets/${cs}/commit`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function objectCount(cs: string): Promise<number> {
  return (await call("GET", `${LENS}/changesets/${cs}`)).body.objectCount as number;
}

const person = (properties: Row): Row => ({ operation: "put_entity", type: "person", properties });
const company = (name: string): Row => ({ operation: "put_entity", type: "company", properties: { name } });
const employment = (from: string, to: string, properties: Row = {}): Row => ({
  operation: "put_relation",
  type: "works_for",
  fromEntityIdentity: from,
  toEntityIdentity: to,
  properties,
});

async function stored(type: string, identity: string): Promise<Row> {
  const res = await call("GET", `${LENS}/entities/${type}/identity/${encodeURIComponent(identity)}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Row;
}

async function setOnePerPair(): Promise<void> {
  const res = await call("PUT", `${MODEL}/relation-types/${fixture.worksForId}`, { onePerPair: true });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  invalidateLoadedSchemaCache();
}

describe("a staging request that lists its calls", () => {
  it("stages every item in order and answers each item's answer", async () => {
    await setOnePerPair();
    const cs = await start();
    const answers = await stage(cs, [
      person({ name: "Alice", age: 30 }),
      company("Acme"),
      // Ends staged by the items before, named by identity.
      employment("Alice", "Acme", { role: "Engineer" }),
      { operation: "create_entity", type: "person", properties: { name: "Bob" } },
    ]);
    expect(answers.map((a) => a.action)).toEqual(["create", "create", "create", undefined]);
    expect(answers.every((a) => typeof a.id === "string")).toBe(true);
    expect(await objectCount(cs)).toBe(4);
    await commit(cs);
    expect((await stored("person", "Alice")).age).toBe(30);
    expect((await call("GET", `${LENS}/relations/works_for`)).body.items.map((r: Row) => r.role)).toEqual(["Engineer"]);
  });

  it("stages nothing when an item fails, and names every failed item by its index", async () => {
    const cs = await start();
    const res = await call("POST", `${LENS}/changesets/${cs}/writes`, [
      person({ name: "Alice" }),
      person({ age: 3 }),
      company("Acme"),
      { operation: "update_entity", type: "company", identity: "Nowhere", properties: { name: "X" } },
    ]);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe("2 of 4 items failed; nothing was staged");
    const items = res.body.error.details.items as Row[];
    expect(items.map((i) => [i.item, i.code])).toEqual([
      [1, "VALIDATION_ERROR"],
      [3, "RESOURCE_NOT_FOUND"],
    ]);
    expect(Object.keys(items[0]!.details.fields)).toEqual(["name"]);
    expect(await objectCount(cs)).toBe(0);
  });

  it("is refused past 1,000 items, and when it fills the changeset", async () => {
    const cs = await start();
    const many = Array.from({ length: 1001 }, (_, i) => person({ name: `P${i}` }));
    expect((await call("POST", `${LENS}/changesets/${cs}/writes`, many)).status).toBe(422);
    expect((await call("POST", `${LENS}/changesets/${cs}/writes`, [])).status).toBe(422);

    const cap = settings.CHANGESET_MAX_OBJECTS;
    settings.CHANGESET_MAX_OBJECTS = 2;
    try {
      const full = await call("POST", `${LENS}/changesets/${cs}/writes`, [company("A"), company("B"), company("C")]);
      expect(full.status).toBe(409);
      expect(full.body.error.message).toBe(`Changeset '${cs}' is full: at most 2 staged objects`);
      expect(await objectCount(cs)).toBe(0);
    } finally {
      settings.CHANGESET_MAX_OBJECTS = cap;
    }
  });

  it("counts the bytes a batch frees: a large value replaced within one request fits", async () => {
    const cs = await start();
    const [big] = await stage(cs, [person({ name: "Big", email: "x".repeat(600) })]);
    const cap = settings.CHANGESET_MAX_BYTES;
    settings.CHANGESET_MAX_BYTES = 1000;
    try {
      const answers = await stage(cs, [
        // Read the staged bytes first, then free some.
        person({ name: "Small" }),
        { operation: "delete_entity", type: "person", id: big!.id },
        person({ name: "Other", email: "y".repeat(600) }),
      ]);
      expect(answers).toHaveLength(3);
      expect(await objectCount(cs)).toBe(2);
    } finally {
      settings.CHANGESET_MAX_BYTES = cap;
    }
  });

  it("answers 413 for a body over the configured limit", async () => {
    const limit = settings.REQUEST_BODY_LIMIT;
    settings.REQUEST_BODY_LIMIT = 1000;
    const small = await createApp();
    try {
      await small.ready();
      const res = await small.inject({
        method: "POST",
        url: `${LENS}/changesets/x/writes`,
        payload: [person({ name: "x".repeat(2000) })],
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe("PAYLOAD_TOO_LARGE");
    } finally {
      settings.REQUEST_BODY_LIMIT = limit;
      await small.close();
    }
  });
});

describe("a put of an entity", () => {
  it("updates the entity that has the identity, keeping the keys it does not send", async () => {
    const first = await start();
    await stage(first, [person({ name: "Alice", age: 30, email: "a@example.org" })]);
    await commit(first);
    const id = (await stored("person", "Alice"))._id as string;

    const again = await start();
    const [answer] = await stage(again, [person({ name: "Alice", age: 31, email: null })]);
    expect(answer).toEqual({ id, action: "update" });
    await commit(again);
    const alice = await stored("person", "Alice");
    expect([alice._id, alice.age, alice.email]).toEqual([id, 31, undefined]);
    expect((await call("GET", `${LENS}/entities/person`)).body.total).toBe(1);
  });

  it("put twice in one changeset merges into its staged create", async () => {
    const cs = await start();
    const [created, merged] = await stage(cs, [person({ name: "Alice", age: 1 }), person({ name: "Alice", age: 2 })]);
    expect([created!.action, merged!.action, merged!.id]).toEqual(["create", "update", created!.id]);
    expect(await objectCount(cs)).toBe(1);
  });

  it("is refused on a type without identity, or values that build none", async () => {
    const res = await call("PUT", `${MODEL}/entity-types/${fixture.companyId}`, { identityProperties: null });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    invalidateLoadedSchemaCache();
    const cs = await start();
    const none = await call("POST", `${LENS}/changesets/${cs}/writes`, company("Acme"));
    expect(none.status).toBe(422);
    expect(none.body.error.details.fields.type).toContain("has no identity");
    const missing = await call("POST", `${LENS}/changesets/${cs}/writes`, person({ age: 3 }));
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.error.details.fields)).toEqual(["name"]);
  });
});

describe("a put of a relation", () => {
  it("on a type the lens hides is not found, whatever links the pair", async () => {
    await setOnePerPair();
    const res = await call("POST", `${MODEL}/lenses`, { key: "no_links", name: "No links" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    for (const key of ["person", "company"]) {
      const included = await call("POST", `${MODEL}/lenses/${res.body.lensId}/includes/entity-types`, { key });
      expect(included.status, JSON.stringify(included.body)).toBe(201);
    }
    // Listing one relation type hides the others.
    await call("POST", `${MODEL}/lenses/${res.body.lensId}/includes/relation-types`, { key: "manages" });
    invalidateLoadedSchemaCache();
    const first = await start();
    await stage(first, [person({ name: "Alice" }), company("Acme"), employment("Alice", "Acme")]);
    await commit(first);

    const hidden = runtimePrefix("test_ont", "no_links");
    const cs = (await call("POST", `${hidden}/changesets`)).body.id as string;
    const linked = await call("POST", `${hidden}/changesets/${cs}/writes`, employment("Alice", "Acme"));
    const unlinked = await call("POST", `${hidden}/changesets/${cs}/writes`, employment("Alice", "Nowhere"));
    expect(linked.status).toBe(404);
    expect(unlinked.status).toBe(404);
    expect(linked.body.error.message).toBe(unlinked.body.error.message);
  });

  it("is refused on a relation type that is not one per pair", async () => {
    const cs = await start();
    await stage(cs, [person({ name: "Alice" }), company("Acme")]);
    const res = await call("POST", `${LENS}/changesets/${cs}/writes`, employment("Alice", "Acme"));
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.type).toContain("not one per pair");
  });

  it("updates the relation that links the pair, stored or staged", async () => {
    await setOnePerPair();
    const first = await start();
    await stage(first, [person({ name: "Alice" }), company("Acme"), employment("Alice", "Acme", { role: "Engineer" })]);
    await commit(first);
    const [stored] = (await call("GET", `${LENS}/relations/works_for`)).body.items as Row[];

    const again = await start();
    const answers = await stage(again, [
      employment("Alice", "Acme", { role: "Manager" }),
      employment("Alice", "Acme", { since: "2020-01-01" }),
    ]);
    expect(answers).toEqual([
      { id: stored!._id, action: "update" },
      { id: stored!._id, action: "update" },
    ]);
    await commit(again);
    const [after] = (await call("GET", `${LENS}/relations/works_for`)).body.items as Row[];
    expect([after!._id, after!.role, after!.since]).toEqual([stored!._id, "Manager", "2020-01-01"]);
  });

  it("creates a pair's relation again after this changeset deletes it", async () => {
    await setOnePerPair();
    const first = await start();
    await stage(first, [person({ name: "Alice" }), company("Acme"), employment("Alice", "Acme")]);
    await commit(first);
    const [old] = (await call("GET", `${LENS}/relations/works_for`)).body.items as Row[];
    const cs = await start();
    const answers = await stage(cs, [
      { operation: "delete_relation", type: "works_for", id: old!._id },
      employment("Alice", "Acme", { role: "Again" }),
    ]);
    expect(answers[1]!.action).toBe("create");
    await commit(cs);
    const listed = (await call("GET", `${LENS}/relations/works_for`)).body.items as Row[];
    expect(listed.map((r) => r.role)).toEqual(["Again"]);
  });
});
