/**
 * Schema transfer against the real Neo4j: the export→wipe→import→export
 * fixed point, validate-then-write leaving the database untouched on
 * conflict, the modeling MCP pair (`get_schema` ≡ export), and backward
 * compatibility with payloads written by the previous implementation.
 *
 * `tests/fixtures/python-export.json` is a real `GET /api/model/export`
 * payload from that implementation, over the same design this suite
 * imports. It is kept because such files exist in users' hands: importing
 * one must keep working. Two normalizations make the comparison meaningful:
 *
 * - Property and inclusion arrays are sorted by key: the full-schema query
 *   collects them WITHOUT an ORDER BY, so their order is storage order —
 *   real, but not deterministic.
 * - The legacy payload spells an unscoped lens as `"includes": null`; this
 *   export omits the key entirely, per the docs' "absent entirely".
 */

import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores, wipeDatabase } from "../../src/core/ports.js";

type Row = Record<string, unknown>;

const PYTHON_EXPORT = JSON.parse(
  readFileSync(new URL("../fixtures/python-export.json", import.meta.url), "utf8"),
) as Row;

/** Order-normalize a payload and drop `includes: null` (the legacy
 * spelling of "absent" — this export omits the key). */
function normalize(payload: Row): Row {
  const clone = JSON.parse(JSON.stringify(payload)) as Row;
  const byKey = (a: Row, b: Row) => String(a.key).localeCompare(String(b.key));
  for (const et of (clone.entityTypes as Row[]) ?? []) {
    (et.properties as Row[]).sort(byKey);
  }
  for (const rt of (clone.relationTypes as Row[]) ?? []) {
    (rt.properties as Row[]).sort(byKey);
  }
  for (const ont of (clone.ontologies as Row[]) ?? []) {
    if (ont.includes === null) {
      delete ont.includes;
    } else if (ont.includes) {
      const includes = ont.includes as Row;
      ((includes.entityTypes as Row[]) ?? []).sort(byKey);
      ((includes.relationTypes as Row[]) ?? []).sort(byKey);
    }
  }
  return clone;
}

let app: FastifyInstance;
let baseUrl: string;

async function importPayload(payload: Row) {
  return app.inject({ method: "POST", url: "/api/model/import", payload });
}

async function exportPayload(): Promise<Row> {
  const res = await app.inject({ method: "GET", url: "/api/model/export" });
  expect(res.statusCode).toBe(200);
  return res.json() as Row;
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
});

describe("round-trip against a legacy export", () => {
  it("imports the legacy payload and re-exports it identically", async () => {
    const res = await importPayload(PYTHON_EXPORT);
    expect(res.statusCode, res.body).toBe(201);
    const created = (res.json() as { ontologies: Row[] }).ontologies;
    expect(created.map((o) => o.key)).toEqual(["hr_view", "test_ontology"]);
    // Created lenses answer in the ontology response shape, ids regenerated.
    expect(created[0]!.ontologyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created[0]!.createdAt).toBeTruthy();

    const reExported = await exportPayload();
    expect(normalize(reExported)).toEqual(normalize(PYTHON_EXPORT));
  });

  it("recreates the agents and saved queries inside their lens", async () => {
    await importPayload(PYTHON_EXPORT);

    const agents = await app.inject({
      method: "GET",
      url: "/api/model/ontologies/hr_view/ai-agents",
    });
    expect(agents.statusCode).toBe(200);
    const agentRows = agents.json() as Row[];
    expect(agentRows.map((a) => a.key)).toEqual(["assistant", "unrestricted"]);
    expect(agentRows[0]!.tools).toEqual(["execute_query", "get_entity", "semantic_search"]);

    const queries = await app.inject({
      method: "GET",
      url: "/api/model/ontologies/hr_view/saved-queries",
    });
    expect(queries.statusCode).toBe(200);
    const queryRows = queries.json() as Row[];
    expect(queryRows.map((q) => q.key)).toEqual(["people-by-name", "similar-then-fetch"]);
  });
});

describe("fixed point", () => {
  it("export → wipe → import → export yields the identical payload", async () => {
    await importPayload(PYTHON_EXPORT);
    const first = await exportPayload();

    await wipeDatabase();
    const res = await importPayload(first);
    expect(res.statusCode, res.body).toBe(201);

    const second = await exportPayload();
    expect(normalize(second)).toEqual(normalize(first));
    // The unscoped lens carries no includes key at all in the TS export.
    const unscoped = (second.ontologies as Row[]).find((o) => o.key === "test_ontology")!;
    expect("includes" in unscoped).toBe(false);
  });
});

describe("validate-then-write", () => {
  it("a conflicting re-import answers 409 naming every key and changes nothing", async () => {
    await importPayload(PYTHON_EXPORT);
    const before = await exportPayload();

    const res = await importPayload(PYTHON_EXPORT);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    for (const key of ["person", "company", "works_for", "hr_view", "test_ontology"]) {
      expect(body.error.message).toContain(`'${key}'`);
    }

    const after = await exportPayload();
    expect(after).toEqual(before);
  });

  it("a payload with rule violations writes nothing", async () => {
    const bad = JSON.parse(JSON.stringify(PYTHON_EXPORT)) as Row;
    ((bad.entityTypes as Row[])[0]!.properties as Row[]).push({
      key: "_id",
      displayName: "Smuggled",
      dataType: "string",
      required: false,
    });
    const res = await importPayload(bad);
    expect(res.statusCode).toBe(422);
    expect((res.json() as Row & { error: Row }).error.message).toContain("'_id'");

    const after = await exportPayload();
    expect(after.entityTypes).toEqual([]);
    expect(after.ontologies).toEqual([]);
  });
});

describe("modeling MCP transfer pair", () => {
  async function connect(): Promise<Client> {
    const client = new Client({ name: "session-10-tests", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/model`)));
    return client;
  }

  async function callJson(client: Client, name: string, args: Row = {}): Promise<Row> {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    return JSON.parse(result.content[0]!.text) as Row;
  }

  it("get_schema and export_schema both return exactly the REST export payload", async () => {
    await importPayload(PYTHON_EXPORT);
    const rest = await exportPayload();

    const client = await connect();
    try {
      const viaGetSchema = await callJson(client, "get_schema");
      const viaExport = await callJson(client, "export_schema");
      expect(viaGetSchema).toEqual(rest);
      expect(viaExport).toEqual(rest);
    } finally {
      await client.close();
    }
  });

  it("import_schema imports a payload and reports conflicts as tool errors", async () => {
    const client = await connect();
    try {
      const result = await callJson(client, "import_schema", { payload: PYTHON_EXPORT });
      expect((result.ontologies as Row[]).map((o) => o.key)).toEqual([
        "hr_view",
        "test_ontology",
      ]);

      const again = (await client.callTool({
        name: "import_schema",
        arguments: { payload: PYTHON_EXPORT },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(again.isError).toBe(true);
      expect(again.content[0]!.text).toContain("already exists");
    } finally {
      await client.close();
    }
  });
});
