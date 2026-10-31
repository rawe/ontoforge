/**
 * The route table: what each registered route needs (`caller.ts`), by its
 * method and its Fastify route pattern as registered — the full path with
 * the prefix, e.g.
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey/entities/:entityTypeKey`.
 * `authorize.ts` judges the need; the handlers filter what lists return.
 *
 * Runtime and changeset routes below a lens, plain and below a ruleset,
 * take their operation from the ruleset table (`runtime/writeAccess.ts`
 * `ROUTES`): one classification of what writes. The assistant and
 * decision routes below a lens add their own rows (`LENS_ROUTES`); none
 * of them writes. The runtime reads of a lens's design (`DESIGN_READS`)
 * also let the ontology's administrators in.
 *
 * A route without a need is `undefined`: when authentication is on, it
 * fails the boot.
 */

import { ROUTES, type Operation } from "../runtime/writeAccess.js";
import type { Need } from "./caller.js";

const PUBLIC: Need = { kind: "public" };
const ONTOLOGY_ADMIN: Need = { kind: "ontology-admin" };
const ONTOLOGY_MEMBER: Need = { kind: "ontology-member" };
const USER_ADMIN: Need = { kind: "user-admin" };
/** A read of one lens's design: its role holders and the ontology's administrators. */
const LENS_DESIGN_READ: Need = { kind: "lens", operation: "read", orAdmin: true };

const ONTOLOGY = "/api/ontologies/:ontologyKey";
const MODEL = `${ONTOLOGY}/model`;
const RULESETS = `${ONTOLOGY}/runtime/rulesets`;
const LENS = `${ONTOLOGY}/runtime/lenses/:lensKey`;
const MIRROR = `${LENS}/rulesets/:rulesetKey`;
const MCP_MODEL = "/mcp/ontologies/:ontologyKey/model";
const MCP_LENS = "/mcp/ontologies/:ontologyKey/runtime/lenses/:lensKey";

/** The routes below a lens that `ROUTES` does not list: assistants and decisions. */
export const LENS_ROUTES: Record<string, Operation> = {
  "GET /ai/assistants/agents": "read",
  "POST /ai/assistants/agents/:assistantKey/chat": "read",
  "GET /ai/assistants/agents/:assistantKey/threads/:threadId": "read",
  "GET /ai/assistants/retrievers": "read",
  "POST /ai/assistants/retrievers/:assistantKey/chat": "read",
  "GET /ai/assistants/retrievers/:assistantKey/threads/:threadId": "read",
  "POST /ai/assistants/retrievers/:assistantKey/retrieve": "read",
  "GET /ai/assistants/navigators": "read",
  "POST /ai/assistants/navigators/:assistantKey/chat": "read",
  "GET /ai/assistants/navigators/:assistantKey/threads/:threadId": "read",
  "POST /decisions/compare-entities": "read",
};

/** The runtime routes below a lens that read its design, not data: its schema and search catalog. */
const DESIGN_READS = new Set([
  "GET /schema",
  "GET /schema/entity-types",
  "GET /schema/entity-types/:key",
  "GET /schema/relation-types",
  "GET /schema/relation-types/:key",
  "GET /search-indices",
]);

/** Outside `/api` and `/mcp`: probes, metrics, the API documentation, resource metadata. */
const PUBLIC_PATHS = ["/livez", "/readyz", "/metrics", "/openapi.json", "/docs", "/.well-known"];

/** `path` is `prefix` or lies below it. */
function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The need of the route `route` (`METHOD path` below a lens) of `operation`. */
function lensNeed(route: string, operation: Operation | undefined): Need | undefined {
  if (operation === undefined) return undefined;
  return DESIGN_READS.has(route) ? LENS_DESIGN_READ : { kind: "lens", operation };
}

/**
 * The need of one route: `method` upper-case (HEAD is GET's, OPTIONS is
 * public), `url` the route pattern as registered. `undefined` for a route
 * the table does not know.
 */
export function needOf(method: string, url: string): Need | undefined {
  const verb = method === "HEAD" ? "GET" : method;
  if (verb === "OPTIONS") return PUBLIC;
  // A route registered with a trailing slash (a mount's root) is its mount's.
  const path = url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url;

  if (PUBLIC_PATHS.some((prefix) => within(path, prefix))) return PUBLIC;
  if (within(path, "/api/auth") || within(path, "/api/server")) return PUBLIC;
  if (within(path, "/api/users")) return USER_ADMIN;

  if (path === "/api/ontologies") {
    if (verb === "GET") return { kind: "signed-in" };
    if (verb === "POST") return { kind: "platform", role: "ontology_creator" };
    return undefined;
  }
  if (path === ONTOLOGY) {
    if (verb === "GET") return ONTOLOGY_MEMBER;
    if (verb === "PATCH" || verb === "DELETE") return ONTOLOGY_ADMIN;
    return undefined;
  }
  if (path === `${ONTOLOGY}/access`) return verb === "GET" ? USER_ADMIN : undefined;

  if (within(path, MODEL)) {
    const below = path.slice(MODEL.length);
    if (verb === "GET" && below === "/lenses") return ONTOLOGY_MEMBER;
    if (verb === "GET" && /^\/lenses\/:(lensId|lensKey)(\/|$)/.test(below)) return LENS_DESIGN_READ;
    return ONTOLOGY_ADMIN;
  }
  if (within(path, RULESETS)) {
    return verb === "GET" ? LENS_DESIGN_READ : ONTOLOGY_ADMIN;
  }
  if (within(path, MIRROR)) {
    const route = `${verb} ${path.slice(MIRROR.length) || "/"}`;
    return lensNeed(route, ROUTES[route]);
  }
  if (path.startsWith(`${LENS}/`)) {
    const below = path.slice(LENS.length);
    // The mirror's root `GET /` has no plain counterpart.
    if (below === "/") return undefined;
    const route = `${verb} ${below}`;
    return lensNeed(route, ROUTES[route] ?? LENS_ROUTES[route]);
  }

  if (path === MCP_MODEL) return ONTOLOGY_ADMIN;
  // The runtime mounts check each tool call against the role (`mcp/runtime.ts`).
  if (path === MCP_LENS || path === `${MCP_LENS}/rulesets/:rulesetKey`) return { kind: "lens", operation: "read" };
  return undefined;
}
