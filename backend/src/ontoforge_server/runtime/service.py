from __future__ import annotations

import copy
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from ontoforge_server.config import settings
from ontoforge_server.core.ai import AgentConfig, SavedQueryConfig, SavedQueryParameter, StepConfig
from ontoforge_server.core.embedding import get_embedding_provider
from ontoforge_server.core.exceptions import ConflictError, NotFoundError, ValidationError
from ontoforge_server.core.schemas import (
    ExportEntityType,
    ExportOntology,
    ExportProperty,
    ExportRelationType,
)
from ontoforge_server.runtime.chunking import chunk_document
from ontoforge_server.runtime.embedding import build_text_repr
from ontoforge_server.runtime.schemas import (
    DocumentEditRequest,
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


async def _load_schema(ontology_key: str, store: Any) -> LoadedSchema:
    """Load the schema for the given ontology key from the store.

    Builds both full and scoped SchemaCache instances.
    """
    cached = _LOADED_SCHEMA_CACHE.get(ontology_key)
    if cached is not None:
        return cached

    schema = await store.get_full_schema(ontology_key)

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
    agent_rows = await store.get_ai_agent_configs(ontology_key)
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
    query_rows = await store.get_saved_queries(ontology_key)
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
                    # Legacy rows may still use step type "cypher" / field
                    # "cypher"; normalize on load.
                    type="oql" if s["type"] == "cypher" else s["type"],
                    oql=s.get("oql", s.get("cypher")),
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
    """Coerce a JSON value to the appropriate plain Python type.

    Temporal values become ``datetime.date`` / ``datetime.datetime`` — the
    persistence adapter converts them to its native types on write.
    """
    if value is None:
        return None

    if data_type == "string":
        return str(value)

    elif data_type == "document":
        # Large text content, interpreted as Markdown; stored as a plain string.
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
                return date.fromisoformat(value)
            except ValueError:
                raise ValueError(f"Expected ISO date for '{key}', got '{value}'")
        raise ValueError(f"Expected ISO date string for '{key}', got {type(value).__name__}")

    elif data_type == "datetime":
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value)
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
        properties=props,
    )


# ---------------------------------------------------------------------------
# Document Properties
# ---------------------------------------------------------------------------

_DOC_LENGTH_PREFIX = "_doc_"
_DOC_LENGTH_SUFFIX = "_length"


def _doc_length_key(property_key: str) -> str:
    """Internal entity property that stores a document property's character count."""
    return f"{_DOC_LENGTH_PREFIX}{property_key}{_DOC_LENGTH_SUFFIX}"


def _document_property_keys(property_defs: dict[str, PropertyDef]) -> set[str]:
    return {k for k, p in property_defs.items() if p.data_type == "document"}


def _stub_document_properties(
    entity: dict,
    property_defs: dict[str, PropertyDef],
    fields: list[str] | None = None,
) -> dict:
    """Replace document property values with ``{"document": true, "length": N}`` stubs.

    Internal ``_doc_{key}_length`` helper properties are consumed for the stub
    length and removed from the payload. Properties explicitly requested via
    the *fields* projection keep their raw value.
    """
    requested = set(fields) if fields is not None else set()

    lengths: dict[str, Any] = {}
    result: dict = {}
    for k, v in entity.items():
        if k.startswith(_DOC_LENGTH_PREFIX) and k.endswith(_DOC_LENGTH_SUFFIX):
            lengths[k[len(_DOC_LENGTH_PREFIX):-len(_DOC_LENGTH_SUFFIX)]] = v
            continue
        result[k] = v

    for key in _document_property_keys(property_defs):
        if key in requested:
            continue  # raw value explicitly requested via fields projection
        value = result.get(key)
        if value is None:
            continue
        length = lengths.get(key)
        if length is None:
            length = len(value) if isinstance(value, str) else 0
        result[key] = {"document": True, "length": length}

    return result


# ---------------------------------------------------------------------------
# Response Property Filtering
# ---------------------------------------------------------------------------


def _filter_entity_properties(
    entity: dict,
    scoped_et: EntityTypeDef,
    fields: list[str] | None = None,
) -> dict:
    """Filter entity properties to the scoped schema and stub document values."""
    filtered = {k: v for k, v in entity.items() if k.startswith("_") or k in scoped_et.properties}
    return _stub_document_properties(filtered, scoped_et.properties, fields)


