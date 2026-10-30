/**
 * Named searches against the real database, without an embedding
 * provider: modeling REST and MCP upsert, list and delete by key; the
 * check at save against a real lens — a hidden property in a stored
 * filter, an index the lens cannot search; deleting the lens deletes its
 * named searches; and export/import carry them inside their lens, an
 * import whose tree the imported lens cannot run writing nothing.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { buildFixture, createOntology, modelPrefix } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, unknown>;

const MODEL = modelPrefix("test_ont");

let app: FastifyInstance;
let baseUrl: string;

/** People ranked by keyword, restricted to those 30 or older. */
const TREE = {
  kind: "cut",
  limit: 10,
  input: {
    kind: "restrict",
    input: { kind: "group", key: "entity", input: { kind: "keywordSearch", index: "person~default", text: "$query", match: "all" } },
    filters: [{ kind: "filter", entityType: "person", conditions: { age__gte: "30" } }],
  },
};

async function inject(method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Row }) });
  return { statusCode: res.statusCode, body: res.body === "" ? null : (res.json() as unknown) };
}

const put = (lensKey: string, key: string, tree: unknown, name = "People") =>
  inject("PUT", `${MODEL}/lenses/${lensKey}/named-searches/${key}`, { name, description: "Find people", tree });

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const { hrViewId } = await buildFixture(app);
  // hr_view includes its types after their indices exist, so no index yet.
  const included = await inject("POST", `${MODEL}/lenses/${hrViewId}/includes/search-indices`, { key: "person~default" });
  expect(included.statusCode).toBe(201);
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("modeling REST", () => {
  it("upserts by key — 201, then 200 — lists the tree as stored, deletes by key", async () => {
    const created = await put("test_lens", "older-people", TREE);
    expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ key: "older-people", name: "People", description: "Find people", tree: TREE });

    const replaced = await put("test_lens", "older-people", TREE, "Older people");
    expect(replaced.statusCode).toBe(200);

    const listed = await inject("GET", `${MODEL}/lenses/test_lens/named-searches`);
    expect(listed.statusCode).toBe(200);
    expect((listed.body as Row[]).map((ns) => [ns.key, ns.name, ns.tree])).toEqual([
      ["older-people", "Older people", TREE],
    ]);

    expect((await inject("DELETE", `${MODEL}/lenses/test_lens/named-searches/older-people`)).statusCode).toBe(204);
    expect((await inject("DELETE", `${MODEL}/lenses/test_lens/named-searches/older-people`)).statusCode).toBe(404);
    expect((await inject("GET", `${MODEL}/lenses/test_lens/named-searches`)).body).toEqual([]);
  });

  it("checks the tree against the lens: a property it hides, an index it cannot search", async () => {
    // hr_view shows person's name and email only.
    const res = await put("hr_view", "hidden", {
      ...TREE,
      input: {
        ...TREE.input,
        input: {
          kind: "fuse",
          inputs: [
            TREE.input.input,
            { kind: "group", key: "entity", input: { kind: "keywordSearch", index: "spaceship~default", text: "$query" } },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(422);
    const errors = ((res.body as Row).error as Row).details as { errors: string[] };
    expect(errors.errors).toEqual([
      "tree.input.filters.0.conditions.age__gte: Unknown filter property or relation type: 'age'",
      "tree.input.input.inputs.1.input.index: Search index 'spaceship~default' is not searchable in this lens",
    ]);
    expect((await inject("GET", `${MODEL}/lenses/hr_view/named-searches`)).body).toEqual([]);
  });

  it("deleting the lens deletes its named searches", async () => {
    const created = await inject("POST", `${MODEL}/lenses`, { key: "cascade_probe", name: "Cascade Probe" });
    expect(created.statusCode).toBe(201);
    expect((await put("cascade_probe", "doomed", TREE)).statusCode).toBe(201);

    const deleted = await inject("DELETE", `${MODEL}/lenses/${(created.body as Row).lensId as string}`);
    expect(deleted.statusCode).toBe(200);
    expect((await inject("POST", `${MODEL}/lenses`, { key: "cascade_probe", name: "Again" })).statusCode).toBe(201);
    expect((await inject("GET", `${MODEL}/lenses/cascade_probe/named-searches`)).body).toEqual([]);
  });
});

describe("modeling MCP", () => {
  it("set_named_search, list_named_searches and delete_named_search", async () => {
    const client = new Client({ name: "named-searches-tests", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ontologies/test_ont/model`)));
    type Result = { content: { text: string }[]; isError?: boolean };
    const call = async (name: string, args: Row) => (await client.callTool({ name, arguments: args })) as unknown as Result;
    try {
      const set = await call("set_named_search", {
        lens_key: "test_lens",
        key: "by-mcp",
        name: "By MCP",
        description: "Set over MCP",
        tree: TREE,
      });
      expect(set.isError, set.content[0]!.text).toBeFalsy();
      expect(JSON.parse(set.content[0]!.text)).toMatchObject({ key: "by-mcp", tree: TREE, created: true });

      const refused = await call("set_named_search", {
        lens_key: "test_lens",
        key: "no-query",
        name: "No query",
        description: "d",
        tree: { ...TREE, input: { ...TREE.input, input: { ...TREE.input.input, input: { kind: "keywordSearch", index: "person~default", text: "people" } } } },
      });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toContain("$query");

      const listed = await call("list_named_searches", { lens_key: "test_lens" });
      expect((JSON.parse(listed.content[0]!.text) as Row[]).map((ns) => ns.key)).toEqual(["by-mcp"]);

      const deleted = await call("delete_named_search", { lens_key: "test_lens", search_key: "by-mcp" });
      expect(deleted.isError).toBeFalsy();
      expect(JSON.parse((await call("list_named_searches", { lens_key: "test_lens" })).content[0]!.text)).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

describe("transfer", () => {
  it("export carries a lens's named searches; import into another ontology recreates them", async () => {
    expect((await put("hr_view", "named-people", {
      kind: "cut",
      limit: 5,
      input: { kind: "group", key: "entity", input: { kind: "keywordSearch", index: "person~default", text: "$query" } },
    })).statusCode).toBe(201);
    expect((await put("test_lens", "older-people", TREE)).statusCode).toBe(201);
    const exported = (await inject("GET", `${MODEL}/export`)).body as { lenses: Row[] };
    const carried = Object.fromEntries(exported.lenses.map((lens) => [lens.key, lens.namedSearches]));
    expect(carried["test_lens"]).toEqual([{ key: "older-people", name: "People", description: "Find people", tree: TREE }]);
    expect((carried["hr_view"] as Row[]).map((ns) => ns.key)).toEqual(["named-people"]);

    await createOntology(app, "ns_copy");
    const imported = await inject("POST", `${modelPrefix("ns_copy")}/import`, exported);
    expect(imported.statusCode, JSON.stringify(imported.body)).toBe(201);
    const reExported = (await inject("GET", `${modelPrefix("ns_copy")}/export`)).body as { lenses: Row[] };
    expect(Object.fromEntries(reExported.lenses.map((lens) => [lens.key, lens.namedSearches]))).toEqual(carried);
  });

  it("an import whose tree the imported lens cannot run is refused, every violation named; nothing is written", async () => {
    const exported = (await inject("GET", `${MODEL}/export`)).body as { lenses: Row[] };
    const hrView = exported.lenses.find((lens) => lens.key === "hr_view")!;
    hrView.namedSearches = [{ key: "hidden", name: "Hidden", description: "d", tree: TREE }];

    await createOntology(app, "ns_refused");
    const res = await inject("POST", `${modelPrefix("ns_refused")}/import`, exported);
    expect(res.statusCode).toBe(422);
    expect(((res.body as Row).error as Row).details).toEqual({
      errors: [
        "Import error: named search 'hidden' of lens 'hr_view' tree.input.filters.0.conditions.age__gte: " +
          "Unknown filter property or relation type: 'age'",
      ],
    });
    const after = (await inject("GET", `${modelPrefix("ns_refused")}/export`)).body as Row;
    expect([after.entityTypes, after.lenses]).toEqual([[], []]);
  });
});
