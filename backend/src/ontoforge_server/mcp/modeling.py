from collections.abc import Callable

from mcp.server.fastmcp import FastMCP

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.modeling import repository, service
from ontoforge_server.modeling.schemas import (
    AiAgentConfigUpsert,
    DataType,
    EntityTypeCreate,
    EntityTypeUpdate,
    ExportPayload,
    IncludeTypeRequest,
    OntologyCreate,
    OntologyUpdate,
    PropertyDefinitionCreate,
    PropertyDefinitionUpdate,
    RelationTypeCreate,
    RelationTypeUpdate,
    SavedQueryUpsert,
)
from ontoforge_server.runtime.tool_names import VALID_AGENT_TOOLS_CSV

modeling_mcp = FastMCP(
    "OntoForge Modeling",
    stateless_http=True,
    json_response=True,
)
modeling_mcp.settings.streamable_http_path = "/"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _resolve_entity_type(driver, entity_type_key: str) -> dict:
    """Resolve entity type key to full dict globally."""
    async with driver.session() as session:
        data = await repository.get_entity_type_by_key(session, entity_type_key)
    if not data:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")
    return data


async def _resolve_relation_type(driver, relation_type_key: str) -> dict:
    """Resolve relation type key to full dict globally."""
    async with driver.session() as session:
        data = await repository.get_relation_type_by_key(session, relation_type_key)
    if not data:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")
    return data


async def _resolve_property(driver, owner_id: str, owner_label: str, property_key: str) -> dict:
    """Resolve property key to full dict."""
    async with driver.session() as session:
        data = await repository.get_property_by_key(session, owner_id, owner_label, property_key)
    if not data:
        raise NotFoundError(f"Property '{property_key}' not found")
    return data


def _resolve_owner_label(type_kind: str) -> str:
    if type_kind == "entity_type":
        return "EntityType"
    elif type_kind == "relation_type":
        return "RelationType"
    else:
        raise ValidationError(
            f"Invalid type_kind '{type_kind}'. Must be 'entity_type' or 'relation_type'."
        )


async def _resolve_owner(driver, type_kind: str, type_key: str):
    """Resolve a type_kind + type_key to (owner_id, owner_label)."""
    owner_label = _resolve_owner_label(type_kind)
    if owner_label == "EntityType":
        owner = await _resolve_entity_type(driver, type_key)
        return owner["entityTypeId"], owner_label
    else:
        owner = await _resolve_relation_type(driver, type_key)
        return owner["relationTypeId"], owner_label


async def _resolve_ontology_by_key(driver, ontology_key: str) -> dict:
    """Resolve ontology key to full ontology dict."""
    async with driver.session() as session:
        data = await repository.get_ontology_by_key(session, ontology_key)
    if not data:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")
    return data


# ---------------------------------------------------------------------------
# Tool functions
# ---------------------------------------------------------------------------


# --- Global Schema Tools ---


async def get_schema() -> dict:
    driver = await get_driver()
    result = await service.export_schema(driver=driver)
    return result.model_dump(by_alias=True)


async def create_entity_type(
    key: str,
    display_name: str,
    description: str | None = None,
) -> dict:
    driver = await get_driver()
    body = EntityTypeCreate(key=key, display_name=display_name, description=description)
    result = await service.create_entity_type(body=body, driver=driver)
    return result.model_dump(by_alias=True)


async def update_entity_type(
    entity_type_key: str,
    display_name: str | None = None,
    description: str | None = None,
) -> dict:
    driver = await get_driver()
    et = await _resolve_entity_type(driver, entity_type_key)
    body = EntityTypeUpdate(display_name=display_name, description=description)
    result = await service.update_entity_type(et["entityTypeId"], body=body, driver=driver)
    return result.model_dump(by_alias=True)


async def delete_entity_type(entity_type_key: str, cascade: bool = False) -> str:
    driver = await get_driver()
    et = await _resolve_entity_type(driver, entity_type_key)
    await service.delete_entity_type(et["entityTypeId"], cascade=cascade, driver=driver)
    return f"Entity type '{entity_type_key}' deleted successfully."


async def create_relation_type(
    key: str,
    display_name: str,
    source_entity_type_key: str,
    target_entity_type_key: str,
    description: str | None = None,
) -> dict:
    driver = await get_driver()
    body = RelationTypeCreate(
        key=key,
        display_name=display_name,
        description=description,
        source_entity_type_key=source_entity_type_key,
        target_entity_type_key=target_entity_type_key,
    )
    result = await service.create_relation_type(body=body, driver=driver)
    return result.model_dump(by_alias=True)


