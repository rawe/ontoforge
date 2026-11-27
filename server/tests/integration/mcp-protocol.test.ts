/**
 * The protocol both MCP mounts speak, on the wire (`docs/interfaces/mcp.md#mcp`):
 * revision 2026-07-28 only, each request on its own, answered in plain
 * JSON. A 2025-era `initialize` is refused, and only POST is routed. Only
 * the modeling mount serves the built-in skills.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mcpRequest } from "../mcpClient.js";
import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

let app: FastifyInstance;
let baseUrl: string;

const MOUNTS = {
  modeling: "/mcp/ontologies/test_ont/model",
  runtime: "/mcp/ontologies/test_ont/runtime/lenses/test_lens",
};

async function post(path: string, method: string, params?: Record<string, unknown>) {
  const { headers, payload } = mcpRequest(method, params);
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
  return { status: res.status, type: res.headers.get("content-type"), body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  await buildFixture(app);
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe.each(Object.entries(MOUNTS))("the %s mount", (kind, path) => {
  it("discovers, lists and calls tools at 2026-07-28, in plain JSON", async () => {
    const discovered = await post(path, "server/discover");
    expect(discovered.status).toBe(200);
    expect(discovered.type).toContain("application/json");
    expect(discovered.body.result.supportedVersions).toEqual(["2026-07-28"]);
    expect(discovered.body.result.capabilities.tools).toEqual({ listChanged: false });

    const listed = await post(path, "tools/list");
    expect(listed.status).toBe(200);
    expect(listed.type).toContain("application/json");
    expect(listed.body.result.tools.map((tool: { name: string }) => tool.name)).toContain("get_schema");

    const called = await post(path, "tools/call", { name: "get_schema", arguments: {} });
    expect(called.status).toBe(200);
    expect(called.type).toContain("application/json");
    expect(called.body.result.isError).toBeUndefined();
    const schema = JSON.parse(called.body.result.content[0].text);
    expect(schema.entityTypes.map((type: { key: string }) => type.key)).toContain("person");
    if (kind === "runtime") expect(schema.lens.key).toBe("test_lens");
  });

  it("refuses a 2025-era initialize", async () => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0.0.1" } },
      }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: { data: { supported: string[] } } };
    expect(body.error.data.supported).toEqual(["2026-07-28"]);
  });

  it("routes only POST", async () => {
    for (const method of ["GET", "DELETE"]) {
      expect((await fetch(`${baseUrl}${path}`, { method })).status, method).toBe(404);
    }
  });
});

describe("the built-in skills", () => {
  const SKILLS = "io.modelcontextprotocol/skills";

  it("are served on the modeling mount", async () => {
    const discovered = await post(MOUNTS.modeling, "server/discover");
    expect(discovered.body.result.capabilities.extensions).toHaveProperty([SKILLS]);
    const listed = await post(MOUNTS.modeling, "skills/list");
    expect(listed.status).toBe(200);
    expect(listed.type).toContain("application/json");
    expect(listed.body.result.skills.map((skill: { frontmatter: { name: string } }) => skill.frontmatter.name)).toContain(
      "property-or-relation",
    );
  });

  it("are not served on a runtime mount", async () => {
    const discovered = await post(MOUNTS.runtime, "server/discover");
    expect(discovered.body.result.capabilities.extensions?.[SKILLS]).toBeUndefined();
    const listed = await post(MOUNTS.runtime, "skills/list");
    expect(listed.body.error.code).toBe(-32601);
  });
});