def _filter_relation_properties(relation: dict, scoped_rt: RelationTypeDef) -> dict:
    """Filter relation properties to only those visible through the scoped schema."""
    return {k: v for k, v in relation.items() if k.startswith("_") or k in scoped_rt.properties or k in ("fromEntityId", "toEntityId", "direction")}


# ---------------------------------------------------------------------------
# Service Functions — Schema Introspection (from cache)
# ---------------------------------------------------------------------------


async def get_full_schema(ontology_key: str, store: Any) -> SchemaResponse:
    """Return the scoped schema for the given ontology."""
    loaded = await _load_schema(ontology_key, store)
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


async def list_entity_types(ontology_key: str, store: Any) -> list[ExportEntityType]:
    loaded = await _load_schema(ontology_key, store)
    return [
        _entity_type_def_to_export(et_def)
        for et_def in loaded.scoped.entity_types.values()
    ]


async def get_entity_type(ontology_key: str, key: str, store: Any) -> ExportEntityType:
    loaded = await _load_schema(ontology_key, store)
    et_def = loaded.scoped.entity_types.get(key)
    if not et_def:
        raise NotFoundError(f"Entity type '{key}' not found")
    return _entity_type_def_to_export(et_def)


async def list_relation_types(ontology_key: str, store: Any) -> list[ExportRelationType]:
    loaded = await _load_schema(ontology_key, store)
    return [
        _relation_type_def_to_export(rt_def)
        for rt_def in loaded.scoped.relation_types.values()
    ]


async def get_relation_type(ontology_key: str, key: str, store: Any) -> ExportRelationType:
    loaded = await _load_schema(ontology_key, store)
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
    store: Any,
) -> dict:
    """Create a new entity instance. Validate against scoped properties, apply defaults from full schema."""
    loaded = await _load_schema(ontology_key, store)
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

    # Document properties: store character counts alongside the values
    doc_keys = _document_property_keys(full_et.properties) if full_et else set()
    doc_values = {k: v for k, v in coerced.items() if k in doc_keys}
    for k, v in doc_values.items():
        if v is not None:
            coerced[_doc_length_key(k)] = len(v)

    embedding = None
    provider = get_embedding_provider()
    if provider and full_et:
        store.validate_vector_indexed_properties(
            entity_type_key, coerced,
            [k for k in full_et.properties if k not in doc_keys],
        )
        text = build_text_repr(entity_type_key, coerced, full_et.properties)
        embedding = await provider.embed(text)

    entity = await store.create_entity(
        entity_type_key, entity_id, coerced, embedding=embedding
    )

    # Chunk + embed document properties (no-op without embedding provider)
    await sync_document_chunks(store, entity_type_key, entity_id, doc_values)

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
    store: Any,
    fields: list[str] | None = None,
) -> dict:
    loaded = await _load_schema(ontology_key, store)
    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    string_props = [
        p.key for p in scoped_et.properties.values() if p.data_type == "string"
    ]

    sort_field = _validate_sort_field(sort, scoped_et.properties)

    items, total = await store.list_entities(
        entity_type_key, scoped_et.properties, filters,
        q, string_props, sort_field, order, limit, offset,
    )

    # Filter response properties to scoped schema
    items = [_filter_entity_properties(e, scoped_et, fields) for e in items]

    if fields is not None:
        items = [_apply_field_projection(e, fields, _ENTITY_ALWAYS_FIELDS) for e in items]

    return PaginatedResponse(
        items=items, total=total, limit=limit, offset=offset
    )


async def get_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    store: Any,
    fields: list[str] | None = None,
) -> dict:
    loaded = await _load_schema(ontology_key, store)
    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    entity = await store.get_entity(entity_type_key, entity_id)
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")

    entity = _filter_entity_properties(entity, scoped_et, fields)
    return _apply_field_projection(entity, fields, _ENTITY_ALWAYS_FIELDS)


