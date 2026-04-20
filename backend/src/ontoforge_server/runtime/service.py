from __future__ import annotations

import asyncio
import copy
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from neo4j import AsyncDriver
from neo4j.time import Date as Neo4jDate
from neo4j.time import DateTime as Neo4jDateTime

from ontoforge_server.core.ai import AgentConfig, SavedQueryConfig, SavedQueryParameter, StepConfig
from ontoforge_server.core.database import validate_vector_indexed_properties
from ontoforge_server.core.embedding import get_embedding_provider
from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.core.schemas import (
    ExportEntityType,
    ExportOntology,
    ExportProperty,
    ExportRelationType,
)
from ontoforge_server.runtime import repository
from ontoforge_server.runtime.embedding import build_text_repr
from ontoforge_server.runtime.schemas import (
    NeighborhoodResponse,
    PaginatedResponse,
    RelationInstanceCreate,
    SchemaResponse,
)

logger = logging.getLogger(__name__)

_NOT_SET = object()  # sentinel to distinguish "no embedding change" from None


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
    fact_template: str | None = None
    properties: dict[str, PropertyDef] = field(default_factory=dict)


@dataclass
class SchemaCache:
    ontology_id: str
    ontology_key: str
    ontology_name: str
    ontology_description: str | None
    entity_types: dict[str, EntityTypeDef] = field(default_factory=dict)
    relation_types: dict[str, RelationTypeDef] = field(default_factory=dict)


@dataclass
class LoadedSchema:
    scoped: SchemaCache  # types/properties visible through this lens
    full: SchemaCache    # all types/properties for default application
    agent_configs: dict[str, AgentConfig] = field(default_factory=dict)
    saved_queries: dict[str, SavedQueryConfig] = field(default_factory=dict)


_LOADED_SCHEMA_CACHE: dict[str, LoadedSchema] = {}


def invalidate_loaded_schema_cache(ontology_key: str | None = None) -> None:
    """Clear the runtime schema cache.

    Single-process strategy:
    - runtime builds and stores cache entries lazily
    - modeling clears the cache after schema/view mutations
    """
    if ontology_key is None:
        _LOADED_SCHEMA_CACHE.clear()
        return
    _LOADED_SCHEMA_CACHE.pop(ontology_key, None)


async def _load_schema(ontology_key: str, driver: AsyncDriver) -> LoadedSchema:
    """Load the schema for the given ontology key from the database.

    Builds both full and scoped SchemaCache instances.
    """
    cached = _LOADED_SCHEMA_CACHE.get(ontology_key)
    if cached is not None:
        return cached

    async with driver.session() as session:
        schema = await repository.get_full_schema(session, ontology_key)

    if schema is None:
        raise NotFoundError(f"Ontology '{ontology_key}' not found or has no schema loaded")

    ont = schema["ontology"]
    entity_types_raw = schema["entityTypes"]
    relation_types_raw = schema["relationTypes"]
    entity_inclusions = schema["entityInclusions"]
    relation_inclusions = schema["relationInclusions"]

    # Build the full SchemaCache from all types
    full_cache = _build_schema_cache_from_raw(ont, entity_types_raw, relation_types_raw)

    # Apply scope filtering
    scoped_cache = _apply_scope_filtering(
        full_cache, entity_inclusions, relation_inclusions
    )

    # Load AI agent configs
    async with driver.session() as session:
        agent_rows = await repository.get_ai_agent_configs(session, ontology_key)
    agent_configs = {
        row["key"]: AgentConfig(
            key=row["key"],
            name=row["name"],
            description=row.get("description"),
            system_prompt=row.get("systemPrompt"),
            tools=row.get("tools"),
        )
        for row in agent_rows
    }

    # Load saved queries
    async with driver.session() as session:
        query_rows = await repository.get_saved_queries(session, ontology_key)
    saved_queries = {}
    for row in query_rows:
        import json as _json
        params_raw = row.get("parameters", "[]")
        if isinstance(params_raw, str):
            params_list = _json.loads(params_raw)
        else:
            params_list = params_raw or []
        steps_raw = row.get("steps", "[]")
        if isinstance(steps_raw, str):
            steps_list = _json.loads(steps_raw)
        else:
            steps_list = steps_raw or []
        saved_queries[row["key"]] = SavedQueryConfig(
            key=row["key"],
            name=row["name"],
            description=row["description"],
            steps=[
                StepConfig(
                    name=s["name"],
                    type=s["type"],
                    cypher=s.get("cypher"),
                    entity_type_key=s.get("entityTypeKey"),
                    query=s.get("query"),
                    limit=s.get("limit"),
                    min_score=s.get("minScore"),
                    bindings=s.get("bindings"),
                )
                for s in steps_list
            ],
            parameters=[
                SavedQueryParameter(
                    name=p["name"],
                    description=p["description"],
                    data_type=p["dataType"],
                )
                for p in params_list
            ],
        )

    loaded = LoadedSchema(scoped=scoped_cache, full=full_cache, agent_configs=agent_configs, saved_queries=saved_queries)
    _LOADED_SCHEMA_CACHE[ontology_key] = loaded
    return loaded


