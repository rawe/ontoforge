from uuid import uuid4

from fastapi import Depends
from neo4j import AsyncDriver

from ontoforge_server.core.database import (
    create_vector_index,
    drop_vector_index,
    get_driver,
    rebuild_vector_index,
)
from ontoforge_server.core.embedding import get_embedding_provider
from ontoforge_server.core.exceptions import (
    CascadeRequiredError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from ontoforge_server.modeling import repository
from ontoforge_server.modeling.schemas import (
    DataType,
    EntityTypeCreate,
    EntityTypeResponse,
    EntityTypeUpdate,
    ExportEntityType,
    ExportOntology,
    ExportOntologyInclusion,
    ExportOntologyInclusions,
    ExportPayload,
    ExportProperty,
    ExportRelationType,
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
    SchemaValidationError,
    ValidationResult,
)


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


# --- Ontology ---


async def create_ontology(
    body: OntologyCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> OntologyResponse:
    async with driver.session() as session:
        existing_key = await repository.get_ontology_by_key(session, body.key)
        if existing_key:
            raise ConflictError(f"Ontology with key '{body.key}' already exists")
        existing = await repository.get_ontology_by_name(session, body.name)
        if existing:
            raise ConflictError(f"Ontology with name '{body.name}' already exists")
        ontology_id = str(uuid4())
        data = await repository.create_ontology(
            session, ontology_id, body.key, body.name, body.description
        )
    _invalidate_runtime_schema_cache()
    return _to_ontology_response(data)


async def list_ontologies(
    driver: AsyncDriver = Depends(get_driver),
) -> list[OntologyResponse]:
    async with driver.session() as session:
        rows = await repository.list_ontologies(session)
        return [_to_ontology_response(r) for r in rows]


async def get_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> OntologyResponse:
    async with driver.session() as session:
        data = await repository.get_ontology(session, ontology_id)
        if not data:
            raise NotFoundError(f"Ontology '{ontology_id}' not found")
        return _to_ontology_response(data)


async def update_ontology(
    ontology_id: str,
    body: OntologyUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> OntologyResponse:
    async with driver.session() as session:
        if body.name is not None:
            existing = await repository.get_ontology_by_name(session, body.name)
            if existing and existing["ontologyId"] != ontology_id:
                raise ConflictError(f"Ontology with name '{body.name}' already exists")
        data = await repository.update_ontology(
            session, ontology_id, body.name, body.description
        )
        if not data:
            raise NotFoundError(f"Ontology '{ontology_id}' not found")
    _invalidate_runtime_schema_cache()
    return _to_ontology_response(data)


async def delete_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        deleted = await repository.delete_ontology(session, ontology_id)
        if not deleted:
            raise NotFoundError(f"Ontology '{ontology_id}' not found")
    _invalidate_runtime_schema_cache()


# --- Entity Type (Global) ---


async def create_entity_type(
    body: EntityTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> EntityTypeResponse:
    async with driver.session() as session:
        existing = await repository.get_entity_type_by_key(session, body.key)
        if existing:
            raise ConflictError(f"Entity type with key '{body.key}' already exists")
        entity_type_id = str(uuid4())
        data = await repository.create_entity_type(
            session, entity_type_id, body.key, body.display_name, body.description
        )
    _invalidate_runtime_schema_cache()
    provider = get_embedding_provider()
    if provider:
        await create_vector_index(driver, body.key, provider.dimensions)
    return _to_entity_type_response(data)


async def list_entity_types(
    driver: AsyncDriver = Depends(get_driver),
) -> list[EntityTypeResponse]:
    async with driver.session() as session:
        rows = await repository.list_entity_types(session)
        return [_to_entity_type_response(r) for r in rows]


async def get_entity_type(
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> EntityTypeResponse:
    async with driver.session() as session:
        data = await repository.get_entity_type(session, entity_type_id)
        if not data:
            raise NotFoundError(f"Entity type '{entity_type_id}' not found")
        return _to_entity_type_response(data)


async def update_entity_type(
    entity_type_id: str,
    body: EntityTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> EntityTypeResponse:
    async with driver.session() as session:
        data = await repository.update_entity_type(
            session, entity_type_id, body.display_name, body.description
        )
        if not data:
            raise NotFoundError(f"Entity type '{entity_type_id}' not found")
    _invalidate_runtime_schema_cache()
    return _to_entity_type_response(data)


async def delete_entity_type(
    entity_type_id: str,
    cascade: bool = False,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        # Check if referenced by relation types
        referenced = await repository.is_entity_type_referenced(session, entity_type_id)
        if referenced:
            raise ConflictError(
                f"Entity type '{entity_type_id}' is referenced by one or more relation types"
            )
        # Check INCLUDES_TYPE references
        affected = await repository.find_ontologies_including_type(
            session, "EntityType", entity_type_id
        )
        if affected and not cascade:
            raise CascadeRequiredError(
                f"Entity type is included by {len(affected)} ontology(ies). Use ?cascade=true to remove.",
                affected_ontologies=affected,
            )
        if affected:
            await repository.remove_all_includes_for_type(session, "EntityType", entity_type_id)

        # Get key for vector index cleanup before deleting
        et_data = await repository.get_entity_type(session, entity_type_id)
        deleted = await repository.delete_entity_type(session, entity_type_id)
        if not deleted:
            raise NotFoundError(f"Entity type '{entity_type_id}' not found")
    _invalidate_runtime_schema_cache()
    if et_data and get_embedding_provider():
        await drop_vector_index(driver, et_data["key"])


# --- Relation Type (Global) ---


async def create_relation_type(
    body: RelationTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> RelationTypeResponse:
    async with driver.session() as session:
        existing = await repository.get_relation_type_by_key(session, body.key)
        if existing:
            raise ConflictError(f"Relation type with key '{body.key}' already exists")
        # Validate source/target entity types exist
        source = await repository.get_entity_type_by_key(session, body.source_entity_type_key)
        if not source:
            raise ValidationError(
                f"Source entity type '{body.source_entity_type_key}' not found"
            )
        target = await repository.get_entity_type_by_key(session, body.target_entity_type_key)
        if not target:
            raise ValidationError(
                f"Target entity type '{body.target_entity_type_key}' not found"
            )
        relation_type_id = str(uuid4())
        data = await repository.create_relation_type(
            session,
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
    driver: AsyncDriver = Depends(get_driver),
) -> list[RelationTypeResponse]:
    async with driver.session() as session:
        rows = await repository.list_relation_types(session)
        return [_to_relation_type_response(r) for r in rows]


async def get_relation_type(
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> RelationTypeResponse:
    async with driver.session() as session:
        data = await repository.get_relation_type(session, relation_type_id)
        if not data:
            raise NotFoundError(f"Relation type '{relation_type_id}' not found")
        return _to_relation_type_response(data)


async def update_relation_type(
    relation_type_id: str,
    body: RelationTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> RelationTypeResponse:
    async with driver.session() as session:
        data = await repository.update_relation_type(
            session, relation_type_id, body.display_name, body.description
        )
        if not data:
            raise NotFoundError(f"Relation type '{relation_type_id}' not found")
    _invalidate_runtime_schema_cache()
    return _to_relation_type_response(data)


async def delete_relation_type(
    relation_type_id: str,
    cascade: bool = False,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        # Check INCLUDES_TYPE references
        affected = await repository.find_ontologies_including_type(
            session, "RelationType", relation_type_id
        )
        if affected and not cascade:
            raise CascadeRequiredError(
                f"Relation type is included by {len(affected)} ontology(ies). Use ?cascade=true to remove.",
                affected_ontologies=affected,
            )
        if affected:
            await repository.remove_all_includes_for_type(session, "RelationType", relation_type_id)
        deleted = await repository.delete_relation_type(session, relation_type_id)
        if not deleted:
            raise NotFoundError(f"Relation type '{relation_type_id}' not found")
    _invalidate_runtime_schema_cache()


# --- Property Definition ---


async def _ensure_owner_exists(
    session, owner_id: str, owner_label: str
) -> None:
    if owner_label == "EntityType":
        data = await repository.get_entity_type(session, owner_id)
        if not data:
            raise NotFoundError(f"Entity type '{owner_id}' not found")
    else:
        data = await repository.get_relation_type(session, owner_id)
        if not data:
            raise NotFoundError(f"Relation type '{owner_id}' not found")


async def _rebuild_entity_type_vector_index(
    driver: AsyncDriver, entity_type_id: str
) -> None:
    """Rebuild the vector index for an entity type after property changes."""
    provider = get_embedding_provider()
    if not provider:
        return
    async with driver.session() as session:
        result = await session.run(
            "MATCH (et:EntityType {entityTypeId: $id}) RETURN et.key AS key",
            id=entity_type_id,
        )
        record = await result.single()
    if record:
        await rebuild_vector_index(driver, record["key"], provider.dimensions)


async def create_property(
    owner_id: str,
    owner_label: str,
    body: PropertyDefinitionCreate,
    cascade: bool = False,
    driver: AsyncDriver = Depends(get_driver),
) -> PropertyDefinitionResponse:
    async with driver.session() as session:
        await _ensure_owner_exists(session, owner_id, owner_label)
        existing = await repository.get_property_by_key(
            session, owner_id, owner_label, body.key
        )
        if existing:
            raise ConflictError(
                f"Property with key '{body.key}' already exists on this type"
            )
        # Cascade check: if adding required property without default
        if body.required and body.default_value is None:
            affected = await repository.find_ontologies_with_explicit_property(
                session, owner_label, owner_id, body.key
            )
            if affected and not cascade:
                raise CascadeRequiredError(
                    f"Adding required property '{body.key}' without default would break {len(affected)} ontology(ies). "
                    f"Use ?cascade=true to auto-add to explicit property lists.",
                    affected_ontologies=affected,
                )
            if affected:
                await repository.add_property_to_includes_lists(
                    session, owner_label, owner_id, body.key
                )
        property_id = str(uuid4())
        data = await repository.create_property(
            session,
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
        await _rebuild_entity_type_vector_index(driver, owner_id)
    return _to_property_response(data)


async def list_properties(
    owner_id: str,
    owner_label: str,
    driver: AsyncDriver = Depends(get_driver),
) -> list[PropertyDefinitionResponse]:
    async with driver.session() as session:
        await _ensure_owner_exists(session, owner_id, owner_label)
        rows = await repository.list_properties(session, owner_id, owner_label)
        return [_to_property_response(r) for r in rows]


async def update_property(
    owner_id: str,
    owner_label: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> PropertyDefinitionResponse:
    async with driver.session() as session:
        await _ensure_owner_exists(session, owner_id, owner_label)
        # Determine if defaultValue was explicitly set to None (clear) vs not provided
        raw = body.model_dump(exclude_unset=True)
        clear_default = "default_value" in raw and raw["default_value"] is None
        data = await repository.update_property(
            session,
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
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        await _ensure_owner_exists(session, owner_id, owner_label)
        # Get property key for cascade check
        prop = await repository.get_property(session, owner_id, owner_label, property_id)
        if not prop:
            raise NotFoundError(f"Property '{property_id}' not found on this type")
        # Check if any scoped ontologies reference this property
        affected = await repository.find_ontologies_including_type(
            session, owner_label, owner_id
        )
        # Filter: only ontologies with explicit property lists that include this key
        # (properties: null ontologies are not affected)
        if affected:
            # We need to check which ontologies actually have this property in their explicit lists
            # The simplest approach: use the repository function for this
            pass
        if affected and not cascade:
            # For cascade on delete: remove from property lists
            # Only matters if ontologies reference this specific property in explicit lists
            pass
        if cascade:
            await repository.remove_property_from_includes_lists(
                session, owner_label, owner_id, prop["key"]
            )
        deleted = await repository.delete_property(
            session, owner_id, owner_label, property_id
        )
        if not deleted:
            raise NotFoundError(
                f"Property '{property_id}' not found on this type"
            )
    _invalidate_runtime_schema_cache()
    if owner_label == "EntityType":
        await _rebuild_entity_type_vector_index(driver, owner_id)


# --- Scope Management ---


async def _resolve_ontology(session, ontology_id: str) -> dict:
    data = await repository.get_ontology(session, ontology_id)
    if not data:
        raise NotFoundError(f"Ontology '{ontology_id}' not found")
    return data


async def add_includes_entity_type(
    ontology_id: str,
    body: IncludeTypeRequest,
    driver: AsyncDriver = Depends(get_driver),
) -> IncludeTypeResponse:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        # Validate entity type exists
        et = await repository.get_entity_type_by_key(session, body.key)
        if not et:
            raise NotFoundError(f"Entity type '{body.key}' not found")
        # Validate property keys if explicit list
        if body.properties is not None:
            et_props = await repository.list_properties(session, et["entityTypeId"], "EntityType")
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
        data = await repository.add_includes_type(
            session, ontology_id, "EntityType", body.key, body.properties
        )
        if not data:
            raise NotFoundError(f"Failed to add inclusion for entity type '{body.key}'")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def list_includes_entity_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> list[IncludeTypeResponse]:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        rows = await repository.list_includes_types(session, ontology_id, "EntityType")
        return [IncludeTypeResponse(key=r["key"], properties=r["properties"]) for r in rows]


async def update_includes_entity_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> IncludeTypeResponse:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        # Validate entity type exists
        et = await repository.get_entity_type(session, type_id)
        if not et:
            raise NotFoundError(f"Entity type '{type_id}' not found")
        # Validate property keys if explicit list
        if body.properties is not None:
            et_props = await repository.list_properties(session, type_id, "EntityType")
            valid_keys = {p["key"] for p in et_props}
            for pk in body.properties:
                if pk not in valid_keys:
                    raise ValidationError(f"Property '{pk}' not found on entity type '{et['key']}'")
            for p in et_props:
                if p["required"] and p.get("defaultValue") is None and p["key"] not in body.properties:
                    raise ValidationError(
                        f"Required property '{p['key']}' without default must be included"
                    )
        data = await repository.update_includes_type(
            session, ontology_id, "EntityType", type_id, body.properties
        )
        if not data:
            raise NotFoundError(f"Entity type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def remove_includes_entity_type(
    ontology_id: str,
    type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        deleted = await repository.remove_includes_type(
            session, ontology_id, "EntityType", type_id
        )
        if not deleted:
            raise NotFoundError(f"Entity type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()


async def add_includes_relation_type(
    ontology_id: str,
    body: IncludeTypeRequest,
    driver: AsyncDriver = Depends(get_driver),
) -> IncludeTypeResponse:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        rt = await repository.get_relation_type_by_key(session, body.key)
        if not rt:
            raise NotFoundError(f"Relation type '{body.key}' not found")
        # Validate source/target entity types are included (or ontology has no entity scoping)
        entity_inclusions = await repository.list_includes_types(session, ontology_id, "EntityType")
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
            rt_props = await repository.list_properties(session, rt["relationTypeId"], "RelationType")
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
        data = await repository.add_includes_type(
            session, ontology_id, "RelationType", body.key, body.properties
        )
        if not data:
            raise NotFoundError(f"Failed to add inclusion for relation type '{body.key}'")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def list_includes_relation_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> list[IncludeTypeResponse]:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        rows = await repository.list_includes_types(session, ontology_id, "RelationType")
        return [IncludeTypeResponse(key=r["key"], properties=r["properties"]) for r in rows]


async def update_includes_relation_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> IncludeTypeResponse:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        rt = await repository.get_relation_type(session, type_id)
        if not rt:
            raise NotFoundError(f"Relation type '{type_id}' not found")
        if body.properties is not None:
            rt_props = await repository.list_properties(session, type_id, "RelationType")
            valid_keys = {p["key"] for p in rt_props}
            for pk in body.properties:
                if pk not in valid_keys:
                    raise ValidationError(f"Property '{pk}' not found on relation type '{rt['key']}'")
            for p in rt_props:
                if p["required"] and p.get("defaultValue") is None and p["key"] not in body.properties:
                    raise ValidationError(
                        f"Required property '{p['key']}' without default must be included"
                    )
        data = await repository.update_includes_type(
            session, ontology_id, "RelationType", type_id, body.properties
        )
        if not data:
            raise NotFoundError(f"Relation type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()
    return IncludeTypeResponse(key=data["key"], properties=data["properties"])


async def remove_includes_relation_type(
    ontology_id: str,
    type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        await _resolve_ontology(session, ontology_id)
        deleted = await repository.remove_includes_type(
            session, ontology_id, "RelationType", type_id
        )
        if not deleted:
            raise NotFoundError(f"Relation type '{type_id}' is not included in this ontology")
    _invalidate_runtime_schema_cache()


# --- Schema Validation ---


async def validate_schema(
    driver: AsyncDriver = Depends(get_driver),
) -> ValidationResult:
    """Validate the global schema."""
    async with driver.session() as session:
        schema = await repository.get_full_schema(session)

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
    driver: AsyncDriver = Depends(get_driver),
) -> ValidationResult:
    """Validate a single ontology's INCLUDES_TYPE configuration."""
    async with driver.session() as session:
        ont = await repository.get_ontology(session, ontology_id)
        if not ont:
            raise NotFoundError(f"Ontology '{ontology_id}' not found")

        schema = await repository.get_full_schema(session)

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
    driver: AsyncDriver = Depends(get_driver),
) -> ValidationResult:
    """Validate schema + all scoped ontologies."""
    schema_result = await validate_schema(driver=driver)
    errors = list(schema_result.errors)

    async with driver.session() as session:
        ontologies = await repository.list_ontologies(session)
    for ont in ontologies:
        ont_result = await validate_ontology(ont["ontologyId"], driver=driver)
        errors.extend(ont_result.errors)

    return ValidationResult(valid=len(errors) == 0, errors=errors)


# --- Export / Import ---


async def export_schema(
    driver: AsyncDriver = Depends(get_driver),
) -> ExportPayload:
    async with driver.session() as session:
        schema = await repository.get_full_schema(session)

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
        ontologies.append(
            ExportOntology(
                key=ont["key"],
                name=ont["name"],
                description=ont.get("description"),
                includes=includes,
            )
        )

    return ExportPayload(
        formatVersion="2.0",
        entityTypes=entity_types,
        relationTypes=relation_types,
        ontologies=ontologies,
    )


async def import_schema(
    payload: ExportPayload,
    driver: AsyncDriver = Depends(get_driver),
) -> dict:
    """Import a v2.0 schema: create types globally, then ontologies with INCLUDES_TYPE edges."""
    async with driver.session() as session:
        # Create entity types and track key->id mapping
        et_key_to_id: dict[str, str] = {}
        for et in payload.entity_types:
            existing = await repository.get_entity_type_by_key(session, et.key)
            if existing:
                raise ConflictError(f"Entity type with key '{et.key}' already exists")
            et_id = str(uuid4())
            await repository.create_entity_type(
                session, et_id, et.key, et.display_name, et.description
            )
            et_key_to_id[et.key] = et_id
            for prop in et.properties:
                prop_id = str(uuid4())
                await repository.create_property(
                    session, et_id, "EntityType", prop_id,
                    prop.key, prop.display_name, prop.description,
                    prop.data_type, prop.required, prop.default_value,
                )

        # Create relation types
        for rt in payload.relation_types:
            existing = await repository.get_relation_type_by_key(session, rt.key)
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
            await repository.create_relation_type(
                session, rt_id, rt.key, rt.display_name, rt.description,
                rt.from_entity_type_key, rt.to_entity_type_key,
            )
            for prop in rt.properties:
                prop_id = str(uuid4())
                await repository.create_property(
                    session, rt_id, "RelationType", prop_id,
                    prop.key, prop.display_name, prop.description,
                    prop.data_type, prop.required, prop.default_value,
                )

        # Create ontologies with INCLUDES_TYPE edges
        created_ontologies = []
        for ont in payload.ontologies:
            existing = await repository.get_ontology_by_key(session, ont.key)
            if existing:
                raise ConflictError(f"Ontology with key '{ont.key}' already exists")
            ont_id = str(uuid4())
            ont_data = await repository.create_ontology(
                session, ont_id, ont.key, ont.name, ont.description
            )
            if ont.includes:
                for inc in ont.includes.entity_types:
                    await repository.add_includes_type(
                        session, ont_id, "EntityType", inc.key, inc.properties
                    )
                for inc in ont.includes.relation_types:
                    await repository.add_includes_type(
                        session, ont_id, "RelationType", inc.key, inc.properties
                    )
            created_ontologies.append(_to_ontology_response(ont_data))

    _invalidate_runtime_schema_cache()
    return {"ontologies": [o.model_dump(by_alias=True) for o in created_ontologies]}
