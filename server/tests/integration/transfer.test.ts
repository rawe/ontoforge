/**
 * Schema transfer against the real database, per ontology: the
 * export→wipe→import→export fixed point, one ontology's export imported
 * into another (bare and populated) with conflicts checked all-or-fail
 * against the target alone, validate-then-write leaving the target
 * untouched on conflict, and the modeling MCP pair (`get_schema` ≡
 * export).
 *
 * `tests/fixtures/export.json` is a stored export payload (format 4.0)
 * over the same design this suite imports; the document is
 * identity-free — no ontology key or name — so it is portable into any
 * ontology. Two normalizations make the comparison meaningful:
 *
 * - Property and inclusion arrays are sorted by key: the full-schema query
 *   collects them WITHOUT an ORDER BY, so their order is storage order —
 *   real, but not deterministic.
 * - The fixture spells an unscoped lens as `"includes": null`; this
 *   export omits the key entirely, per the docs' "absent entirely".
 */

import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, unknown>;

const EXPORT_FIXTURE = JSON.parse(
  readFileSync(new URL("../fixtures/export.json", import.meta.url), "utf8"),
) as Row;

/** Order-normalize a payload and drop `includes: null` (the fixture's
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
  for (const lens of (clone.lenses as Row[]) ?? []) {
    if (lens.includes === null) {
      delete lens.includes;
    } else if (lens.includes) {
      const includes = lens.includes as Row;
      ((includes.entityTypes as Row[]) ?? []).sort(byKey);
      ((includes.relationTypes as Row[]) ?? []).sort(byKey);
    }
  }
  return clone;
}

let app: FastifyInstance;
let baseUrl: string;

async function createOntology(key: string): Promise<void> {
  const res = await app.inject({ method: "POST", url: "/api/ontologies", payload: { key } });
  expect(res.statusCode, res.body).toBe(201);
}

async function importInto(ontologyKey: string, payload: Row) {
  return app.inject({
    method: "POST",
    url: `/api/ontologies/${ontologyKey}/model/import`,
    payload,
  });
}

async function exportFrom(ontologyKey: string): Promise<Row> {
  const res = await app.inject({
    method: "GET",
    url: `/api/ontologies/${ontologyKey}/model/export`,
  });
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
  await createOntology("test_ont");
});

describe("round-trip against a stored export document", () => {
  it("imports the fixture payload and re-exports it identically", async () => {
    const res = await importInto("test_ont", EXPORT_FIXTURE);
    expect(res.statusCode, res.body).toBe(201);
    const created = (res.json() as { lenses: Row[] }).lenses;
    expect(created.map((o) => o.key)).toEqual(["hr_view", "test_lens"]);
    // Created lenses answer in the lens response shape, ids regenerated.
    expect(created[0]!.lensId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created[0]!.createdAt).toBeTruthy();

    const reExported = await exportFrom("test_ont");
    expect(normalize(reExported)).toEqual(normalize(EXPORT_FIXTURE));
  });

  it("recreates the agents and saved queries inside their lens", async () => {
    await importInto("test_ont", EXPORT_FIXTURE);

    const agents = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/model/lenses/hr_view/ai-agents",
    });
    expect(agents.statusCode).toBe(200);
    const agentRows = agents.json() as Row[];
    expect(agentRows.map((a) => a.key)).toEqual(["assistant", "unrestricted"]);
    expect(agentRows[0]!.tools).toEqual(["execute_query", "get_entity", "semantic_search"]);

    const queries = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/model/lenses/hr_view/saved-queries",
    });
    expect(queries.statusCode).toBe(200);
    const queryRows = queries.json() as Row[];
    expect(queryRows.map((q) => q.key)).toEqual(["people-by-name", "similar-then-fetch"]);
  });

  it("the export document carries no ontology identity", async () => {
    await importInto("test_ont", EXPORT_FIXTURE);
    const exported = await exportFrom("test_ont");
    expect(Object.keys(exported).sort()).toEqual([
      "entityTypes",
      "formatVersion",
      "lenses",
      "relationTypes",
    ]);
  });
});

describe("transfer between ontologies", () => {
  it("one ontology's export imports into another, bare or populated", async () => {
    await createOntology("target_ont");
    await importInto("test_ont", EXPORT_FIXTURE);

    // Into the bare target: the source ontology holding the same keys is
    // irrelevant — conflicts are checked against the target alone.
    const exported = await exportFrom("test_ont");
    const intoBare = await importInto("target_ont", exported);
    expect(intoBare.statusCode, intoBare.body).toBe(201);
    expect(normalize(await exportFrom("target_ont"))).toEqual(normalize(exported));

    // Into the now-populated target: a disjoint payload still lands.
    const disjoint: Row = {
      formatVersion: "4.0",
      entityTypes: [
        { key: "project", displayName: "Project", description: null, properties: [] },
      ],
      relationTypes: [],
      lenses: [],
    };
    const intoPopulated = await importInto("target_ont", disjoint);
    expect(intoPopulated.statusCode, intoPopulated.body).toBe(201);

    const targetTypes = await app.inject({
      method: "GET",
      url: "/api/ontologies/target_ont/model/entity-types",
    });
    expect((targetTypes.json() as Row[]).map((et) => et.key)).toEqual([
      "company",
      "person",
      "project",
    ]);
    // The source ontology never saw the disjoint payload.
    const sourceTypes = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/model/entity-types",
    });
    expect((sourceTypes.json() as Row[]).map((et) => et.key)).toEqual(["company", "person"]);
  });

  it("conflicts fail all-or-nothing against the target ontology's keys", async () => {
    await createOntology("target_ont");
    await importInto("test_ont", EXPORT_FIXTURE);
    const exported = await exportFrom("test_ont");
    await importInto("target_ont", exported);
    const before = await exportFrom("target_ont");

    const res = await importInto("target_ont", exported);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    for (const key of ["person", "company", "works_for", "hr_view", "test_lens"]) {
      expect(body.error.message).toContain(`'${key}'`);
    }

    expect(await exportFrom("target_ont")).toEqual(before);
  });

  it("import into an unknown ontology answers 404 — import never creates its target", async () => {
    const res = await importInto("no_such_ont", EXPORT_FIXTURE);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { message: string } }).error.message).toContain(
      "'no_such_ont'",
    );
  });
});

describe("fixed point", () => {
  it("export → wipe → import → export yields the identical payload", async () => {
    await importInto("test_ont", EXPORT_FIXTURE);
    const first = await exportFrom("test_ont");

    await wipeDatabase();
    await createOntology("test_ont");
    const res = await importInto("test_ont", first);
    expect(res.statusCode, res.body).toBe(201);

    const second = await exportFrom("test_ont");
    expect(normalize(second)).toEqual(normalize(first));
    // The unscoped lens carries no includes key at all in the TS export.
    const unscoped = (second.lenses as Row[]).find((o) => o.key === "test_lens")!;
    expect("includes" in unscoped).toBe(false);
  });
});

describe("validate-then-write", () => {
  it("a conflicting re-import answers 409 naming every key and changes nothing", async () => {
    await importInto("test_ont", EXPORT_FIXTURE);
    const before = await exportFrom("test_ont");

    const res = await importInto("test_ont", EXPORT_FIXTURE);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    for (const key of ["person", "company", "works_for", "hr_view", "test_lens"]) {
      expect(body.error.message).toContain(`'${key}'`);
    }

    const after = await exportFrom("test_ont");
    expect(after).toEqual(before);
  });

  it("a payload with rule violations writes nothing", async () => {
    const bad = JSON.parse(JSON.stringify(EXPORT_FIXTURE)) as Row;
    ((bad.entityTypes as Row[])[0]!.properties as Row[]).push({
      key: "_id",
      displayName: "Smuggled",
      dataType: "string",
      required: false,
    });
    const res = await importInto("test_ont", bad);
    expect(res.statusCode).toBe(422);
    expect((res.json() as Row & { error: Row }).error.message).toContain("'_id'");

    const after = await exportFrom("test_ont");
    expect(after.entityTypes).toEqual([]);
    expect(after.lenses).toEqual([]);
  });
});

describe("modeling MCP transfer pair", () => {
  // The legacy /mcp/model mount binds to the server's sole ontology
  // (test_ont here) until ticket 17 moves it under /mcp/ontologies.
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
    await importInto("test_ont", EXPORT_FIXTURE);
    const rest = await exportFrom("test_ont");

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
      const result = await callJson(client, "import_schema", { payload: EXPORT_FIXTURE });
      expect((result.lenses as Row[]).map((o) => o.key)).toEqual([
        "hr_view",
        "test_lens",
      ]);

      const again = (await client.callTool({
        name: "import_schema",
        arguments: { payload: EXPORT_FIXTURE },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(again.isError).toBe(true);
      expect(again.content[0]!.text).toContain("already exists");
    } finally {
      await client.close();
    }
  });
});