async def update_relation_type(
    relation_type_key: str,
    display_name: str | None = None,
    description: str | None = None,
) -> dict:
    driver = await get_driver()
    rt = await _resolve_relation_type(driver, relation_type_key)
    body = RelationTypeUpdate(display_name=display_name, description=description)
    result = await service.update_relation_type(rt["relationTypeId"], body=body, driver=driver)
    return result.model_dump(by_alias=True)


async def delete_relation_type(relation_type_key: str, cascade: bool = False) -> str:
    driver = await get_driver()
    rt = await _resolve_relation_type(driver, relation_type_key)
    await service.delete_relation_type(rt["relationTypeId"], cascade=cascade, driver=driver)
    return f"Relation type '{relation_type_key}' deleted successfully."


async def add_property(
    type_kind: str,
    type_key: str,
    key: str,
    display_name: str,
    data_type: str,
    required: bool = False,
    default_value: str | None = None,
    description: str | None = None,
    cascade: bool = False,
) -> dict:
    driver = await get_driver()
    owner_id, owner_label = await _resolve_owner(driver, type_kind, type_key)
    body = PropertyDefinitionCreate(
        key=key,
        display_name=display_name,
        description=description,
        data_type=DataType(data_type),
        required=required,
        default_value=default_value,
    )
    result = await service.create_property(
        owner_id, owner_label, body=body, cascade=cascade, driver=driver
    )
    return result.model_dump(by_alias=True)


async def update_property(
    type_kind: str,
    type_key: str,
    property_key: str,
    display_name: str | None = None,
    required: bool | None = None,
    default_value: str | None = None,
    description: str | None = None,
) -> dict:
    driver = await get_driver()
    owner_id, owner_label = await _resolve_owner(driver, type_kind, type_key)
    prop = await _resolve_property(driver, owner_id, owner_label, property_key)
    body = PropertyDefinitionUpdate(
        display_name=display_name,
        description=description,
        required=required,
        default_value=default_value,
    )
    result = await service.update_property(
        owner_id, owner_label, prop["propertyId"], body=body, driver=driver
    )
    return result.model_dump(by_alias=True)


async def delete_property(
    type_kind: str,
    type_key: str,
    property_key: str,
    cascade: bool = False,
) -> str:
    driver = await get_driver()
    owner_id, owner_label = await _resolve_owner(driver, type_kind, type_key)
    prop = await _resolve_property(driver, owner_id, owner_label, property_key)
    await service.delete_property(
        owner_id, owner_label, prop["propertyId"], cascade=cascade, driver=driver
    )
    return f"Property '{property_key}' deleted from {type_kind} '{type_key}'."


async def validate_schema() -> dict:
    driver = await get_driver()
    result = await service.validate_all(driver=driver)
    return result.model_dump()


async def export_schema() -> dict:
    driver = await get_driver()
    result = await service.export_schema(driver=driver)
    return result.model_dump(by_alias=True)


async def import_schema(payload: dict) -> dict:
    driver = await get_driver()
    export = ExportPayload.model_validate(payload)
    result = await service.import_schema(export, driver=driver)
    return result


# --- Ontology Management Tools ---


async def create_ontology(
    key: str,
    name: str,
    description: str | None = None,
) -> dict:
    driver = await get_driver()
    body = OntologyCreate(key=key, name=name, description=description)
    result = await service.create_ontology(body=body, driver=driver)
    return result.model_dump(by_alias=True)


async def update_ontology(
    ontology_key: str,
    name: str | None = None,
    description: str | None = None,
) -> dict:
    driver = await get_driver()
    ontology = await _resolve_ontology_by_key(driver, ontology_key)
    body = OntologyUpdate(name=name, description=description)
    result = await service.update_ontology(ontology["ontologyId"], body=body, driver=driver)
    return result.model_dump(by_alias=True)


async def delete_ontology(ontology_key: str) -> str:
    driver = await get_driver()
    ontology = await _resolve_ontology_by_key(driver, ontology_key)
    await service.delete_ontology(ontology["ontologyId"], driver=driver)
    return f"Ontology '{ontology_key}' deleted successfully."


async def add_entity_type_to_ontology(
    ontology_key: str,
    entity_type_key: str,
    properties: list[str] | None = None,
) -> dict:
    driver = await get_driver()
    ontology = await _resolve_ontology_by_key(driver, ontology_key)
    body = IncludeTypeRequest(key=entity_type_key, properties=properties)
    result = await service.add_includes_entity_type(ontology["ontologyId"], body, driver)
    return result.model_dump()


async def remove_entity_type_from_ontology(
    ontology_key: str,
    entity_type_key: str,
) -> str:
    driver = await get_driver()
    ontology = await _resolve_ontology_by_key(driver, ontology_key)
    et = await _resolve_entity_type(driver, entity_type_key)
    await service.remove_includes_entity_type(ontology["ontologyId"], et["entityTypeId"], driver)
    return f"Entity type '{entity_type_key}' removed from ontology '{ontology_key}'."