def _build_schema_cache_from_raw(
    ont: dict,
    entity_types_raw: list[dict],
    relation_types_raw: list[dict],
) -> SchemaCache:
    """Build a SchemaCache from raw dicts."""
    cache = SchemaCache(
        ontology_id=ont["ontologyId"],
        ontology_key=ont["key"],
        ontology_name=ont["name"],
        ontology_description=ont.get("description"),
    )
    for et in entity_types_raw:
        props = {}
        for p in et.get("properties", []):
            props[p["key"]] = PropertyDef(
                key=p["key"],
                display_name=p["displayName"],
                description=p.get("description"),
                data_type=p["dataType"],
                required=p["required"],
                default_value=p.get("defaultValue"),
            )
        cache.entity_types[et["key"]] = EntityTypeDef(
            key=et["key"],
            display_name=et["displayName"],
            description=et.get("description"),
            properties=props,
        )
    for rt in relation_types_raw:
        props = {}
        for p in rt.get("properties", []):
            props[p["key"]] = PropertyDef(
                key=p["key"],
                display_name=p["displayName"],
                description=p.get("description"),
                data_type=p["dataType"],
                required=p["required"],
                default_value=p.get("defaultValue"),
            )
        cache.relation_types[rt["key"]] = RelationTypeDef(
            key=rt["key"],
            display_name=rt["displayName"],
            description=rt.get("description"),
            from_entity_type_key=rt["sourceKey"],
            to_entity_type_key=rt["targetKey"],
            fact_template=rt.get("factTemplate"),
            properties=props,
        )
    return cache


def _apply_scope_filtering(
    full_cache: SchemaCache,
    entity_inclusions: list[dict],
    relation_inclusions: list[dict],
) -> SchemaCache:
    """Apply the four-case scoping matrix to build a scoped SchemaCache.

    CRITICAL: Deep-copy entity/relation type defs before filtering properties
    to avoid mutating the full cache.
    """
    has_entity_scope = len(entity_inclusions) > 0
    has_relation_scope = len(relation_inclusions) > 0

    scoped = SchemaCache(
        ontology_id=full_cache.ontology_id,
        ontology_key=full_cache.ontology_key,
        ontology_name=full_cache.ontology_name,
        ontology_description=full_cache.ontology_description,
    )

    # --- Entity types ---
    if not has_entity_scope:
        # All entity types exposed (deep copy to avoid mutation)
        for key, et_def in full_cache.entity_types.items():
            scoped.entity_types[key] = copy.deepcopy(et_def)
    else:
        # Only included entity types
        et_inclusion_map = {inc["key"]: inc["properties"] for inc in entity_inclusions}
        for key, prop_filter in et_inclusion_map.items():
            if key not in full_cache.entity_types:
                continue
            et_def = copy.deepcopy(full_cache.entity_types[key])
            if prop_filter is not None:
                # Filter to only listed properties
                et_def.properties = {
                    pk: pv for pk, pv in et_def.properties.items()
                    if pk in prop_filter
                }
            scoped.entity_types[key] = et_def

    included_et_keys = set(scoped.entity_types.keys())

    # --- Relation types ---
    if not has_entity_scope and not has_relation_scope:
        # Case 1: fully unscoped — all relation types
        for key, rt_def in full_cache.relation_types.items():
            scoped.relation_types[key] = copy.deepcopy(rt_def)
    elif has_entity_scope and not has_relation_scope:
        # Case 2: auto-filter — only relations where BOTH source AND target are in included set
        for key, rt_def in full_cache.relation_types.items():
            if (rt_def.from_entity_type_key in included_et_keys and
                    rt_def.to_entity_type_key in included_et_keys):
                scoped.relation_types[key] = copy.deepcopy(rt_def)
    elif not has_entity_scope and has_relation_scope:
        # Case 3: only explicitly included relation types
        rt_inclusion_map = {inc["key"]: inc["properties"] for inc in relation_inclusions}
        for key, prop_filter in rt_inclusion_map.items():
            if key not in full_cache.relation_types:
                continue
            rt_def = copy.deepcopy(full_cache.relation_types[key])
            if prop_filter is not None:
                rt_def.properties = {
                    pk: pv for pk, pv in rt_def.properties.items()
                    if pk in prop_filter
                }
            scoped.relation_types[key] = rt_def
    else:
        # Case 4: both entity and relation scoping — only explicitly included
        rt_inclusion_map = {inc["key"]: inc["properties"] for inc in relation_inclusions}
        for key, prop_filter in rt_inclusion_map.items():
            if key not in full_cache.relation_types:
                continue
            rt_def = copy.deepcopy(full_cache.relation_types[key])
            if prop_filter is not None:
                rt_def.properties = {
                    pk: pv for pk, pv in rt_def.properties.items()
                    if pk in prop_filter
                }
            scoped.relation_types[key] = rt_def

    return scoped


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
    """Coerce a JSON value to the appropriate Python/Neo4j type."""
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
                    parsed.microsecond * 1000,
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
    """Validate and coerce properties against schema definitions."""
    coerced: dict[str, Any] = {}
    errors: dict[str, str] = {}

    for key in properties:
        if key not in property_defs:
            errors[key] = f"Unknown property: not defined in type '{type_key}'"

    for prop_key, prop_def in property_defs.items():
        if prop_key in properties:
            value = properties[prop_key]
            if value is None:
                if partial:
                    if prop_def.required:
                        errors[prop_key] = "Cannot set required property to null"
                    else:
                        coerced[prop_key] = None
                else:
                    if prop_def.required and prop_def.default_value is None:
                        errors[prop_key] = "Required property missing"
                    elif prop_def.default_value is not None:
                        try:
                            coerced[prop_key] = coerce_value(
                                prop_def.default_value, prop_def.data_type, prop_key
                            )
                        except ValueError as e:
                            errors[prop_key] = str(e)
            else:
                try:
                    coerced[prop_key] = coerce_value(value, prop_def.data_type, prop_key)
                except ValueError as e:
                    errors[prop_key] = str(e)
        elif not partial:
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


def _entity_type_def_to_export(et_def: EntityTypeDef) -> ExportEntityType:
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
        factTemplate=rt_def.fact_template,
        properties=props,
    )


# ---------------------------------------------------------------------------
# Response Property Filtering
# ---------------------------------------------------------------------------


