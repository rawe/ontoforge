from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from neo4j import AsyncDriver
from neo4j.time import Date as Neo4jDate
from neo4j.time import DateTime as Neo4jDateTime

from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.core.schemas import (
    ExportEntityType,
    ExportOntology,
    ExportProperty,
    ExportRelationType,
)
from ontoforge_server.runtime import repository
from ontoforge_server.runtime.schemas import (
    DataWipeResponse,
    NeighborhoodResponse,
    PaginatedResponse,
    RelationInstanceCreate,
    SchemaResponse,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schema Cache (in-memory dataclass structure)
# ---------------------------------------------------------------------------


@dataclass
class PropertyDef:
    key: str
    display_name: str
    description: str | None
    data_type: str  # from DataType enum value
    required: bool
    default_value: str | None


@dataclass
class EntityTypeDef:
    key: str
    display_name: str
    description: str | None
    properties: dict[str, PropertyDef] = field(default_factory=dict)


@dataclass
class RelationTypeDef:
    key: str
    display_name: str
    description: str | None
    from_entity_type_key: str
    to_entity_type_key: str
    properties: dict[str, PropertyDef] = field(default_factory=dict)


@dataclass
class SchemaCache:
    ontology_id: str
    ontology_key: str
    ontology_name: str
    ontology_description: str | None
    entity_types: dict[str, EntityTypeDef] = field(default_factory=dict)
    relation_types: dict[str, RelationTypeDef] = field(default_factory=dict)


async def _load_schema(ontology_key: str, driver: AsyncDriver) -> SchemaCache:
    """Load the schema for the given ontology key from the database."""
    async with driver.session() as session:
        schema = await repository.get_full_schema(session, ontology_key)

    if schema is None:
        raise NotFoundError(f"Ontology '{ontology_key}' not found or has no schema loaded")

    ont = schema["ontology"]
    entity_types_raw = schema["entityTypes"]
    relation_types_raw = schema["relationTypes"]

    export_entity_types = [
        ExportEntityType(
            key=et["key"],
            displayName=et["displayName"],
            description=et.get("description"),
            properties=[
                ExportProperty(
                    key=p["key"],
                    displayName=p["displayName"],
                    description=p.get("description"),
                    dataType=p["dataType"],
                    required=p["required"],
                    defaultValue=p.get("defaultValue"),
                )
                for p in et.get("properties", [])
            ],
        )
        for et in entity_types_raw
    ]

    export_relation_types = [
        ExportRelationType(
            key=rt["key"],
            displayName=rt["displayName"],
            description=rt.get("description"),
            fromEntityTypeKey=rt["sourceKey"],
            toEntityTypeKey=rt["targetKey"],
            properties=[
                ExportProperty(
                    key=p["key"],
                    displayName=p["displayName"],
                    description=p.get("description"),
                    dataType=p["dataType"],
                    required=p["required"],
                    defaultValue=p.get("defaultValue"),
                )
                for p in rt.get("properties", [])
            ],
        )
        for rt in relation_types_raw
    ]

    ontology_export = ExportOntology(
        ontologyId=ont["ontologyId"],
        key=ont["key"],
        name=ont["name"],
        description=ont.get("description"),
    )

    return _build_schema_cache(ontology_export, export_entity_types, export_relation_types)


# ---------------------------------------------------------------------------
# Naming Conventions
# ---------------------------------------------------------------------------


def to_pascal_case(key: str) -> str:
    """Convert a snake_case key to PascalCase. E.g. 'research_paper' -> 'ResearchPaper'."""
    return "".join(segment.capitalize() for segment in key.split("_"))


def to_upper_snake_case(key: str) -> str:
    """Convert a key to UPPER_SNAKE_CASE. E.g. 'works_for' -> 'WORKS_FOR'."""
    return key.upper()


# ---------------------------------------------------------------------------
# Type Coercion
# ---------------------------------------------------------------------------


def coerce_value(value: Any, data_type: str, key: str) -> Any:
    """Coerce a JSON value to the appropriate Python/Neo4j type.

    Raises ValueError with a descriptive message on failure.
    """
    if value is None:
        return None

    if data_type == "string":
        return str(value)

    elif data_type == "integer":
        if isinstance(value, bool):
            raise ValueError(f"Expected integer for '{key}', got boolean")
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            try:
                return int(value)
            except (ValueError, OverflowError):
                raise ValueError(f"Expected integer for '{key}', got '{value}'")
        raise ValueError(f"Expected integer for '{key}', got {type(value).__name__}")

    elif data_type == "float":
        if isinstance(value, bool):
            raise ValueError(f"Expected float for '{key}', got boolean")
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                raise ValueError(f"Expected float for '{key}', got '{value}'")
        raise ValueError(f"Expected float for '{key}', got {type(value).__name__}")

    elif data_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            if value.lower() == "true":
                return True
            if value.lower() == "false":
                return False
            raise ValueError(f"Expected boolean for '{key}', got '{value}'")
        raise ValueError(f"Expected boolean for '{key}', got {type(value).__name__}")

    elif data_type == "date":
        if isinstance(value, str):
            try:
                parsed = date.fromisoformat(value)
                return Neo4jDate(parsed.year, parsed.month, parsed.day)
            except ValueError:
                raise ValueError(f"Expected ISO date for '{key}', got '{value}'")
        raise ValueError(f"Expected ISO date string for '{key}', got {type(value).__name__}")

    elif data_type == "datetime":
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value)
                return Neo4jDateTime(
                    parsed.year, parsed.month, parsed.day,
                    parsed.hour, parsed.minute, parsed.second,
                    parsed.microsecond * 1000,  # nanoseconds
                    tzinfo=parsed.tzinfo,
                )
            except ValueError:
                raise ValueError(f"Expected ISO datetime for '{key}', got '{value}'")
        raise ValueError(f"Expected ISO datetime string for '{key}', got {type(value).__name__}")

    else:
        raise ValueError(f"Unknown data type '{data_type}' for '{key}'")