async def update_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    body: dict,
    store: Any,
) -> dict:
    """Partial update. Validate against scoped properties. NO default re-application."""
    loaded = await _load_schema(ontology_key, store)
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
        return await get_entity(ontology_key, entity_type_key, entity_id, store)

    full_et = loaded.full.entity_types.get(entity_type_key)

    # Document properties: maintain stored lengths for changed values
    doc_keys = _document_property_keys(full_et.properties) if full_et else set()
    doc_changes = {k: v for k, v in coerced.items() if k in doc_keys}
    for k, v in doc_changes.items():
        if v is not None:
            set_props[_doc_length_key(k)] = len(v)
        else:
            remove_props.append(_doc_length_key(k))

    # Re-embed if any string properties changed (use full schema for embedding)
    embedding = _NOT_SET
    provider = get_embedding_provider()
    if provider and full_et:
        has_string_changes = any(
            k in full_et.properties and full_et.properties[k].data_type == "string"
            for k in coerced
        )
        if has_string_changes:
            current = await store.get_entity(entity_type_key, entity_id)
            if current:
                merged = {k: v for k, v in current.items() if not k.startswith("_")}
                merged.update({k: v for k, v in set_props.items()})
                for k in remove_props:
                    merged.pop(k, None)
                store.validate_vector_indexed_properties(
                    entity_type_key, merged,
                    [k for k in full_et.properties if k not in doc_keys],
                    entity_id=entity_id,
                )
                text = build_text_repr(entity_type_key, merged, full_et.properties)
                embedding = await provider.embed(text)

    entity = await store.update_entity(
        entity_type_key, entity_id, set_props, remove_props,
        embedding=embedding if embedding is not _NOT_SET else None,
        has_embedding_update=embedding is not _NOT_SET,
    )
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")

    # Re-chunk changed document properties only (no-op without provider)
    await sync_document_chunks(store, entity_type_key, entity_id, doc_changes)

    return _filter_entity_properties(entity, scoped_et)


async def delete_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    store: Any,
) -> None:
    loaded = await _load_schema(ontology_key, store)
    if entity_type_key not in loaded.scoped.entity_types:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    deleted = await store.delete_entity(entity_type_key, entity_id)
    if not deleted:
        raise NotFoundError(f"Entity '{entity_id}' not found")


# ---------------------------------------------------------------------------
# Service Functions — Document Properties
# ---------------------------------------------------------------------------


async def sync_document_chunks(
    store: Any,
    entity_type_key: str,
    entity_id: str,
    doc_values: dict[str, str | None],
) -> None:
    """Replace the chunk nodes for the given document property values.

    For each property: delete its existing chunks, then (for non-null values)
    re-chunk, embed, and write new chunk nodes. No-op when no embedding
    provider is configured.
    """
    if not doc_values:
        return
    provider = get_embedding_provider()
    if not provider:
        return

    for property_key, value in doc_values.items():
        # Reuse embeddings of chunks whose text is unchanged — after a partial
        # edit the chunker re-synchronizes on the same boundaries, so most
        # chunks keep their exact text (at shifted offsets) and only the
        # chunks overlapping the edit need a fresh embedding.
        reusable = await store.get_chunk_embeddings_for_entity_property(
            entity_id, property_key
        )
        await store.delete_chunks_for_entity_property(entity_id, property_key)
        if not value:
            continue

        chunks = chunk_document(
            value, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP
        )
        rows = []
        for index, chunk in enumerate(chunks):
            row = {
                "_id": str(uuid4()),
                "_entityId": entity_id,
                "_entityTypeKey": entity_type_key,
                "_propertyKey": property_key,
                "_index": index,
                "startChar": chunk.start_char,
                "charLength": chunk.char_length,
                "text": chunk.text,
            }
            chunk_embedding = reusable.get(chunk.text)
            if chunk_embedding is None:
                chunk_embedding = await provider.embed(chunk.text)
            if chunk_embedding is not None:
                row["_embedding"] = chunk_embedding
            rows.append(row)

        await store.create_document_chunks(
            entity_id, entity_type_key, property_key, rows
        )


async def _load_document_value(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    store: Any,
) -> str:
    """Resolve a scoped document property and return its current value.

    Raises NotFoundError for unknown/out-of-scope types or properties,
    non-document properties, and missing entities. An unset value reads as "".
    """
    loaded = await _load_schema(ontology_key, store)
    scoped_et = loaded.scoped.entity_types.get(entity_type_key)
    if not scoped_et:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    prop_def = scoped_et.properties.get(property_key)
    if not prop_def or prop_def.data_type != "document":
        raise NotFoundError(
            f"Document property '{property_key}' not found on entity type '{entity_type_key}'"
        )

    entity = await store.get_entity(entity_type_key, entity_id)
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")

    value = entity.get(property_key)
    return value if isinstance(value, str) else ""


async def get_document(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    offset: int,
    limit: int | None,
    store: Any,
) -> dict:
    """Read (a slice of) a document property value.

    ``offset``/``limit`` are character-based; without them the full document
    is returned.
    """
    value = await _load_document_value(
        ontology_key, entity_type_key, entity_id, property_key, store
    )

    if limit is None:
        content = value[offset:]
    else:
        content = value[offset:offset + limit]

    return {
        "propertyKey": property_key,
        "content": content,
        "offset": offset,
        "length": len(content),
        "totalLength": len(value),
    }