def _filter_entity_properties(entity: dict, scoped_et: EntityTypeDef) -> dict:
    """Filter entity properties to only those visible through the scoped schema."""
    return {k: v for k, v in entity.items() if k.startswith("_") or k in scoped_et.properties}


def _filter_relation_properties(relation: dict, scoped_rt: RelationTypeDef) -> dict:
    """Filter relation properties to only those visible through the scoped schema."""
    return {k: v for k, v in relation.items() if k.startswith("_") or k in scoped_rt.properties or k in ("fromEntityId", "toEntityId", "direction")}


# ---------------------------------------------------------------------------
# Service Functions — Schema Introspection (from cache)
# ---------------------------------------------------------------------------


async def get_full_schema(ontology_key: str, driver: AsyncDriver) -> SchemaResponse:
    """Return the scoped schema for the given ontology."""
    loaded = await _load_schema(ontology_key, driver)
    cache = loaded.scoped
    ontology = ExportOntology(
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
    loaded = await _load_schema(ontology_key, driver)
    return [
        _entity_type_def_to_export(et_def)
        for et_def in loaded.scoped.entity_types.values()
    ]


async def get_entity_type(ontology_key: str, key: str, driver: AsyncDriver) -> ExportEntityType:
    loaded = await _load_schema(ontology_key, driver)
    et_def = loaded.scoped.entity_types.get(key)
    if not et_def:
        raise NotFoundError(f"Entity type '{key}' not found")
    return _entity_type_def_to_export(et_def)


async def list_relation_types(ontology_key: str, driver: AsyncDriver) -> list[ExportRelationType]:
    loaded = await _load_schema(ontology_key, driver)
    return [
        _relation_type_def_to_export(rt_def)
        for rt_def in loaded.scoped.relation_types.values()
    ]


async def get_relation_type(ontology_key: str, key: str, driver: AsyncDriver) -> ExportRelationType:
    loaded = await _load_schema(ontology_key, driver)
    rt_def = loaded.scoped.relation_types.get(key)
    if not rt_def:
        raise NotFoundError(f"Relation type '{key}' not found")
    return _relation_type_def_to_export(rt_def)


# ---------------------------------------------------------------------------
# Field Projection
# ---------------------------------------------------------------------------

_ENTITY_ALWAYS_FIELDS = frozenset({"_id"})
_ENTITY_NEIGHBOR_ALWAYS_FIELDS = frozenset({"_id", "_entityTypeKey"})
_RELATION_ALWAYS_FIELDS = frozenset({"_id", "_relationTypeKey", "direction"})


def _apply_field_projection(
    data: dict,
    fields: list[str] | None,
    always_include: frozenset[str],
) -> dict:
    if fields is None:
        return data
    keep = always_include | set(fields)
    return {k: v for k, v in data.items() if k in keep}


# ---------------------------------------------------------------------------
# Filter / Sort Helpers (for list endpoints)
# ---------------------------------------------------------------------------


def _parse_filters(query_params: dict[str, str]) -> dict[str, str]:
    filters = {}
    for param_name, value in query_params.items():
        if param_name.startswith("filter."):
            filter_key = param_name[len("filter."):]
            filters[filter_key] = value
    return filters


def _build_filter_clauses(
    filters: dict[str, str],
    property_defs: dict[str, PropertyDef],
    type_key: str,
    node_alias: str = "n",
) -> tuple[list[str], dict]:
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
        if "__" in filter_expr:
            prop_key, op_name = filter_expr.rsplit("__", 1)
        else:
            prop_key = filter_expr
            op_name = None

        prop_def = property_defs.get(prop_key)
        if not prop_def:
            raise ValidationError(
                f"Unknown filter property: '{prop_key}'",
                details={"fields": {prop_key: f"Not defined in type '{type_key}'"}},
            )

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
    """Create a new entity instance. Validate against scoped properties, apply defaults from full schema."""
    loaded = await _load_schema(ontology_key, driver)
    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    # Validate against scoped properties
    coerced, errors = validate_properties(body, scoped_et.properties, entity_type_key)
    if errors:
        raise ValidationError("Instance validation failed", details={"fields": errors})

    # Apply defaults from full schema for properties not in scope
    full_et = loaded.full.entity_types.get(entity_type_key)
    if full_et:
        for prop_key, prop_def in full_et.properties.items():
            if prop_key not in coerced and prop_def.default_value is not None:
                try:
                    coerced[prop_key] = coerce_value(
                        prop_def.default_value, prop_def.data_type, prop_key
                    )
                except ValueError:
                    pass  # Skip defaults that fail coercion

    entity_id = str(uuid4())
    pascal_label = to_pascal_case(entity_type_key)

    embedding = None
    provider = get_embedding_provider()
    if provider and full_et:
        validate_vector_indexed_properties(
            entity_type_key, coerced, list(full_et.properties.keys())
        )
        text = build_text_repr(entity_type_key, coerced, full_et.properties)
        embedding = await provider.embed(text)

    async with driver.session() as session:
        entity = await repository.create_entity(
            session, entity_type_key, pascal_label, entity_id, coerced,
            embedding=embedding,
        )

    # Filter response to scoped properties
    return _filter_entity_properties(entity, scoped_et)


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
    fields: list[str] | None = None,
) -> dict:
    loaded = await _load_schema(ontology_key, driver)
    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    where_clauses, params = _build_filter_clauses(
        filters, scoped_et.properties, entity_type_key
    )

    if q:
        string_props = [
            p.key for p in scoped_et.properties.values() if p.data_type == "string"
        ]
        if string_props:
            q_clauses = [
                f"toLower(toString(n.{prop})) CONTAINS toLower($q_search)"
                for prop in string_props
            ]
            where_clauses.append(f"({' OR '.join(q_clauses)})")
            params["q_search"] = q

    sort_field = _validate_sort_field(sort, scoped_et.properties)

    pascal_label = to_pascal_case(entity_type_key)
    async with driver.session() as session:
        items, total = await repository.list_entities(
            session, pascal_label, entity_type_key,
            where_clauses, params, sort_field, order, limit, offset,
        )

    # Filter response properties to scoped schema
    items = [_filter_entity_properties(e, scoped_et) for e in items]

    if fields is not None:
        items = [_apply_field_projection(e, fields, _ENTITY_ALWAYS_FIELDS) for e in items]

    return PaginatedResponse(
        items=items, total=total, limit=limit, offset=offset
    )


