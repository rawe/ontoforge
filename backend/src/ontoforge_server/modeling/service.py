import json
import logging
import re
from collections.abc import AsyncGenerator
from uuid import uuid4

from fastapi import Depends

from ontoforge_server.core.ports import get_modeling_store, get_runtime_store
from ontoforge_server.runtime.embedding import build_text_repr
from ontoforge_server.runtime.service import (
    PropertyDef,
    sync_document_chunks,
)
from ontoforge_server.core.embedding import get_embedding_provider
from ontoforge_server.core.exceptions import (
    CascadeRequiredError,
    ConflictError,
    NotFoundError,
    StoreError,
    ValidationError,
)
from ontoforge_server.runtime.tool_names import VALID_AGENT_TOOLS
from ontoforge_server.modeling.schemas import (
    AGENT_KEY_PATTERN,
    AiAgentConfigResponse,
    AiAgentConfigUpsert,
    DataType,
    EntityTypeCreate,
    EntityTypeResponse,
    EntityTypeUpdate,
    ExportAiAgent,
    ExportEntityType,
    ExportOntology,
    ExportOntologyInclusion,
    ExportOntologyInclusions,
    ExportPayload,
    ExportProperty,
    ExportRelationType,
    ExportSavedQuery,
    ExportSavedQueryParameter,
    ExportSavedQueryStep,
    IncludeTypeRequest,
    IncludeTypeResponse,
    IncludeTypeUpdate,
    OntologyCreate,
    OntologyResponse,
    OntologyUpdate,
    PropertyDefinitionCreate,
    PropertyDefinitionResponse,
    PropertyDefinitionUpdate,
    RelationTypeCreate,
    RelationTypeResponse,
    RelationTypeUpdate,
    SavedQueryParameterSchema,
    SavedQueryResponse,
    SavedQueryUpsert,
    SchemaValidationError,
    StepSchema,
    StepType,
    ValidationResult,
)

logger = logging.getLogger(__name__)

# Page size for iterating all entities of a type during embedding rebuild.
_REBUILD_PAGE_SIZE = 500


def _to_ontology_response(data: dict) -> OntologyResponse:
    return OntologyResponse.model_validate(data)


def _to_entity_type_response(data: dict) -> EntityTypeResponse:
    return EntityTypeResponse.model_validate(data)


def _to_relation_type_response(data: dict) -> RelationTypeResponse:
    return RelationTypeResponse.model_validate(data)


def _to_property_response(data: dict) -> PropertyDefinitionResponse:
    return PropertyDefinitionResponse.model_validate(data)


def _invalidate_runtime_schema_cache() -> None:
    """Modeling writes change runtime-visible schema, so clear runtime cache."""
    from ontoforge_server.runtime import service as runtime_service

    runtime_service.invalidate_loaded_schema_cache()


def _reject_reserved_entity_type_key(store, key: str, context: str = "") -> None:
    """Reject an entity type key the storage adapter reserves for its own objects."""
    reserved = store.reserved_entity_type_keys()
    if key in reserved:
        raise ValidationError(
            f"{context}Entity type key '{key}' is reserved for internal use and "
            "cannot name a user-defined type. Reserved entity type keys: "
            f"{', '.join(sorted(reserved))}"
        )


def _reject_reserved_relation_type_key(store, key: str, context: str = "") -> None:
    """Reject a relation type key the storage adapter reserves for its own objects."""
    reserved = store.reserved_relation_type_keys()
    if key in reserved:
        raise ValidationError(
            f"{context}Relation type key '{key}' is reserved for internal use and "
            "cannot name a user-defined type. Reserved relation type keys: "
            f"{', '.join(sorted(reserved))}"
        )


# --- Ontology ---


async def create_ontology(
    body: OntologyCreate,
    store=Depends(get_modeling_store),
) -> OntologyResponse:
    existing_key = await store.get_ontology_by_key(body.key)
    if existing_key:
        raise ConflictError(f"Ontology with key '{body.key}' already exists")
    existing = await store.get_ontology_by_name(body.name)
    if existing:
        raise ConflictError(f"Ontology with name '{body.name}' already exists")
    ontology_id = str(uuid4())
    data = await store.create_ontology(
        ontology_id, body.key, body.name, body.description
    )
    _invalidate_runtime_schema_cache()
    return _to_ontology_response(data)


async def list_ontologies(
    store=Depends(get_modeling_store),
) -> list[OntologyResponse]:
    rows = await store.list_ontologies()
    return [_to_ontology_response(r) for r in rows]


async def get_ontology(
    ontology_id: str,
    store=Depends(get_modeling_store),
) -> OntologyResponse:
    data = await store.get_ontology(ontology_id)
    if not data:
        raise NotFoundError(f"Ontology '{ontology_id}' not found")
    return _to_ontology_response(data)


async def update_ontology(
    ontology_id: str,
    body: OntologyUpdate,
    store=Depends(get_modeling_store),
) -> OntologyResponse:
    if body.name is not None:
        existing = await store.get_ontology_by_name(body.name)
        if existing and existing["ontologyId"] != ontology_id:
            raise ConflictError(f"Ontology with name '{body.name}' already exists")
    data = await store.update_ontology(ontology_id, body.name, body.description)
    if not data:
        raise NotFoundError(f"Ontology '{ontology_id}' not found")
    _invalidate_runtime_schema_cache()
    return _to_ontology_response(data)


async def delete_ontology(
    ontology_id: str,
    store=Depends(get_modeling_store),
) -> None:
    deleted = await store.delete_ontology(ontology_id)
    if not deleted:
        raise NotFoundError(f"Ontology '{ontology_id}' not found")
    _invalidate_runtime_schema_cache()


# --- Entity Type (Global) ---


async def create_entity_type(
    body: EntityTypeCreate,
    store=Depends(get_modeling_store),
) -> EntityTypeResponse:
    _reject_reserved_entity_type_key(store, body.key)
    existing = await store.get_entity_type_by_key(body.key)
    if existing:
        raise ConflictError(f"Entity type with key '{body.key}' already exists")
    entity_type_id = str(uuid4())
    data = await store.create_entity_type(
        entity_type_id, body.key, body.display_name, body.description
    )
    _invalidate_runtime_schema_cache()
    provider = get_embedding_provider()
    if provider:
        await store.create_vector_index(body.key, provider.dimensions)
    return _to_entity_type_response(data)


async def list_entity_types(
    store=Depends(get_modeling_store),
) -> list[EntityTypeResponse]:
    rows = await store.list_entity_types()
    return [_to_entity_type_response(r) for r in rows]


async def get_entity_type(
    entity_type_id: str,
    store=Depends(get_modeling_store),
) -> EntityTypeResponse:
    data = await store.get_entity_type(entity_type_id)
    if not data:
        raise NotFoundError(f"Entity type '{entity_type_id}' not found")
    return _to_entity_type_response(data)


