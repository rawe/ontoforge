from mcp.server.fastmcp import FastMCP

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.modeling import repository, service
from ontoforge_server.modeling.schemas import (
    DataType,
    EntityTypeCreate,
    EntityTypeUpdate,
    ExportPayload,
    OntologyCreate,
    OntologyUpdate,
    PropertyDefinitionCreate,
    PropertyDefinitionUpdate,
    RelationTypeCreate,
    RelationTypeUpdate,
)
from ontoforge_server.mcp.mount import current_ontology_key

modeling_mcp = FastMCP(
    "OntoForge Modeling",
    stateless_http=True,
    json_response=True,
)
modeling_mcp.settings.streamable_http_path = "/"


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


async def _resolve_ontology(driver, ontology_key: str) -> dict:
    """Resolve ontology key to full ontology dict. Raises NotFoundError if missing."""
    async with driver.session() as session:
        data = await repository.get_ontology_by_key(session, ontology_key)
    if not data:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")
    return data


async def _resolve_entity_type(
    driver, ontology_id: str, entity_type_key: str
) -> dict:
    """Resolve entity type key to full dict. Raises NotFoundError if missing."""
    async with driver.session() as session:
        data = await repository.get_entity_type_by_key(
            session, ontology_id, entity_type_key
        )
    if not data:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")
    return data


async def _resolve_relation_type(
    driver, ontology_id: str, relation_type_key: str
) -> dict:
    """Resolve relation type key to full dict. Raises NotFoundError if missing."""
    async with driver.session() as session:
        data = await repository.get_relation_type_by_key(
            session, ontology_id, relation_type_key
        )
    if not data:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")
    return data


async def _resolve_property(
    driver, owner_id: str, owner_label: str, property_key: str
) -> dict:
    """Resolve property key to full dict. Raises NotFoundError if missing."""
    async with driver.session() as session:
        data = await repository.get_property_by_key(
            session, owner_id, owner_label, property_key
        )
    if not data:
        raise NotFoundError(f"Property '{property_key}' not found")
    return data


def _resolve_owner_label(type_kind: str) -> str:
    """Map type_kind string to Neo4j label."""
    if type_kind == "entity_type":
        return "EntityType"
    elif type_kind == "relation_type":
        return "RelationType"
    else:
        raise ValidationError(
            f"Invalid type_kind '{type_kind}'. Must be 'entity_type' or 'relation_type'."
        )


async def _resolve_owner(driver, ontology_id: str, type_kind: str, type_key: str):
    """Resolve a type_kind + type_key to (owner_id, owner_label)."""
    owner_label = _resolve_owner_label(type_kind)
    if owner_label == "EntityType":
        owner = await _resolve_entity_type(driver, ontology_id, type_key)
        return owner["entityTypeId"], owner_label
    else:
        owner = await _resolve_relation_type(driver, ontology_id, type_key)
        return owner["relationTypeId"], owner_label


async def _invalidate_schema_cache(driver) -> None:
    """Reload the runtime schema cache after a modeling change."""
    from ontoforge_server.runtime import service as runtime_service

    await runtime_service.load_schema_caches_from_db(driver)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@modeling_mcp.tool()
async def get_schema() -> dict:
    """Get the current state of the ontology. Call this first to understand what
    exists before making changes. Returns all entity types, relation types, and
    their properties."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    result = await service.export_ontology(ontology["ontologyId"], driver=driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def create_ontology(
    name: str,
    description: str | None = None,
) -> dict:
    """Bootstrap the ontology. The key is set automatically from the connection
    URL. Fails if the ontology already exists."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    body = OntologyCreate(key=ontology_key, name=name, description=description)
    result = await service.create_ontology(body=body, driver=driver)
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def update_ontology(
    name: str | None = None,
    description: str | None = None,
) -> dict:
    """Update the ontology's display name or description."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    body = OntologyUpdate(name=name, description=description)
    result = await service.update_ontology(
        ontology["ontologyId"], body=body, driver=driver
    )
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def create_entity_type(
    key: str,
    display_name: str,
    description: str | None = None,
) -> dict:
    """Add a new entity type. Key must be snake_case, unique within the ontology."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    body = EntityTypeCreate(
        key=key, display_name=display_name, description=description
    )
    result = await service.create_entity_type(
        ontology["ontologyId"], body=body, driver=driver
    )
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def update_entity_type(
    entity_type_key: str,
    display_name: str | None = None,
    description: str | None = None,
) -> dict:
    """Update an entity type's display name or description. Key is immutable."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    et = await _resolve_entity_type(driver, ontology["ontologyId"], entity_type_key)
    body = EntityTypeUpdate(display_name=display_name, description=description)
    result = await service.update_entity_type(
        ontology["ontologyId"], et["entityTypeId"], body=body, driver=driver
    )
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def delete_entity_type(entity_type_key: str) -> str:
    """Remove an entity type and its properties. Fails if any relation type
    references it as source or target."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    et = await _resolve_entity_type(driver, ontology["ontologyId"], entity_type_key)
    await service.delete_entity_type(
        ontology["ontologyId"], et["entityTypeId"], driver=driver
    )
    await _invalidate_schema_cache(driver)
    return f"Entity type '{entity_type_key}' deleted successfully."


