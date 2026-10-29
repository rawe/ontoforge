/**
 * Write access: how a connection through a ruleset may change data. Every
 * MCP tool of a ruleset mount and every route of the ruleset REST mirror
 * declares the one operation it needs, in the tables below; each level is
 * a fixed set of operations. The two entrances (the mirror's preHandler,
 * `rulesetRouter.ts`; the MCP tools, `mcp/runtime.ts`) run `checkOperation`
 * on the binding of the URL before any service is called, and nothing
 * else checks write access. A ruleset mount lists only the tools its level
 * allows (`listsTool`). A route or tool without a row fails the boot.
 *
 * The binding is the URL's only: a changeset started through a ruleset
 * and committed through the plain lens is judged by the plain lens's
 * `full`. The anchor rule is the service's (`anchorGuard.ts`, `changesets.ts`).
 */

import { ConflictError } from "../core/exceptions.js";
import type { WriteAccess } from "../core/ports.js";

/** The closed list of operations. `stage` starts, stages into, unstages
 * from, rebases, checks, submits, unsubmits and discards a changeset. */
export type Operation = "read" | "stage" | "commit" | "write";

/** Each level a fixed set of operations, an ordered ladder: each level
 * allows everything the one before it does. */
export const LEVELS: Record<WriteAccess, ReadonlySet<Operation>> = {
  none: new Set(["read"]),
  propose: new Set(["read", "stage"]),
  full: new Set(["read", "stage", "commit", "write"]),
};

/** One MCP tool's row. A stageable tool writes directly, or stages with
 * `changeset_id`: its operation is decided per call (`toolOperation`). */
export interface ToolRow {
  operation: Operation;
  stageable?: true;
}

const STAGEABLE: ToolRow = { operation: "write", stageable: true };

/** Every tool of a ruleset mount, by name. */
export const TOOLS: Record<string, ToolRow> = {
  get_ruleset: { operation: "read" },
  get_schema: { operation: "read" },
  create_entity: STAGEABLE,
  list_entities: { operation: "read" },
  get_entity: { operation: "read" },
  get_path: { operation: "read" },
  get_document: { operation: "read" },
  update_entity: STAGEABLE,
  edit_document: STAGEABLE,
  write_document: STAGEABLE,
  delete_entity: STAGEABLE,
  create_relation: STAGEABLE,
  list_relations: { operation: "read" },
  get_relation: { operation: "read" },
  update_relation: STAGEABLE,
  delete_relation: STAGEABLE,
  get_neighbors: { operation: "read" },
  execute_query: { operation: "read" },
  list_search_indices: { operation: "read" },
  search: { operation: "read" },
  search_documents: { operation: "read" },
  search_by_index: { operation: "read" },
  list_saved_queries: { operation: "read" },
  run_saved_query: { operation: "read" },
  search_saved_queries: { operation: "read" },
  start_changeset: { operation: "stage" },
  list_changesets: { operation: "read" },
  get_changeset: { operation: "read" },
  get_staged_document: { operation: "read" },
  unstage: { operation: "stage" },
  rebase: { operation: "stage" },
  submit_changeset: { operation: "stage" },
  unsubmit_changeset: { operation: "stage" },
  check_changeset: { operation: "stage" },
  commit_changeset: { operation: "commit" },
  discard_changeset: { operation: "stage" },
};

/** Every route of the ruleset REST mirror, as "METHOD /path" below the
 * mount. Four POST routes only read. */