async def add_relation_type_to_ontology(
    ontology_key: str,
    relation_type_key: str,
    properties: list[str] | None = None,
) -> dict:
    driver = await get_driver()
    ontology = await _resolve_ontology_by_key(driver, ontology_key)
    body = IncludeTypeRequest(key=relation_type_key, properties=properties)
    result = await service.add_includes_relation_type(ontology["ontologyId"], body, driver)
    return result.model_dump()


async def remove_relation_type_from_ontology(
    ontology_key: str,
    relation_type_key: str,
) -> str:
    driver = await get_driver()
    ontology = await _resolve_ontology_by_key(driver, ontology_key)
    rt = await _resolve_relation_type(driver, relation_type_key)
    await service.remove_includes_relation_type(ontology["ontologyId"], rt["relationTypeId"], driver)
    return f"Relation type '{relation_type_key}' removed from ontology '{ontology_key}'."


async def validate_ontology(ontology_key: str) -> dict:
    driver = await get_driver()
    ontology = await _resolve_ontology_by_key(driver, ontology_key)
    result = await service.validate_ontology(ontology["ontologyId"], driver=driver)
    return result.model_dump()


# --- AI Agent Config Tools ---


async def list_ai_agents(ontology_key: str) -> list[dict]:
    driver = await get_driver()
    results = await service.list_ai_agents(ontology_key, driver)
    return [r.model_dump(by_alias=True) for r in results]


async def set_ai_agent(
    ontology_key: str,
    key: str,
    name: str,
    description: str | None = None,
    system_prompt: str | None = None,
    tools: list[str] | None = None,
) -> dict:
    driver = await get_driver()
    body = AiAgentConfigUpsert(
        name=name,
        description=description,
        system_prompt=system_prompt,
        tools=tools,
    )
    result, created = await service.upsert_ai_agent(ontology_key, key, body, driver)
    response = result.model_dump(by_alias=True)
    response["created"] = created
    return response


async def delete_ai_agent(ontology_key: str, agent_key: str) -> str:
    driver = await get_driver()
    await service.delete_ai_agent(ontology_key, agent_key, driver)
    return f"AI agent '{agent_key}' deleted from ontology '{ontology_key}'."


# --- Saved Query Config Tools ---


async def list_saved_queries(ontology_key: str) -> list[dict]:
    driver = await get_driver()
    results = await service.list_saved_queries(ontology_key, driver)
    return [r.model_dump(by_alias=True) for r in results]


async def set_saved_query(
    ontology_key: str,
    key: str,
    name: str,
    description: str,
    steps: list[dict],
    parameters: list[dict] | None = None,
) -> dict:
    driver = await get_driver()
    body = SavedQueryUpsert(
        name=name,
        description=description,
        steps=steps,
        parameters=parameters or [],
    )
    result, created = await service.upsert_saved_query(ontology_key, key, body, driver)
    response = result.model_dump(by_alias=True)
    response["created"] = created
    return response


async def delete_saved_query(ontology_key: str, query_key: str) -> str:
    driver = await get_driver()
    await service.delete_saved_query(ontology_key, query_key, driver)
    return f"Saved query '{query_key}' deleted from ontology '{ontology_key}'."


# ---------------------------------------------------------------------------
# Programmatic tool registration
# ---------------------------------------------------------------------------

