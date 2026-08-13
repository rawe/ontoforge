/**
 * Shared tool-name constants for the runtime MCP server and AI agent
 * allowlists. The grantable set is exactly ten names — the read-only subset MINUS
 * `get_document` and `get_relation`, which are read-only but deliberately
 * not grantable (`docs/interfaces.md#runtime-tools`).
 */

// Read tools (shared by MCP + agent)
export const TOOL_GET_SCHEMA = "get_schema";
export const TOOL_LIST_ENTITIES = "list_entities";
export const TOOL_GET_ENTITY = "get_entity";
export const TOOL_GET_DOCUMENT = "get_document";
export const TOOL_LIST_RELATIONS = "list_relations";
export const TOOL_GET_NEIGHBORS = "get_neighbors";
export const TOOL_SEMANTIC_SEARCH = "semantic_search";
export const TOOL_EXECUTE_QUERY = "execute_query";
export const TOOL_LIST_SAVED_QUERIES = "list_saved_queries";
export const TOOL_RUN_SAVED_QUERY = "run_saved_query";
export const TOOL_SEARCH_SAVED_QUERIES = "search_saved_queries";

/** The fixed ten-name set an agent configuration may grant. */
export const VALID_AGENT_TOOLS: ReadonlySet<string> = new Set([
  TOOL_GET_SCHEMA,
  TOOL_LIST_ENTITIES,
  TOOL_GET_ENTITY,
  TOOL_LIST_RELATIONS,
  TOOL_GET_NEIGHBORS,
  TOOL_SEMANTIC_SEARCH,
  TOOL_EXECUTE_QUERY,
  TOOL_LIST_SAVED_QUERIES,
  TOOL_RUN_SAVED_QUERY,
  TOOL_SEARCH_SAVED_QUERIES,
]);

/** Formatted list for use in descriptions (e.g. MCP modeling tool docs). */
export const VALID_AGENT_TOOLS_CSV: string = [...VALID_AGENT_TOOLS].sort().join(", ");