async def get_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    driver: AsyncDriver,
    fields: list[str] | None = None,
) -> dict:
    loaded = await _load_schema(ontology_key, driver)
    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    pascal_label = to_pascal_case(entity_type_key)
    async with driver.session() as session:
        entity = await repository.get_entity(session, pascal_label, entity_id)
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")

    entity = _filter_entity_properties(entity, scoped_et)
    return _apply_field_projection(entity, fields, _ENTITY_ALWAYS_FIELDS)


async def update_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    body: dict,
    driver: AsyncDriver,
) -> dict:
    """Partial update. Validate against scoped properties. NO default re-application."""
    loaded = await _load_schema(ontology_key, driver)
    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    coerced, errors = validate_properties(
        body, scoped_et.properties, entity_type_key, partial=True
    )
    if errors:
        raise ValidationError("Instance validation failed", details={"fields": errors})

    set_props = {k: v for k, v in coerced.items() if v is not None}
    remove_props = [k for k, v in coerced.items() if v is None]

    if not set_props and not remove_props:
        return await get_entity(ontology_key, entity_type_key, entity_id, driver)

    pascal_label = to_pascal_case(entity_type_key)

    # Re-embed if any string properties changed (use full schema for embedding)
    embedding = _NOT_SET
    provider = get_embedding_provider()
    full_et = loaded.full.entity_types.get(entity_type_key)
    if provider and full_et:
        has_string_changes = any(
            k in full_et.properties and full_et.properties[k].data_type == "string"
            for k in coerced
        )
        if has_string_changes:
            async with driver.session() as session:
                current = await repository.get_entity(session, pascal_label, entity_id)
            if current:
                merged = {k: v for k, v in current.items() if not k.startswith("_")}
                merged.update({k: v for k, v in set_props.items()})
                for k in remove_props:
                    merged.pop(k, None)
                validate_vector_indexed_properties(
                    entity_type_key, merged, list(full_et.properties.keys()), entity_id=entity_id
                )
                text = build_text_repr(entity_type_key, merged, full_et.properties)
                embedding = await provider.embed(text)

    async with driver.session() as session:
        entity = await repository.update_entity(
            session, pascal_label, entity_id, set_props, remove_props,
            embedding=embedding if embedding is not _NOT_SET else None,
            has_embedding_update=embedding is not _NOT_SET,
        )
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")

    return _filter_entity_properties(entity, scoped_et)


async def delete_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    driver: AsyncDriver,
) -> None:
    loaded = await _load_schema(ontology_key, driver)
    if entity_type_key not in loaded.scoped.entity_types:
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
    loaded = await _load_schema(ontology_key, driver)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    from_entity_id = body.from_entity_id
    to_entity_id = body.to_entity_id
    user_props = dict(body.model_extra) if body.model_extra else {}

    # Validate user properties against scoped schema
    coerced, errors = validate_properties(user_props, scoped_rt.properties, relation_type_key)

    # Apply defaults from full schema for properties not in scope
    full_rt = loaded.full.relation_types.get(relation_type_key)
    if full_rt:
        for prop_key, prop_def in full_rt.properties.items():
            if prop_key not in coerced and prop_def.default_value is not None:
                try:
                    coerced[prop_key] = coerce_value(
                        prop_def.default_value, prop_def.data_type, prop_key
                    )
                except ValueError:
                    pass

    # Use full schema for entity type validation
    full_rt_for_validation = full_rt or scoped_rt
    async with driver.session() as session:
        from_entity = await repository.get_entity_by_id(session, from_entity_id)
        if not from_entity:
            errors["fromEntityId"] = f"Source entity '{from_entity_id}' not found"
        elif from_entity["_entityTypeKey"] != full_rt_for_validation.from_entity_type_key:
            errors["fromEntityId"] = (
                f"Source entity type mismatch: expected '{full_rt_for_validation.from_entity_type_key}', "
                f"got '{from_entity['_entityTypeKey']}'"
            )

        to_entity = await repository.get_entity_by_id(session, to_entity_id)
        if not to_entity:
            errors["toEntityId"] = f"Target entity '{to_entity_id}' not found"
        elif to_entity["_entityTypeKey"] != full_rt_for_validation.to_entity_type_key:
            errors["toEntityId"] = (
                f"Target entity type mismatch: expected '{full_rt_for_validation.to_entity_type_key}', "
                f"got '{to_entity['_entityTypeKey']}'"
            )

        if errors:
            raise ValidationError("Instance validation failed", details={"fields": errors})

        relation_id = str(uuid4())
        rel_type_upper = to_upper_snake_case(relation_type_key)

        # Semantic relation type? Render + embed the fact.
        fact: str | None = None
        fact_version: int | None = None
        embedding: list[float] | None = None
        embedding_state = "ok"
        embedding_version = 1
        template = full_rt_for_validation.fact_template if full_rt_for_validation else None
        if template:
            from ontoforge_server.runtime.relation_embedding import (
                render_and_embed_relation_fact,
            )

            # Relation data passed to the template is the coerced user props
            # plus any explicit displayName (none for now — the relation carries
            # no displayName property by default). Pass `_relationTypeKey` too.
            relation_ctx: dict[str, Any] = dict(coerced)
            try:
                result = await render_and_embed_relation_fact(
                    template, from_entity, to_entity, relation_ctx,
                )
            except ValueError as exc:
                raise ValidationError(
                    f"Fact template render failed: {exc}",
                    details={"fields": {"factTemplate": str(exc)}},
                )
            fact = result.fact
            fact_version = result.fact_version
            embedding = result.embedding
            embedding_state = result.embedding_state
            embedding_version = result.embedding_version

        relation = await repository.create_relation(
            session, relation_type_key, rel_type_upper,
            relation_id, from_entity_id, to_entity_id, coerced,
            fact=fact,
            fact_version=fact_version,
            embedding=embedding,
            embedding_state=embedding_state,
            embedding_version=embedding_version,
        )

    return _filter_relation_properties(relation, scoped_rt)


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
    loaded = await _load_schema(ontology_key, driver)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    where_clauses, params = _build_filter_clauses(
        filters, scoped_rt.properties, relation_type_key, node_alias="r"
    )

    if from_entity_id:
        where_clauses.append("from._id = $from_entity_id_filter")
        params["from_entity_id_filter"] = from_entity_id
    if to_entity_id:
        where_clauses.append("to._id = $to_entity_id_filter")
        params["to_entity_id_filter"] = to_entity_id

    sort_field = _validate_sort_field(sort, scoped_rt.properties)
    rel_type_upper = to_upper_snake_case(relation_type_key)

    async with driver.session() as session:
        items, total = await repository.list_relations(
            session, rel_type_upper, relation_type_key,
            where_clauses, params, sort_field, order, limit, offset,
        )

    items = [_filter_relation_properties(r, scoped_rt) for r in items]

    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


