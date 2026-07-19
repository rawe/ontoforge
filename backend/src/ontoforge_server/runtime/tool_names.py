"""Shared tool name constants for MCP runtime and AI agent tools."""

# Read tools (shared by MCP + agent)
TOOL_GET_SCHEMA = "get_schema"
TOOL_LIST_ENTITIES = "list_entities"
TOOL_GET_ENTITY = "get_entity"
TOOL_GET_DOCUMENT = "get_document"
TOOL_LIST_RELATIONS = "list_relations"
TOOL_GET_NEIGHBORS = "get_neighbors"
TOOL_SEMANTIC_SEARCH = "semantic_search"
TOOL_EXECUTE_QUERY = "execute_query"
# Deprecated alias, accepted in stored agent configs; removed after the
# deprecation window.
TOOL_EXECUTE_QUERY_LEGACY = "execute_cypher_query"
TOOL_LIST_SAVED_QUERIES = "list_saved_queries"
TOOL_RUN_SAVED_QUERY = "run_saved_query"
TOOL_SEARCH_SAVED_QUERIES = "search_saved_queries"

# Write tools (MCP only)
TOOL_CREATE_ENTITY = "create_entity"
TOOL_UPDATE_ENTITY = "update_entity"
TOOL_EDIT_DOCUMENT = "edit_document"
TOOL_WRITE_DOCUMENT = "write_document"
TOOL_DELETE_ENTITY = "delete_entity"
TOOL_CREATE_RELATION = "create_relation"
TOOL_GET_RELATION = "get_relation"
TOOL_UPDATE_RELATION = "update_relation"
TOOL_DELETE_RELATION = "delete_relation"

VALID_AGENT_TOOLS: set[str] = {
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
}


def normalize_tool_name(name: str) -> str:
    """Map deprecated tool names to their current spelling."""
    return TOOL_EXECUTE_QUERY if name == TOOL_EXECUTE_QUERY_LEGACY else name

# Formatted list for use in descriptions (e.g. MCP modeling tool docs)
VALID_AGENT_TOOLS_CSV: str = ", ".join(sorted(VALID_AGENT_TOOLS))