async def update_entity_type(
    entity_type_id: str,
    body: EntityTypeUpdate,
    store=Depends(get_modeling_store),
) -> EntityTypeResponse:
    data = await store.update_entity_type(
        entity_type_id, body.display_name, body.description
    )
    if not data:
        raise NotFoundError(f"Entity type '{entity_type_id}' not found")
    _invalidate_runtime_schema_cache()
    return _to_entity_type_response(data)


async def delete_entity_type(
    entity_type_id: str,
    cascade: bool = False,
    store=Depends(get_modeling_store),
) -> None:
    # Check if referenced by relation types
    referenced = await store.is_entity_type_referenced(entity_type_id)
    if referenced:
        raise ConflictError(
            f"Entity type '{entity_type_id}' is referenced by one or more relation types"
        )
    # Check INCLUDES_TYPE references
    affected = await store.find_ontologies_including_type(
        "EntityType", entity_type_id
    )
    if affected and not cascade:
        raise CascadeRequiredError(
            f"Entity type is included by {len(affected)} ontology(ies). Use ?cascade=true to remove.",
            affected_ontologies=affected,
        )
    if affected:
        await store.remove_all_includes_for_type("EntityType", entity_type_id)

    # Get key + properties for vector index / chunk cleanup before deleting
    et_data = await store.get_entity_type(entity_type_id)
    et_props = (
        await store.list_properties(entity_type_id, "EntityType")
        if et_data else []
    )
    deleted = await store.delete_entity_type(entity_type_id)
    if not deleted:
        raise NotFoundError(f"Entity type '{entity_type_id}' not found")
    _invalidate_runtime_schema_cache()
    if et_data:
        for prop in et_props:
            if prop.get("dataType") == DataType.DOCUMENT.value:
                await _drop_document_property_artifacts(
                    store, et_data["key"], prop["key"]
                )
        if get_embedding_provider():
            await store.drop_vector_index(et_data["key"])


# --- Relation Type (Global) ---


async def create_relation_type(
    body: RelationTypeCreate,
    store=Depends(get_modeling_store),
) -> RelationTypeResponse:
    _reject_reserved_relation_type_key(store, body.key)
    existing = await store.get_relation_type_by_key(body.key)
    if existing:
        raise ConflictError(f"Relation type with key '{body.key}' already exists")
    # Validate source/target entity types exist
    source = await store.get_entity_type_by_key(body.source_entity_type_key)
    if not source:
        raise ValidationError(
            f"Source entity type '{body.source_entity_type_key}' not found"
        )
    target = await store.get_entity_type_by_key(body.target_entity_type_key)
    if not target:
        raise ValidationError(
            f"Target entity type '{body.target_entity_type_key}' not found"
        )
    relation_type_id = str(uuid4())
    data = await store.create_relation_type(
        relation_type_id,
        body.key,
        body.display_name,
        body.description,
        body.source_entity_type_key,
        body.target_entity_type_key,
    )
    _invalidate_runtime_schema_cache()
    return _to_relation_type_response(data)


async def list_relation_types(
    store=Depends(get_modeling_store),
) -> list[RelationTypeResponse]:
    rows = await store.list_relation_types()
    return [_to_relation_type_response(r) for r in rows]


async def get_relation_type(
    relation_type_id: str,
    store=Depends(get_modeling_store),
) -> RelationTypeResponse:
    data = await store.get_relation_type(relation_type_id)
    if not data:
        raise NotFoundError(f"Relation type '{relation_type_id}' not found")
    return _to_relation_type_response(data)


async def update_relation_type(
    relation_type_id: str,
    body: RelationTypeUpdate,
    store=Depends(get_modeling_store),
) -> RelationTypeResponse:
    data = await store.update_relation_type(
        relation_type_id, body.display_name, body.description
    )
    if not data:
        raise NotFoundError(f"Relation type '{relation_type_id}' not found")
    _invalidate_runtime_schema_cache()
    return _to_relation_type_response(data)


async def delete_relation_type(
    relation_type_id: str,
    cascade: bool = False,
    store=Depends(get_modeling_store),
) -> None:
    # Check INCLUDES_TYPE references
    affected = await store.find_ontologies_including_type(
        "RelationType", relation_type_id
    )
    if affected and not cascade:
        raise CascadeRequiredError(
            f"Relation type is included by {len(affected)} ontology(ies). Use ?cascade=true to remove.",
            affected_ontologies=affected,
        )
    if affected:
        await store.remove_all_includes_for_type("RelationType", relation_type_id)
    deleted = await store.delete_relation_type(relation_type_id)
    if not deleted:
        raise NotFoundError(f"Relation type '{relation_type_id}' not found")
    _invalidate_runtime_schema_cache()


# --- Property Definition ---


async def _ensure_owner_exists(store, owner_id: str, owner_label: str) -> None:
    if owner_label == "EntityType":
        data = await store.get_entity_type(owner_id)
        if not data:
            raise NotFoundError(f"Entity type '{owner_id}' not found")
    else:
        data = await store.get_relation_type(owner_id)
        if not data:
            raise NotFoundError(f"Relation type '{owner_id}' not found")


async def _drop_document_property_artifacts(
    store, entity_type_key: str, property_key: str
) -> None:
    """Remove all chunk nodes and the vector index of a document property."""
    await store.delete_chunks_for_virtual_type(entity_type_key, property_key)
    await store.drop_document_vector_index(entity_type_key, property_key)


async def _rebuild_entity_type_vector_index(store, entity_type_id: str) -> None:
    """Rebuild the vector index for an entity type after property changes."""
    provider = get_embedding_provider()
    if not provider:
        return
    et = await store.get_entity_type(entity_type_id)
    if et:
        await store.rebuild_vector_index(et["key"], provider.dimensions)


async def create_property(
    owner_id: str,
    owner_label: str,
    body: PropertyDefinitionCreate,
    cascade: bool = False,
    store=Depends(get_modeling_store),
) -> PropertyDefinitionResponse:
    if owner_label == "RelationType" and body.data_type == DataType.DOCUMENT:
        raise ValidationError(
            "Document properties are only supported on entity types"
        )
    await _ensure_owner_exists(store, owner_id, owner_label)
    existing = await store.get_property_by_key(owner_id, owner_label, body.key)
    if existing:
        raise ConflictError(
            f"Property with key '{body.key}' already exists on this type"
        )
    # Cascade check: if adding required property without default
    if body.required and body.default_value is None:
        affected = await store.find_ontologies_with_explicit_property(
            owner_label, owner_id, body.key
        )
        if affected and not cascade:
            raise CascadeRequiredError(
                f"Adding required property '{body.key}' without default would break {len(affected)} ontology(ies). "
                f"Use ?cascade=true to auto-add to explicit property lists.",
                affected_ontologies=affected,
            )
        if affected:
            await store.add_property_to_includes_lists(
                owner_label, owner_id, body.key
            )
    property_id = str(uuid4())
    data = await store.create_property(
        owner_id,
        owner_label,
        property_id,
        body.key,
        body.display_name,
        body.description,
        body.data_type.value,
        body.required,
        body.default_value,
    )
    _invalidate_runtime_schema_cache()
    if owner_label == "EntityType":
        await _rebuild_entity_type_vector_index(store, owner_id)
        if body.data_type == DataType.DOCUMENT:
            provider = get_embedding_provider()
            if provider:
                et = await store.get_entity_type(owner_id)
                if et:
                    await store.create_document_vector_index(
                        et["key"], body.key, provider.dimensions
                    )
    return _to_property_response(data)


