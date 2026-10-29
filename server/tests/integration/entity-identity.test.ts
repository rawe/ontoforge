/**
 * Entity identity end to end, over REST and MCP, against the
 * docker-compose PostgreSQL (`docs/capabilities/entity-identity.md`):
 * declaring an identity (the list, the stored data, the cascade), the
 * locks, writes and addressing by identity, renames, concurrent creates,
 * the lens safety net, changesets, a type deleted and created again, and
 * the design transfer.
 *
 * Its own ontology: `box` (identity `code`) and `item` (`code`, `year`,
 * `weight`, the document `notes`), `contains` box → item flagged as a
 * parent relation, `related` item → item; the unscoped lens `all` and
 * `narrow`, which lists item's `name` and `code` only.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import { runQuery, withTransaction } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createOntology, modelPrefix, runtimePrefix } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const O = "ident_ont";
const MODEL = modelPrefix(O);
const ALL = runtimePrefix(O, "all");
const NARROW = runtimePrefix(O, "narrow");

let app: FastifyInstance;
let baseUrl: string;
let itemTypeId: string;
let boxTypeId: string;
let narrowLensId: string;

async function call(method: string, url: string, payload?: unknown): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload: payload as Row }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function ok(method: string, url: string, payload?: unknown, status = method === "POST" ? 201 : 200): Promise<Row> {
  const res = await call(method, url, payload);
  expect(res.status, `${method} ${url}: ${JSON.stringify(res.body)}`).toBe(status);
  return res.body;
}

async function properties(entityTypeId: string): Promise<Row[]> {
  return (await ok("GET", `${MODEL}/entity-types/${entityTypeId}/properties`)) as unknown as Row[];
}

async function property(entityTypeId: string, key: string): Promise<Row> {
  return (await properties(entityTypeId)).find((p) => p.key === key)!;
}

function setIdentity(entityTypeId: string, identityProperties: string[] | null, cascade = false) {
  return call("PUT", `${MODEL}/entity-types/${entityTypeId}${cascade ? "?cascade=true" : ""}`, { identityProperties });
}

/** One identity as a path segment. */
const seg = (identity: string) => encodeURIComponent(identity);

const item = (values: Row, base = ALL) => call("POST", `${base}/entities/item`, values);

async function buildOntology(): Promise<void> {
  await createOntology(app, O);
  const box = await ok("POST", `${MODEL}/entity-types`, { key: "box", displayName: "Box" });
  boxTypeId = box.entityTypeId;
  await ok("POST", `${MODEL}/entity-types/${boxTypeId}/properties`, {
    key: "code",
    displayName: "Code",
    dataType: "string",
    required: true,
  });
  await ok("PUT", `${MODEL}/entity-types/${boxTypeId}`, { identityProperties: ["code"] });

  const it = await ok("POST", `${MODEL}/entity-types`, { key: "item", displayName: "Item" });
  itemTypeId = it.entityTypeId;
  for (const prop of [
    { key: "code", displayName: "Code", dataType: "string", required: false },
    { key: "year", displayName: "Year", dataType: "integer", required: false, defaultValue: "2000" },
    { key: "weight", displayName: "Weight", dataType: "float", required: false },
    { key: "notes", displayName: "Notes", dataType: "document", required: false },
  ]) {
    await ok("POST", `${MODEL}/entity-types/${itemTypeId}/properties`, prop);
  }
  await ok("POST", `${MODEL}/relation-types`, {
    key: "contains",
    displayName: "Contains",
    sourceEntityTypeKey: "box",
    targetEntityTypeKey: "item",
    parent: "source",
  });
  await ok("POST", `${MODEL}/relation-types`, {
    key: "related",
    displayName: "Related",
    sourceEntityTypeKey: "item",
    targetEntityTypeKey: "item",
  });
  await ok("POST", `${MODEL}/lenses`, { key: "all", name: "All" });
  const narrow = await ok("POST", `${MODEL}/lenses`, { key: "narrow", name: "Narrow" });
  narrowLensId = narrow.lensId;
  await ok("POST", `${MODEL}/lenses/${narrowLensId}/includes/entity-types`, { key: "item", properties: ["name", "code"] });
}

