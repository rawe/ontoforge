import functools
from collections.abc import Callable

from mcp.server.fastmcp import FastMCP

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.exceptions import ValidationError
from ontoforge_server.mcp.mount import current_ontology_key
from ontoforge_server.runtime import service
from ontoforge_server.runtime.schemas import DocumentEditRequest, RelationInstanceCreate
from ontoforge_server.runtime.tool_names import (
    TOOL_CREATE_ENTITY,
    TOOL_CREATE_RELATION,
    TOOL_DELETE_ENTITY,
    TOOL_DELETE_RELATION,
    TOOL_EDIT_DOCUMENT,
    TOOL_EXECUTE_CYPHER,
    TOOL_GET_DOCUMENT,
    TOOL_GET_ENTITY,
    TOOL_GET_NEIGHBORS,
    TOOL_GET_RELATION,
    TOOL_GET_SCHEMA,
    TOOL_LIST_ENTITIES,
    TOOL_LIST_RELATIONS,
    TOOL_LIST_SAVED_QUERIES,
    TOOL_RUN_SAVED_QUERY,
    TOOL_SEARCH_SAVED_QUERIES,
    TOOL_SEMANTIC_SEARCH,
    TOOL_UPDATE_ENTITY,
    TOOL_UPDATE_RELATION,
    TOOL_WRITE_DOCUMENT,
)

runtime_mcp = FastMCP(
    "OntoForge Runtime",
    stateless_http=True,
    json_response=True,
)
runtime_mcp.settings.streamable_http_path = "/"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_ontology_key() -> str:
    try:
        return current_ontology_key.get()
    except LookupError:
        raise RuntimeError(
            "No ontology key in context — is the MCP server mounted correctly?"
        )


def _format_validation_error(exc: ValidationError) -> str:
    msg = str(exc)
    details = getattr(exc, "details", None)
    if not details:
        return msg
    if "fields" in details:
        field_errors = "; ".join(f"{k}: {v}" for k, v in details["fields"].items())
        msg = f"{msg} — {field_errors}"
    elif "errors" in details:
        msg = f"{msg} — {'; '.join(details['errors'])}"
    return msg


def _enrich_errors(fn):
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except ValidationError as exc:
            raise ValidationError(
                _format_validation_error(exc), details=exc.details
            )
    return wrapper


# ---------------------------------------------------------------------------
# Tool functions
# ---------------------------------------------------------------------------


async def get_schema() -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.get_full_schema(ontology_key, driver)
    return result.model_dump(by_alias=True)