async def get_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    driver: AsyncDriver,
) -> dict:
    loaded = await _load_schema(ontology_key, driver)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    rel_type_upper = to_upper_snake_case(relation_type_key)
    async with driver.session() as session:
        relation = await repository.get_relation(session, rel_type_upper, relation_id)
    if not relation:
        raise NotFoundError(f"Relation '{relation_id}' not found")
    return _filter_relation_properties(relation, scoped_rt)


async def update_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    body: dict,
    driver: AsyncDriver,
) -> dict:
    loaded = await _load_schema(ontology_key, driver)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    body.pop("fromEntityId", None)
    body.pop("toEntityId", None)

    coerced, errors = validate_properties(
        body, scoped_rt.properties, relation_type_key, partial=True
    )
    if errors:
        raise ValidationError("Instance validation failed", details={"fields": errors})

    set_props = {k: v for k, v in coerced.items() if v is not None}
    remove_props = [k for k, v in coerced.items() if v is None]

    if not set_props and not remove_props:
        return await get_relation(ontology_key, relation_type_key, relation_id, driver)

    rel_type_upper = to_upper_snake_case(relation_type_key)

    # Semantic relation type? Re-render + re-embed using merged state.
    full_rt = loaded.full.relation_types.get(relation_type_key)
    template = full_rt.fact_template if full_rt else None
    fact: str | None = None
    fact_version: int | None = None
    embedding: list[float] | None = None
    has_embedding_update = False

    if template:
        async with driver.session() as session:
            current = await repository.get_relation(session, rel_type_upper, relation_id)
        if current is None:
            raise NotFoundError(f"Relation '{relation_id}' not found")

        merged_relation_props = {
            k: v for k, v in current.items()
            if not k.startswith("_") and k not in ("fromEntityId", "toEntityId")
        }
        merged_relation_props.update(set_props)
        for k in remove_props:
            merged_relation_props.pop(k, None)

        async with driver.session() as session:
            from_entity = await repository.get_entity_by_id(session, current["fromEntityId"])
            to_entity = await repository.get_entity_by_id(session, current["toEntityId"])

        from ontoforge_server.runtime.relation_embedding import (
            render_and_embed_relation_fact,
        )

        try:
            result = await render_and_embed_relation_fact(
                template, from_entity or {}, to_entity or {}, merged_relation_props,
            )
        except ValueError as exc:
            raise ValidationError(
                f"Fact template render failed: {exc}",
                details={"fields": {"factTemplate": str(exc)}},
            )
        fact = result.fact
        fact_version = result.fact_version
        embedding = result.embedding
        has_embedding_update = True

    async with driver.session() as session:
        relation = await repository.update_relation(
            session, rel_type_upper, relation_id, set_props, remove_props,
            fact=fact,
            fact_version=fact_version,
            embedding=embedding,
            has_embedding_update=has_embedding_update,
        )
    if not relation:
        raise NotFoundError(f"Relation '{relation_id}' not found")
    return _filter_relation_properties(relation, scoped_rt)