async def list_properties(
    owner_id: str,
    owner_label: str,
    store=Depends(get_modeling_store),
) -> list[PropertyDefinitionResponse]:
    await _ensure_owner_exists(store, owner_id, owner_label)
    rows = await store.list_properties(owner_id, owner_label)
    return [_to_property_response(r) for r in rows]


async def update_property(
    owner_id: str,
    owner_label: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    store=Depends(get_modeling_store),
) -> PropertyDefinitionResponse:
    await _ensure_owner_exists(store, owner_id, owner_label)
    # Determine if defaultValue was explicitly set to None (clear) vs not provided
    raw = body.model_dump(exclude_unset=True)
    clear_default = "default_value" in raw and raw["default_value"] is None
    data = await store.update_property(
        owner_id,
        owner_label,
        property_id,
        body.display_name,
        body.description,
        body.required,
        body.default_value,
        clear_default=clear_default,
    )
    if not data:
        raise NotFoundError(
            f"Property '{property_id}' not found on this type"
        )
    _invalidate_runtime_schema_cache()
    return _to_property_response(data)


async def delete_property(
    owner_id: str,
    owner_label: str,
    property_id: str,
    cascade: bool = False,
    store=Depends(get_modeling_store),
) -> None:
    await _ensure_owner_exists(store, owner_id, owner_label)
    # Get property key for cascade check
    prop = await store.get_property(owner_id, owner_label, property_id)
    if not prop:
        raise NotFoundError(f"Property '{property_id}' not found on this type")
    # Check if any scoped ontologies reference this property
    affected = await store.find_ontologies_including_type(owner_label, owner_id)
    # Filter: only ontologies with explicit property lists that include this key
    # (properties: null ontologies are not affected)
    if affected:
        # We need to check which ontologies actually have this property in their explicit lists
        # The simplest approach: use the store function for this
        pass
    if affected and not cascade:
        # For cascade on delete: remove from property lists
        # Only matters if ontologies reference this specific property in explicit lists
        pass
    if cascade:
        await store.remove_property_from_includes_lists(
            owner_label, owner_id, prop["key"]
        )
    deleted = await store.delete_property(owner_id, owner_label, property_id)
    if not deleted:
        raise NotFoundError(
            f"Property '{property_id}' not found on this type"
        )
    _invalidate_runtime_schema_cache()
    if owner_label == "EntityType":
        await _rebuild_entity_type_vector_index(store, owner_id)
        if prop.get("dataType") == DataType.DOCUMENT.value:
            et = await store.get_entity_type(owner_id)
            if et:
                await _drop_document_property_artifacts(store, et["key"], prop["key"])


# --- Scope Management ---


async def _resolve_ontology(store, ontology_id: str) -> dict:
    data = await store.get_ontology(ontology_id)
    if not data:
        raise NotFoundError(f"Ontology '{ontology_id}' not found")
    return data


async def add_includes_entity_type(
    ontology_id: str,
    body: IncludeTypeRequest,
    store=Depends(get_modeling_store),
) -> IncludeTypeResponse:
    await _resolve_ontology(store, ontology_id)
    # Validate entity type exists
    et = await store.get_entity_type_by_key(body.key)
    if not et:
        raise NotFoundError(f"Entity type '{body.key}' not found")
    # Validate property keys if explicit list
    if body.properties is not None:
        et_props = await store.list_properties(et["entityTypeId"], "EntityType")
        valid_keys = {p["key"] for p in et_props}
        for pk in body.properties:
            if pk not in valid_keys:
                raise ValidationError(f"Property '{pk}' not found on entity type '{body.key}'")
        # Check required properties without defaults are included
        for p in et_props:
            if p["required"] and p.get("defaultValue") is None and p["key"] not in body.properties:
                raise ValidationError(
                    f"Required property '{p['key']}' without default must be included "
                    f"in the property list for entity type '{body.key}'"
                )
    data = await store.add_includes_type(
        ontology_id, "EntityType", body.key, body.properties
    )
    if not data:
        raise NotFoundError(f"Failed to add inclusion for entity type '{body.key}'")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def list_includes_entity_types(
    ontology_id: str,
    store=Depends(get_modeling_store),
) -> list[IncludeTypeResponse]:
    await _resolve_ontology(store, ontology_id)
    rows = await store.list_includes_types(ontology_id, "EntityType")
    return [IncludeTypeResponse(key=r["key"], properties=r["properties"]) for r in rows]