export const ROUTES: Record<string, Operation> = {
  "GET /": "read",
  "GET /schema": "read",
  "GET /schema/entity-types": "read",
  "GET /schema/entity-types/:key": "read",
  "GET /schema/relation-types": "read",
  "GET /schema/relation-types/:key": "read",
  "GET /search": "read",
  "GET /search-indices": "read",
  "POST /search": "read",
  "POST /search/entities": "read",
  "POST /entities/:entityTypeKey": "write",
  "GET /entities/:entityTypeKey": "read",
  "GET /entities/:entityTypeKey/:entityId": "read",
  "PATCH /entities/:entityTypeKey/:entityId": "write",
  "DELETE /entities/:entityTypeKey/:entityId": "write",
  "GET /entities/:entityTypeKey/:entityId/path": "read",
  "GET /entities/:entityTypeKey/:entityId/documents/:propertyKey": "read",
  "PATCH /entities/:entityTypeKey/:entityId/documents/:propertyKey": "write",
  "GET /entities/:entityTypeKey/:entityId/neighbors": "read",
  "GET /entities/:entityTypeKey/identity/:identity": "read",
  "PATCH /entities/:entityTypeKey/identity/:identity": "write",
  "DELETE /entities/:entityTypeKey/identity/:identity": "write",
  "GET /entities/:entityTypeKey/identity/:identity/path": "read",
  "GET /entities/:entityTypeKey/identity/:identity/documents/:propertyKey": "read",
  "PATCH /entities/:entityTypeKey/identity/:identity/documents/:propertyKey": "write",
  "GET /entities/:entityTypeKey/identity/:identity/neighbors": "read",
  "POST /query": "read",
  "GET /saved-queries": "read",
  "GET /saved-queries/search": "read",
  "POST /saved-queries/:queryKey/run": "read",
  "POST /relations/:relationTypeKey": "write",
  "GET /relations/:relationTypeKey": "read",
  "GET /relations/:relationTypeKey/:relationId": "read",
  "PATCH /relations/:relationTypeKey/:relationId": "write",
  "DELETE /relations/:relationTypeKey/:relationId": "write",
  "POST /changesets": "stage",
  "GET /changesets": "read",
  "GET /changesets/:changesetId": "read",
  "GET /changesets/:changesetId/documents/:entityTypeKey/:entityId/:propertyKey": "read",
  "GET /changesets/:changesetId/entities/:entityTypeKey/:entityId": "read",
  "GET /changesets/:changesetId/entities/:entityTypeKey/identity/:identity": "read",
  "DELETE /changesets/:changesetId": "stage",
  "POST /changesets/:changesetId/writes": "stage",
  "DELETE /changesets/:changesetId/objects/:objectId": "stage",
  "DELETE /changesets/:changesetId/objects/:objectId/properties/:propertyKey": "stage",
  "POST /changesets/:changesetId/objects/:objectId/rebase": "stage",
  "POST /changesets/:changesetId/submit": "stage",
  "POST /changesets/:changesetId/unsubmit": "stage",
  "POST /changesets/:changesetId/check": "stage",
  "POST /changesets/:changesetId/commit": "commit",
};

/** What a call is bound to by its URL: the ruleset key and its level. The
 * plain lens is `{ rulesetKey: null, writeAccess: "full" }`. */
export interface Binding {
  rulesetKey: string | null;
  writeAccess: WriteAccess;
}

export function allows(level: WriteAccess, operation: Operation): boolean {
  return LEVELS[level].has(operation);
}

/** The lower of two levels on the ladder: a ruleset's and a lens role's. */
export function lower(a: WriteAccess, b: WriteAccess): WriteAccess {
  return LEVELS[a].size <= LEVELS[b].size ? a : b;
}

function toolRow(name: string): ToolRow {
  const row = TOOLS[name];
  if (row === undefined) throw new Error(`Tool '${name}' has no row in the operation table`);
  return row;
}

/** Whether a level lists a tool: it allows the tool's operation, or, for
 * a stageable tool, staging. A tool without a row throws. */
export function listsTool(level: WriteAccess, name: string): boolean {
  const row = toolRow(name);
  return allows(level, row.operation) || (row.stageable === true && allows(level, "stage"));
}

/** The operation of one tool call: a stageable tool stages with
 * `changeset_id`. A tool without a row throws. */
export function toolOperation(name: string, args: unknown): Operation {
  const row = toolRow(name);
  const stages =
    row.stageable === true &&
    typeof args === "object" &&
    args !== null &&
    (args as { changeset_id?: unknown }).changeset_id !== undefined;
  return stages ? "stage" : row.operation;
}

/** The operation of a mirror route, by its method and its path below the
 * mount; HEAD is GET's. A route without a row throws. */
export function routeOperation(method: string, path: string): Operation {
  const key = `${method === "HEAD" ? "GET" : method} ${path}`;
  const operation = ROUTES[key];
  if (operation === undefined) throw new Error(`Route '${key}' has no row in the operation table`);
  return operation;
}

/** What a refused operation cannot do. */
const VERBS: Record<Operation, string> = {
  read: "read",
  stage: "start or change a changeset",
  commit: "commit",
  write: "write directly",
};

/** The way round a refused operation, on a level that stages. */
const INSTEAD: Partial<Record<Operation, string>> = {
  write: "stage the write into a changeset",
  commit: "submit the changeset, and a person commits it",
};

/** The one check: a 409 when the binding's level lacks the operation. */
export function checkOperation(binding: Binding, operation: Operation): void {
  const level = binding.writeAccess;
  if (allows(level, operation)) return;
  const instead = allows(level, "stage") ? INSTEAD[operation] : undefined;
  throw new ConflictError(
    `Ruleset '${binding.rulesetKey}' gives write access '${level}': this connection cannot ` +
      `${VERBS[operation]}; ${instead ?? "it can only read"}`,
  );
}
