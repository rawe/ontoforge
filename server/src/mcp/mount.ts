/**
 * MCP mounts on the Fastify app.
 *
 * Both servers are bound by URL, mirroring the REST tree — the URL is
 * the ONLY binding channel (`docs/decisions.md#interfaces`): no header,
 * no environment fallback, no tool parameter. A URL that names no
 * ontology (or, for runtime, no lens; anchored, no anchor) answers the
 * app's standard 404 — as an unmatched route, or through the
 * empty-segment guards below.
 *
 *   - Modeling: `/mcp/ontologies/:ontologyKey/model`. The mount accepts
 *     requests even when its ontology does not exist yet — that is what
 *     lets `ensure_ontology` provision the mount's own ontology; every
 *     other tool then fails with not-found until it exists.
 *   - Runtime: `/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey`.
 *   - Anchored runtime: the runtime mount plus `/anchors/:anchorKey`, which
 *     adds `get_anchor` and binds the anchor the write tools are held to.
 *     The anchor record is read before the server is built: a staged-only
 *     anchor gets the staged-only tool set (`createRuntimeMcpServer`).
 *
 * Transport is Streamable HTTP, STATELESS, with plain JSON responses
 * (no SSE), per `docs/decisions.md#interfaces`: a fresh server +
 * transport pair serves each request, so one mount serves many clients
 * and no connection carries state.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { NotFoundError } from "../core/exceptions.js";
import { getRuntimeStore } from "../core/ports.js";
import { createModelingMcpServer } from "./modeling.js";
import { createRuntimeMcpServer } from "./runtime.js";

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

/** Whether the anchor of an anchored mount is staged-only, read once per
 * request. An unknown ontology or anchor is not: the normal tool set is
 * built, and every call answers not found. */
async function isStagedOnly(ontologyKey: string, anchorKey: string): Promise<boolean> {
  try {
    const record = await (await getRuntimeStore(ontologyKey)).anchors().getAnchor(anchorKey);
    return record?.stagedOnly === true;
  } catch (error) {
    if (error instanceof NotFoundError) return false;
    throw error;
  }
}

export function mountMcp(app: FastifyInstance): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/ontologies/:ontologyKey/model",
    schema: { hide: true },
    handler: async (request, reply) => {
      const { ontologyKey } = request.params as { ontologyKey: string };
      // An empty segment matches the route but names no ontology.
      if (ontologyKey === "") {
        return reply.callNotFound();
      }
      await handleMcpRequest(createModelingMcpServer(ontologyKey), request, reply);
    },
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey",
    schema: { hide: true },
    handler: async (request, reply) => {
      const { ontologyKey, lensKey } = request.params as {
        ontologyKey: string;
        lensKey: string;
      };
      // An empty segment matches the route but names no ontology/lens.
      if (ontologyKey === "" || lensKey === "") {
        return reply.callNotFound();
      }
      await handleMcpRequest(createRuntimeMcpServer(ontologyKey, lensKey), request, reply);
    },
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey/anchors/:anchorKey",
    schema: { hide: true },
    handler: async (request, reply) => {
      const { ontologyKey, lensKey, anchorKey } = request.params as {
        ontologyKey: string;
        lensKey: string;
        anchorKey: string;
      };
      if (ontologyKey === "" || lensKey === "" || anchorKey === "") {
        return reply.callNotFound();
      }
      const stagedOnly = await isStagedOnly(ontologyKey, anchorKey);
      await handleMcpRequest(createRuntimeMcpServer(ontologyKey, lensKey, anchorKey, stagedOnly), request, reply);
    },
  });
}