# Characters returned around an edit so callers can verify without re-reading.
_EDIT_CONTEXT_CHARS = 200


def _apply_str_replace(value: str, body: DocumentEditRequest) -> tuple[str, int, int, int]:
    """Returns (new_value, edit_offset, edit_length, replacements)."""
    old, new = body.old_string, body.new_string
    if not old:
        raise ValidationError("oldString must be a non-empty string")
    if new is None:
        raise ValidationError("newString is required for str_replace")
    if old == new:
        raise ValidationError("newString must differ from oldString")

    count = value.count(old)
    if count == 0:
        raise ValidationError("oldString not found in document")
    if count > 1 and not body.replace_all:
        raise ValidationError(
            f"oldString matches {count} times — provide a longer, unique string "
            "or set replaceAll to true"
        )

    first = value.index(old)
    if body.replace_all:
        return value.replace(old, new), first, len(new), count
    return value[:first] + new + value[first + len(old):], first, len(new), 1


def _apply_replace_range(value: str, body: DocumentEditRequest) -> tuple[str, int, int, int]:
    """Returns (new_value, edit_offset, edit_length, replacements)."""
    offset, length, content = body.offset, body.length, body.content
    if offset is None or length is None or content is None:
        raise ValidationError(
            "replace_range requires offset, length, and content"
        )
    if offset < 0 or length < 0:
        raise ValidationError("offset and length must be >= 0")
    if offset > len(value):
        raise ValidationError(
            f"offset {offset} is beyond the document end ({len(value)} chars)"
        )
    if offset + length > len(value):
        raise ValidationError(
            f"range [{offset}, {offset + length}) exceeds the document end "
            f"({len(value)} chars)"
        )
    if body.expect is not None and value[offset:offset + length] != body.expect:
        raise ConflictError(
            f"expect mismatch at [{offset}, {offset + length}) — the document "
            "changed since it was read; re-read before editing"
        )
    return value[:offset] + content + value[offset + length:], offset, len(content), 1


async def edit_document(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    body: DocumentEditRequest,
    store: Any,
) -> dict:
    """Apply one partial-write operation to a document property.

    ``str_replace`` swaps an exact, unique string (or all occurrences with
    ``replaceAll``); ``replace_range`` overwrites the character range
    ``[offset, offset+length)`` with ``content`` (insert with length 0, append
    at ``offset == totalLength``). The changed value is persisted whole and the
    property's chunks are re-synced — unchanged chunk texts keep their
    embeddings, so only chunks overlapping the edit are re-embedded.
    """
    value = await _load_document_value(
        ontology_key, entity_type_key, entity_id, property_key, store
    )

    if body.op == "str_replace":
        new_value, offset, length, replacements = _apply_str_replace(value, body)
    else:
        new_value, offset, length, replacements = _apply_replace_range(value, body)

    set_props = {
        property_key: new_value,
        _doc_length_key(property_key): len(new_value),
    }
    entity = await store.update_entity(entity_type_key, entity_id, set_props, [])
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")

    await sync_document_chunks(
        store, entity_type_key, entity_id, {property_key: new_value}
    )

    context_start = max(0, offset - _EDIT_CONTEXT_CHARS)
    context_end = min(len(new_value), offset + length + _EDIT_CONTEXT_CHARS)
    return {
        "propertyKey": property_key,
        "totalLength": len(new_value),
        "editedRange": {"offset": offset, "length": length},
        "replacements": replacements,
        "context": new_value[context_start:context_end],
        "contextOffset": context_start,
    }


# ---------------------------------------------------------------------------
# Service Functions — Relation Instance CRUD
# ---------------------------------------------------------------------------