async def delete_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    driver: AsyncDriver,
) -> None:
    loaded = await _load_schema(ontology_key, driver)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
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
    fields: list[str] | None = None,
    relation_fields: list[str] | None = None,
) -> NeighborhoodResponse:
    loaded = await _load_schema(ontology_key, driver)
    if entity_type_key not in loaded.scoped.entity_types:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    pascal_label = to_pascal_case(entity_type_key)

    async with driver.session() as session:
        entity = await repository.get_entity(session, pascal_label, entity_id)
        if not entity:
            raise NotFoundError(f"Entity '{entity_id}' not found")

        rel_type_filter = to_upper_snake_case(relation_type_key) if relation_type_key else None

        neighbors = await repository.get_neighbors(
            session, entity_id, direction, rel_type_filter, limit
        )

    # Filter neighbors by scoped relation types
    scoped_rt_upper = {to_upper_snake_case(k) for k in loaded.scoped.relation_types}
    filtered_neighbors = []
    for n in neighbors:
        rel = n["relation"]
        rt_key = rel.get("_relationTypeKey")
        if rt_key and rt_key in loaded.scoped.relation_types:
            scoped_rt = loaded.scoped.relation_types[rt_key]
            n["relation"] = _filter_relation_properties(rel, scoped_rt)
            # Filter neighbor entity properties if its type is in scope
            neighbor_et_key = n["entity"].get("_entityTypeKey")
            if neighbor_et_key and neighbor_et_key in loaded.scoped.entity_types:
                n["entity"] = _filter_entity_properties(n["entity"], loaded.scoped.entity_types[neighbor_et_key])
            filtered_neighbors.append(n)
        elif not rt_key:
            filtered_neighbors.append(n)

    # Filter center entity
    scoped_et = loaded.scoped.entity_types[entity_type_key]
    entity = _filter_entity_properties(entity, scoped_et)

    if fields is not None:
        entity = _apply_field_projection(entity, fields, _ENTITY_ALWAYS_FIELDS)
        for n in filtered_neighbors:
            n["entity"] = _apply_field_projection(n["entity"], fields, _ENTITY_NEIGHBOR_ALWAYS_FIELDS)
    if relation_fields is not None:
        for n in filtered_neighbors:
            n["relation"] = _apply_field_projection(n["relation"], relation_fields, _RELATION_ALWAYS_FIELDS)

    return NeighborhoodResponse(entity=entity, neighbors=filtered_neighbors)


# ---------------------------------------------------------------------------
# Service Functions — Semantic Search
# ---------------------------------------------------------------------------


async def semantic_search(
    ontology_key: str,
    query: str,
    entity_type_key: str,
    limit: int,
    min_score: float | None,
    driver: AsyncDriver,
    filters: dict[str, str] | None = None,
    fields: list[str] | None = None,
) -> dict:
    loaded = await _load_schema(ontology_key, driver)

    provider = get_embedding_provider()
    if not provider:
        raise ValidationError(
            "Semantic search requires EMBEDDING_PROVIDER to be configured",
            details={"code": "FEATURE_DISABLED"},
        )

    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    query_embedding = await provider.embed(query)
    if query_embedding is None:
        raise ValidationError("Failed to generate embedding for search query")

    filters = filters or {}
    # Reject __contains — not supported by in-index WHERE (SEARCH clause).
    # Use the entity list endpoint for substring filtering.
    for filter_key in filters:
        if filter_key.endswith("__contains"):
            raise ValidationError(
                "The '__contains' filter is not supported on semantic search. "
                "Use exact match or range operators (=, __gt, __gte, __lt, __lte).",
                details={"fields": {filter_key: "Not supported on semantic search"}},
            )

    where_clauses: list[str] = []
    filter_params: dict = {}
    if filters:
        where_clauses, filter_params = _build_filter_clauses(
            filters, scoped_et.properties, entity_type_key, node_alias="n"
        )

    pascal_label = to_pascal_case(entity_type_key)

    async with driver.session() as session:
        results = await repository.semantic_search(
            session,
            pascal_label,
            entity_type_key,
            query_embedding,
            limit,
            min_score,
            where_clauses=where_clauses if where_clauses else None,
            filter_params=filter_params if filter_params else None,
        )

    # Filter result properties to scoped schema
    for r in results:
        r["entity"] = _filter_entity_properties(r["entity"], scoped_et)

    if fields is not None:
        for r in results:
            r["entity"] = _apply_field_projection(r["entity"], fields, _ENTITY_ALWAYS_FIELDS)

    return {
        "results": results,
        "query": query,
        "total": len(results),
    }


# ---------------------------------------------------------------------------
# Service Functions — Cypher Query
# ---------------------------------------------------------------------------


async def execute_cypher_query(
    ontology_key: str,
    cypher: str,
    driver: AsyncDriver,
) -> dict:
    """Validate, rewrite, and execute a read-only Cypher query.

    Returns ``{"columns": [...], "results": [...]}`` with properties
    filtered to the scoped ontology schema.
    """
    from ontoforge_server.runtime.cypher import (
        SYSTEM_PROPERTIES,
        get_return_variables,
        validate_and_rewrite,
    )

    loaded = await _load_schema(ontology_key, driver)
    scoped = loaded.scoped

    # Map variables → schema keys before rewriting (uses original labels).
    var_map = get_return_variables(cypher, scoped)

    # Validate and rewrite (snake_case → PascalCase / UPPER_SNAKE_CASE).
    rewritten = validate_and_rewrite(cypher, scoped)

    # Execute in a read transaction.
    async with driver.session() as session:
        columns, rows = await repository.execute_cypher_read(
            session, rewritten
        )

    # Post-process: filter out-of-scope properties from returned
    # nodes and relationships.
    for row in rows:
        for col, value in row.items():
            if not isinstance(value, dict):
                continue
            # Determine schema type for this value.
            type_key = _resolve_type_key_for_value(col, value, var_map, scoped)
            if type_key is None:
                continue
            _strip_out_of_scope_props(value, type_key, scoped)

    return {"columns": columns, "results": rows}


def _resolve_type_key_for_value(
    column: str,
    value: dict,
    var_map: dict[str, str | None],
    schema: SchemaCache,
) -> str | None:
    """Figure out the schema type key for a dict returned by Neo4j."""
    # If the column is a known variable, use the pre-built mapping.
    if column in var_map:
        return var_map[column]
    # Fallback: inspect _entityTypeKey or _relationTypeKey in the value.
    etk = value.get("_entityTypeKey")
    if etk and etk in schema.entity_types:
        return etk
    rtk = value.get("_relationTypeKey")
    if rtk and rtk in schema.relation_types:
        return rtk
    return None


