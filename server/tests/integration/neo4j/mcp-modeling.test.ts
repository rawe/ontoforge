/**
 * Neo4j-specific modeling-MCP behaviour: the reserved-type-key rejection.
 * Only this adapter reserves keys (its physical schema objects share the
 * instance label namespace); the PostgreSQL adapter's reserved sets are
 * provably empty, so the case cannot live in the shared suite.
 *
 * The database-blind modeling-MCP contract lives in
 * `tests/integration/mcp-modeling.test.ts`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { closeStores, initStores, wipeDatabase } from "../../../src/core/ports.js";

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

describe.skipIf(settings.DB_BACKEND !== "neo4j")("modeling MCP on Neo4j", () => {
  let app: FastifyInstance;
  let client: Client;

  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    app = await createApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a bound TCP port");
    }
    client = new Client({ name: "modeling-mcp-neo4j-tests", version: "0.0.1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp/model`)),
    );
  });

  afterAll(async () => {
    await client.close();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  it("a reserved type key is rejected with the vendor-free reserved-set message", async () => {
    const rejected = (await client.callTool({
      name: "create_entity_type",
      arguments: { key: "ontology", display_name: "Injected" },
    })) as unknown as ToolCallResult;
    expect(rejected.isError).toBe(true);
    const message = rejected.content[0]?.text ?? "";
    expect(message).toContain("reserved");
    expect(message.toLowerCase()).not.toContain("neo4j");
  });
});