async def create_relation(
    ontology_key: str,
    relation_type_key: str,
    body: RelationInstanceCreate,
    store: Any,
) -> dict:
    loaded = await _load_schema(ontology_key, store)
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
    from_entity = await store.get_entity_by_id(from_entity_id)
    if not from_entity:
        errors["fromEntityId"] = f"Source entity '{from_entity_id}' not found"
    elif from_entity["_entityTypeKey"] != full_rt_for_validation.from_entity_type_key:
        errors["fromEntityId"] = (
            f"Source entity type mismatch: expected '{full_rt_for_validation.from_entity_type_key}', "
            f"got '{from_entity['_entityTypeKey']}'"
        )

    to_entity = await store.get_entity_by_id(to_entity_id)
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

    relation = await store.create_relation(
        relation_type_key, relation_id, from_entity_id, to_entity_id, coerced,
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
    store: Any,
) -> PaginatedResponse:
    loaded = await _load_schema(ontology_key, store)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    sort_field = _validate_sort_field(sort, scoped_rt.properties)

    items, total = await store.list_relations(
        relation_type_key, scoped_rt.properties, filters,
        from_entity_id, to_entity_id, sort_field, order, limit, offset,
    )

    items = [_filter_relation_properties(r, scoped_rt) for r in items]

    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


async def get_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    store: Any,
) -> dict:
    loaded = await _load_schema(ontology_key, store)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    relation = await store.get_relation(relation_type_key, relation_id)
    if not relation:
        raise NotFoundError(f"Relation '{relation_id}' not found")
    return _filter_relation_properties(relation, scoped_rt)


async def update_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    body: dict,
    store: Any,
) -> dict:
    loaded = await _load_schema(ontology_key, store)
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
        return await get_relation(ontology_key, relation_type_key, relation_id, store)

    relation = await store.update_relation(
        relation_type_key, relation_id, set_props, remove_props
    )
    if not relation:
        raise NotFoundError(f"Relation '{relation_id}' not found")
    return _filter_relation_properties(relation, scoped_rt)


async def delete_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    store: Any,
) -> None:
    loaded = await _load_schema(ontology_key, store)
    scoped_rt = loaded.scoped.relation_types.get(relation_type_key)
    if not scoped_rt:
        raise NotFoundError(f"Relation type '{relation_type_key}' not found")

    deleted = await store.delete_relation(relation_type_key, relation_id)
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
    store: Any,
    fields: list[str] | None = None,
    relation_fields: list[str] | None = None,
) -> NeighborhoodResponse:
    loaded = await _load_schema(ontology_key, store)
    if entity_type_key not in loaded.scoped.entity_types:
        raise NotFoundError(f"Entity type '{entity_type_key}' not found")

    entity = await store.get_entity(entity_type_key, entity_id)
    if not entity:
        raise NotFoundError(f"Entity '{entity_id}' not found")

    neighbors = await store.get_neighbors(
        entity_id, direction, relation_type_key, limit
    )

    # Filter neighbors by scoped relation types
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
                n["entity"] = _filter_entity_properties(n["entity"], loaded.scoped.entity_types[neighbor_et_key], fields)
            elif neighbor_et_key and neighbor_et_key in loaded.full.entity_types:
                # Type not in scope — still stub document values (never inline)
                n["entity"] = _stub_document_properties(
                    n["entity"], loaded.full.entity_types[neighbor_et_key].properties, fields
                )
            filtered_neighbors.append(n)
        elif not rt_key:
            filtered_neighbors.append(n)

    # Filter center entity
    scoped_et = loaded.scoped.entity_types[entity_type_key]
    entity = _filter_entity_properties(entity, scoped_et, fields)

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


_SEARCH_IN_VALUES = ("entities", "documents", "all")
_RRF_K = 60
_SNIPPET_CHARS = 200