/** item's identity as (code, year), with the cascade. */
async function identifyItems(): Promise<void> {
  const res = await setIdentity(itemTypeId, ["code", "year"], true);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  await buildOntology();
});

describe("declaring an identity", () => {
  it("refuses a list that cannot be one", async () => {
    for (const [keys, fragment] of [
      [["weight"], "float"],
      [["notes"], "document"],
      [["nope"], "not found"],
      [["code", "code"], "twice"],
      [[], "1 to 5"],
      [["code", "year", "name", "code", "year", "name"], "1 to 5"],
    ] as [string[], string][]) {
      const res = await setIdentity(itemTypeId, keys, true);
      expect(res.status, JSON.stringify(keys)).toBe(422);
      expect(res.body.error.details.fields.identityProperties).toContain(fragment);
    }
  });

  it("needs the cascade for optional, defaulted and allowlist-omitted properties, and repairs them", async () => {
    const refused = await setIdentity(itemTypeId, ["code", "year"]);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CASCADE_REQUIRED");
    expect(refused.body.error.details.affectedLenses).toEqual(["narrow"]);

    await identifyItems();
    const type = await ok("GET", `${MODEL}/entity-types/${itemTypeId}`);
    expect(type.identityProperties).toEqual(["code", "year"]);
    expect(await property(itemTypeId, "code")).toMatchObject({ required: true, defaultValue: null });
    expect(await property(itemTypeId, "year")).toMatchObject({ required: true, defaultValue: null });
    const narrow = await ok("GET", `${NARROW}/schema/entity-types/item`);
    expect(narrow.identityProperties).toEqual(["code", "year"]);
    expect(narrow.properties.map((p: Row) => p.key).sort()).toEqual(["code", "name", "year"]);

    // Repeating the stored list changes nothing and needs no consent.
    expect((await setIdentity(itemTypeId, ["code", "year"])).status).toBe(200);
  });

  it("refuses stored data that cannot take it, naming the entities; builds and clears every identity", async () => {
    const ids: string[] = [];
    for (const values of [
      { code: "A", year: 1 },
      { code: "A", year: 1 },
      { code: "", year: 2 },
      { year: 3 },
      { code: "B", year: 4 },
    ]) {
      ids.push((await ok("POST", `${ALL}/entities/item`, values))._id);
    }
    const refused = await setIdentity(itemTypeId, ["code", "year"], true);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("RESOURCE_CONFLICT");
    const violations = refused.body.error.details.violations as Row[];
    expect(violations.map((v) => [v.rule, v.count])).toEqual([
      ["missing_value", 2],
      ["duplicate", 2],
    ]);
    expect(violations[0]!.entities.map((e: Row) => e.id)).toEqual([ids[2], ids[3]].sort());
    expect(violations[1]!.entities.map((e: Row) => e.id)).toEqual([ids[0], ids[1]].sort());
    // Nothing was changed: not even the flags the cascade would repair.
    expect((await ok("GET", `${MODEL}/entity-types/${itemTypeId}`)).identityProperties).toBeNull();
    expect((await property(itemTypeId, "code")).required).toBe(false);

    for (const id of ids.slice(1, 4)) await ok("DELETE", `${ALL}/entities/item/${id}`, undefined, 204);
    await identifyItems();
    expect((await ok("GET", `${ALL}/entities/item/${ids[0]}`))._identity).toBe("A~1");
    expect((await ok("GET", `${ALL}/entities/item/${ids[4]}`))._identity).toBe("B~4");

    expect((await setIdentity(itemTypeId, null)).status).toBe(200);
    expect((await ok("GET", `${ALL}/entities/item/${ids[0]}`))._identity).toBeUndefined();
    expect((await call("GET", `${ALL}/entities/item/identity/A~1`)).status).toBe(404);
  });

  it("locks an identity property: it cannot become optional, take a default or be deleted", async () => {
    await identifyItems();
    const code = await property(itemTypeId, "code");
    const url = `${MODEL}/entity-types/${itemTypeId}/properties/${code.propertyId}`;
    for (const [payload, fragment] of [
      [{ required: false }, "become optional"],
      [{ defaultValue: "X" }, "take a default"],
    ] as [Row, string][]) {
      const res = await call("PUT", url, payload);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain(fragment);
    }
    const deleted = await call("DELETE", `${url}?cascade=true`);
    expect(deleted.status).toBe(409);
    expect(deleted.body.error.message).toContain("be deleted");
    // Other changes of the property are allowed.
    expect((await call("PUT", url, { displayName: "Item code" })).status).toBe(200);
  });
});