@_enrich_errors
async def create_entity(
    entity_type_key: str,
    properties: dict,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.create_entity(
        ontology_key, entity_type_key, properties, driver
    )
    return result


@_enrich_errors
async def list_entities(
    entity_type_key: str,
    search: str | None = None,
    filters: dict | None = None,
    sort: str = "_createdAt",
    order: str = "asc",
    limit: int = 50,
    offset: int = 0,
    fields: list[str] | None = None,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    str_filters = {k: str(v) for k, v in (filters or {}).items()}
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    result = await service.list_entities(
        ontology_key, entity_type_key, limit, offset, sort, order,
        search, str_filters, driver, fields=fields,
    )
    return result.model_dump()


async def get_entity(
    entity_type_key: str,
    entity_id: str,
    fields: list[str] | None = None,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.get_entity(
        ontology_key, entity_type_key, entity_id, driver, fields=fields
    )
    return result


@_enrich_errors
async def update_entity(
    entity_type_key: str,
    entity_id: str,
    properties: dict,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.update_entity(
        ontology_key, entity_type_key, entity_id, properties, driver
    )
    return result


async def delete_entity(
    entity_type_key: str,
    entity_id: str,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    await service.delete_entity(
        ontology_key, entity_type_key, entity_id, driver
    )
    return {"message": f"Entity '{entity_id}' deleted successfully."}


async def get_document(
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    offset: int = 0,
    limit: int | None = None,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    offset = max(0, offset)
    if limit is not None:
        limit = max(1, limit)
    return await service.get_document(
        ontology_key, entity_type_key, entity_id, property_key,
        offset, limit, driver,
    )


@_enrich_errors
async def edit_document(
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    body = DocumentEditRequest(
        op="str_replace",
        old_string=old_string,
        new_string=new_string,
        replace_all=replace_all,
    )
    return await service.edit_document(
        ontology_key, entity_type_key, entity_id, property_key, body, driver
    )


@_enrich_errors
async def write_document(
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    offset: int,
    length: int,
    content: str,
    expect: str | None = None,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    body = DocumentEditRequest(
        op="replace_range",
        offset=offset,
        length=length,
        content=content,
        expect=expect,
    )
    return await service.edit_document(
        ontology_key, entity_type_key, entity_id, property_key, body, driver
    )


@_enrich_errors
async def create_relation(
    relation_type_key: str,
    from_entity_id: str,
    to_entity_id: str,
    properties: dict | None = None,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    body = RelationInstanceCreate(
        fromEntityId=from_entity_id,
        toEntityId=to_entity_id,
        **(properties or {}),
    )
    result = await service.create_relation(
        ontology_key, relation_type_key, body, driver
    )
    return result


@_enrich_errors
async def list_relations(
    relation_type_key: str,
    from_entity_id: str | None = None,
    to_entity_id: str | None = None,
    filters: dict | None = None,
    sort: str = "_createdAt",
    order: str = "asc",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    str_filters = {k: str(v) for k, v in (filters or {}).items()}
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    result = await service.list_relations(
        ontology_key, relation_type_key, limit, offset, sort, order,
        from_entity_id, to_entity_id, str_filters, driver,
    )
    return result.model_dump()


async def get_relation(
    relation_type_key: str,
    relation_id: str,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.get_relation(
        ontology_key, relation_type_key, relation_id, driver
    )
    return result


@_enrich_errors
async def update_relation(
    relation_type_key: str,
    relation_id: str,
    properties: dict,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.update_relation(
        ontology_key, relation_type_key, relation_id, properties, driver
    )
    return result


async def delete_relation(
    relation_type_key: str,
    relation_id: str,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    await service.delete_relation(
        ontology_key, relation_type_key, relation_id, driver
    )
    return {"message": f"Relation '{relation_id}' deleted successfully."}


async def get_neighbors(
    entity_type_key: str,
    entity_id: str,
    direction: str = "both",
    relation_type_key: str | None = None,
    limit: int = 50,
    fields: list[str] | None = None,
    relation_fields: list[str] | None = None,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    limit = max(1, min(limit, 200))
    result = await service.get_neighbors(
        ontology_key, entity_type_key, entity_id, direction,
        relation_type_key, limit, driver,
        fields=fields, relation_fields=relation_fields,
    )
    return result.model_dump()


@_enrich_errors
async def cypher_query(
    cypher: str,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    return await service.execute_cypher_query(ontology_key, cypher, driver)


@_enrich_errors
async def semantic_search(
    query: str,
    entity_type_key: str | None = None,
    limit: int = 10,
    filters: dict | None = None,
    fields: list[str] | None = None,
    search_in: str = "all",
    snippets: bool = True,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    limit = max(1, min(limit, 100))
    str_filters = {k: str(v) for k, v in (filters or {}).items()}
    result = await service.semantic_search(
        ontology_key, query, entity_type_key, limit, None, driver,
        filters=str_filters, fields=fields,
        search_in=search_in, snippets=snippets,
    )
    return result


async def list_saved_queries() -> list[dict]:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    loaded = await service._load_schema(ontology_key, driver)
    return [
        {
            "key": sq.key,
            "name": sq.name,
            "description": sq.description,
            "steps": [
                {
                    "name": s.name,
                    "type": s.type,
                    **({"cypher": s.cypher} if s.cypher else {}),
                    **({"entityTypeKey": s.entity_type_key} if s.entity_type_key else {}),
                    **({"query": s.query} if s.query else {}),
                    **({"limit": s.limit} if s.limit is not None else {}),
                    **({"minScore": s.min_score} if s.min_score is not None else {}),
                    **({"bindings": s.bindings} if s.bindings else {}),
                }
                for s in sq.steps
            ],
            "parameters": [
                {"name": p.name, "description": p.description, "dataType": p.data_type}
                for p in sq.parameters
            ],
        }
        for sq in loaded.saved_queries.values()
    ]


@_enrich_errors
async def run_saved_query(
    query_key: str,
    params: dict | None = None,
) -> dict:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    return await service.execute_saved_query(
        ontology_key, query_key, params or {}, driver
    )


@_enrich_errors
async def search_saved_queries(
    query: str,
) -> list[dict]:
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    return await service.search_saved_queries(
        ontology_key, query, 3, 0.7, driver
    )


# ---------------------------------------------------------------------------
# Programmatic tool registration
# ---------------------------------------------------------------------------

_MCP_TOOL_DEFS: list[tuple[Callable, str, str]] = [
    (
        get_schema,
        TOOL_GET_SCHEMA,
        "Understand the ontology before creating data. Shows available entity types, "
        "relation types, and their property definitions including data types and "
        "required flags. Call this first.",
    ),
    (
        create_entity,
        TOOL_CREATE_ENTITY,
        "Create a new entity instance. Properties must conform to the schema — "
        "required properties must be present, types must match the property "
        "definitions.",
    ),
    (
        list_entities,
        TOOL_LIST_ENTITIES,
        "List entities of a type with optional filtering, search, sorting, and "
        "pagination. Use 'search' for substring matching across all string properties. "
        "Use 'filters' for property-based filtering with operators: exact match "
        '("name": "Alice"), greater than ("age__gt": "25"), greater or equal ("__gte"), '
        'less than ("__lt"), less or equal ("__lte"), contains '
        '("name__contains": "ali"). Use \'fields\' to select which properties to '
        "include — only listed fields plus _id are returned. Omit for all fields.",
    ),
    (
        get_entity,
        TOOL_GET_ENTITY,
        "Retrieve a specific entity by its _id. Use 'fields' to select which "
        "properties to include — only listed fields plus _id are returned. "
        "Omit for all fields. Document properties appear as "
        '{"document": true, "length": N} stubs — read their content with the '
        "get_document tool.",
    ),
    (
        get_document,
        TOOL_GET_DOCUMENT,
        "Read (a slice of) a document property's content. Document properties "
        "hold large Markdown text and are never returned inline by other tools "
        '— they appear as {"document": true, "length": N} stubs. '
        "'offset' and 'limit' are character-based; omit both to read the full "
        "document. Use the charOffset/charLength from a semantic search hit's "
        "matchedVia to read exactly the matching passage.",
    ),
    (
        update_entity,
        TOOL_UPDATE_ENTITY,
        "Partial update — only provided properties change. Set a property to null "
        "to remove it (fails for required properties). Document properties are "
        "replaced whole here — prefer edit_document / write_document for "
        "partial edits inside a document.",
    ),
    (
        edit_document,
        TOOL_EDIT_DOCUMENT,
        "Edit a document property by exact string replacement — the preferred "
        "way to change part of a document. old_string must match the current "
        "content exactly and uniquely; if it matches more than once, provide a "
        "longer string with surrounding context, or set replace_all to true to "
        "replace every occurrence. Returns the new totalLength, the edited "
        "range, and ~200 chars of context around the edit for verification.",
    ),
    (
        write_document,
        TOOL_WRITE_DOCUMENT,
        "Overwrite a character range of a document property: replaces "
        "[offset, offset+length) with content. Insert with length=0; append "
        "with offset=totalLength and length=0. Offsets pair with get_document "
        "reads and the charOffset/charLength of semantic search hits. Pass "
        "'expect' (the text currently in the range) to fail safely if the "
        "document changed since it was read. Returns the new totalLength, the "
        "edited range, and ~200 chars of context around the edit.",
    ),
    (
        delete_entity,
        TOOL_DELETE_ENTITY,
        "Delete an entity and all its connected relations.",
    ),
    (
        create_relation,
        TOOL_CREATE_RELATION,
        "Create a relation between two entities. The entity types must match the "
        "relation type's source/target definition.",
    ),
    (
        list_relations,
        TOOL_LIST_RELATIONS,
        "List relations of a type. Optionally filter by source or target entity.",
    ),
    (
        get_relation,
        TOOL_GET_RELATION,
        "Retrieve a specific relation by its _id.",
    ),
    (
        update_relation,
        TOOL_UPDATE_RELATION,
        "Partial update of relation properties. Cannot change connected entities — "
        "delete and recreate instead.",
    ),
    (
        delete_relation,
        TOOL_DELETE_RELATION,
        "Delete a relation. Connected entities are unaffected.",
    ),
    (
        get_neighbors,
        TOOL_GET_NEIGHBORS,
        "Explore an entity's local neighborhood — discover what it's connected to "
        "and how. Returns the center entity plus all connected entities with their "
        "connecting relations. Use 'fields' to project entity properties (neighbor "
        "entities always include _entityTypeKey). Use 'relation_fields' to project "
        "relation properties.",
    ),
    (
        cypher_query,
        TOOL_EXECUTE_CYPHER,
        "Execute a read-only Cypher query against the ontology's scoped schema. "
        "Use schema entity type keys (snake_case) as node labels and relation type "
        "keys as relationship types. They are automatically translated to Neo4j "
        "conventions. Only MATCH/RETURN queries are allowed — no writes, no CALL. "
        "All node patterns must include a label. Available types and properties can "
        "be discovered via the get_schema tool. System properties (_id, "
        "_entityTypeKey, _relationTypeKey, _createdAt, _updatedAt) are always "
        "available. "
        "Example: MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' RETURN p, c LIMIT 10",
    ),
    (
        semantic_search,
        TOOL_SEMANTIC_SEARCH,
        "Search entity instances by semantic similarity to a natural language query. "
        "Returns entities ranked by relevance. "
        "entity_type_key is optional — omit it to search across all entity types "
        "at once (each result carries _entityTypeKey), or set it to search a "
        "single type. 'search_in' selects the ranking: 'entities' (entity "
        "embeddings), 'documents' (passage-level matches inside document "
        "properties), or 'all' (default — both, fused via reciprocal rank "
        "fusion). Every hit carries 'matchedVia': document hits include the "
        "property key, charOffset/charLength (usable with get_document), a "
        "~200-char snippet (disable with snippets=false), and the raw cosine "
        "'similarity'; entity hits carry only source and similarity. "
        "Use 'filters' for property-based filtering on results "
        "(requires entity_type_key): exact match "
        '("location": "Berlin"), operators ("age__gt": "25", "__gte", "__lt", '
        '"__lte"). Use \'fields\' to select which entity properties to include — '
        "only listed fields plus _id (and _entityTypeKey for cross-type search) "
        "are returned. Omit for all fields.",
    ),
    (
        list_saved_queries,
        TOOL_LIST_SAVED_QUERIES,
        "Discover available pre-defined queries and their required parameters. "
        "Each saved query has a key, name, description, and parameter definitions "
        "with name, description, and dataType.",
    ),
    (
        run_saved_query,
        TOOL_RUN_SAVED_QUERY,
        "Execute a saved query by name with parameter values. "
        "Use list_saved_queries to discover available queries and their required "
        "parameters first.",
    ),
    (
        search_saved_queries,
        TOOL_SEARCH_SAVED_QUERIES,
        "Search saved queries by semantic similarity to a natural language "
        "description. Returns the most relevant saved queries ranked by how well "
        "their description matches. Use this to find the right saved query for a "
        "user's intent.",
    ),
]

for fn, name, description in _MCP_TOOL_DEFS:
    runtime_mcp.add_tool(fn, name=name, description=description)