@modeling_mcp.tool()
async def create_relation_type(
    key: str,
    display_name: str,
    source_entity_type_key: str,
    target_entity_type_key: str,
    description: str | None = None,
) -> dict:
    """Add a new relation type connecting two entity types. Source and target are
    specified by entity type key."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    ontology_id = ontology["ontologyId"]
    source_et = await _resolve_entity_type(driver, ontology_id, source_entity_type_key)
    target_et = await _resolve_entity_type(driver, ontology_id, target_entity_type_key)
    body = RelationTypeCreate(
        key=key,
        display_name=display_name,
        description=description,
        source_entity_type_id=source_et["entityTypeId"],
        target_entity_type_id=target_et["entityTypeId"],
    )
    result = await service.create_relation_type(
        ontology_id, body=body, driver=driver
    )
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def update_relation_type(
    relation_type_key: str,
    display_name: str | None = None,
    description: str | None = None,
) -> dict:
    """Update a relation type's display name or description. Source/target
    endpoints are immutable."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    rt = await _resolve_relation_type(
        driver, ontology["ontologyId"], relation_type_key
    )
    body = RelationTypeUpdate(display_name=display_name, description=description)
    result = await service.update_relation_type(
        ontology["ontologyId"], rt["relationTypeId"], body=body, driver=driver
    )
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def delete_relation_type(relation_type_key: str) -> str:
    """Remove a relation type and its properties."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    rt = await _resolve_relation_type(
        driver, ontology["ontologyId"], relation_type_key
    )
    await service.delete_relation_type(
        ontology["ontologyId"], rt["relationTypeId"], driver=driver
    )
    await _invalidate_schema_cache(driver)
    return f"Relation type '{relation_type_key}' deleted successfully."


@modeling_mcp.tool()
async def add_property(
    type_kind: str,
    type_key: str,
    key: str,
    display_name: str,
    data_type: str,
    required: bool = False,
    default_value: str | None = None,
    description: str | None = None,
) -> dict:
    """Add a property definition to an entity type or relation type.

    type_kind must be "entity_type" or "relation_type".
    data_type must be one of: string, integer, float, boolean, date, datetime.
    """
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    ontology_id = ontology["ontologyId"]
    owner_id, owner_label = await _resolve_owner(
        driver, ontology_id, type_kind, type_key
    )
    body = PropertyDefinitionCreate(
        key=key,
        display_name=display_name,
        description=description,
        data_type=DataType(data_type),
        required=required,
        default_value=default_value,
    )
    result = await service.create_property(
        ontology_id, owner_id, owner_label, body=body, driver=driver
    )
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def update_property(
    type_kind: str,
    type_key: str,
    property_key: str,
    display_name: str | None = None,
    required: bool | None = None,
    default_value: str | None = None,
    description: str | None = None,
) -> dict:
    """Update a property's metadata. Key and data type are immutable after creation.

    type_kind must be "entity_type" or "relation_type".
    """
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    ontology_id = ontology["ontologyId"]
    owner_id, owner_label = await _resolve_owner(
        driver, ontology_id, type_kind, type_key
    )
    prop = await _resolve_property(driver, owner_id, owner_label, property_key)
    body = PropertyDefinitionUpdate(
        display_name=display_name,
        description=description,
        required=required,
        default_value=default_value,
    )
    result = await service.update_property(
        ontology_id, owner_id, owner_label, prop["propertyId"], body=body, driver=driver
    )
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def delete_property(
    type_kind: str,
    type_key: str,
    property_key: str,
) -> str:
    """Remove a property definition from an entity type or relation type.

    type_kind must be "entity_type" or "relation_type".
    """
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    ontology_id = ontology["ontologyId"]
    owner_id, owner_label = await _resolve_owner(
        driver, ontology_id, type_kind, type_key
    )
    prop = await _resolve_property(driver, owner_id, owner_label, property_key)
    await service.delete_property(
        ontology_id, owner_id, owner_label, prop["propertyId"], driver=driver
    )
    await _invalidate_schema_cache(driver)
    return f"Property '{property_key}' deleted from {type_kind} '{type_key}'."


@modeling_mcp.tool()
async def validate_schema() -> dict:
    """Check the schema for consistency — dangling references, duplicate keys,
    missing fields."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    result = await service.validate_schema(ontology["ontologyId"], driver=driver)
    return result.model_dump()


@modeling_mcp.tool()
async def export_schema() -> dict:
    """Export the full ontology schema in OntoForge transfer format (JSON)."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    ontology = await _resolve_ontology(driver, ontology_key)
    result = await service.export_ontology(ontology["ontologyId"], driver=driver)
    return result.model_dump(by_alias=True)


@modeling_mcp.tool()
async def import_schema(
    payload: dict,
    overwrite: bool = False,
) -> dict:
    """Import a schema from a JSON payload into the current ontology. With
    overwrite=true, replaces the existing schema."""
    ontology_key = _get_ontology_key()
    driver = await get_driver()
    export = ExportPayload.model_validate(payload)
    # Override the ontology key to match the URL
    export.ontology.key = ontology_key
    # Check if ontology already exists by key
    async with driver.session() as session:
        existing = await repository.get_ontology_by_key(session, ontology_key)
    if existing:
        export.ontology.ontology_id = existing["ontologyId"]
    result = await service.import_ontology(export, overwrite=overwrite, driver=driver)
    await _invalidate_schema_cache(driver)
    return result.model_dump(by_alias=True)
