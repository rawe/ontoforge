import functools

from mcp.server.fastmcp import FastMCP

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.exceptions import ValidationError
from ontoforge_server.mcp.mount import current_ontology_key
from ontoforge_server.runtime import service
from ontoforge_server.runtime.schemas import RelationInstanceCreate

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
    """Get the current ontology key from the request context."""
    try:
        return current_ontology_key.get()
    except LookupError:
        raise RuntimeError(
            "No ontology key in context — is the MCP server mounted correctly?"
        )


def _format_validation_error(exc: ValidationError) -> str:
    """Format a ValidationError with field-level details for LLM consumption."""
    msg = str(exc)
    details = getattr(exc, "details", None)
    if details and "fields" in details:
        field_errors = "; ".join(f"{k}: {v}" for k, v in details["fields"].items())
        msg = f"{msg} — {field_errors}"
    return msg


def _enrich_errors(fn):
    """Decorator that enriches ValidationError messages with field-level details."""
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
# Tools
# ---------------------------------------------------------------------------


@runtime_mcp.tool()
async def get_schema() -> dict:
    """Understand the ontology before creating data. Shows available entity types,
    relation types, and their property definitions including data types and required
    flags. Call this first."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.get_full_schema(ontology_key, driver)
    return result.model_dump(by_alias=True)


@runtime_mcp.tool()
@_enrich_errors
async def create_entity(
    entity_type_key: str,
    properties: dict,
) -> dict:
    """Create a new entity instance. Properties must conform to the schema —
    required properties must be present, types must match the property
    definitions."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.create_entity(
        ontology_key, entity_type_key, properties, driver
    )
    return result


@runtime_mcp.tool()
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
    """List entities of a type with optional filtering, search, sorting, and
    pagination. Use 'search' for substring matching across all string properties.
    Use 'filters' for property-based filtering with operators: exact match
    ("name": "Alice"), greater than ("age__gt": "25"), greater or equal ("__gte"),
    less than ("__lt"), less or equal ("__lte"), contains
    ("name__contains": "ali"). Use 'fields' to select which properties to
    include — only listed fields plus _id are returned. Omit for all fields."""
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


@runtime_mcp.tool()
async def get_entity(
    entity_type_key: str,
    entity_id: str,
    fields: list[str] | None = None,
) -> dict:
    """Retrieve a specific entity by its _id. Use 'fields' to select which
    properties to include — only listed fields plus _id are returned.
    Omit for all fields."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.get_entity(
        ontology_key, entity_type_key, entity_id, driver, fields=fields
    )
    return result


@runtime_mcp.tool()
@_enrich_errors
async def update_entity(
    entity_type_key: str,
    entity_id: str,
    properties: dict,
) -> dict:
    """Partial update — only provided properties change. Set a property to null
    to remove it (fails for required properties)."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.update_entity(
        ontology_key, entity_type_key, entity_id, properties, driver
    )
    return result


@runtime_mcp.tool()
async def delete_entity(
    entity_type_key: str,
    entity_id: str,
) -> dict:
    """Delete an entity and all its connected relations."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    await service.delete_entity(
        ontology_key, entity_type_key, entity_id, driver
    )
    return {"message": f"Entity '{entity_id}' deleted successfully."}


@runtime_mcp.tool()
@_enrich_errors
async def create_relation(
    relation_type_key: str,
    from_entity_id: str,
    to_entity_id: str,
    properties: dict | None = None,
) -> dict:
    """Create a relation between two entities. The entity types must match the
    relation type's source/target definition."""
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


@runtime_mcp.tool()
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
    """List relations of a type. Optionally filter by source or target entity."""
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


@runtime_mcp.tool()
async def get_relation(
    relation_type_key: str,
    relation_id: str,
) -> dict:
    """Retrieve a specific relation by its _id."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.get_relation(
        ontology_key, relation_type_key, relation_id, driver
    )
    return result


@runtime_mcp.tool()
@_enrich_errors
async def update_relation(
    relation_type_key: str,
    relation_id: str,
    properties: dict,
) -> dict:
    """Partial update of relation properties. Cannot change connected entities —
    delete and recreate instead."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.update_relation(
        ontology_key, relation_type_key, relation_id, properties, driver
    )
    return result


@runtime_mcp.tool()
async def delete_relation(
    relation_type_key: str,
    relation_id: str,
) -> dict:
    """Delete a relation. Connected entities are unaffected."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    await service.delete_relation(
        ontology_key, relation_type_key, relation_id, driver
    )
    return {"message": f"Relation '{relation_id}' deleted successfully."}


@runtime_mcp.tool()
async def get_neighbors(
    entity_type_key: str,
    entity_id: str,
    direction: str = "both",
    relation_type_key: str | None = None,
    limit: int = 50,
    fields: list[str] | None = None,
    relation_fields: list[str] | None = None,
) -> dict:
    """Explore an entity's local neighborhood — discover what it's connected to
    and how. Returns the center entity plus all connected entities with their
    connecting relations. Use 'fields' to project entity properties (neighbor
    entities always include _entityTypeKey). Use 'relation_fields' to project
    relation properties."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    limit = max(1, min(limit, 200))
    result = await service.get_neighbors(
        ontology_key, entity_type_key, entity_id, direction,
        relation_type_key, limit, driver,
        fields=fields, relation_fields=relation_fields,
    )
    return result.model_dump()


@runtime_mcp.tool()
@_enrich_errors
async def semantic_search(
    query: str,
    entity_type_key: str,
    limit: int = 10,
    filters: dict | None = None,
    fields: list[str] | None = None,
) -> dict:
    """Search entity instances by semantic similarity to a natural language query.
    Returns entities ranked by relevance with similarity scores.
    entity_type_key is required — specifies which entity type to search.
    Use 'filters' for property-based filtering on results: exact match
    ("location": "Berlin"), operators ("age__gt": "25", "__gte", "__lt",
    "__lte", "__contains"). Use 'fields' to select which entity properties to
    include — only listed fields plus _id are returned. Omit for all fields."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    limit = max(1, min(limit, 100))
    str_filters = {k: str(v) for k, v in (filters or {}).items()}
    result = await service.semantic_search(
        ontology_key, query, entity_type_key, limit, None, driver,
        filters=str_filters, fields=fields,
    )
    return result


@runtime_mcp.tool()
async def wipe_data() -> dict:
    """DESTRUCTIVE. Delete ALL instance data for this ontology. The schema is
    preserved — only entity and relation instances are removed. Cannot be undone."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    result = await service.wipe_instance_data(ontology_key, driver)
    return result.model_dump(by_alias=True)