async def semantic_search(
    ontology_key: str,
    query: str,
    entity_type_key: str | None,
    limit: int,
    min_score: float | None,
    store: Any,
    filters: dict[str, str] | None = None,
    fields: list[str] | None = None,
    search_in: str = "all",
    snippets: bool = True,
) -> dict:
    loaded = await _load_schema(ontology_key, store)

    provider = get_embedding_provider()
    if not provider:
        raise ValidationError(
            "Semantic search requires EMBEDDING_PROVIDER to be configured",
            details={"code": "FEATURE_DISABLED"},
        )

    if search_in not in _SEARCH_IN_VALUES:
        raise ValidationError(
            f"Invalid searchIn value: '{search_in}'. "
            f"Must be one of: {', '.join(_SEARCH_IN_VALUES)}",
            details={"fields": {"searchIn": f"Invalid value '{search_in}'"}},
        )

    filters = filters or {}

    scoped_et = None
    if entity_type_key is not None:
        scoped_et = loaded.scoped.entity_types.get(entity_type_key)
        if not scoped_et:
            raise NotFoundError(f"Entity type '{entity_type_key}' not found")
    elif filters:
        raise ValidationError(
            "Property filters require 'type' — filters are defined per entity type",
            details={"fields": {k: "Requires 'type'" for k in filters}},
        )

    # Reject __contains — not supported by in-index WHERE (SEARCH clause).
    # Use the entity list endpoint for substring filtering.
    for filter_key in filters:
        if filter_key.endswith("__contains"):
            raise ValidationError(
                "The '__contains' filter is not supported on semantic search. "
                "Use exact match or range operators (=, __gt, __gte, __lt, __lte).",
                details={"fields": {filter_key: "Not supported on semantic search"}},
            )

    query_embedding = await provider.embed(query)
    if query_embedding is None:
        raise ValidationError("Failed to generate embedding for search query")

    entity_ranking: list[dict] = []
    if search_in in ("entities", "all"):
        if entity_type_key is None:
            entity_ranking = await _semantic_search_all_types(
                loaded, query_embedding, limit, min_score, store, fields
            )
        else:
            entity_ranking = await _semantic_search_single_type(
                entity_type_key, scoped_et, query_embedding,
                limit, min_score, filters, store, fields,
            )

    document_ranking: list[dict] = []
    if search_in in ("documents", "all"):
        document_ranking = await _semantic_search_documents(
            loaded, entity_type_key, query_embedding, limit, min_score,
            filters, snippets, store, fields,
        )

    if search_in == "entities":
        results = [
            {
                "entity": r["entity"],
                "score": r["score"],
                "matchedVia": {"source": "entity", "similarity": r["score"]},
            }
            for r in entity_ranking
        ]
    elif search_in == "documents":
        results = document_ranking
    else:
        results = _rrf_fuse(entity_ranking, document_ranking, limit)

    if fields is not None:
        always = (
            _ENTITY_ALWAYS_FIELDS if entity_type_key is not None
            else _ENTITY_NEIGHBOR_ALWAYS_FIELDS
        )
        for r in results:
            r["entity"] = _apply_field_projection(r["entity"], fields, always)

    return {
        "results": results,
        "query": query,
        "total": len(results),
    }


async def _semantic_search_single_type(
    entity_type_key: str,
    scoped_et: EntityTypeDef,
    query_embedding: list[float],
    limit: int,
    min_score: float | None,
    filters: dict[str, str],
    store: Any,
    fields: list[str] | None,
) -> list[dict]:
    """Rank entities of a single type via its per-type vector index."""
    results = await store.semantic_search(
        entity_type_key,
        scoped_et.properties,
        query_embedding,
        limit,
        min_score,
        filters=filters if filters else None,
    )

    # Filter result properties to scoped schema
    for r in results:
        r["entity"] = _filter_entity_properties(r["entity"], scoped_et, fields)
    return results


async def _semantic_search_all_types(
    loaded: LoadedSchema,
    query_embedding: list[float],
    limit: int,
    min_score: float | None,
    store: Any,
    fields: list[str] | None = None,
) -> list[dict]:
    """Search the shared cross-type entity vector index across all scoped entity types.

    The SEARCH clause's in-index WHERE cannot express membership in a set of
    type keys, so scoped ontologies over-fetch and filter to scoped types in
    Python. The candidate pool is capped, so a heavily restricted scope may
    return fewer than `limit` results even when more matches exist.
    """
    scoped_type_keys = set(loaded.scoped.entity_types.keys())
    if not scoped_type_keys:
        return []

    is_restricted = scoped_type_keys != set(loaded.full.entity_types.keys())
    fetch_limit = min(limit * 5, 500) if is_restricted else limit

    raw = await store.semantic_search_all(query_embedding, fetch_limit, min_score)

    results: list[dict] = []
    for r in raw:
        scoped_et = loaded.scoped.entity_types.get(r["entity"].get("_entityTypeKey"))
        if scoped_et is None:
            continue
        r["entity"] = _filter_entity_properties(r["entity"], scoped_et, fields)
        results.append(r)
        if len(results) >= limit:
            break
    return results