def _strip_out_of_scope_props(
    value: dict,
    type_key: str,
    schema: SchemaCache,
) -> None:
    """Remove properties not in the scoped schema (in place)."""
    from ontoforge_server.runtime.cypher import SYSTEM_PROPERTIES

    if type_key in schema.entity_types:
        allowed = set(schema.entity_types[type_key].properties) | SYSTEM_PROPERTIES
    elif type_key in schema.relation_types:
        allowed = set(schema.relation_types[type_key].properties) | SYSTEM_PROPERTIES
    else:
        return
    for key in list(value):
        if key not in allowed:
            del value[key]


# ---------------------------------------------------------------------------
# Service Functions — Saved Query Execution
# ---------------------------------------------------------------------------


_BINDING_RE = re.compile(r'\{\{(\w+)\.(\w+)\}\}')


def _resolve_bindings(
    bindings: dict[str, str],
    step_results: dict[str, list[dict]],
) -> dict[str, list]:
    """Resolve binding expressions to concrete values from previous step results."""
    resolved: dict[str, list] = {}
    for param_name, expr in bindings.items():
        match = _BINDING_RE.fullmatch(expr)
        if not match:
            raise ValidationError(f"Invalid binding expression: {expr}")
        step_name = match.group(1)
        field_name = match.group(2)
        rows = step_results.get(step_name, [])
        resolved[param_name] = [row[field_name] for row in rows if field_name in row]
    return resolved


def _substitute_params(template: str, params: dict[str, Any]) -> str:
    """Replace $param_name references in a string with their values."""
    def replacer(m: re.Match) -> str:
        name = m.group(1)
        if name in params:
            return str(params[name])
        return m.group(0)  # leave unresolved
    return re.sub(r'\$([a-zA-Z_]\w*)', replacer, template)


async def execute_saved_query(
    ontology_key: str,
    query_key: str,
    params: dict[str, Any],
    driver: AsyncDriver,
) -> dict:
    """Execute a saved query pipeline by key with parameter values.

    Validates parameters, coerces types, then runs each step sequentially.
    Bindings allow steps to reference results from earlier steps.
    Returns the last step's output.
    """
    from ontoforge_server.runtime.cypher import (
        get_return_variables,
        validate_and_rewrite,
    )

    loaded = await _load_schema(ontology_key, driver)
    config = loaded.saved_queries.get(query_key)
    if not config:
        raise NotFoundError(f"Saved query '{query_key}' not found")

    # Validate all declared parameters are present (no missing, no extra)
    declared_names = {p.name for p in config.parameters}
    provided_names = set(params.keys())
    missing = declared_names - provided_names
    extra = provided_names - declared_names
    errors: list[str] = []
    if missing:
        errors.append(f"Missing required parameters: {sorted(missing)}")
    if extra:
        errors.append(f"Unknown parameters: {sorted(extra)}")
    if errors:
        raise ValidationError(
            f"Parameter validation failed: {'; '.join(errors)}",
            details={"errors": errors},
        )

    # Coerce parameter values to declared data types
    coerced_params: dict[str, Any] = {}
    coercion_errors: dict[str, str] = {}
    for param_def in config.parameters:
        raw_value = params[param_def.name]
        try:
            coerced_params[param_def.name] = coerce_value(
                raw_value, param_def.data_type, param_def.name
            )
        except ValueError as e:
            coercion_errors[param_def.name] = str(e)
    if coercion_errors:
        raise ValidationError(
            "Parameter type coercion failed",
            details={"fields": coercion_errors},
        )

    scoped = loaded.scoped
    step_results: dict[str, list[dict]] = {}
    last_output: dict = {"columns": [], "results": []}

    for step in config.steps:
        # Resolve bindings from previous step outputs
        resolved_bindings: dict[str, Any] = {}
        if step.bindings:
            resolved_bindings = _resolve_bindings(step.bindings, step_results)

        if step.type == "cypher":
            assert step.cypher is not None  # enforced by modeling validation
            # Merge user params + resolved bindings for Cypher parameters
            cypher_params = {**coerced_params, **resolved_bindings}

            var_map = get_return_variables(step.cypher, scoped)
            rewritten = validate_and_rewrite(step.cypher, scoped)

            async with driver.session() as session:
                columns, rows = await repository.execute_cypher_read(
                    session, rewritten, params=cypher_params
                )

            # Post-process: strip out-of-scope properties
            for row in rows:
                for col, value in row.items():
                    if not isinstance(value, dict):
                        continue
                    type_key = _resolve_type_key_for_value(col, value, var_map, scoped)
                    if type_key is None:
                        continue
                    _strip_out_of_scope_props(value, type_key, scoped)

            step_results[step.name] = rows
            last_output = {"columns": columns, "results": rows}

        elif step.type == "semantic_search":
            assert step.query is not None  # enforced by modeling validation
            assert step.entity_type_key is not None  # enforced by modeling validation
            # Resolve the query text from user params
            query_text = _substitute_params(step.query, coerced_params)

            limit = step.limit or 10
            min_score = step.min_score

            result = await semantic_search(
                ontology_key,
                query_text,
                step.entity_type_key,
                limit,
                min_score,
                driver,
            )

            # Flatten results for binding: each result's entity dict becomes a row
            rows = [r["entity"] for r in result.get("results", [])]
            # Include _score in each row for downstream use
            for r, row in zip(result.get("results", []), rows):
                row["_score"] = r.get("_score", r.get("score"))

            step_results[step.name] = rows
            last_output = result

    return last_output