describe("writes and addressing by identity", () => {
  beforeEach(identifyItems);

  it("reads, updates, walks and deletes by identity; an unknown one is not found", async () => {
    const created = await ok("POST", `${ALL}/entities/item`, { name: "Lamp", code: "50%~off", year: 2024, notes: "Hello" });
    const identity = "50%25%7Eoff~2024";
    expect(created._identity).toBe(identity);
    const at = `${ALL}/entities/item/identity/${seg(identity)}`;

    expect((await ok("GET", at))._id).toBe(created._id);
    expect(await ok("GET", `${at}?fields=name`)).toEqual({ _id: created._id, _identity: identity, name: "Lamp" });
    expect(await ok("GET", `${at}/path`)).toEqual([{ type: "item", id: created._id, identity, name: "Lamp" }]);
    expect((await ok("GET", `${at}/neighbors`)).entity._id).toBe(created._id);
    expect((await ok("GET", `${at}/documents/notes`)).content).toBe("Hello");
    await ok("PATCH", `${at}/documents/notes`, { op: "str_replace", oldString: "Hello", newString: "Hi" });
    expect((await ok("GET", `${at}/documents/notes`)).content).toBe("Hi");
    expect((await ok("PATCH", at, { weight: 1.5 })).weight).toBe(1.5);

    expect((await call("GET", `${ALL}/entities/item/identity/${seg("nope~1")}`)).status).toBe(404);
    expect((await call("GET", `${ALL}/entities/box/identity/${seg(identity)}`)).status).toBe(404);

    expect((await call("DELETE", at)).status).toBe(204);
    expect((await call("GET", at)).status).toBe(404);
  });

  it("refuses a taken identity on create and on a renaming update, naming the identity, never the holder", async () => {
    const first = await ok("POST", `${ALL}/entities/item`, { code: "A", year: 1 });
    const other = await ok("POST", `${ALL}/entities/item`, { code: "B", year: 1 });

    const taken = await item({ code: "A", year: 1 });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("RESOURCE_CONFLICT");
    expect(taken.body.error.details).toEqual({ code: "IDENTITY_TAKEN", identity: "A~1", properties: ["code", "year"] });
    expect(JSON.stringify(taken.body)).not.toContain(first._id);

    const renamed = await call("PATCH", `${ALL}/entities/item/${other._id}`, { code: "A" });
    expect(renamed.status).toBe(409);
    expect(renamed.body.error.details.code).toBe("IDENTITY_TAKEN");
    // An update that leaves the identity as it is passes.
    expect((await call("PATCH", `${ALL}/entities/item/${first._id}`, { code: "A", weight: 2 })).status).toBe(200);
  });

  it("renames by an ordinary update: the old identity no longer finds the entity", async () => {
    const created = await ok("POST", `${ALL}/entities/item`, { code: "A", year: 1 });
    const renamed = await ok("PATCH", `${ALL}/entities/item/identity/A~1`, { year: 2 });
    expect(renamed._identity).toBe("A~2");
    expect((await call("GET", `${ALL}/entities/item/identity/A~1`)).status).toBe(404);
    expect((await ok("GET", `${ALL}/entities/item/identity/A~2`))._id).toBe(created._id);
    // The old identity is free again.
    expect((await item({ code: "A", year: 1 })).status).toBe(201);
  });

  it("never writes _identity, and refuses an empty identity value", async () => {
    const write = await item({ code: "A", year: 1, _identity: "X~1" });
    expect(write.status).toBe(422);
    expect(write.body.error.details.fields._identity).toBeDefined();
    const empty = await item({ code: "", year: 1 });
    expect(empty.status).toBe(422);
    expect(empty.body.error.details.fields.code).toBeDefined();
  });

  it("sorts and filters lists by _identity", async () => {
    for (const code of ["b", "a", "c"]) await ok("POST", `${ALL}/entities/item`, { code, year: 1 });
    const sorted = await ok("GET", `${ALL}/entities/item?sort=_identity&order=desc`);
    expect(sorted.items.map((e: Row) => e._identity)).toEqual(["c~1", "b~1", "a~1"]);
    const filtered = await ok("GET", `${ALL}/entities/item?filter._identity=${seg("a~1")}`);
    expect(filtered.items.map((e: Row) => e._identity)).toEqual(["a~1"]);
    const contains = await ok("GET", `${ALL}/entities/item?filter._identity__contains=B`);
    expect(contains.total).toBe(1);
  });

  it("creates and lists relations and creates under a parent by identity", async () => {
    await ok("POST", `${ALL}/entities/box`, { code: "BX" });
    const lamp = await ok("POST", `${ALL}/entities/item`, { code: "A", year: 1 });
    const child = await ok("POST", `${ALL}/entities/item`, {
      code: "B",
      year: 1,
      parentRelation: { type: "contains", parentIdentity: "BX" },
    });
    expect(await ok("GET", `${ALL}/entities/item/${child._id}/path`)).toEqual([
      { type: "box", id: expect.any(String), identity: "BX", name: null },
      { type: "item", id: child._id, identity: "B~1", name: null },
    ]);

    const related = await ok("POST", `${ALL}/relations/related`, { fromEntityIdentity: "A~1", toEntityIdentity: "B~1" });
    expect(related.fromEntityId).toBe(lamp._id);
    expect(related.toEntityId).toBe(child._id);
    const listed = await ok("GET", `${ALL}/relations/related?fromEntityIdentity=${seg("A~1")}`);
    expect(listed.items.map((r: Row) => r._id)).toEqual([related._id]);

    const both = await call("POST", `${ALL}/relations/related`, {
      fromEntityId: lamp._id,
      fromEntityIdentity: "A~1",
      toEntityIdentity: "B~1",
    });
    expect(both.status).toBe(422);
    expect(Object.keys(both.body.error.details.fields).sort()).toEqual(["fromEntityId", "fromEntityIdentity"]);

    const unknown = await call("POST", `${ALL}/relations/related`, { fromEntityIdentity: "Z~9", toEntityIdentity: "B~1" });
    expect(unknown.status, JSON.stringify(unknown.body)).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(unknown.body)).toContain("fromEntityIdentity");

    const orphan = await item({ code: "C", year: 1, parentRelation: { type: "contains", parentIdentity: "NOPE" } });
    expect(orphan.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(orphan.body)).toContain("parentRelation.parentIdentity");
  });

  it("carries _identity in OQL", async () => {
    await ok("POST", `${ALL}/entities/item`, { code: "A", year: 1 });
    await ok("POST", `${ALL}/entities/item`, { code: "B", year: 2 });
    const body = await ok("POST", `${ALL}/query`, {
      query: "MATCH (i:item) WHERE i._identity <> 'B~2' RETURN i._identity AS identity, i AS node",
    }, 200);
    expect(body.results.map((r: Row) => r.identity)).toEqual(["A~1"]);
    expect(body.results[0].node._identity).toBe("A~1");
  });

  it("keeps the identity in step with the values under concurrent updates of different identity properties", async () => {
    for (let round = 0; round < 8; round++) {
      const created = await ok("POST", `${ALL}/entities/item`, { code: `A${round}`, year: 1 });
      const url = `${ALL}/entities/item/${created._id}`;
      const updates = await Promise.all([call("PATCH", url, { code: `B${round}` }), call("PATCH", url, { year: 2 })]);
      for (const update of updates) expect(update.status, JSON.stringify(update.body)).toBe(200);
      const stored = await ok("GET", url);
      expect(stored._identity).toBe(`B${round}~2`);
      expect((await ok("GET", `${ALL}/entities/item/identity/${seg(`B${round}~2`)}`))._id).toBe(created._id);
    }
  });

  it("addresses an identity of the longest form by path", async () => {
    // 510 code points, each four UTF-8 bytes: the segment is 6,000 characters encoded.
    const code = "😀".repeat(508);
    const created = await ok("POST", `${ALL}/entities/item`, { code, year: 1 });
    expect(created._identity).toBe(`${code}~1`);
    expect((await ok("GET", `${ALL}/entities/item/identity/${seg(created._identity)}`))._id).toBe(created._id);
    expect((await ok("GET", `${ALL}/entities/item/identity/${seg(created._identity)}/path`))[0].id).toBe(created._id);
    const escaped = await ok("POST", `${ALL}/entities/item`, { code: "%~".repeat(85), year: 1 });
    expect((await ok("GET", `${ALL}/entities/item/identity/${seg(escaped._identity)}`))._id).toBe(escaped._id);
  });

  it("gives exactly one of several concurrent creates of one identity; the others are IDENTITY_TAKEN", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => item({ code: "RACE", year: 1 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const refused of results.filter((r) => r.status !== 201)) {
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.error.details.code).toBe("IDENTITY_TAKEN");
    }
  });

  it("addresses by identity over MCP", async () => {
    const client = new Client({ name: "identity-tests", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ontologies/${O}/runtime/lenses/all`)));
    try {
      const tool = async (name: string, args: Row) =>
        (await client.callTool({ name, arguments: args })) as unknown as { content: { text: string }[]; isError?: boolean };
      const created = JSON.parse((await tool("create_entity", { entity_type_key: "item", properties: { code: "M", year: 7 } })).content[0]!.text);
      expect(created._identity).toBe("M~7");
      const read = JSON.parse((await tool("get_entity", { entity_type_key: "item", entity_identity: "M~7" })).content[0]!.text);
      expect(read._id).toBe(created._id);
      const both = await tool("get_entity", { entity_type_key: "item", entity_id: created._id, entity_identity: "M~7" });
      expect(both.isError).toBe(true);
      await tool("create_entity", { entity_type_key: "item", properties: { code: "N", year: 7 } });
      const relation = await tool("create_relation", {
        relation_type_key: "related",
        from_entity_identity: "M~7",
        to_entity_identity: "N~7",
      });
      expect(relation.isError, relation.content[0]!.text).toBeFalsy();
      const taken = await tool("create_entity", { entity_type_key: "item", properties: { code: "M", year: 7 } });
      expect(taken.isError).toBe(true);
      expect(taken.content[0]!.text).toContain("M~7");
    } finally {
      await client.close();
    }
  });
});

describe("through a lens", () => {
  it("a lens that hides an identity property (by design import) withholds _identity and finds no identity", async () => {
    await identifyItems();
    const design = await ok("GET", `${MODEL}/export`);
    const narrow = (design.lenses as Row[]).find((l) => l.key === "narrow")!;
    narrow.includes.entityTypes = narrow.includes.entityTypes.map((inc: Row) => ({ ...inc, properties: ["name", "code"] }));
    const copy = "ident_copy";
    await createOntology(app, copy);
    await ok("POST", `${modelPrefix(copy)}/import`, design);

    const created = await ok("POST", `${runtimePrefix(copy, "all")}/entities/item`, { code: "A", year: 1 });
    expect(created._identity).toBe("A~1");
    const hidden = runtimePrefix(copy, "narrow");
    expect((await ok("GET", `${hidden}/schema/entity-types/item`)).identityProperties).toBeNull();
    expect((await ok("GET", `${hidden}/entities/item/${created._id}`))._identity).toBeUndefined();
    expect((await ok("GET", `${hidden}/entities/item`)).items[0]._identity).toBeUndefined();
    expect((await call("GET", `${hidden}/entities/item/identity/A~1`)).status).toBe(404);
    expect((await call("GET", `${hidden}/entities/item?sort=_identity`)).status).toBe(422);
  });
});

describe("in a changeset", () => {
  beforeEach(identifyItems);

  async function start(): Promise<string> {
    return (await ok("POST", `${ALL}/changesets`)).id;
  }
  const stage = (cs: string, write: Row) => call("POST", `${ALL}/changesets/${cs}/writes`, write);
  async function staged(cs: string, write: Row): Promise<Row> {
    const res = await stage(cs, write);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }
  const kinds = (body: Row) => (body.error?.details?.violations ?? []).map((v: Row) => v.kind);

  it("resolves an identity in the changeset's view: created, renamed, deleted, ambiguous", async () => {
    const stored = await ok("POST", `${ALL}/entities/item`, { code: "S", year: 1 });
    const cs = await start();

    const created = await staged(cs, { operation: "create_entity", type: "item", properties: { code: "N", year: 1 } });
    const update = await staged(cs, { operation: "update_entity", type: "item", identity: "N~1", properties: { weight: 3 } });
    expect(update.id).toBe(created.id);

    await staged(cs, { operation: "update_entity", type: "item", identity: "S~1", properties: { year: 2 } });
    expect((await stage(cs, { operation: "update_entity", type: "item", identity: "S~1", properties: { weight: 1 } })).status).toBe(404);
    expect((await staged(cs, { operation: "update_entity", type: "item", identity: "S~2", properties: { weight: 1 } })).id).toBe(stored._id);
    const read = await ok("GET", `${ALL}/changesets/${cs}/entities/item/identity/S~2`);
    expect(read.entity._id).toBe(stored._id);
    expect(read.object.identity).toEqual({ before: "S~1", after: "S~2" });

    await staged(cs, { operation: "delete_entity", type: "item", identity: "N~1" });
    expect((await stage(cs, { operation: "update_entity", type: "item", identity: "N~1", properties: { weight: 1 } })).status).toBe(404);

    await staged(cs, { operation: "create_entity", type: "item", properties: { code: "D", year: 1 } });
    await staged(cs, { operation: "create_entity", type: "item", properties: { code: "D", year: 1 } });
    const ambiguous = await stage(cs, { operation: "update_entity", type: "item", identity: "D~1", properties: { weight: 1 } });
    expect(ambiguous.status).toBe(409);

    const both = await stage(cs, { operation: "update_entity", type: "item", id: stored._id, identity: "S~2", properties: {} });
    expect(both.status).toBe(422);
  });

  it("resolves by the identity the entity has now, after a live write to a value the changeset does not stage", async () => {
    const stored = await ok("POST", `${ALL}/entities/item`, { code: "A", year: 1 });
    const cs = await start();
    await staged(cs, { operation: "update_entity", type: "item", id: stored._id, properties: { code: "B" } });
    await ok("PATCH", `${ALL}/entities/item/${stored._id}`, { year: 2 });

    expect((await ok("GET", `${ALL}/changesets/${cs}/entities/item/identity/B~2`)).entity._id).toBe(stored._id);
    expect((await call("GET", `${ALL}/changesets/${cs}/entities/item/identity/B~1`)).status).toBe(404);
    expect((await staged(cs, { operation: "update_entity", type: "item", identity: "B~2", properties: { weight: 1 } })).id).toBe(stored._id);
    expect((await stage(cs, { operation: "update_entity", type: "item", identity: "B~1", properties: { weight: 1 } })).status).toBe(404);

    // A staged create of B~2 now clashes with it, also on a review page
    // that shows the create alone.
    await staged(cs, { operation: "create_entity", type: "item", properties: { code: "B", year: 2 } });
    for (const page of ["", "?offset=1&limit=1"]) {
      const review = await ok("GET", `${ALL}/changesets/${cs}${page}`);
      expect(review.objects.map((o: Row) => o.markers.map((m: Row) => m.kind)).flat()).toContain("duplicate_identity");
    }
  });

  it("judges an identity a live write makes too long: the preview has none, review and submit report it", async () => {
    const stored = await ok("POST", `${ALL}/entities/item`, { code: "A", year: 1 });
    const cs = await start();
    await staged(cs, { operation: "update_entity", type: "item", id: stored._id, properties: { code: "x".repeat(500) } });
    expect((await ok("GET", `${ALL}/changesets/${cs}/entities/item/${stored._id}`)).entity._identity).toBe(`${"x".repeat(500)}~1`);
    await ok("PATCH", `${ALL}/entities/item/${stored._id}`, { year: Number.MAX_SAFE_INTEGER });

    expect((await ok("GET", `${ALL}/changesets/${cs}/entities/item/${stored._id}`)).entity._identity).toBeUndefined();
    const review = await ok("GET", `${ALL}/changesets/${cs}`);
    expect(JSON.stringify(review.objects[0])).toContain("The identity is longer than 512 characters");
    const submitted = await call("POST", `${ALL}/changesets/${cs}/submit`, {});
    expect(kinds(submitted.body)).toContain("replay");
  });

  it("commits a swap of two identities, and a delete with a create of the same identity", async () => {
    const a = await ok("POST", `${ALL}/entities/item`, { code: "A", year: 1 });
    const b = await ok("POST", `${ALL}/entities/item`, { code: "B", year: 1 });
    const swap = await start();
    await staged(swap, { operation: "update_entity", type: "item", id: a._id, properties: { code: "B" } });
    await staged(swap, { operation: "update_entity", type: "item", id: b._id, properties: { code: "A" } });
    const review = await ok("GET", `${ALL}/changesets/${swap}`);
    expect(review.objects.map((o: Row) => o.identity)).toEqual([
      { before: "A~1", after: "B~1" },
      { before: "B~1", after: "A~1" },
    ]);
    expect(review.objects.flatMap((o: Row) => o.markers)).toEqual([]);
    await ok("POST", `${ALL}/changesets/${swap}/commit`, {}, 200);
    expect((await ok("GET", `${ALL}/entities/item/identity/A~1`))._id).toBe(b._id);
    expect((await ok("GET", `${ALL}/entities/item/identity/B~1`))._id).toBe(a._id);

    const replace = await start();
    await staged(replace, { operation: "delete_entity", type: "item", identity: "A~1" });
    const created = await staged(replace, { operation: "create_entity", type: "item", properties: { code: "A", year: 1 } });
    await ok("POST", `${ALL}/changesets/${replace}/commit`, {}, 200);
    expect((await ok("GET", `${ALL}/entities/item/identity/A~1`))._id).toBe(created.id);
  });

  it("finds two staged creates of one identity on submit, the review, the check and the commit", async () => {
    const cs = await start();
    await staged(cs, { operation: "create_entity", type: "item", properties: { code: "T", year: 1 } });
    await staged(cs, { operation: "create_entity", type: "item", properties: { code: "T", year: 1 } });

    const review = await ok("GET", `${ALL}/changesets/${cs}`);
    expect(review.objects.map((o: Row) => o.markers.map((m: Row) => m.kind))).toEqual([
      ["duplicate_identity"],
      ["duplicate_identity"],
    ]);
    expect(review.objects[0].markers[0].message).toContain("T~1");

    for (const action of ["check", "commit", "submit"]) {
      const res = await call("POST", `${ALL}/changesets/${cs}/${action}`, action === "check" ? undefined : {});
      expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(422);
      expect(kinds(res.body)).toEqual(["duplicate_identity", "duplicate_identity"]);
    }
  });

  it("fails the commit of a staged create whose identity was taken live after staging", async () => {
    const cs = await start();
    await staged(cs, { operation: "create_entity", type: "item", properties: { code: "L", year: 1 } });
    await ok("POST", `${ALL}/entities/item`, { code: "L", year: 1 });
    const checked = await call("POST", `${ALL}/changesets/${cs}/check`);
    expect(kinds(checked.body)).toEqual(["duplicate_identity"]);
    const committed = await call("POST", `${ALL}/changesets/${cs}/commit`, {});
    expect(committed.status).toBe(422);
    expect(kinds(committed.body)).toEqual(["duplicate_identity"]);
    expect((await ok("GET", `${ALL}/entities/item?filter._identity=L~1`)).total).toBe(1);
    expect((await ok("GET", `${ALL}/changesets/${cs}`)).objectCount).toBe(1);
  });
});

/**
 * An item row with `identity` inserted by a transaction of its own that
 * stays open until `release`: another write of that identity passes its
 * checks and waits on it only where uniqueness is finally judged.
 */
async function holdIdentity(identity: string): Promise<{ release: () => Promise<void> }> {
  let held!: () => void;
  const inserted = new Promise<void>((resolve) => (held = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const done = withTransaction(
    async (querier) => {
      await querier.query(`INSERT INTO entity (id, type_key, props, identity) VALUES ($1, 'item', '{}', $2)`, [
        randomUUID(),
        identity,
      ]);
      held();
      await released;
    },
    "READ COMMITTED",
    `ont_${O}`,
  );
  await Promise.race([inserted, done]);
  return {
    release: async () => {
      release();
      await done;
    },
  };
}

/** Until a backend waits on another transaction, as a deferred unique check does. */
async function untilWaiting(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const waiting = await runQuery(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'transactionid'`,
    );
    if ((waiting.rows[0]!.n as number) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("No backend waited on the held identity");
}

describe("an identity taken while a commit runs", () => {
  beforeEach(identifyItems);

  it("fails the commit at its end with a conflict, persisting nothing and keeping the changeset", async () => {
    const cs = (await ok("POST", `${ALL}/changesets`)).id;
    await ok("POST", `${ALL}/changesets/${cs}/writes`, { operation: "create_entity", type: "item", properties: { code: "R", year: 1 } });
    const before = (await ok("GET", `${ALL}/changesets/${cs}`)).version;

    const holder = await holdIdentity("R~1");
    const committing = call("POST", `${ALL}/changesets/${cs}/commit`, {});
    await untilWaiting();
    await holder.release();
    const committed = await committing;
    expect(committed.status, JSON.stringify(committed.body)).toBe(409);
    expect(committed.body.error.message).toBe("An identity was taken meanwhile; nothing was persisted. Check and commit again");
    expect((await ok("GET", `${ALL}/entities/item?filter._identity=R~1`)).total).toBe(1);
    const kept = await ok("GET", `${ALL}/changesets/${cs}`);
    expect([kept.version, kept.objectCount]).toEqual([before, 1]);
  });

  it("a check reports the deferred violation as duplicate_identity", async () => {
    const cs = (await ok("POST", `${ALL}/changesets`)).id;
    await ok("POST", `${ALL}/changesets/${cs}/writes`, { operation: "create_entity", type: "item", properties: { code: "Q", year: 1 } });

    const holder = await holdIdentity("Q~1");
    const checking = call("POST", `${ALL}/changesets/${cs}/check`);
    await untilWaiting();
    await holder.release();
    const checked = await checking;
    expect(checked.status, JSON.stringify(checked.body)).toBe(422);
    expect(checked.body.error.details.violations.map((v: Row) => v.kind)).toEqual(["duplicate_identity"]);
  });
});

describe("the type and the design", () => {
  it("deleting a type clears its orphaned identities; a new type of the key builds them again", async () => {
    const kept = await ok("POST", `${ALL}/entities/box`, { code: "K" });
    await ok("DELETE", `${MODEL}/relation-types/${await relationTypeId("contains")}`, undefined, 204);
    await ok("DELETE", `${MODEL}/entity-types/${boxTypeId}`, undefined, 204);
    const orphan = await runQuery(`SELECT identity FROM entity WHERE id = $1`, [kept._id], `ont_${O}`);
    expect(orphan.rows).toEqual([{ identity: null }]);

    // A type of the same key finds the stored entities again; without an
    // identity nothing is held, and setting one builds every identity.
    const again = await ok("POST", `${MODEL}/entity-types`, { key: "box", displayName: "Box" });
    await ok("POST", `${MODEL}/entity-types/${again.entityTypeId}/properties`, {
      key: "code",
      displayName: "Code",
      dataType: "string",
      required: true,
    });
    await ok("POST", `${ALL}/entities/box`, { code: "J" });
    await ok("PUT", `${MODEL}/entity-types/${again.entityTypeId}`, { identityProperties: ["code"] });
    expect((await ok("GET", `${ALL}/entities/box/identity/K`))._id).toBe(kept._id);
    expect((await ok("GET", `${ALL}/entities/box/identity/J`))._identity).toBe("J");
  });

  it("carries identityProperties through a design round trip", async () => {
    await identifyItems();
    const design = await ok("GET", `${MODEL}/export`);
    const types = Object.fromEntries((design.entityTypes as Row[]).map((t) => [t.key, t]));
    expect(types.item.identityProperties).toEqual(["code", "year"]);
    expect(types.box.identityProperties).toEqual(["code"]);
    await createOntology(app, "ident_round");
    await ok("POST", `${modelPrefix("ident_round")}/import`, design);
    expect(await ok("GET", `${modelPrefix("ident_round")}/export`)).toEqual(design);

    const optional = structuredClone(design);
    const box = (optional.entityTypes as Row[]).find((t) => t.key === "box")!;
    box.properties.find((p: Row) => p.key === "code").required = false;
    await createOntology(app, "ident_bad");
    const refused = await call("POST", `${modelPrefix("ident_bad")}/import`, optional);
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain("identity of entity type 'box'");
  });
});

async function relationTypeId(key: string): Promise<string> {
  const types = (await ok("GET", `${MODEL}/relation-types`)) as unknown as Row[];
  return types.find((t) => t.key === key)!.relationTypeId;
}
