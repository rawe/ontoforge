/**
 * MCP mounts on the Fastify app.
 *
 * Both servers are bound by URL, mirroring the REST tree — the URL is
 * the ONLY binding channel (`docs/interfaces/mcp.md#how-a-mount-is-bound`): no header,
 * no environment fallback, no tool parameter. A URL that names no
 * ontology (or, for runtime, no lens; on a ruleset mount, no ruleset)
 * answers the app's standard 404 — as an unmatched route, or through the
 * empty-segment guards below.
 *
 *   - Modeling: `/mcp/ontologies/:ontologyKey/model`. The mount accepts
 *     requests even when its ontology does not exist yet — that is what
 *     lets `ensure_ontology` provision the mount's own ontology; every
 *     other tool then fails with not-found until it exists.
 *   - Runtime: `/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey`.
 *   - Ruleset runtime: the runtime mount plus `/rulesets/:rulesetKey`,
 *     which adds `get_ruleset` and binds the ruleset whose rules the tools
 *     follow. The ruleset is read before the server is built, so the tool
 *     list follows its write access (`createRuntimeMcpServer`); a tool
 *     call's server offers every tool, and the call's check judges it.
 *
 * With authentication on, the route table lets in the modeling mount's
 * Ontology Administrator and any role holder of a runtime mount's lens;
 * a runtime server is built with the caller's role (`lensLevel`): a
 * Reader lists and calls only reads, below the ruleset's level too.
 *
 * Each request is served on its own, per `docs/interfaces/mcp.md#mcp`:
 * the route builds a fresh server from the request and the SDK's serving
 * entry answers the request with it in plain JSON, so one mount serves
 * many clients and no connection carries state. Only POST is routed:
 * nothing is served over GET or DELETE.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { lensLevel } from "../access/authorize.js";
import { accessOf, actorOf } from "../auth/plugin.js";
import { NotFoundError } from "../core/exceptions.js";
import { getRuntimeStore, type WriteAccess } from "../core/ports.js";
import { createModelingMcpServer } from "./modeling.js";
import type { Binding } from "../runtime/writeAccess.js";
import { createRuntimeMcpServer } from "./runtime.js";

type Serve = (server: McpServer, request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** The serving entry: protocol revision 2026-07-28 only, each request on
 * its own, answered in plain JSON. The route builds the request's server
 * before the entry runs, so a failure there answers like any other
 * route's; the entry's factory hands that server over. */
function mcpEntry(): Serve {
  const current = new AsyncLocalStorage<McpServer>();
  const onerror = (error: Error): void => console.warn(`MCP request not served: ${error.message}`);
  const handle = toNodeHandler(
    createMcpHandler(() => current.getStore()!, { legacy: "reject", responseMode: "json", onerror }),
    { onerror },
  );
  return async (server, request, reply) => {
    // The entry writes to the raw response; Fastify must not.
    reply.hijack();
    await current.run(server, () => handle(request.raw, reply.raw, request.body));
  };
}

function callsTool(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { method?: unknown }).method === "tools/call";
}

/** The caller's role on a runtime mount's lens, and the level its tool
 * list is built at: a tool call lists every tool, and the call's own
 * check refuses what the role lacks — as for a ruleset's level. */
async function roleOf(request: FastifyRequest, ontologyKey: string, lensKey: string): Promise<[WriteAccess, WriteAccess]> {
  const role = await lensLevel(await accessOf(request), ontologyKey, lensKey);
  return [role, callsTool(request.body) ? "full" : role];
}

/** The binding a ruleset mount's server is built with, once per request;
 * its level shapes the tool list. A request that lists tools reads the
 * ruleset; an unknown ontology or ruleset lists every tool, at 'full', and
 * every call answers not found. A tool call lists nothing: its server
 * offers every tool, at 'full', without a read, and the call's own check
 * reads the ruleset and refuses what its level lacks. So a client whose
 * list is older than the level gets the refusal, not an unknown tool. */
async function bindingOf(ontologyKey: string, rulesetKey: string, body: unknown): Promise<Binding> {
  if (callsTool(body)) return { rulesetKey, writeAccess: "full" };
  try {
    const record = await (await getRuntimeStore(ontologyKey)).rulesets().get(rulesetKey);
    return { rulesetKey, writeAccess: record?.writeAccess ?? "full" };
  } catch (error) {
    if (error instanceof NotFoundError) return { rulesetKey, writeAccess: "full" };
    throw error;
  }
}

export function mountMcp(app: FastifyInstance): void {
  // A tool with no row in the operation table fails the boot (`writeAccess.ts`).
  createRuntimeMcpServer("boot", "boot", { rulesetKey: "boot", writeAccess: "full" });
  const handleMcpRequest = mcpEntry();

  app.route({
    method: "POST",
    url: "/mcp/ontologies/:ontologyKey/model",
    schema: { hide: true },
    handler: async (request, reply) => {
      const { ontologyKey } = request.params as { ontologyKey: string };
      // An empty segment matches the route but names no ontology.
      if (ontologyKey === "") {
        return reply.callNotFound();
      }
      await handleMcpRequest(createModelingMcpServer(ontologyKey, await actorOf(request)), request, reply);
    },
  });

  app.route({
    method: "POST",
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
      const [role, listed] = await roleOf(request, ontologyKey, lensKey);
      await handleMcpRequest(createRuntimeMcpServer(ontologyKey, lensKey, undefined, role, listed), request, reply);
    },
  });

  app.route({
    method: "POST",
    url: "/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey/rulesets/:rulesetKey",
    schema: { hide: true },
    handler: async (request, reply) => {
      const { ontologyKey, lensKey, rulesetKey } = request.params as {
        ontologyKey: string;
        lensKey: string;
        rulesetKey: string;
      };
      if (ontologyKey === "" || lensKey === "" || rulesetKey === "") {
        return reply.callNotFound();
      }
      const binding = await bindingOf(ontologyKey, rulesetKey, request.body);
      const [role, listed] = await roleOf(request, ontologyKey, lensKey);
      await handleMcpRequest(createRuntimeMcpServer(ontologyKey, lensKey, binding, role, listed), request, reply);
    },
  });
}