def _entity_matches_filters(
    entity: dict,
    filters: dict[str, str],
    property_defs: dict[str, PropertyDef],
    type_key: str,
) -> bool:
    """Evaluate list-endpoint-style property filters against an entity in Python.

    Used for document-chunk hits, where filters cannot be applied in-index.
    ``__contains`` is rejected upstream; supported operators mirror the
    in-index ones (=, __gt, __gte, __lt, __lte).
    """
    from operator import eq, ge, gt, le, lt

    OPERATORS = {None: eq, "gt": gt, "gte": ge, "lt": lt, "lte": le}

    for filter_expr, raw_value in filters.items():
        if "__" in filter_expr:
            prop_key, op_name = filter_expr.rsplit("__", 1)
        else:
            prop_key, op_name = filter_expr, None

        prop_def = property_defs.get(prop_key)
        if not prop_def:
            raise ValidationError(
                f"Unknown filter property: '{prop_key}'",
                details={"fields": {prop_key: f"Not defined in type '{type_key}'"}},
            )
        if op_name not in OPERATORS:
            raise ValidationError(
                f"Unknown filter operator: '{op_name}'",
                details={"fields": {filter_expr: f"Unsupported operator '{op_name}'"}},
            )

        try:
            expected = coerce_value(raw_value, prop_def.data_type, prop_key)
        except ValueError as e:
            raise ValidationError(
                f"Invalid filter value for '{prop_key}'",
                details={"fields": {prop_key: str(e)}},
            )
        # coerce_value returns plain datetime.date/datetime.datetime, matching
        # the native temporals the adapter returns on read — compare directly.

        actual = entity.get(prop_key)
        if actual is None:
            return False
        try:
            if not OPERATORS[op_name](actual, expected):
                return False
        except TypeError:
            return False

    return True


async def _semantic_search_documents(
    loaded: LoadedSchema,
    entity_type_key: str | None,
    query_embedding: list[float],
    limit: int,
    min_score: float | None,
    filters: dict[str, str],
    snippets: bool,
    store: Any,
    fields: list[str] | None,
) -> list[dict]:
    """Rank entities by their best-matching document chunk.

    Queries each in-scope (entity type, document property) virtual index,
    merges chunk hits by raw score, and dedupes to parent entities — the best
    chunk per entity wins and provides ``matchedVia``.
    """
    if entity_type_key is not None:
        type_keys = [entity_type_key]
    else:
        type_keys = list(loaded.scoped.entity_types)

    pairs: list[tuple[str, str]] = []
    for tk in type_keys:
        et_def = loaded.scoped.entity_types.get(tk)
        if not et_def:
            continue
        for pk in _document_property_keys(et_def.properties):
            pairs.append((tk, pk))

    if not pairs:
        return []

    chunk_hits: list[dict] = []
    for tk, pk in pairs:
        hits = await store.search_document_chunks(tk, pk, query_embedding, limit)
        chunk_hits.extend(hits)

    # Dedupe to parent entities: best chunk per entity wins
    best_per_entity: dict[str, dict] = {}
    for hit in chunk_hits:
        if min_score is not None and hit["score"] < min_score:
            continue
        parent_id = hit["chunk"].get("_entityId")
        if not parent_id:
            continue
        current = best_per_entity.get(parent_id)
        if current is None or hit["score"] > current["score"]:
            best_per_entity[parent_id] = hit

    if not best_per_entity:
        return []

    ranked = sorted(best_per_entity.values(), key=lambda h: h["score"], reverse=True)

    entities = await store.get_entities_by_ids(
        [h["chunk"]["_entityId"] for h in ranked]
    )

    results: list[dict] = []
    for hit in ranked:
        chunk = hit["chunk"]
        entity = entities.get(chunk["_entityId"])
        if entity is None:
            continue
        et_key = entity.get("_entityTypeKey")
        scoped_et = loaded.scoped.entity_types.get(et_key)
        if scoped_et is None:
            continue
        if filters and not _entity_matches_filters(
            entity, filters, scoped_et.properties, et_key
        ):
            continue

        matched_via = {
            "source": "document",
            "propertyKey": chunk["_propertyKey"],
            "charOffset": chunk["startChar"],
            "charLength": chunk["charLength"],
            "similarity": hit["score"],
        }
        if snippets:
            matched_via["snippet"] = chunk["text"][:_SNIPPET_CHARS]

        results.append({
            "entity": _filter_entity_properties(entity, scoped_et, fields),
            "score": hit["score"],
            "matchedVia": matched_via,
        })
        if len(results) >= limit:
            break

    return results


