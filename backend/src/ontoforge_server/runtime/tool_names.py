"""Shared tool name constants for MCP runtime and AI agent tools."""

# Read tools (shared by MCP + agent)
TOOL_GET_SCHEMA = "get_schema"
TOOL_LIST_ENTITIES = "list_entities"
TOOL_GET_ENTITY = "get_entity"
TOOL_LIST_RELATIONS = "list_relations"
TOOL_GET_NEIGHBORS = "get_neighbors"
TOOL_SEMANTIC_SEARCH = "semantic_search"
TOOL_SEMANTIC_SEARCH_RELATIONS = "semantic_search_relations"
TOOL_EXECUTE_CYPHER = "execute_cypher_query"
TOOL_LIST_SAVED_QUERIES = "list_saved_queries"
TOOL_RUN_SAVED_QUERY = "run_saved_query"
TOOL_SEARCH_SAVED_QUERIES = "search_saved_queries"

# Write tools (MCP only)
TOOL_CREATE_ENTITY = "create_entity"
TOOL_UPDATE_ENTITY = "update_entity"
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
    TOOL_SEMANTIC_SEARCH_RELATIONS,
    TOOL_EXECUTE_CYPHER,
    TOOL_LIST_SAVED_QUERIES,
    TOOL_RUN_SAVED_QUERY,
    TOOL_SEARCH_SAVED_QUERIES,
}

# Formatted list for use in descriptions (e.g. MCP modeling tool docs)
VALID_AGENT_TOOLS_CSV: str = ", ".join(sorted(VALID_AGENT_TOOLS))
