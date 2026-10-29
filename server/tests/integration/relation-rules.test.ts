/**
 * Relation rules against PostgreSQL: one per pair on a relation type —
 * declared, refused over stored data, implied by a parent end — and how it
 * binds an immediate relation create, a changeset and transfer.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture, createOntology, modelPrefix, runtimePrefix, type FixtureIds } from "./fixture.js";
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
});

async function call(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function entity(type: string, name: string): Promise<string> {
  const res = await call("POST", `${LENS}/entities/${type}`, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body._id as string;
}

function link(from: string, to: string, extra: Row = {}): Promise<{ status: number; body: Row }> {
  return call("POST", `${LENS}/relations/works_for`, { fromEntityId: from, toEntityId: to, ...extra });
}

async function setRules(rules: Row): Promise<{ status: number; body: Row }> {
  const res = await call("PUT", `${MODEL}/relation-types/${fixture.worksForId}`, rules);
  invalidateLoadedSchemaCache();
  return res;
}

describe("declaring one per pair", () => {
  it("is off by default and turns on and off; every read carries it", async () => {
    expect((await call("GET", `${MODEL}/relation-types/${fixture.worksForId}`)).body.onePerPair).toBe(false);
    const on = await setRules({ onePerPair: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.onePerPair).toBe(true);
    const listed = (await call("GET", `${MODEL}/relation-types`)).body as Row[];
    expect(listed.find((rt) => rt.key === "works_for")!.onePerPair).toBe(true);
    const off = await setRules({ onePerPair: false });
    expect(off.body.onePerPair).toBe(false);
  });

  it("is refused while the stored relations link a pair twice, naming the pairs' sources", async () => {
    const [alice, acme] = [await entity("person", "Alice"), await entity("company", "Acme")];
    expect((await link(alice, acme)).status).toBe(201);
    expect((await link(alice, acme)).status).toBe(201);
    const refused = await setRules({ onePerPair: true, displayName: "Employed by" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("cannot take one per pair");
    expect(refused.body.error.details.violations).toEqual([
      { rule: "duplicate_pair", count: 1, entities: [{ type: "person", id: alice }] },
    ]);
    // Nothing else of the update was written.
    const read = (await call("GET", `${MODEL}/relation-types/${fixture.worksForId}`)).body;
    expect([read.onePerPair, read.displayName]).toEqual([false, "Works For"]);
  });

  it("is implied by a parent end, kept when the parent end is cleared, and never turned off under one", async () => {
    const parent = await setRules({ parent: "target" });
    expect([parent.body.parent, parent.body.onePerPair]).toEqual(["target", true]);
    const off = await setRules({ onePerPair: false });
    expect(off.status).toBe(422);
    expect(off.body.error.details.fields.onePerPair).toContain("always one per pair");
    const cleared = await setRules({ parent: null });
    expect([cleared.body.parent, cleared.body.onePerPair]).toEqual([null, true]);
    expect((await setRules({ onePerPair: false })).body.onePerPair).toBe(false);
  });
});

describe("an immediate relation create", () => {
  it("of a pair already linked answers PAIR_TAKEN; the reverse pair and other pairs stay free", async () => {
    await setRules({ onePerPair: true });
    const [alice, bob, acme] = [await entity("person", "Alice"), await entity("person", "Bob"), await entity("company", "Acme")];
    expect((await link(alice, acme, { role: "Engineer" })).status).toBe(201);
    const taken = await link(alice, acme, { role: "Manager" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("RESOURCE_CONFLICT");
    expect(taken.body.error.details).toEqual({ code: "PAIR_TAKEN", relationTypeKey: "works_for" });
    expect((await link(bob, acme)).status).toBe(201);
    const listed = await call("GET", `${LENS}/relations/works_for`);
    expect(listed.body.total).toBe(2);
  });

  it("of one pair at the same time leaves exactly one relation", async () => {
    await setRules({ onePerPair: true });
    const [alice, acme] = [await entity("person", "Alice"), await entity("company", "Acme")];
    const answers = await Promise.all(Array.from({ length: 4 }, () => link(alice, acme)));
    expect(answers.map((a) => a.status).sort()).toEqual([201, 409, 409, 409]);
    expect((await call("GET", `${LENS}/relations/works_for`)).body.total).toBe(1);
  });
});

describe("a changeset", () => {
  async function start(): Promise<string> {
    const res = await call("POST", `${LENS}/changesets`);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function stage(cs: string, write: Row): Promise<string> {
    const res = await call("POST", `${LENS}/changesets/${cs}/writes`, write);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }

  it("marks a create of a pair stored or staged twice as duplicate_pair and rejects its commit", async () => {
    await setRules({ onePerPair: true });
    const [alice, bob, acme] = [await entity("person", "Alice"), await entity("person", "Bob"), await entity("company", "Acme")];
    expect((await link(alice, acme)).status).toBe(201);
    const cs = await start();
    const stored = await stage(cs, { operation: "create_relation", type: "works_for", fromEntityId: alice, toEntityId: acme });
    const first = await stage(cs, { operation: "create_relation", type: "works_for", fromEntityId: bob, toEntityId: acme });
    const second = await stage(cs, { operation: "create_relation", type: "works_for", fromEntityId: bob, toEntityId: acme });
    const read = (await call("GET", `${LENS}/changesets/${cs}`)).body;
    const markers = Object.fromEntries((read.objects as Row[]).map((o) => [o.id, o.markers.map((m: Row) => m.kind)]));
    expect([markers[stored], markers[first], markers[second]]).toEqual([["duplicate_pair"], ["duplicate_pair"], ["duplicate_pair"]]);
    const rejected = await call("POST", `${LENS}/changesets/${cs}/commit`);
    expect(rejected.status).toBe(422);
    expect((rejected.body.error.details.violations as Row[]).map((v) => [v.object, v.kind])).toEqual([
      [stored, "duplicate_pair"],
      [first, "duplicate_pair"],
      [second, "duplicate_pair"],
    ]);
  });

  it("may delete a pair's relation and create it again", async () => {
    await setRules({ onePerPair: true });
    const [alice, acme] = [await entity("person", "Alice"), await entity("company", "Acme")];
    const old = (await link(alice, acme, { role: "Engineer" })).body._id as string;
    const cs = await start();
    await stage(cs, { operation: "delete_relation", type: "works_for", id: old });
    await stage(cs, { operation: "create_relation", type: "works_for", fromEntityId: alice, toEntityId: acme, properties: { role: "Manager" } });
    const committed = await call("POST", `${LENS}/changesets/${cs}/commit`);
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    const listed = (await call("GET", `${LENS}/relations/works_for`)).body;
    expect(listed.items.map((r: Row) => r.role)).toEqual(["Manager"]);
  });

  it("whose pair another write took after staging fails the commit, persisting nothing", async () => {
    await setRules({ onePerPair: true });
    const [alice, acme] = [await entity("person", "Alice"), await entity("company", "Acme")];
    const cs = await start();
    await stage(cs, { operation: "create_relation", type: "works_for", fromEntityId: alice, toEntityId: acme });
    const checked = await call("POST", `${LENS}/changesets/${cs}/check`);
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    expect((await link(alice, acme)).status).toBe(201);
    const rejected = await call("POST", `${LENS}/changesets/${cs}/commit`);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.details.violations[0].kind).toBe("duplicate_pair");
    expect((await call("GET", `${LENS}/relations/works_for`)).body.total).toBe(1);
  });
});

describe("transfer", () => {
  it("carries one per pair, and import refuses it over stored relations that link a pair twice", async () => {
    await setRules({ onePerPair: true });
    const exported = (await call("GET", `${MODEL}/export`)).body;
    const worksFor = (exported.relationTypes as Row[]).find((rt) => rt.key === "works_for")!;
    expect(worksFor.onePerPair).toBe(true);
    const manages = (exported.relationTypes as Row[]).find((rt) => rt.key === "manages")!;
    expect(manages.onePerPair).toBeUndefined();

    await createOntology(app, "copy");
    const imported = await call("POST", `${modelPrefix("copy")}/import`, exported);
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const copied = (await call("GET", `${modelPrefix("copy")}/relation-types`)).body as Row[];
    expect(copied.find((rt) => rt.key === "works_for")!.onePerPair).toBe(true);
  });
});
