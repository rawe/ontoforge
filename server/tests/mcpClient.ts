/**
 * MCP clients for tests, on the protocol revision the mounts serve:
 * `mcpClient` for a mount's URL, `connectServer` for a server built in the
 * test and served in memory through the same entry as the mounts.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";

export function mcpClient(name: string): Client {
  return new Client({ name, version: "0.0.1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
}

const builds = new AsyncLocalStorage<() => McpServer>();
const entry = createMcpHandler(() => builds.getStore()!(), { legacy: "reject", responseMode: "json" });

/** A client of the servers `build` makes, a fresh one per request, as a mount builds them. */
export async function connectServer(name: string, build: () => McpServer): Promise<Client> {
  const client = mcpClient(name);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://in-memory/mcp"), {
      fetch: (url, init) => builds.run(build, () => entry.fetch(new Request(url, init))),
    }),
  );
  return client;
}

/** The headers and body of one raw request to a mount, as a client on the
 * served revision sends it. */
export function mcpRequest(method: string, params: Record<string, unknown> = {}): { headers: Record<string, string>; payload: object } {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (method === "tools/call") headers["mcp-name"] = String(params.name);
  const _meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "raw", version: "0.0.1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  return { headers, payload: { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta } } };
}