_MODELING_TOOL_DEFS: list[tuple[Callable, str, str]] = [
    # --- Global Schema ---
    (
        get_schema,
        "get_schema",
        "Get the current state of the global schema. Returns all entity types, "
        "relation types, and their properties.",
    ),
    (
        create_entity_type,
        "create_entity_type",
        "Add a new entity type to the global schema. Key must be snake_case, globally unique.",
    ),
    (
        update_entity_type,
        "update_entity_type",
        "Update an entity type's display name or description. Key is immutable.",
    ),
    (
        delete_entity_type,
        "delete_entity_type",
        "Remove an entity type and its properties. Use cascade=True to auto-remove "
        "from any scoped ontologies. Fails if any relation type references it.",
    ),
    (
        create_relation_type,
        "create_relation_type",
        "Add a new relation type connecting two entity types. Source and target are "
        "specified by entity type key.",
    ),
    (
        update_relation_type,
        "update_relation_type",
        "Update a relation type's display name or description. Source/target "
        "endpoints are immutable.",
    ),
    (
        delete_relation_type,
        "delete_relation_type",
        "Remove a relation type and its properties. Use cascade=True to auto-remove "
        "from any scoped ontologies.",
    ),
    (
        add_property,
        "add_property",
        "Add a property definition to an entity type or relation type. "
        "type_kind must be 'entity_type' or 'relation_type'. "
        "data_type must be one of: string, integer, float, boolean, date, datetime. "
        "Use cascade=True to auto-add required properties to scoped ontology property lists.",
    ),
    (
        update_property,
        "update_property",
        "Update a property's metadata. Key and data type are immutable after creation. "
        "type_kind must be 'entity_type' or 'relation_type'.",
    ),
    (
        delete_property,
        "delete_property",
        "Remove a property definition from an entity type or relation type. "
        "type_kind must be 'entity_type' or 'relation_type'. "
        "Use cascade=True to auto-remove from scoped ontology property lists.",
    ),
    (
        validate_schema,
        "validate_schema",
        "Check the global schema + all scoped ontologies for consistency.",
    ),
    (
        export_schema,
        "export_schema",
        "Export the full schema in OntoForge v2.0 transfer format (JSON).",
    ),
    (
        import_schema,
        "import_schema",
        "Import a v2.0 schema payload. Creates entity types, relation types, "
        "and ontologies with scope configuration.",
    ),
    # --- Ontology Management ---
    (
        create_ontology,
        "create_ontology",
        "Create a new ontology (named lens over the schema).",
    ),
    (
        update_ontology,
        "update_ontology",
        "Update an ontology's display name or description.",
    ),
    (
        delete_ontology,
        "delete_ontology",
        "Delete an ontology. Does not affect the schema or other ontologies.",
    ),
    (
        add_entity_type_to_ontology,
        "add_entity_type_to_ontology",
        "Add an entity type to an ontology's scope. Properties=null means all "
        "properties. Properties=[...] means only listed properties are exposed.",
    ),
    (
        remove_entity_type_from_ontology,
        "remove_entity_type_from_ontology",
        "Remove an entity type from an ontology's scope.",
    ),
    (
        add_relation_type_to_ontology,
        "add_relation_type_to_ontology",
        "Add a relation type to an ontology's scope. Properties=null means all "
        "properties. Properties=[...] means only listed properties are exposed.",
    ),
    (
        remove_relation_type_from_ontology,
        "remove_relation_type_from_ontology",
        "Remove a relation type from an ontology's scope.",
    ),
    (
        validate_ontology,
        "validate_ontology",
        "Validate a single ontology's INCLUDES_TYPE configuration against the schema.",
    ),
    # --- AI Agent Config ---
    (
        list_ai_agents,
        "list_ai_agents",
        "List all AI agent configurations for an ontology.",
    ),
    (
        set_ai_agent,
        "set_ai_agent",
        "Create or update an AI agent configuration for an ontology. "
        "Key must match pattern ^[a-z][a-z0-9_-]*$ and cannot be '_default'. "
        f"Tools must be valid tool names ({VALID_AGENT_TOOLS_CSV}). "
        "Set tools=null to allow all tools.",
    ),
    (
        delete_ai_agent,
        "delete_ai_agent",
        "Delete an AI agent configuration from an ontology.",
    ),
    # --- Saved Query Config ---
    (
        list_saved_queries,
        "list_saved_queries",
        "List all saved queries for an ontology.",
    ),
    (
        set_saved_query,
        "set_saved_query",
        "Create or update a saved query pipeline for an ontology. "
        "Key must match pattern ^[a-z][a-z0-9_-]*$. "
        "Steps is an ordered array of pipeline steps. Each step requires a unique 'name' and a 'type'. "
        "Step types: "
        "'cypher' — needs 'cypher' field with a Cypher query using $param placeholders. "
        "'semantic_search' — needs 'entityTypeKey' and 'query' (use $param_name to reference a declared parameter). "
        "Optional: 'limit' (default 10), 'minScore'. "
        "Data flow: steps can have 'bindings' dict mapping param names to '{{prevStepName.fieldName}}' "
        "which collects that field from all rows of a previous step's output into a list. "
        "Parameters define top-level $param placeholders. "
        "Each parameter needs: name, description, dataType (string/integer/float/boolean/date/datetime). "
        "Example: steps=[{name:'skills', type:'semantic_search', entityTypeKey:'skill', query:'$q', limit:5}, "
        "{name:'results', type:'cypher', cypher:'MATCH (p:person)-[:has_skill]->(s:skill) "
        "WHERE s._id IN $ids RETURN p', bindings:{ids:'{{skills._id}}'}}], parameters=[{name:'q', ...}]",
    ),
    (
        delete_saved_query,
        "delete_saved_query",
        "Delete a saved query from an ontology.",
    ),
]

for fn, name, description in _MODELING_TOOL_DEFS:
    modeling_mcp.add_tool(fn, name=name, description=description)