def _rrf_fuse(
    entity_ranking: list[dict],
    document_ranking: list[dict],
    limit: int,
) -> list[dict]:
    """Reciprocal Rank Fusion over entity and document rankings.

    ``score = Σ 1/(K + rank)`` with K=60. Document ``matchedVia`` wins when an
    entity appears in both rankings (it carries retrieval coordinates).
    """
    fused: dict[str, dict] = {}

    for rank, r in enumerate(entity_ranking, start=1):
        eid = r["entity"].get("_id")
        item = fused.setdefault(
            eid,
            {"entity": r["entity"], "score": 0.0, "matchedVia": None},
        )
        item["score"] += 1.0 / (_RRF_K + rank)
        if item["matchedVia"] is None:
            item["matchedVia"] = {"source": "entity", "similarity": r["score"]}

    for rank, r in enumerate(document_ranking, start=1):
        eid = r["entity"].get("_id")
        item = fused.setdefault(
            eid,
            {"entity": r["entity"], "score": 0.0, "matchedVia": None},
        )
        item["score"] += 1.0 / (_RRF_K + rank)
        item["matchedVia"] = r["matchedVia"]

    return sorted(fused.values(), key=lambda x: x["score"], reverse=True)[:limit]


# ---------------------------------------------------------------------------
# Service Functions — OQL Query
# ---------------------------------------------------------------------------


async def execute_query(
    ontology_key: str,
    query: str,
    store: Any,
) -> dict:
    """Validate, compile, and execute a read-only OQL query.

    Returns ``{"columns": [...], "results": [...]}`` with properties
    filtered to the scoped ontology schema.
    """
    from ontoforge_server.runtime.cypher import (
        SYSTEM_PROPERTIES,
        get_return_variables,
        validate_and_rewrite,
    )

    loaded = await _load_schema(ontology_key, store)
    scoped = loaded.scoped

    # Map variables → schema keys before compiling (uses original type keys).
    var_map = get_return_variables(query, scoped)

    # Validate and compile to the Neo4j dialect
    # (snake_case → PascalCase / UPPER_SNAKE_CASE).
    rewritten = validate_and_rewrite(query, scoped)

    columns, rows = await store.execute_cypher_read(rewritten)

    # Post-process: filter out-of-scope properties and stub document values.
    _postprocess_cypher_rows(rows, var_map, scoped)

    return {"columns": columns, "results": rows}


def _postprocess_cypher_rows(
    rows: list[dict],
    var_map: dict[str, str | None],
    scoped: SchemaCache,
) -> None:
    """Filter out-of-scope properties and stub document values (in place).

    Node/relationship dicts are stripped to scoped properties with document
    values stubbed. Scalar columns of the form ``var.property`` that reference
    a document property are stubbed as well.
    """
    for row in rows:
        for col, value in row.items():
            if isinstance(value, dict):
                type_key = _resolve_type_key_for_value(col, value, var_map, scoped)
                if type_key is None:
                    continue
                _strip_out_of_scope_props(value, type_key, scoped)
            elif isinstance(value, str) and "." in col:
                # Scalar projection like `RETURN p.bio` — stub document values
                var, _, prop = col.partition(".")
                type_key = var_map.get(var.strip())
                if type_key is None:
                    continue
                et_def = scoped.entity_types.get(type_key)
                if et_def is None:
                    continue
                prop_def = et_def.properties.get(prop.strip())
                if prop_def is not None and prop_def.data_type == "document":
                    row[col] = {"document": True, "length": len(value)}


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
    """Remove properties not in the scoped schema and stub documents (in place)."""
    from ontoforge_server.runtime.cypher import SYSTEM_PROPERTIES

    if type_key in schema.entity_types:
        property_defs = schema.entity_types[type_key].properties
        allowed = set(property_defs) | SYSTEM_PROPERTIES
        # Stub document values before the helper `_doc_*_length` keys are stripped
        stubbed = _stub_document_properties(value, property_defs)
        value.clear()
        value.update(stubbed)
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
    store: Any,
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

    loaded = await _load_schema(ontology_key, store)
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

        if step.type == "oql":
            assert step.oql is not None  # enforced by modeling validation
            # Merge user params + resolved bindings for query parameters
            query_params = {**coerced_params, **resolved_bindings}

            var_map = get_return_variables(step.oql, scoped)
            rewritten = validate_and_rewrite(step.oql, scoped)

            columns, rows = await store.execute_cypher_read(
                rewritten, params=query_params
            )

            # Post-process: strip out-of-scope properties + stub documents
            _postprocess_cypher_rows(rows, var_map, scoped)

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
                store,
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
# Service Functions — Saved Query Semantic Search
# ---------------------------------------------------------------------------


async def search_saved_queries(
    ontology_key: str,
    query: str,
    limit: int,
    min_score: float | None,
    store: Any,
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

    results = await store.search_saved_queries(
        query_embedding, ontology_key, limit, min_score
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
