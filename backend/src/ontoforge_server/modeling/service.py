from uuid import uuid4

from fastapi import Depends
from neo4j import AsyncDriver

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.exceptions import ConflictError, NotFoundError, ValidationError
from ontoforge_server.modeling import repository
from ontoforge_server.modeling.schemas import (
    DataType,
    EntityTypeCreate,
    EntityTypeResponse,
    EntityTypeUpdate,
    ExportEntityType,
    ExportOntology,
    ExportPayload,
    ExportProperty,
    ExportRelationType,
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


# --- Ontology ---


async def create_ontology(
    body: OntologyCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> OntologyResponse:
    async with driver.session() as session:
        existing = await repository.get_ontology_by_name(session, body.name)
        if existing:
            raise ConflictError(f"Ontology with name '{body.name}' already exists")
        ontology_id = str(uuid4())
        data = await repository.create_ontology(
            session, ontology_id, body.name, body.description
        )
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
        return _to_ontology_response(data)


async def delete_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        deleted = await repository.delete_ontology(session, ontology_id)
        if not deleted:
            raise NotFoundError(f"Ontology '{ontology_id}' not found")


# --- Entity Type ---


async def _ensure_ontology_exists(session, ontology_id: str) -> None:
    data = await repository.get_ontology(session, ontology_id)
    if not data:
        raise NotFoundError(f"Ontology '{ontology_id}' not found")


async def create_entity_type(
    ontology_id: str,
    body: EntityTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> EntityTypeResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        existing = await repository.get_entity_type_by_key(
            session, ontology_id, body.key
        )
        if existing:
            raise ConflictError(
                f"Entity type with key '{body.key}' already exists in ontology '{ontology_id}'"
            )
        entity_type_id = str(uuid4())
        data = await repository.create_entity_type(
            session,
            ontology_id,
            entity_type_id,
            body.key,
            body.display_name,
            body.description,
        )
        return _to_entity_type_response(data)


async def list_entity_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> list[EntityTypeResponse]:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        rows = await repository.list_entity_types(session, ontology_id)
        return [_to_entity_type_response(r) for r in rows]


async def get_entity_type(
    ontology_id: str,
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> EntityTypeResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        data = await repository.get_entity_type(session, ontology_id, entity_type_id)
        if not data:
            raise NotFoundError(
                f"Entity type '{entity_type_id}' not found in ontology '{ontology_id}'"
            )
        return _to_entity_type_response(data)


async def update_entity_type(
    ontology_id: str,
    entity_type_id: str,
    body: EntityTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> EntityTypeResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        data = await repository.update_entity_type(
            session, ontology_id, entity_type_id, body.display_name, body.description
        )
        if not data:
            raise NotFoundError(
                f"Entity type '{entity_type_id}' not found in ontology '{ontology_id}'"
            )
        return _to_entity_type_response(data)


async def delete_entity_type(
    ontology_id: str,
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        # Check if referenced by relation types
        referenced = await repository.is_entity_type_referenced(
            session, entity_type_id
        )
        if referenced:
            raise ConflictError(
                f"Entity type '{entity_type_id}' is referenced by one or more relation types"
            )
        deleted = await repository.delete_entity_type(
            session, ontology_id, entity_type_id
        )
        if not deleted:
            raise NotFoundError(
                f"Entity type '{entity_type_id}' not found in ontology '{ontology_id}'"
            )


# --- Relation Type ---


async def create_relation_type(
    ontology_id: str,
    body: RelationTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> RelationTypeResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        # Check key uniqueness
        existing = await repository.get_relation_type_by_key(
            session, ontology_id, body.key
        )
        if existing:
            raise ConflictError(
                f"Relation type with key '{body.key}' already exists in ontology '{ontology_id}'"
            )
        # Validate source/target entity types exist in this ontology
        source = await repository.get_entity_type(
            session, ontology_id, body.source_entity_type_id
        )
        if not source:
            raise ValidationError(
                f"Source entity type '{body.source_entity_type_id}' not found in ontology '{ontology_id}'"
            )
        target = await repository.get_entity_type(
            session, ontology_id, body.target_entity_type_id
        )
        if not target:
            raise ValidationError(
                f"Target entity type '{body.target_entity_type_id}' not found in ontology '{ontology_id}'"
            )
        relation_type_id = str(uuid4())
        data = await repository.create_relation_type(
            session,
            ontology_id,
            relation_type_id,
            body.key,
            body.display_name,
            body.description,
            body.source_entity_type_id,
            body.target_entity_type_id,
        )
        return _to_relation_type_response(data)


async def list_relation_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> list[RelationTypeResponse]:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        rows = await repository.list_relation_types(session, ontology_id)
        return [_to_relation_type_response(r) for r in rows]


async def get_relation_type(
    ontology_id: str,
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> RelationTypeResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        data = await repository.get_relation_type(
            session, ontology_id, relation_type_id
        )
        if not data:
            raise NotFoundError(
                f"Relation type '{relation_type_id}' not found in ontology '{ontology_id}'"
            )
        return _to_relation_type_response(data)


async def update_relation_type(
    ontology_id: str,
    relation_type_id: str,
    body: RelationTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> RelationTypeResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        data = await repository.update_relation_type(
            session, ontology_id, relation_type_id, body.display_name, body.description
        )
        if not data:
            raise NotFoundError(
                f"Relation type '{relation_type_id}' not found in ontology '{ontology_id}'"
            )
        return _to_relation_type_response(data)


async def delete_relation_type(
    ontology_id: str,
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        deleted = await repository.delete_relation_type(
            session, ontology_id, relation_type_id
        )
        if not deleted:
            raise NotFoundError(
                f"Relation type '{relation_type_id}' not found in ontology '{ontology_id}'"
            )


# --- Property Definition ---


async def _ensure_owner_exists(
    session, ontology_id: str, owner_id: str, owner_label: str
) -> None:
    if owner_label == "EntityType":
        data = await repository.get_entity_type(session, ontology_id, owner_id)
        if not data:
            raise NotFoundError(
                f"Entity type '{owner_id}' not found in ontology '{ontology_id}'"
            )
    else:
        data = await repository.get_relation_type(session, ontology_id, owner_id)
        if not data:
            raise NotFoundError(
                f"Relation type '{owner_id}' not found in ontology '{ontology_id}'"
            )


async def create_property(
    ontology_id: str,
    owner_id: str,
    owner_label: str,
    body: PropertyDefinitionCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> PropertyDefinitionResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        await _ensure_owner_exists(session, ontology_id, owner_id, owner_label)
        existing = await repository.get_property_by_key(
            session, owner_id, owner_label, body.key
        )
        if existing:
            raise ConflictError(
                f"Property with key '{body.key}' already exists on this type"
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
        return _to_property_response(data)


async def list_properties(
    ontology_id: str,
    owner_id: str,
    owner_label: str,
    driver: AsyncDriver = Depends(get_driver),
) -> list[PropertyDefinitionResponse]:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        await _ensure_owner_exists(session, ontology_id, owner_id, owner_label)
        rows = await repository.list_properties(session, owner_id, owner_label)
        return [_to_property_response(r) for r in rows]


async def update_property(
    ontology_id: str,
    owner_id: str,
    owner_label: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    driver: AsyncDriver = Depends(get_driver),
) -> PropertyDefinitionResponse:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        await _ensure_owner_exists(session, ontology_id, owner_id, owner_label)
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
        return _to_property_response(data)


async def delete_property(
    ontology_id: str,
    owner_id: str,
    owner_label: str,
    property_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        await _ensure_ontology_exists(session, ontology_id)
        await _ensure_owner_exists(session, ontology_id, owner_id, owner_label)
        deleted = await repository.delete_property(
            session, owner_id, owner_label, property_id
        )
        if not deleted:
            raise NotFoundError(
                f"Property '{property_id}' not found on this type"
            )


# --- Schema Validation ---


async def validate_schema(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> ValidationResult:
    async with driver.session() as session:
        schema = await repository.get_full_schema(session, ontology_id)
        if not schema:
            raise NotFoundError(f"Ontology '{ontology_id}' not found")

        errors: list[SchemaValidationError] = []
        entity_type_ids = {
            et["entityTypeId"] for et in schema["entityTypes"]
        }
        valid_data_types = {dt.value for dt in DataType}

        # Check entity type key uniqueness
        et_keys: set[str] = set()
        for et in schema["entityTypes"]:
            if et["key"] in et_keys:
                errors.append(
                    SchemaValidationError(
                        path=f"entityTypes.{et['key']}",
                        message=f"Duplicate entity type key '{et['key']}'",
                    )
                )
            et_keys.add(et["key"])
            # Check property keys and data types
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
            # Check source/target references
            if rt["sourceEntityTypeId"] not in entity_type_ids:
                errors.append(
                    SchemaValidationError(
                        path=f"relationTypes.{rt['key']}",
                        message=f"Source entity type '{rt['sourceEntityTypeId']}' does not exist",
                    )
                )
            if rt["targetEntityTypeId"] not in entity_type_ids:
                errors.append(
                    SchemaValidationError(
                        path=f"relationTypes.{rt['key']}",
                        message=f"Target entity type '{rt['targetEntityTypeId']}' does not exist",
                    )
                )
            # Check property keys and data types
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


# --- Export / Import ---


async def export_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> ExportPayload:
    async with driver.session() as session:
        schema = await repository.get_full_schema(session, ontology_id)
        if not schema:
            raise NotFoundError(f"Ontology '{ontology_id}' not found")

        ont = schema["ontology"]
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

        return ExportPayload(
            formatVersion="1.0",
            ontology=ExportOntology(
                ontologyId=ont["ontologyId"],
                name=ont["name"],
                description=ont.get("description"),
            ),
            entityTypes=entity_types,
            relationTypes=relation_types,
        )


async def import_ontology(
    payload: ExportPayload,
    overwrite: bool = False,
    driver: AsyncDriver = Depends(get_driver),
) -> OntologyResponse:
    async with driver.session() as session:
        ont = payload.ontology
        existing = await repository.get_ontology(session, ont.ontology_id)
        if existing and not overwrite:
            raise ConflictError(
                f"Ontology '{ont.ontology_id}' already exists. Use overwrite=true to replace."
            )
        if existing:
            await repository.delete_ontology(session, ont.ontology_id)

        # Check for name conflict with a different ontology
        by_name = await repository.get_ontology_by_name(session, ont.name)
        if by_name and by_name["ontologyId"] != ont.ontology_id:
            raise ConflictError(
                f"Ontology with name '{ont.name}' already exists"
            )

        # Create ontology
        ont_data = await repository.create_ontology(
            session, ont.ontology_id, ont.name, ont.description
        )

        # Create entity types and track key->id mapping
        et_key_to_id: dict[str, str] = {}
        for et in payload.entity_types:
            et_id = str(uuid4())
            await repository.create_entity_type(
                session,
                ont.ontology_id,
                et_id,
                et.key,
                et.display_name,
                et.description,
            )
            et_key_to_id[et.key] = et_id
            for prop in et.properties:
                prop_id = str(uuid4())
                await repository.create_property(
                    session,
                    et_id,
                    "EntityType",
                    prop_id,
                    prop.key,
                    prop.display_name,
                    prop.description,
                    prop.data_type,
                    prop.required,
                    prop.default_value,
                )

        # Create relation types
        for rt in payload.relation_types:
            source_id = et_key_to_id.get(rt.from_entity_type_key)
            target_id = et_key_to_id.get(rt.to_entity_type_key)
            if not source_id:
                raise ValidationError(
                    f"Import error: source entity type key '{rt.from_entity_type_key}' not found"
                )
            if not target_id:
                raise ValidationError(
                    f"Import error: target entity type key '{rt.to_entity_type_key}' not found"
                )
            rt_id = str(uuid4())
            await repository.create_relation_type(
                session,
                ont.ontology_id,
                rt_id,
                rt.key,
                rt.display_name,
                rt.description,
                source_id,
                target_id,
            )
            for prop in rt.properties:
                prop_id = str(uuid4())
                await repository.create_property(
                    session,
                    rt_id,
                    "RelationType",
                    prop_id,
                    prop.key,
                    prop.display_name,
                    prop.description,
                    prop.data_type,
                    prop.required,
                    prop.default_value,
                )

        return _to_ontology_response(ont_data)