# ---------------------------------------------------------------------------
# Property Validation
# ---------------------------------------------------------------------------


def validate_properties(
    properties: dict[str, Any],
    property_defs: dict[str, PropertyDef],
    type_key: str,
    partial: bool = False,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Validate and coerce properties against schema definitions.

    Returns (coerced_properties, errors).
    errors is a dict of {property_key: error_message}.
    If partial=True, missing required properties are not flagged.
    """
    coerced: dict[str, Any] = {}
    errors: dict[str, str] = {}

    # Check for unknown properties
    for key in properties:
        if key not in property_defs:
            errors[key] = f"Unknown property: not defined in type '{type_key}'"

    # Check required properties and coerce values
    for prop_key, prop_def in property_defs.items():
        if prop_key in properties:
            value = properties[prop_key]
            if value is None:
                # Null means "remove this property" in PATCH
                if partial:
                    if prop_def.required:
                        errors[prop_key] = "Cannot set required property to null"
                    else:
                        coerced[prop_key] = None
                else:
                    # On create, null means "not provided"
                    if prop_def.required and prop_def.default_value is None:
                        errors[prop_key] = "Required property missing"
                    elif prop_def.default_value is not None:
                        try:
                            coerced[prop_key] = coerce_value(
                                prop_def.default_value, prop_def.data_type, prop_key
                            )
                        except ValueError as e:
                            errors[prop_key] = str(e)
                    # else: optional, null -> not stored
            else:
                try:
                    coerced[prop_key] = coerce_value(value, prop_def.data_type, prop_key)
                except ValueError as e:
                    errors[prop_key] = str(e)
        elif not partial:
            # Property not provided on create
            if prop_def.required:
                if prop_def.default_value is not None:
                    try:
                        coerced[prop_key] = coerce_value(
                            prop_def.default_value, prop_def.data_type, prop_key
                        )
                    except ValueError as e:
                        errors[prop_key] = str(e)
                else:
                    errors[prop_key] = "Required property missing"

    return coerced, errors


# ---------------------------------------------------------------------------
# Cache Building Helpers
# ---------------------------------------------------------------------------


def _build_property_defs(props: list[ExportProperty]) -> dict[str, PropertyDef]:
    """Convert a list of ExportProperty to a dict of PropertyDef."""
    result: dict[str, PropertyDef] = {}
    for p in props:
        result[p.key] = PropertyDef(
            key=p.key,
            display_name=p.display_name,
            description=p.description,
            data_type=p.data_type,
            required=p.required,
            default_value=p.default_value,
        )
    return result


def _build_schema_cache(payload_ontology: ExportOntology, entity_types: list[ExportEntityType], relation_types: list[ExportRelationType]) -> SchemaCache:
    """Build a SchemaCache from ontology metadata and type lists."""
    cache = SchemaCache(
        ontology_id=payload_ontology.ontology_id,
        ontology_key=payload_ontology.key,
        ontology_name=payload_ontology.name,
        ontology_description=payload_ontology.description,
    )
    for et in entity_types:
        cache.entity_types[et.key] = EntityTypeDef(
            key=et.key,
            display_name=et.display_name,
            description=et.description,
            properties=_build_property_defs(et.properties),
        )
    for rt in relation_types:
        cache.relation_types[rt.key] = RelationTypeDef(
            key=rt.key,
            display_name=rt.display_name,
            description=rt.description,
            from_entity_type_key=rt.from_entity_type_key,
            to_entity_type_key=rt.to_entity_type_key,
            properties=_build_property_defs(rt.properties),
        )
    return cache


def _entity_type_def_to_export(et_def: EntityTypeDef) -> ExportEntityType:
    """Convert an EntityTypeDef to an ExportEntityType."""
    props = [
        ExportProperty(
            key=p.key,
            displayName=p.display_name,
            description=p.description,
            dataType=p.data_type,
            required=p.required,
            defaultValue=p.default_value,
        )
        for p in et_def.properties.values()
    ]
    return ExportEntityType(
        key=et_def.key,
        displayName=et_def.display_name,
        description=et_def.description,
        properties=props,
    )


def _relation_type_def_to_export(rt_def: RelationTypeDef) -> ExportRelationType:
    """Convert a RelationTypeDef to an ExportRelationType."""
    props = [
        ExportProperty(
            key=p.key,
            displayName=p.display_name,
            description=p.description,
            dataType=p.data_type,
            required=p.required,
            defaultValue=p.default_value,
        )
        for p in rt_def.properties.values()
    ]
    return ExportRelationType(
        key=rt_def.key,
        displayName=rt_def.display_name,
        description=rt_def.description,
        fromEntityTypeKey=rt_def.from_entity_type_key,
        toEntityTypeKey=rt_def.to_entity_type_key,
        properties=props,
    )


# ---------------------------------------------------------------------------
# Service Functions — Data Wipe
# ---------------------------------------------------------------------------


async def wipe_instance_data(
    ontology_key: str, driver: AsyncDriver,
) -> DataWipeResponse:
    """Delete all instance data for the given ontology."""
    cache = await _load_schema(ontology_key, driver)
    entity_type_keys = list(cache.entity_types.keys())

    async with driver.session() as session:
        entities_deleted, relations_deleted = await repository.wipe_instance_data(
            session, entity_type_keys,
        )

    return DataWipeResponse(
        ontologyKey=ontology_key,
        entitiesDeleted=entities_deleted,
        relationsDeleted=relations_deleted,
    )


# ---------------------------------------------------------------------------
# Service Functions — Schema Introspection (from cache)
# ---------------------------------------------------------------------------


async def get_full_schema(ontology_key: str, driver: AsyncDriver) -> SchemaResponse:
    """Return the full schema for the given ontology."""
    cache = await _load_schema(ontology_key, driver)
    ontology = ExportOntology(
        ontologyId=cache.ontology_id,
        key=cache.ontology_key,
        name=cache.ontology_name,
        description=cache.ontology_description,
    )
    entity_types = [
        _entity_type_def_to_export(et_def)
        for et_def in cache.entity_types.values()
    ]
    relation_types = [
        _relation_type_def_to_export(rt_def)
        for rt_def in cache.relation_types.values()
    ]
    return SchemaResponse(
        ontology=ontology,
        entityTypes=entity_types,
        relationTypes=relation_types,
    )


async def list_entity_types(ontology_key: str, driver: AsyncDriver) -> list[ExportEntityType]:
    """Return all entity types for the given ontology."""
    cache = await _load_schema(ontology_key, driver)
    return [
        _entity_type_def_to_export(et_def)
        for et_def in cache.entity_types.values()
    ]


async def get_entity_type(ontology_key: str, key: str, driver: AsyncDriver) -> ExportEntityType:
    """Return a single entity type by key."""
    cache = await _load_schema(ontology_key, driver)
    et_def = cache.entity_types.get(key)
    if not et_def:
        raise NotFoundError(f"Entity type '{key}' not found")
    return _entity_type_def_to_export(et_def)


async def list_relation_types(ontology_key: str, driver: AsyncDriver) -> list[ExportRelationType]:
    """Return all relation types for the given ontology."""
    cache = await _load_schema(ontology_key, driver)
    return [
        _relation_type_def_to_export(rt_def)
        for rt_def in cache.relation_types.values()
    ]


async def get_relation_type(ontology_key: str, key: str, driver: AsyncDriver) -> ExportRelationType:
    """Return a single relation type by key."""
    cache = await _load_schema(ontology_key, driver)
    rt_def = cache.relation_types.get(key)
    if not rt_def:
        raise NotFoundError(f"Relation type '{key}' not found")
    return _relation_type_def_to_export(rt_def)


# ---------------------------------------------------------------------------
# Filter / Sort Helpers (for list endpoints)
# ---------------------------------------------------------------------------


def _parse_filters(query_params: dict[str, str]) -> dict[str, str]:
    """Extract filter.{key} and filter.{key}__{op} from query parameters."""
    filters = {}
    for param_name, value in query_params.items():
        if param_name.startswith("filter."):
            filter_key = param_name[len("filter."):]  # e.g., "name" or "age__gt"
            filters[filter_key] = value
    return filters


def _build_filter_clauses(
    filters: dict[str, str],
    property_defs: dict[str, PropertyDef],
    type_key: str,
    node_alias: str = "n",
) -> tuple[list[str], dict]:
    """Build WHERE clauses from filter params.

    Filter syntax per the API contract:
    - filter.{key} -> exact match
    - filter.{key}__gt -> greater than
    - filter.{key}__gte -> greater or equal
    - filter.{key}__lt -> less than
    - filter.{key}__lte -> less or equal
    - filter.{key}__contains -> case-insensitive substring
    """
    OPERATORS = {
        "gt": ">",
        "gte": ">=",
        "lt": "<",
        "lte": "<=",
        "contains": "CONTAINS",
    }

    where_clauses: list[str] = []
    params: dict[str, Any] = {}

    for filter_expr, raw_value in filters.items():
        # Parse key and operator
        if "__" in filter_expr:
            prop_key, op_name = filter_expr.rsplit("__", 1)
        else:
            prop_key = filter_expr
            op_name = None

        # Validate property exists in schema
        prop_def = property_defs.get(prop_key)
        if not prop_def:
            raise ValidationError(
                f"Unknown filter property: '{prop_key}'",
                details={"fields": {prop_key: f"Not defined in type '{type_key}'"}},
            )

        # Coerce the filter value to the appropriate type
        try:
            if op_name == "contains":
                coerced_value = str(raw_value)
            else:
                coerced_value = coerce_value(raw_value, prop_def.data_type, prop_key)
        except ValueError as e:
            raise ValidationError(
                f"Invalid filter value for '{prop_key}'",
                details={"fields": {prop_key: str(e)}},
            )

        # Generate a collision-resistant parameter name using index
        param_name = f"flt_{len(params)}"

        if op_name is None:
            where_clauses.append(f"{node_alias}.{prop_key} = ${param_name}")
        elif op_name == "contains":
            where_clauses.append(
                f"toLower(toString({node_alias}.{prop_key})) CONTAINS toLower(${param_name})"
            )
        elif op_name in OPERATORS:
            where_clauses.append(f"{node_alias}.{prop_key} {OPERATORS[op_name]} ${param_name}")
        else:
            raise ValidationError(
                f"Unknown filter operator: '{op_name}'",
                details={"fields": {filter_expr: f"Unsupported operator '{op_name}'"}},
            )

        params[param_name] = coerced_value

    return where_clauses, params


def _validate_sort_field(sort: str, property_defs: dict[str, PropertyDef]) -> str:
    """Validate and return the actual Neo4j property name for sorting."""
    SYSTEM_SORT_FIELDS = {
        "createdAt": "_createdAt",
        "updatedAt": "_updatedAt",
        "_createdAt": "_createdAt",
        "_updatedAt": "_updatedAt",
    }
    if sort in SYSTEM_SORT_FIELDS:
        return SYSTEM_SORT_FIELDS[sort]
    if sort in property_defs:
        return sort
    raise ValidationError(
        f"Invalid sort field: '{sort}'",
        details={"fields": {"sort": f"'{sort}' is not a valid sort field"}},
    )


# ---------------------------------------------------------------------------
# Service Functions — Entity Instance CRUD
# ---------------------------------------------------------------------------


async def create_entity(
    ontology_key: str,
    entity_type_key: str,
    body: dict,
    driver: AsyncDriver,
) -> dict:
    """Create a new entity instance of the given type."""
    cache = await _load_schema(ontology_key, driver)
    et_def = cache.entity_types.get(entity_type_key)
    if not et_def:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    # Validate and coerce properties
    coerced, errors = validate_properties(body, et_def.properties, entity_type_key)
    if errors:
        raise ValidationError("Instance validation failed", details={"fields": errors})

    entity_id = str(uuid4())
    pascal_label = to_pascal_case(entity_type_key)

    async with driver.session() as session:
        entity = await repository.create_entity(
            session, entity_type_key, pascal_label, entity_id, coerced
        )

    return entity


async def list_entities(
    ontology_key: str,
    entity_type_key: str,
    limit: int,
    offset: int,
    sort: str,
    order: str,
    q: str | None,
    filters: dict[str, str],
    driver: AsyncDriver,
) -> dict:
    """List entity instances with filtering, search, sorting, and pagination."""
    cache = await _load_schema(ontology_key, driver)
    et_def = cache.entity_types.get(entity_type_key)
    if not et_def:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    # Build WHERE clauses and params from filters
    where_clauses, params = _build_filter_clauses(
        filters, et_def.properties, entity_type_key
    )

    # Handle text search (q parameter)
    if q:
        string_props = [
            p.key for p in et_def.properties.values() if p.data_type == "string"
        ]
        if string_props:
            q_clauses = [
                f"toLower(toString(n.{prop})) CONTAINS toLower($q_search)"
                for prop in string_props
            ]
            where_clauses.append(f"({' OR '.join(q_clauses)})")
            params["q_search"] = q

    # Validate sort field
    sort_field = _validate_sort_field(sort, et_def.properties)

    pascal_label = to_pascal_case(entity_type_key)
    async with driver.session() as session:
        items, total = await repository.list_entities(
            session,
            pascal_label,
            entity_type_key,
            where_clauses,
            params,
            sort_field,
            order,
            limit,
            offset,
        )

    return PaginatedResponse(
        items=items, total=total, limit=limit, offset=offset
    )


async def get_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    driver: AsyncDriver,
) -> dict:
    """Get a single entity instance by type key and ID."""
    cache = await _load_schema(ontology_key, driver)
    if entity_type_key not in cache.entity_types:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    pascal_label = to_pascal_case(entity_type_key)
    async with driver.session() as session:
        entity = await repository.get_entity(session, pascal_label, entity_id)
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")
    return entity


async def update_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    body: dict,
    driver: AsyncDriver,
) -> dict:
    """Partial update of an entity instance (PATCH semantics)."""
    cache = await _load_schema(ontology_key, driver)
    et_def = cache.entity_types.get(entity_type_key)
    if not et_def:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    # Validate with partial=True (PATCH semantics)
    coerced, errors = validate_properties(
        body, et_def.properties, entity_type_key, partial=True
    )
    if errors:
        raise ValidationError("Instance validation failed", details={"fields": errors})

    # Separate properties to set vs remove (null means remove)
    set_props = {k: v for k, v in coerced.items() if v is not None}
    remove_props = [k for k, v in coerced.items() if v is None]

    # Short-circuit: no changes to apply
    if not set_props and not remove_props:
        return await get_entity(ontology_key, entity_type_key, entity_id, driver)

    pascal_label = to_pascal_case(entity_type_key)
    async with driver.session() as session:
        entity = await repository.update_entity(
            session, pascal_label, entity_id, set_props, remove_props
        )
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")
    return entity


async def delete_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    driver: AsyncDriver,
) -> None:
    """Delete an entity instance (DETACH DELETE removes connected relationships too)."""
    cache = await _load_schema(ontology_key, driver)
    if entity_type_key not in cache.entity_types:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    pascal_label = to_pascal_case(entity_type_key)
    async with driver.session() as session:
        deleted = await repository.delete_entity(session, pascal_label, entity_id)
    if not deleted:
        raise NotFoundError(f"Entity '{entity_id}' not found")


# ---------------------------------------------------------------------------
# Service Functions — Relation Instance CRUD
# ---------------------------------------------------------------------------


async def create_relation(
    ontology_key: str,
    relation_type_key: str,
    body: RelationInstanceCreate,
    driver: AsyncDriver,
) -> dict:
    """Create a new relation instance between two entity instances."""
    cache = await _load_schema(ontology_key, driver)
    rt_def = cache.relation_types.get(relation_type_key)
    if not rt_def:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    from_entity_id = body.from_entity_id
    to_entity_id = body.to_entity_id

    # Extra fields (beyond fromEntityId/toEntityId) are user-defined properties
    user_props = dict(body.model_extra) if body.model_extra else {}

    # Validate user properties against schema
    coerced, errors = validate_properties(user_props, rt_def.properties, relation_type_key)

    # Validate source and target entities exist and match expected types
    async with driver.session() as session:
        from_entity = await repository.get_entity_by_id(session, from_entity_id)
        if not from_entity:
            errors["fromEntityId"] = f"Source entity '{from_entity_id}' not found"
        elif from_entity["_entityTypeKey"] != rt_def.from_entity_type_key:
            errors["fromEntityId"] = (
                f"Source entity type mismatch: expected '{rt_def.from_entity_type_key}', "
                f"got '{from_entity['_entityTypeKey']}'"
            )

        to_entity = await repository.get_entity_by_id(session, to_entity_id)
        if not to_entity:
            errors["toEntityId"] = f"Target entity '{to_entity_id}' not found"
        elif to_entity["_entityTypeKey"] != rt_def.to_entity_type_key:
            errors["toEntityId"] = (
                f"Target entity type mismatch: expected '{rt_def.to_entity_type_key}', "
                f"got '{to_entity['_entityTypeKey']}'"
            )

        if errors:
            raise ValidationError("Instance validation failed", details={"fields": errors})

        relation_id = str(uuid4())
        rel_type_upper = to_upper_snake_case(relation_type_key)

        relation = await repository.create_relation(
            session, relation_type_key, rel_type_upper,
            relation_id, from_entity_id, to_entity_id, coerced,
        )

    return relation


async def list_relations(
    ontology_key: str,
    relation_type_key: str,
    limit: int,
    offset: int,
    sort: str,
    order: str,
    from_entity_id: str | None,
    to_entity_id: str | None,
    filters: dict[str, str],
    driver: AsyncDriver,
) -> PaginatedResponse:
    """List relation instances with filtering and pagination."""
    cache = await _load_schema(ontology_key, driver)
    rt_def = cache.relation_types.get(relation_type_key)
    if not rt_def:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    where_clauses, params = _build_filter_clauses(
        filters, rt_def.properties, relation_type_key, node_alias="r"
    )

    # Add fromEntityId/toEntityId filters
    if from_entity_id:
        where_clauses.append("from._id = $from_entity_id_filter")
        params["from_entity_id_filter"] = from_entity_id
    if to_entity_id:
        where_clauses.append("to._id = $to_entity_id_filter")
        params["to_entity_id_filter"] = to_entity_id

    sort_field = _validate_sort_field(sort, rt_def.properties)
    rel_type_upper = to_upper_snake_case(relation_type_key)

    async with driver.session() as session:
        items, total = await repository.list_relations(
            session, rel_type_upper, relation_type_key,
            where_clauses, params, sort_field, order, limit, offset,
        )

    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


async def get_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    driver: AsyncDriver,
) -> dict:
    """Get a single relation instance by type key and ID."""
    cache = await _load_schema(ontology_key, driver)
    rt_def = cache.relation_types.get(relation_type_key)
    if not rt_def:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    rel_type_upper = to_upper_snake_case(relation_type_key)
    async with driver.session() as session:
        relation = await repository.get_relation(session, rel_type_upper, relation_id)
    if not relation:
        raise NotFoundError(f"Relation '{relation_id}' not found")
    return relation


async def update_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    body: dict,
    driver: AsyncDriver,
) -> dict:
    """Partial update of a relation instance (PATCH semantics).

    Cannot change fromEntityId or toEntityId — those fields are silently ignored.
    """
    cache = await _load_schema(ontology_key, driver)
    rt_def = cache.relation_types.get(relation_type_key)
    if not rt_def:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    # Strip fromEntityId/toEntityId — cannot be changed via PATCH
    body.pop("fromEntityId", None)
    body.pop("toEntityId", None)

    # Validate with partial=True (PATCH semantics)
    coerced, errors = validate_properties(
        body, rt_def.properties, relation_type_key, partial=True
    )
    if errors:
        raise ValidationError("Instance validation failed", details={"fields": errors})

    # Separate properties to set vs remove (null means remove)
    set_props = {k: v for k, v in coerced.items() if v is not None}
    remove_props = [k for k, v in coerced.items() if v is None]

    # Short-circuit: no changes to apply
    if not set_props and not remove_props:
        return await get_relation(ontology_key, relation_type_key, relation_id, driver)

    rel_type_upper = to_upper_snake_case(relation_type_key)
    async with driver.session() as session:
        relation = await repository.update_relation(
            session, rel_type_upper, relation_id, set_props, remove_props
        )
    if not relation:
        raise NotFoundError(f"Relation '{relation_id}' not found")
    return relation


async def delete_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    driver: AsyncDriver,
) -> None:
    """Delete a relation instance. Only removes the relationship, not the entities."""
    cache = await _load_schema(ontology_key, driver)
    rt_def = cache.relation_types.get(relation_type_key)
    if not rt_def:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    rel_type_upper = to_upper_snake_case(relation_type_key)
    async with driver.session() as session:
        deleted = await repository.delete_relation(session, rel_type_upper, relation_id)
    if not deleted:
        raise NotFoundError(f"Relation '{relation_id}' not found")


# ---------------------------------------------------------------------------
# Service Functions — Graph Traversal
# ---------------------------------------------------------------------------


async def get_neighbors(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    direction: str,
    relation_type_key: str | None,
    limit: int,
    driver: AsyncDriver,
) -> NeighborhoodResponse:
    """Get an entity's neighborhood — connected entities and the relations between them."""
    cache = await _load_schema(ontology_key, driver)
    if entity_type_key not in cache.entity_types:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    pascal_label = to_pascal_case(entity_type_key)

    async with driver.session() as session:
        entity = await repository.get_entity(session, pascal_label, entity_id)
        if not entity:
            raise NotFoundError(f"Entity '{entity_id}' not found")

        # Convert relation type key to UPPER_SNAKE_CASE if provided
        rel_type_filter = to_upper_snake_case(relation_type_key) if relation_type_key else None

        neighbors = await repository.get_neighbors(
            session, entity_id, direction, rel_type_filter, limit
        )

    return NeighborhoodResponse(entity=entity, neighbors=neighbors)