async def update_includes_entity_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    store=Depends(get_modeling_store),
) -> IncludeTypeResponse:
    await _resolve_ontology(store, ontology_id)
    # Validate entity type exists
    et = await store.get_entity_type(type_id)
    if not et:
        raise NotFoundError(f"Entity type '{type_id}' not found")
    # Validate property keys if explicit list
    if body.properties is not None:
        et_props = await store.list_properties(type_id, "EntityType")
        valid_keys = {p["key"] for p in et_props}
        for pk in body.properties:
            if pk not in valid_keys:
                raise ValidationError(f"Property '{pk}' not found on entity type '{et['key']}'")
        for p in et_props:
            if p["required"] and p.get("defaultValue") is None and p["key"] not in body.properties:
                raise ValidationError(
                    f"Required property '{p['key']}' without default must be included"
                )
    data = await store.update_includes_type(
        ontology_id, "EntityType", type_id, body.properties
    )
    if not data:
        raise NotFoundError(f"Entity type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def remove_includes_entity_type(
    ontology_id: str,
    type_id: str,
    store=Depends(get_modeling_store),
) -> None:
    await _resolve_ontology(store, ontology_id)
    deleted = await store.remove_includes_type(ontology_id, "EntityType", type_id)
    if not deleted:
        raise NotFoundError(f"Entity type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()


async def add_includes_relation_type(
    ontology_id: str,
    body: IncludeTypeRequest,
    store=Depends(get_modeling_store),
) -> IncludeTypeResponse:
    await _resolve_ontology(store, ontology_id)
    rt = await store.get_relation_type_by_key(body.key)
    if not rt:
        raise NotFoundError(f"Relation type '{body.key}' not found")
    # Validate source/target entity types are included (or ontology has no entity scoping)
    entity_inclusions = await store.list_includes_types(ontology_id, "EntityType")
    if entity_inclusions:
        included_et_keys = {inc["key"] for inc in entity_inclusions}
        if rt["sourceEntityTypeKey"] not in included_et_keys:
            raise ValidationError(
                f"Source entity type '{rt['sourceEntityTypeKey']}' of relation type '{body.key}' "
                f"is not included in this ontology"
            )
        if rt["targetEntityTypeKey"] not in included_et_keys:
            raise ValidationError(
                f"Target entity type '{rt['targetEntityTypeKey']}' of relation type '{body.key}' "
                f"is not included in this ontology"
            )
    # Validate property keys if explicit list
    if body.properties is not None:
        rt_props = await store.list_properties(rt["relationTypeId"], "RelationType")
        valid_keys = {p["key"] for p in rt_props}
        for pk in body.properties:
            if pk not in valid_keys:
                raise ValidationError(f"Property '{pk}' not found on relation type '{body.key}'")
        for p in rt_props:
            if p["required"] and p.get("defaultValue") is None and p["key"] not in body.properties:
                raise ValidationError(
                    f"Required property '{p['key']}' without default must be included "
                    f"in the property list for relation type '{body.key}'"
                )
    data = await store.add_includes_type(
        ontology_id, "RelationType", body.key, body.properties
    )
    if not data:
        raise NotFoundError(f"Failed to add inclusion for relation type '{body.key}'")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def list_includes_relation_types(
    ontology_id: str,
    store=Depends(get_modeling_store),
) -> list[IncludeTypeResponse]:
    await _resolve_ontology(store, ontology_id)
    rows = await store.list_includes_types(ontology_id, "RelationType")
    return [IncludeTypeResponse(key=r["key"], properties=r["properties"]) for r in rows]


async def update_includes_relation_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    store=Depends(get_modeling_store),
) -> IncludeTypeResponse:
    await _resolve_ontology(store, ontology_id)
    rt = await store.get_relation_type(type_id)
    if not rt:
        raise NotFoundError(f"Relation type '{type_id}' not found")
    if body.properties is not None:
        rt_props = await store.list_properties(type_id, "RelationType")
        valid_keys = {p["key"] for p in rt_props}
        for pk in body.properties:
            if pk not in valid_keys:
                raise ValidationError(f"Property '{pk}' not found on relation type '{rt['key']}'")
        for p in rt_props:
            if p["required"] and p.get("defaultValue") is None and p["key"] not in body.properties:
                raise ValidationError(
                    f"Required property '{p['key']}' without default must be included"
                )
    data = await store.update_includes_type(
        ontology_id, "RelationType", type_id, body.properties
    )
    if not data:
        raise NotFoundError(f"Relation type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def remove_includes_relation_type(
    ontology_id: str,
    type_id: str,
    store=Depends(get_modeling_store),
) -> None:
    await _resolve_ontology(store, ontology_id)
    deleted = await store.remove_includes_type(ontology_id, "RelationType", type_id)
    if not deleted:
        raise NotFoundError(f"Relation type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()


# --- Schema Validation ---


async def validate_schema(
    store=Depends(get_modeling_store),
) -> ValidationResult:
    """Validate the global schema."""
    schema = await store.get_full_schema()

    errors: list[SchemaValidationError] = []
    valid_data_types = {dt.value for dt in DataType}

    # Check entity type key uniqueness
    et_keys: set[str] = set()
    entity_type_ids: set[str] = set()
    for et in schema["entityTypes"]:
        entity_type_ids.add(et["entityTypeId"])
        if et["key"] in et_keys:
            errors.append(
                SchemaValidationError(
                    path=f"entityTypes.{et['key']}",
                    message=f"Duplicate entity type key '{et['key']}'",
                )
            )
        et_keys.add(et["key"])
        prop_keys: set[str] = set()
        for p in et.get("properties", []):
            if p["key"] in prop_keys:
                errors.append(
                    SchemaValidationError(
                        path=f"entityTypes.{et['key']}.properties.{p['key']}",
                        message=f"Duplicate property key '{p['key']}'",
                    )
                )
            prop_keys.add(p["key"])
            if p["dataType"] not in valid_data_types:
                errors.append(
                    SchemaValidationError(
                        path=f"entityTypes.{et['key']}.properties.{p['key']}",
                        message=f"Invalid data type '{p['dataType']}'",
                    )
                )

    # Check relation types
    rt_keys: set[str] = set()
    for rt in schema["relationTypes"]:
        if rt["key"] in rt_keys:
            errors.append(
                SchemaValidationError(
                    path=f"relationTypes.{rt['key']}",
                    message=f"Duplicate relation type key '{rt['key']}'",
                )
            )
        rt_keys.add(rt["key"])
        if rt["sourceKey"] not in et_keys:
            errors.append(
                SchemaValidationError(
                    path=f"relationTypes.{rt['key']}",
                    message=f"Source entity type '{rt['sourceKey']}' does not exist",
                )
            )
        if rt["targetKey"] not in et_keys:
            errors.append(
                SchemaValidationError(
                    path=f"relationTypes.{rt['key']}",
                    message=f"Target entity type '{rt['targetKey']}' does not exist",
                )
            )
        prop_keys = set()
        for p in rt.get("properties", []):
            if p["key"] in prop_keys:
                errors.append(
                    SchemaValidationError(
                        path=f"relationTypes.{rt['key']}.properties.{p['key']}",
                        message=f"Duplicate property key '{p['key']}'",
                    )
                )
            prop_keys.add(p["key"])
            if p["dataType"] not in valid_data_types:
                errors.append(
                    SchemaValidationError(
                        path=f"relationTypes.{rt['key']}.properties.{p['key']}",
                        message=f"Invalid data type '{p['dataType']}'",
                    )
                )

    return ValidationResult(valid=len(errors) == 0, errors=errors)


async def validate_ontology(
    ontology_id: str,
    store=Depends(get_modeling_store),
) -> ValidationResult:
    """Validate a single ontology's INCLUDES_TYPE configuration."""
    ont = await store.get_ontology(ontology_id)
    if not ont:
        raise NotFoundError(f"Ontology '{ontology_id}' not found")

    schema = await store.get_full_schema()

    errors: list[SchemaValidationError] = []
    ontology_key = ont["key"]

    # Find this ontology in the schema
    ont_data = None
    for o in schema["ontologies"]:
        if o["ontologyId"] == ontology_id:
            ont_data = o
            break
    if not ont_data:
        return ValidationResult(valid=True, errors=[])

    entity_inclusions = ont_data.get("entityInclusions", [])
    relation_inclusions = ont_data.get("relationInclusions", [])

    if not entity_inclusions and not relation_inclusions:
        return ValidationResult(valid=True, errors=[])

    # Build lookup maps
    et_map = {et["key"]: et for et in schema["entityTypes"]}
    rt_map = {rt["key"]: rt for rt in schema["relationTypes"]}

    # Validate entity type inclusions
    included_et_keys = set()
    for inc in entity_inclusions:
        if inc["key"] not in et_map:
            errors.append(SchemaValidationError(
                path=f"ontologies.{ontology_key}.includes.entityTypes.{inc['key']}",
                message=f"Entity type '{inc['key']}' does not exist",
            ))
            continue
        included_et_keys.add(inc["key"])
        if inc["properties"] is not None:
            et = et_map[inc["key"]]
            valid_props = {p["key"] for p in et.get("properties", [])}
            for pk in inc["properties"]:
                if pk not in valid_props:
                    errors.append(SchemaValidationError(
                        path=f"ontologies.{ontology_key}.includes.entityTypes.{inc['key']}.properties",
                        message=f"Property '{pk}' does not exist on entity type '{inc['key']}'",
                    ))
            # Check required properties without defaults are included
            for p in et.get("properties", []):
                if p["required"] and p.get("defaultValue") is None and p["key"] not in inc["properties"]:
                    errors.append(SchemaValidationError(
                        path=f"ontologies.{ontology_key}.includes.entityTypes.{inc['key']}.properties",
                        message=f"Required property '{p['key']}' without default must be included",
                    ))

    # Validate relation type inclusions
    for inc in relation_inclusions:
        if inc["key"] not in rt_map:
            errors.append(SchemaValidationError(
                path=f"ontologies.{ontology_key}.includes.relationTypes.{inc['key']}",
                message=f"Relation type '{inc['key']}' does not exist",
            ))
            continue
        rt = rt_map[inc["key"]]
        # Check source/target are included (if entity scoping is active)
        if included_et_keys:
            if rt["sourceKey"] not in included_et_keys:
                errors.append(SchemaValidationError(
                    path=f"ontologies.{ontology_key}.includes.relationTypes.{inc['key']}",
                    message=f"Source entity type '{rt['sourceKey']}' is not included",
                ))
            if rt["targetKey"] not in included_et_keys:
                errors.append(SchemaValidationError(
                    path=f"ontologies.{ontology_key}.includes.relationTypes.{inc['key']}",
                    message=f"Target entity type '{rt['targetKey']}' is not included",
                ))
        if inc["properties"] is not None:
            valid_props = {p["key"] for p in rt.get("properties", [])}
            for pk in inc["properties"]:
                if pk not in valid_props:
                    errors.append(SchemaValidationError(
                        path=f"ontologies.{ontology_key}.includes.relationTypes.{inc['key']}.properties",
                        message=f"Property '{pk}' does not exist on relation type '{inc['key']}'",
                    ))
            for p in rt.get("properties", []):
                if p["required"] and p.get("defaultValue") is None and p["key"] not in inc["properties"]:
                    errors.append(SchemaValidationError(
                        path=f"ontologies.{ontology_key}.includes.relationTypes.{inc['key']}.properties",
                        message=f"Required property '{p['key']}' without default must be included",
                    ))

    return ValidationResult(valid=len(errors) == 0, errors=errors)


async def validate_all(
    store=Depends(get_modeling_store),
) -> ValidationResult:
    """Validate schema + all scoped ontologies."""
    schema_result = await validate_schema(store=store)
    errors = list(schema_result.errors)

    ontologies = await store.list_ontologies()
    for ont in ontologies:
        ont_result = await validate_ontology(ont["ontologyId"], store=store)
        errors.extend(ont_result.errors)

    return ValidationResult(valid=len(errors) == 0, errors=errors)


# --- Export / Import ---


async def export_schema(
    store=Depends(get_modeling_store),
) -> ExportPayload:
    schema = await store.get_full_schema()

    entity_types = []
    for et in schema["entityTypes"]:
        props = [
            ExportProperty(
                key=p["key"],
                displayName=p["displayName"],
                description=p.get("description"),
                dataType=p["dataType"],
                required=p["required"],
                defaultValue=p.get("defaultValue"),
            )
            for p in et.get("properties", [])
        ]
        entity_types.append(
            ExportEntityType(
                key=et["key"],
                displayName=et["displayName"],
                description=et.get("description"),
                properties=props,
            )
        )

    relation_types = []
    for rt in schema["relationTypes"]:
        props = [
            ExportProperty(
                key=p["key"],
                displayName=p["displayName"],
                description=p.get("description"),
                dataType=p["dataType"],
                required=p["required"],
                defaultValue=p.get("defaultValue"),
            )
            for p in rt.get("properties", [])
        ]
        relation_types.append(
            ExportRelationType(
                key=rt["key"],
                displayName=rt["displayName"],
                description=rt.get("description"),
                fromEntityTypeKey=rt["sourceKey"],
                toEntityTypeKey=rt["targetKey"],
                properties=props,
            )
        )

    ontologies = []
    for ont in schema["ontologies"]:
        entity_inclusions = ont.get("entityInclusions", [])
        relation_inclusions = ont.get("relationInclusions", [])
        if entity_inclusions or relation_inclusions:
            includes = ExportOntologyInclusions(
                entityTypes=[
                    ExportOntologyInclusion(key=inc["key"], properties=inc["properties"])
                    for inc in entity_inclusions
                ],
                relationTypes=[
                    ExportOntologyInclusion(key=inc["key"], properties=inc["properties"])
                    for inc in relation_inclusions
                ],
            )
        else:
            includes = None

        # Load AI agent configs for this ontology
        agent_rows = await store.list_ai_agents_for_export(ont["ontologyId"])
        ai_agents = [
            ExportAiAgent(
                key=ag["key"],
                name=ag["name"],
                description=ag.get("description"),
                systemPrompt=ag.get("systemPrompt"),
                tools=ag.get("tools"),
            )
            for ag in agent_rows
        ]

        # Load saved query configs for this ontology
        query_rows = await store.list_saved_queries_for_export(ont["ontologyId"])
        saved_queries = [
            ExportSavedQuery(
                key=sq["key"],
                name=sq["name"],
                description=sq["description"],
                steps=_deserialize_export_steps(sq.get("steps")),
                parameters=_deserialize_export_params(sq.get("parameters")),
            )
            for sq in query_rows
        ]

        ontologies.append(
            ExportOntology(
                key=ont["key"],
                name=ont["name"],
                description=ont.get("description"),
                includes=includes,
                aiAgents=ai_agents,
                savedQueries=saved_queries,
            )
        )

    return ExportPayload(
        formatVersion="3.0",
        entityTypes=entity_types,
        relationTypes=relation_types,
        ontologies=ontologies,
    )


async def import_schema(
    payload: ExportPayload,
    store=Depends(get_modeling_store),
) -> dict:
    """Import a v2.0 schema: create types globally, then ontologies with INCLUDES_TYPE edges."""
    provider = get_embedding_provider()

    # Create entity types and track key->id mapping
    et_key_to_id: dict[str, str] = {}
    for et in payload.entity_types:
        _reject_reserved_entity_type_key(store, et.key, context="Import error: ")
        existing = await store.get_entity_type_by_key(et.key)
        if existing:
            raise ConflictError(f"Entity type with key '{et.key}' already exists")
        et_id = str(uuid4())
        await store.create_entity_type(
            et_id, et.key, et.display_name, et.description
        )
        et_key_to_id[et.key] = et_id
        for prop in et.properties:
            prop_id = str(uuid4())
            await store.create_property(
                et_id, "EntityType", prop_id,
                prop.key, prop.display_name, prop.description,
                prop.data_type, prop.required, prop.default_value,
            )

        # Create vector indexes for this entity type (document values
        # are never in-index metadata; chunks get their own index)
        if provider:
            filter_props = [
                prop.key for prop in et.properties
                if prop.data_type != DataType.DOCUMENT.value
            ]
            await store.create_vector_index(
                et.key, provider.dimensions,
                filter_properties=filter_props,
            )
            for prop in et.properties:
                if prop.data_type == DataType.DOCUMENT.value:
                    await store.create_document_vector_index(
                        et.key, prop.key, provider.dimensions
                    )

    # Create relation types
    for rt in payload.relation_types:
        _reject_reserved_relation_type_key(store, rt.key, context="Import error: ")
        existing = await store.get_relation_type_by_key(rt.key)
        if existing:
            raise ConflictError(f"Relation type with key '{rt.key}' already exists")
        if rt.from_entity_type_key not in et_key_to_id:
            raise ValidationError(
                f"Import error: source entity type key '{rt.from_entity_type_key}' not found"
            )
        if rt.to_entity_type_key not in et_key_to_id:
            raise ValidationError(
                f"Import error: target entity type key '{rt.to_entity_type_key}' not found"
            )
        rt_id = str(uuid4())
        await store.create_relation_type(
            rt_id, rt.key, rt.display_name, rt.description,
            rt.from_entity_type_key, rt.to_entity_type_key,
        )
        for prop in rt.properties:
            if prop.data_type == DataType.DOCUMENT.value:
                raise ValidationError(
                    f"Import error: property '{prop.key}' on relation type "
                    f"'{rt.key}' has data type 'document'; document properties "
                    "are only supported on entity types"
                )
            prop_id = str(uuid4())
            await store.create_property(
                rt_id, "RelationType", prop_id,
                prop.key, prop.display_name, prop.description,
                prop.data_type, prop.required, prop.default_value,
            )

    # Create ontologies with INCLUDES_TYPE edges
    created_ontologies = []
    for ont in payload.ontologies:
        existing = await store.get_ontology_by_key(ont.key)
        if existing:
            raise ConflictError(f"Ontology with key '{ont.key}' already exists")
        ont_id = str(uuid4())
        ont_data = await store.create_ontology(
            ont_id, ont.key, ont.name, ont.description
        )
        if ont.includes:
            for inc in ont.includes.entity_types:
                await store.add_includes_type(
                    ont_id, "EntityType", inc.key, inc.properties
                )
            for inc in ont.includes.relation_types:
                await store.add_includes_type(
                    ont_id, "RelationType", inc.key, inc.properties
                )

        # Import AI agent configs
        for ag in ont.ai_agents:
            # Validate tools strictly
            if ag.tools is not None:
                unknown = [t for t in ag.tools if t not in VALID_AGENT_TOOLS]
                if unknown:
                    available = sorted(VALID_AGENT_TOOLS)
                    raise ValidationError(
                        f"Import error: agent '{ag.key}' references unknown tool(s): "
                        f"{unknown}. Available tools: {available}"
                    )
            ag_id = str(uuid4())
            await store.upsert_ai_agent(
                ont_id, ag_id, ag.key, ag.name,
                ag.description, ag.system_prompt, ag.tools,
            )

        # Import saved queries
        provider = get_embedding_provider()
        for sq in ont.saved_queries:
            # Convert export steps to StepSchema for validation
            import_steps = [
                StepSchema(
                    name=s.name,
                    type=StepType(s.type),
                    oql=s.oql,
                    entityTypeKey=s.entity_type_key,
                    query=s.query,
                    limit=s.limit,
                    minScore=s.min_score,
                    bindings=s.bindings,
                )
                for s in sq.steps
            ]
            for p in sq.parameters:
                if p.data_type == DataType.DOCUMENT.value:
                    raise ValidationError(
                        f"Import error: parameter '{p.name}' of saved query "
                        f"'{sq.key}' has data type 'document'; parameters "
                        "must be scalar types"
                    )
            _validate_pipeline(import_steps, [p.name for p in sq.parameters], sq.key)
            steps_json = _serialize_json([
                {
                    "name": s.name,
                    "type": s.type,
                    **({"oql": s.oql} if s.oql else {}),
                    **({"entityTypeKey": s.entity_type_key} if s.entity_type_key else {}),
                    **({"query": s.query} if s.query else {}),
                    **({"limit": s.limit} if s.limit is not None else {}),
                    **({"minScore": s.min_score} if s.min_score is not None else {}),
                    **({"bindings": s.bindings} if s.bindings else {}),
                }
                for s in sq.steps
            ])
            params_json = _serialize_json([
                {"name": p.name, "description": p.description, "dataType": p.data_type}
                for p in sq.parameters
            ])
            sq_embedding = None
            if provider:
                sq_embedding = await provider.embed(sq.description)
            sq_id = str(uuid4())
            await store.upsert_saved_query(
                ont_id, sq_id, sq.key, sq.name,
                sq.description, steps_json, params_json,
                ontology_key=ont.key,
                embedding=sq_embedding,
            )

        created_ontologies.append(_to_ontology_response(ont_data))

    # Ensure saved query vector index exists
    if provider:
        await store.ensure_saved_query_vector_index(provider.dimensions)

    _invalidate_runtime_schema_cache()
    return {"ontologies": [o.model_dump(by_alias=True) for o in created_ontologies]}


# --- Rebuild Embeddings ---


async def rebuild_embeddings(
    store,
    runtime_store,
) -> AsyncGenerator[str, None]:
    """Re-embed all entities and saved queries. Yields NDJSON progress lines."""
    provider = get_embedding_provider()
    if not provider:
        raise ValidationError(
            "Embedding provider is not configured. "
            "Set EMBEDDING_PROVIDER to enable semantic search."
        )

    # Ensure all vector indexes exist
    await store.ensure_vector_indexes(provider.dimensions)

    # Discover all entity types with their property definitions
    entity_types = []
    for raw in await store.get_entity_types_with_properties():
        props = {}
        for p in raw["properties"]:
            props[p["key"]] = PropertyDef(
                key=p["key"],
                display_name=p.get("displayName", p["key"]),
                description=p.get("description"),
                data_type=p.get("dataType", "string"),
                required=p.get("required", False),
                default_value=p.get("defaultValue"),
            )
        entity_types.append({"key": raw["key"], "properties": props})

    # For each entity type, iterate all entities and re-embed
    type_results = []
    total_processed = 0
    total_failed = 0

    for et in entity_types:
        et_key = et["key"]
        property_defs = et["properties"]

        # Page through all entities of this type
        records: list[dict] = []
        entity_total = 0
        offset = 0
        while True:
            items, entity_total = await runtime_store.list_entities(
                et_key, {}, {}, None, [], "_createdAt", "asc",
                _REBUILD_PAGE_SIZE, offset,
            )
            records.extend(items)
            offset += _REBUILD_PAGE_SIZE
            if not items or offset >= entity_total:
                break

        processed = 0
        failed = 0

        doc_prop_keys = [
            k for k, p in property_defs.items() if p.data_type == "document"
        ]

        for record in records:
            entity_id = record["_id"]
            user_props = {k: v for k, v in record.items() if not k.startswith("_")}

            text = build_text_repr(et_key, user_props, property_defs)
            embedding = await provider.embed(text)

            if embedding is not None:
                await store.set_entity_embedding(entity_id, embedding)
                processed += 1
            else:
                failed += 1

            # Rebuild document chunks (delete + re-chunk + re-embed)
            if doc_prop_keys:
                doc_values = {k: user_props.get(k) for k in doc_prop_keys}
                await sync_document_chunks(
                    runtime_store, et_key, entity_id, doc_values
                )

            yield json.dumps({
                "type": "progress",
                "entityTypeKey": et_key,
                "processed": processed + failed,
                "total": entity_total,
            }) + "\n"

        type_results.append({
            "entityTypeKey": et_key,
            "processed": processed,
            "failed": failed,
        })
        total_processed += processed
        total_failed += failed

    # Re-embed saved queries
    saved_queries = await store.list_saved_query_refs()

    sq_total = len(saved_queries)
    sq_processed = 0
    sq_failed = 0

    for sq in saved_queries:
        embedding = await provider.embed(sq["description"])
        if embedding is not None:
            await store.set_saved_query_embedding(sq["savedQueryId"], embedding)
            sq_processed += 1
        else:
            sq_failed += 1

        yield json.dumps({
            "type": "progress",
            "entityTypeKey": "saved_queries",
            "processed": sq_processed + sq_failed,
            "total": sq_total,
        }) + "\n"

    total_processed += sq_processed
    total_failed += sq_failed

    # Final summary
    yield json.dumps({
        "type": "summary",
        "entityTypes": type_results,
        "savedQueriesProcessed": sq_processed,
        "savedQueriesFailed": sq_failed,
        "totalProcessed": total_processed,
        "totalFailed": total_failed,
    }) + "\n"

    logger.info(
        "Rebuild embeddings complete: %d processed, %d failed",
        total_processed, total_failed,
    )


# --- AI Agent Config ---


def _to_ai_agent_response(data: dict) -> AiAgentConfigResponse:
    return AiAgentConfigResponse.model_validate(data)


async def list_ai_agents(
    ontology_key: str,
    store=Depends(get_modeling_store),
) -> list[AiAgentConfigResponse]:
    ont = await store.get_ontology_by_key(ontology_key)
    if not ont:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")
    rows = await store.list_ai_agents(ont["ontologyId"])
    return [_to_ai_agent_response(r) for r in rows]


async def upsert_ai_agent(
    ontology_key: str,
    agent_key: str,
    body: AiAgentConfigUpsert,
    store=Depends(get_modeling_store),
) -> tuple[AiAgentConfigResponse, bool]:
    """Returns (response, created)."""
    if not re.match(AGENT_KEY_PATTERN, agent_key):
        raise ValidationError(
            f"Invalid agent key '{agent_key}'. Must match pattern: {AGENT_KEY_PATTERN}"
        )
    if agent_key == "_default":
        raise ValidationError("Agent key '_default' is reserved")

    # Validate tools
    if body.tools is not None:
        unknown = [t for t in body.tools if t not in VALID_AGENT_TOOLS]
        if unknown:
            available = sorted(VALID_AGENT_TOOLS)
            raise ValidationError(
                f"Unknown tool(s): {unknown}. Available tools: {available}"
            )

    ont = await store.get_ontology_by_key(ontology_key)
    if not ont:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")
    agent_config_id = str(uuid4())
    data, created = await store.upsert_ai_agent(
        ont["ontologyId"],
        agent_config_id,
        agent_key,
        body.name,
        body.description,
        body.system_prompt,
        body.tools,
    )
    _invalidate_runtime_schema_cache()
    return _to_ai_agent_response(data), created


async def delete_ai_agent(
    ontology_key: str,
    agent_key: str,
    store=Depends(get_modeling_store),
) -> None:
    ont = await store.get_ontology_by_key(ontology_key)
    if not ont:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")
    deleted = await store.delete_ai_agent(ont["ontologyId"], agent_key)
    if not deleted:
        raise NotFoundError(f"AI agent '{agent_key}' not found")
    _invalidate_runtime_schema_cache()


# --- Saved Query Config ---


def _to_saved_query_response(data: dict) -> SavedQueryResponse:
    """Convert store dict to SavedQueryResponse, deserializing JSON fields."""
    import json

    params_raw = data.get("parameters", "[]")
    if isinstance(params_raw, str):
        params_list = json.loads(params_raw)
    else:
        params_list = params_raw or []

    steps_raw = data.get("steps", "[]")
    if isinstance(steps_raw, str):
        steps_list = json.loads(steps_raw)
    else:
        steps_list = steps_raw or []

    return SavedQueryResponse(
        key=data["key"],
        name=data["name"],
        description=data["description"],
        steps=[
            StepSchema(
                name=s["name"],
                type=s["type"],
                oql=s.get("oql", s.get("cypher")),
                entityTypeKey=s.get("entityTypeKey"),
                query=s.get("query"),
                limit=s.get("limit"),
                minScore=s.get("minScore"),
                bindings=s.get("bindings"),
            )
            for s in steps_list
        ],
        parameters=[
            SavedQueryParameterSchema(
                name=p["name"],
                description=p["description"],
                dataType=p["dataType"],
            )
            for p in params_list
        ],
        createdAt=data["createdAt"],
        updatedAt=data["updatedAt"],
    )


def _serialize_json(data: list[dict]) -> str:
    """Serialize a list of dicts to JSON string for storage."""
    import json
    return json.dumps(data)


def _deserialize_export_params(params_json: str | None) -> list[ExportSavedQueryParameter]:
    """Deserialize parameters JSON to export model list."""
    import json
    if not params_json:
        return []
    params_list = json.loads(params_json) if isinstance(params_json, str) else params_json
    return [
        ExportSavedQueryParameter(
            name=p["name"],
            description=p["description"],
            dataType=p["dataType"],
        )
        for p in params_list
    ]


def _deserialize_export_steps(steps_json: str | None) -> list[ExportSavedQueryStep]:
    """Deserialize steps JSON to export model list."""
    import json
    if not steps_json:
        return []
    steps_list = json.loads(steps_json) if isinstance(steps_json, str) else steps_json
    return [
        ExportSavedQueryStep(
            name=s["name"],
            type=s["type"],
            oql=s.get("oql", s.get("cypher")),
            entityTypeKey=s.get("entityTypeKey"),
            query=s.get("query"),
            limit=s.get("limit"),
            minScore=s.get("minScore"),
            bindings=s.get("bindings"),
        )
        for s in steps_list
    ]


_BINDING_PATTERN = re.compile(r'\{\{(\w+)\.(\w+)\}\}')


def _validate_pipeline(
    steps: list[StepSchema],
    param_names: list[str],
    query_key: str,
) -> None:
    """Validate a saved query pipeline. Collects all errors before raising."""
    errors: list[str] = []
    declared_params = set(param_names)
    seen_step_names: dict[str, int] = {}

    for i, step in enumerate(steps):
        prefix = f"steps[{i}]"

        # Step name uniqueness
        if step.name in seen_step_names:
            errors.append(
                f"{prefix}.name: '{step.name}' already used by steps[{seen_step_names[step.name]}]"
            )
        seen_step_names[step.name] = i

        # Type-specific required fields
        if step.type == StepType.OQL:
            if not step.oql:
                errors.append(f"{prefix}.oql: Required for oql steps")
        elif step.type == StepType.SEMANTIC_SEARCH:
            if not step.entity_type_key:
                errors.append(f"{prefix}.entityTypeKey: Required for semantic_search steps")
            if not step.query:
                errors.append(f"{prefix}.query: Required for semantic_search steps")

        # Validate bindings reference earlier steps
        if step.bindings:
            for param_name, expr in step.bindings.items():
                match = _BINDING_PATTERN.fullmatch(expr)
                if not match:
                    errors.append(
                        f"{prefix}.bindings.{param_name}: Invalid expression '{expr}'. "
                        "Must be {{stepName.fieldName}}"
                    )
                    continue
                ref_step = match.group(1)
                if ref_step not in seen_step_names or seen_step_names[ref_step] >= i:
                    errors.append(
                        f"{prefix}.bindings.{param_name}: References step '{ref_step}' "
                        "which does not exist before this step"
                    )

    # Cross-check parameters against $param references across all oql steps
    all_query_params: set[str] = set()
    all_binding_names: set[str] = set()
    for step in steps:
        if step.bindings:
            all_binding_names.update(step.bindings.keys())
        if step.type == StepType.OQL and step.oql:
            param_refs = set(re.findall(r'\$([a-zA-Z_]\w*)', step.oql))
            all_query_params.update(param_refs)

    # Params needed by oql steps = all $refs minus those provided by bindings
    needed_from_user = all_query_params - all_binding_names
    # Also check $param refs in semantic_search query fields
    for step in steps:
        if step.type == StepType.SEMANTIC_SEARCH and step.query:
            for ref in re.findall(r'\$([a-zA-Z_]\w*)', step.query):
                needed_from_user.add(ref)

    referenced_not_declared = needed_from_user - declared_params
    declared_not_used = declared_params - needed_from_user
    if referenced_not_declared:
        errors.append(
            f"Parameters referenced in steps but not declared: {sorted(referenced_not_declared)}"
        )
    if declared_not_used:
        errors.append(
            f"Parameters declared but not referenced in any step: {sorted(declared_not_used)}"
        )

    if errors:
        raise ValidationError(
            f"Saved query '{query_key}' validation failed",
            details={"errors": errors},
        )


async def list_saved_queries(
    ontology_key: str,
    store=Depends(get_modeling_store),
) -> list[SavedQueryResponse]:
    ont = await store.get_ontology_by_key(ontology_key)
    if not ont:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")
    rows = await store.list_saved_queries(ont["ontologyId"])
    return [_to_saved_query_response(r) for r in rows]


async def upsert_saved_query(
    ontology_key: str,
    query_key: str,
    body: SavedQueryUpsert,
    store=Depends(get_modeling_store),
    runtime_store=Depends(get_runtime_store),
) -> tuple[SavedQueryResponse, bool]:
    """Returns (response, created)."""
    if not re.match(AGENT_KEY_PATTERN, query_key):
        raise ValidationError(
            f"Invalid query key '{query_key}'. Must match pattern: {AGENT_KEY_PATTERN}"
        )

    for p in body.parameters:
        if p.data_type == DataType.DOCUMENT:
            raise ValidationError(
                f"Saved query parameter '{p.name}' has data type 'document'; "
                "parameters must be scalar types"
            )

    # Validate pipeline structure and parameter cross-checks
    param_names = [p.name for p in body.parameters]
    _validate_pipeline(body.steps, param_names, query_key)

    # Validate OQL steps against schema
    ont = await store.get_ontology_by_key(ontology_key)
    if not ont:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")

    try:
        from ontoforge_server.runtime import service as runtime_service
        loaded = await runtime_service._load_schema(ontology_key, runtime_store)
        from ontoforge_server.core.oql import parse_and_validate
        for step in body.steps:
            if step.type == StepType.OQL and step.oql:
                parse_and_validate(step.oql, loaded.scoped)
    except NotFoundError:
        pass  # Ontology has no runtime schema loaded yet
    except (ValidationError, StoreError):
        # A storage failure loading the schema is not a problem with the
        # submitted query: reporting it as one would answer 422 and discard
        # the error id the adapter logged.
        raise
    except Exception as exc:
        raise ValidationError(f"Query validation failed: {exc}")

    steps_json = _serialize_json([
        {
            "name": s.name,
            "type": s.type.value,
            **({"oql": s.oql} if s.oql else {}),
            **({"entityTypeKey": s.entity_type_key} if s.entity_type_key else {}),
            **({"query": s.query} if s.query else {}),
            **({"limit": s.limit} if s.limit is not None else {}),
            **({"minScore": s.min_score} if s.min_score is not None else {}),
            **({"bindings": s.bindings} if s.bindings else {}),
        }
        for s in body.steps
    ])
    params_json = _serialize_json([
        {"name": p.name, "description": p.description, "dataType": p.data_type.value}
        for p in body.parameters
    ])

    # Embed the description for semantic search over saved queries
    embedding = None
    provider = get_embedding_provider()
    if provider:
        embedding = await provider.embed(body.description)

    saved_query_id = str(uuid4())
    data, created = await store.upsert_saved_query(
        ont["ontologyId"],
        saved_query_id,
        query_key,
        body.name,
        body.description,
        steps_json,
        params_json,
        ontology_key=ontology_key,
        embedding=embedding,
    )
    _invalidate_runtime_schema_cache()
    return _to_saved_query_response(data), created


async def delete_saved_query(
    ontology_key: str,
    query_key: str,
    store=Depends(get_modeling_store),
) -> None:
    ont = await store.get_ontology_by_key(ontology_key)
    if not ont:
        raise NotFoundError(f"Ontology '{ontology_key}' not found")
    deleted = await store.delete_saved_query(ont["ontologyId"], query_key)
    if not deleted:
        raise NotFoundError(f"Saved query '{query_key}' not found")
    _invalidate_runtime_schema_cache()
