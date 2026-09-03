/**
 * Shared tool-name constants for the runtime MCP server and AI agent
 * allowlists. The grantable set is exactly twelve names — the document reads
 * included, `get_relation` still deliberately not grantable
 * (`docs/interfaces.md#runtime-tools`). `search_documents` is agent-only: it
 * is the MCP `semantic_search` restricted to document passages, split off as
 * its own tool so a small model chooses it by name rather than by argument.
 */

// Read tools (shared by MCP + agent)
export const TOOL_GET_SCHEMA = "get_schema";
export const TOOL_LIST_ENTITIES = "list_entities";
export const TOOL_GET_ENTITY = "get_entity";
export const TOOL_GET_DOCUMENT = "get_document";
export const TOOL_LIST_RELATIONS = "list_relations";
export const TOOL_GET_NEIGHBORS = "get_neighbors";
export const TOOL_SEMANTIC_SEARCH = "semantic_search";
export const TOOL_SEARCH_DOCUMENTS = "search_documents";
export const TOOL_EXECUTE_QUERY = "execute_query";
export const TOOL_LIST_SAVED_QUERIES = "list_saved_queries";
export const TOOL_RUN_SAVED_QUERY = "run_saved_query";
export const TOOL_SEARCH_SAVED_QUERIES = "search_saved_queries";

/** The fixed twelve-name set an agent configuration may grant. */
export const VALID_AGENT_TOOLS: ReadonlySet<string> = new Set([
  TOOL_GET_SCHEMA,
  TOOL_LIST_ENTITIES,
  TOOL_GET_ENTITY,
  TOOL_GET_DOCUMENT,
  TOOL_LIST_RELATIONS,
  TOOL_GET_NEIGHBORS,
  TOOL_SEMANTIC_SEARCH,
  TOOL_SEARCH_DOCUMENTS,
  TOOL_EXECUTE_QUERY,
  TOOL_LIST_SAVED_QUERIES,
  TOOL_RUN_SAVED_QUERY,
  TOOL_SEARCH_SAVED_QUERIES,
]);

/** Formatted list for use in descriptions (e.g. MCP modeling tool docs). */
export const VALID_AGENT_TOOLS_CSV: string = [...VALID_AGENT_TOOLS].sort().join(", ");
