/**
 * MCP mounts on the Fastify app.
 *
 * The modeling server is mounted at exactly `/mcp/model` — no lens key,
 * and a trailing path segment is NOT a lens (it falls through to the
 * app's standard 404). Until ticket 17 moves both mounts under
 * `/mcp/ontologies/:key/...`, each tool call binds to the server's sole
 * ontology. Transport is Streamable HTTP,
 * STATELESS, with plain JSON responses (no SSE), per
 * `docs/decisions.md#interfaces`: a fresh server + transport pair serves
 * each request, so one mount serves many clients and no connection
 * carries state.
 *
 * The runtime server is mounted at `/mcp/runtime` and binds each request
 * to exactly one lens, resolved in priority order:
 *
 *   1. the first path segment after the mount (`/mcp/runtime/{key}`);
 *   2. the `X-Lens-Key` request header;
 *   3. the `DEFAULT_MCP_LENS_KEY` environment variable.
 *
 * With none of the three the request is refused with 400 — a model never
 * chooses a lens and can never reach across two. The environment variable
 * is read per request.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createModelingMcpServer } from "./modeling.js";
import { createRuntimeMcpServer } from "./runtime.js";

const LENS_KEY_HEADER = "x-lens-key";

/** Serve one stateless MCP request with a fresh server + transport pair. */
async function handleMcpRequest(
  server: McpServer,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
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
}

export function mountMcp(app: FastifyInstance): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/model",
    schema: { hide: true },
    handler: async (request, reply) => {
      await handleMcpRequest(createModelingMcpServer(), request, reply);
    },
  });

  // Runtime mount: without a path key the header, then the environment
  // fallback, may still supply one; otherwise the request is refused.
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/runtime",
    schema: { hide: true },
    handler: async (request, reply) => {
      const headerKey = request.headers[LENS_KEY_HEADER];
      const envKey = process.env.DEFAULT_MCP_LENS_KEY;
      const lensKey =
        (Array.isArray(headerKey) ? headerKey[0] : headerKey) ||
        (envKey !== undefined && envKey !== "" ? envKey : undefined);
      if (lensKey === undefined) {
        return reply
          .status(400)
          .header("content-type", "text/plain; charset=utf-8")
          .send("Lens key required");
      }
      await handleMcpRequest(createRuntimeMcpServer(lensKey), request, reply);
    },
  });

  // Path form: the first segment after the mount is the lens key and takes
  // priority over header and environment.
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/runtime/:lensKey",
    schema: { hide: true },
    handler: async (request, reply) => {
      const { lensKey } = request.params as { lensKey: string };
      await handleMcpRequest(createRuntimeMcpServer(lensKey), request, reply);
    },
  });
}
