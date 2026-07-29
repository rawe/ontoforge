/**
 * MCP mounts on the Fastify app.
 *
 * The modeling server is mounted at exactly `/mcp/model` — global by
 * design, no ontology key, and a trailing path segment is NOT a lens (it
 * falls through to the app's standard 404). Transport is Streamable HTTP,
 * STATELESS, with plain JSON responses (no SSE), per
 * `docs/decisions.md#interfaces`: a fresh server + transport pair serves
 * each request, so one mount serves many clients and no connection
 * carries state.
 *
 * The runtime MCP server (with its ontology-key resolution) arrives in
 * session 04 and mounts here beside the modeling server.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";

import { createModelingMcpServer } from "./modeling.js";

export function mountMcp(app: FastifyInstance): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/model",
    schema: { hide: true },
    handler: async (request, reply) => {
      const server = createModelingMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true, // plain JSON, no SSE
      });
      // The transport writes to the raw response; Fastify must not.
      reply.hijack();
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        console.error("MCP request handling failed:", error);
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { "content-type": "application/json" });
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            }),
          );
        }
      }
    },
  });
}