# ---------------------------------------------------------------------------
# Service Functions — Semantic Search over Relation Facts (Phase 1 §7.1)
# ---------------------------------------------------------------------------


def _rrf_fuse(
    ranked_lists: list[list[dict]],
    k: int,
) -> list[dict]:
    """Fuse N per-type ranked lists with Reciprocal Rank Fusion.

    Each input list is assumed to already be sorted best-first. Returns a list
    sorted by RRF score desc, tiebroken by ``_id`` ascending, with the original
    per-item dict preserved and a recomputed ``score`` reflecting the RRF total.
    """
    scores: dict[str, float] = {}
    items: dict[str, dict] = {}
    for ranked in ranked_lists:
        for rank, item in enumerate(ranked):
            rid = item["_id"]
            scores[rid] = scores.get(rid, 0.0) + 1.0 / (k + rank + 1)
            if rid not in items:
                items[rid] = item
    fused: list[dict] = []
    for rid, total in scores.items():
        row = dict(items[rid])
        row["score"] = total
        fused.append(row)
    fused.sort(key=lambda r: (-r["score"], r["_id"]))
    return fused


async def _search_one_relation_type(
    driver: AsyncDriver,
    rel_type_upper: str,
    relation_type_key: str,
    query_embedding: list[float],
    group_id: str,
    per_type_limit: int,
) -> list[dict]:
    """Run the per-type SEARCH query for one semantic relation type.

    On any Neo4j-side error, returns an empty list (per-index failure isolation
    per §7.1 step 6).
    """
    index_name = f"{relation_type_key}_relation_embedding"
    # Cypher 25 SEARCH ... IN (VECTOR INDEX ...) form, mirroring the entity
    # semantic-search repository pattern (``SEARCH n IN (...)``).
    query = (
        f"MATCH ()-[r:{rel_type_upper}]-() "
        f"SEARCH r IN ("
        f"VECTOR INDEX {index_name} "
        f"FOR $query_embedding "
        f"WHERE r._groupId = $group_id "
        f"LIMIT $per_type_limit"
        f") SCORE AS score "
        f"RETURN r._id AS _id, "
        f"r._relationTypeKey AS _relationTypeKey, "
        f"r._fact AS _fact, "
        f"startNode(r)._id AS source_id, "
        f"endNode(r)._id AS target_id, "
        f"score "
        f"ORDER BY score DESC"
    )
    try:
        async with driver.session() as session:
            result = await session.run(
                query,
                query_embedding=query_embedding,
                group_id=group_id,
                per_type_limit=per_type_limit,
            )
            rows: list[dict] = []
            async for record in result:
                rows.append(
                    {
                        "_id": record["_id"],
                        "_relationTypeKey": record["_relationTypeKey"],
                        "_fact": record["_fact"],
                        "source_id": record["source_id"],
                        "target_id": record["target_id"],
                        "score": record["score"],
                        "matched_via": ["vector"],
                    }
                )
            return rows
    except Exception as exc:
        logger.warning(
            "Relation semantic search failed for type '%s': %s",
            relation_type_key, exc,
        )
        return []


async def semantic_search_relations(
    ontology_key: str,
    q: str,
    limit: int,
    group_id: str | None,
    k: int,
    driver: AsyncDriver,
) -> list[dict]:
    """Cross-type semantic search over relation facts (Phase 1 §7.1).

    Enumerates every semantic relation type visible through the active lens
    (``fact_template is not None``), fans out one parallel Cypher call per
    eligible type, then fuses the ranked lists with Reciprocal Rank Fusion.
    """
    loaded = await _load_schema(ontology_key, driver)

    provider = get_embedding_provider()
    if not provider:
        return []

    # Eligible relation types: visible in the scoped lens AND semantic.
    eligible_types = [
        rt for rt in loaded.scoped.relation_types.values()
        if rt.fact_template is not None
    ]
    if not eligible_types:
        return []

    query_embedding = await provider.embed(q)
    if query_embedding is None:
        return []

    effective_group = group_id or "default"
    per_type_limit = max(limit, 50)

    tasks = [
        _search_one_relation_type(
            driver,
            to_upper_snake_case(rt.key),
            rt.key,
            query_embedding,
            effective_group,
            per_type_limit,
        )
        for rt in eligible_types
    ]
    ranked_lists = await asyncio.gather(*tasks, return_exceptions=False)

    fused = _rrf_fuse(ranked_lists, k=k)
    return fused[:limit]


# ---------------------------------------------------------------------------
# Service Functions — Saved Query Semantic Search
# ---------------------------------------------------------------------------


async def search_saved_queries(
    ontology_key: str,
    query: str,
    limit: int,
    min_score: float | None,
    driver: AsyncDriver,
) -> list[dict]:
    """Semantic search over saved query descriptions.

    Returns results in the same shape as list_saved_queries, plus a score.
    """
    import json as _json

    provider = get_embedding_provider()
    if not provider:
        raise ValidationError(
            "Semantic search requires EMBEDDING_PROVIDER to be configured",
            details={"code": "FEATURE_DISABLED"},
        )

    query_embedding = await provider.embed(query)
    if query_embedding is None:
        raise ValidationError("Failed to generate embedding for search query")

    async with driver.session() as session:
        results = await repository.search_saved_queries(
            session, query_embedding, ontology_key, limit, min_score
        )

    # Deserialize parameters JSON for each result
    for r in results:
        params_raw = r.get("parameters", "[]")
        if isinstance(params_raw, str):
            params_list = _json.loads(params_raw)
        else:
            params_list = params_raw or []
        r["parameters"] = [
            {"name": p["name"], "description": p["description"], "dataType": p["dataType"]}
            for p in params_list
        ]

    return results
