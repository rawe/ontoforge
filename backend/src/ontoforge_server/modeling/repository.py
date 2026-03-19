from datetime import datetime, timezone

from neo4j import AsyncSession
from neo4j.time import DateTime as Neo4jDateTime


def _convert_neo4j_types(data: dict) -> dict:
    """Convert Neo4j-specific types (DateTime) to Python stdlib types."""
    result = {}
    for key, value in data.items():
        if isinstance(value, Neo4jDateTime):
            result[key] = value.to_native().replace(tzinfo=timezone.utc) if value.tzinfo else datetime(
                value.year, value.month, value.day,
                value.hour, value.minute, value.second,
                value.nanosecond // 1000,
                tzinfo=timezone.utc,
            )
        else:
            result[key] = value
    return result


# --- Ontology ---


async def create_ontology(
    session: AsyncSession,
    ontology_id: str,
    key: str,
    name: str,
    description: str | None,
) -> dict:
    result = await session.run(
        """
        CREATE (o:Ontology {
            ontologyId: $ontology_id,
            key: $key,
            name: $name,
            description: $description,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        RETURN o {.*} AS ontology
        """,
        ontology_id=ontology_id,
        key=key,
        name=name,
        description=description,
    )
    record = await result.single()
    return _convert_neo4j_types(record["ontology"])


async def list_ontologies(session: AsyncSession) -> list[dict]:
    result = await session.run(
        "MATCH (o:Ontology) RETURN o {.*} AS ontology ORDER BY o.name"
    )
    return [_convert_neo4j_types(record["ontology"]) async for record in result]


async def get_ontology(session: AsyncSession, ontology_id: str) -> dict | None:
    result = await session.run(
        "MATCH (o:Ontology {ontologyId: $ontology_id}) RETURN o {.*} AS ontology",
        ontology_id=ontology_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["ontology"]) if record else None


async def get_ontology_by_name(session: AsyncSession, name: str) -> dict | None:
    result = await session.run(
        "MATCH (o:Ontology {name: $name}) RETURN o {.*} AS ontology",
        name=name,
    )
    record = await result.single()
    return _convert_neo4j_types(record["ontology"]) if record else None


async def get_ontology_by_key(session: AsyncSession, key: str) -> dict | None:
    result = await session.run(
        "MATCH (o:Ontology {key: $key}) RETURN o {.*} AS ontology",
        key=key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["ontology"]) if record else None


async def update_ontology(
    session: AsyncSession,
    ontology_id: str,
    name: str | None,
    description: str | None,
) -> dict | None:
    set_clauses = ["o.updatedAt = datetime()"]
    params: dict = {"ontology_id": ontology_id}
    if name is not None:
        set_clauses.append("o.name = $name")
        params["name"] = name
    if description is not None:
        set_clauses.append("o.description = $description")
        params["description"] = description

    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})
        SET {', '.join(set_clauses)}
        RETURN o {{.*}} AS ontology
        """,
        **params,
    )
    record = await result.single()
    return _convert_neo4j_types(record["ontology"]) if record else None


async def delete_ontology(session: AsyncSession, ontology_id: str) -> bool:
    """Delete ontology and cascade to agent configs."""
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})
        OPTIONAL MATCH (o)-[:HAS_AI_AGENT]->(ac:AiAgentConfig)
        DETACH DELETE o, ac
        RETURN count(o) AS deleted
        """,
        ontology_id=ontology_id,
    )
    record = await result.single()
    return record["deleted"] > 0


# --- Entity Type (Global) ---


async def create_entity_type(
    session: AsyncSession,
    entity_type_id: str,
    key: str,
    display_name: str,
    description: str | None,
) -> dict:
    result = await session.run(
        """
        CREATE (et:EntityType {
            entityTypeId: $entity_type_id,
            key: $key,
            displayName: $display_name,
            description: $description,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        RETURN et {.*} AS entity_type
        """,
        entity_type_id=entity_type_id,
        key=key,
        display_name=display_name,
        description=description,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"])


async def list_entity_types(session: AsyncSession) -> list[dict]:
    result = await session.run(
        "MATCH (et:EntityType) RETURN et {.*} AS entity_type ORDER BY et.key"
    )
    return [_convert_neo4j_types(record["entity_type"]) async for record in result]


async def get_entity_type(session: AsyncSession, entity_type_id: str) -> dict | None:
    result = await session.run(
        "MATCH (et:EntityType {entityTypeId: $entity_type_id}) RETURN et {.*} AS entity_type",
        entity_type_id=entity_type_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"]) if record else None


async def get_entity_type_by_key(session: AsyncSession, key: str) -> dict | None:
    result = await session.run(
        "MATCH (et:EntityType {key: $key}) RETURN et {.*} AS entity_type",
        key=key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"]) if record else None


async def update_entity_type(
    session: AsyncSession,
    entity_type_id: str,
    display_name: str | None,
    description: str | None,
) -> dict | None:
    set_clauses = ["et.updatedAt = datetime()"]
    params: dict = {"entity_type_id": entity_type_id}
    if display_name is not None:
        set_clauses.append("et.displayName = $display_name")
        params["display_name"] = display_name
    if description is not None:
        set_clauses.append("et.description = $description")
        params["description"] = description

    result = await session.run(
        f"""
        MATCH (et:EntityType {{entityTypeId: $entity_type_id}})
        SET {', '.join(set_clauses)}
        RETURN et {{.*}} AS entity_type
        """,
        **params,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"]) if record else None


async def delete_entity_type(session: AsyncSession, entity_type_id: str) -> bool:
    """Delete entity type and cascade to its properties only."""
    result = await session.run(
        """
        MATCH (et:EntityType {entityTypeId: $entity_type_id})
        OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        DETACH DELETE et, p
        RETURN count(et) AS deleted
        """,
        entity_type_id=entity_type_id,
    )
    record = await result.single()
    return record["deleted"] > 0


async def is_entity_type_referenced(
    session: AsyncSession, entity_type_id: str
) -> bool:
    result = await session.run(
        """
        MATCH (rt:RelationType)-[:RELATES_FROM|RELATES_TO]->(et:EntityType {entityTypeId: $entity_type_id})
        RETURN count(rt) > 0 AS referenced
        """,
        entity_type_id=entity_type_id,
    )
    record = await result.single()
    return record["referenced"]


# --- Relation Type (Global) ---


async def create_relation_type(
    session: AsyncSession,
    relation_type_id: str,
    key: str,
    display_name: str,
    description: str | None,
    source_entity_type_key: str,
    target_entity_type_key: str,
) -> dict:
    result = await session.run(
        """
        MATCH (source:EntityType {key: $source_entity_type_key})
        MATCH (target:EntityType {key: $target_entity_type_key})
        CREATE (rt:RelationType {
            relationTypeId: $relation_type_id,
            key: $key,
            displayName: $display_name,
            description: $description,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        CREATE (rt)-[:RELATES_FROM]->(source)
        CREATE (rt)-[:RELATES_TO]->(target)
        RETURN rt {.*,
            sourceEntityTypeKey: source.key,
            targetEntityTypeKey: target.key
        } AS relation_type
        """,
        relation_type_id=relation_type_id,
        key=key,
        display_name=display_name,
        description=description,
        source_entity_type_key=source_entity_type_key,
        target_entity_type_key=target_entity_type_key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"])


async def list_relation_types(session: AsyncSession) -> list[dict]:
    result = await session.run(
        """
        MATCH (rt:RelationType)
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        RETURN rt {.*,
            sourceEntityTypeKey: source.key,
            targetEntityTypeKey: target.key
        } AS relation_type ORDER BY rt.key
        """
    )
    return [_convert_neo4j_types(record["relation_type"]) async for record in result]


async def get_relation_type(
    session: AsyncSession, relation_type_id: str
) -> dict | None:
    result = await session.run(
        """
        MATCH (rt:RelationType {relationTypeId: $relation_type_id})
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        RETURN rt {.*,
            sourceEntityTypeKey: source.key,
            targetEntityTypeKey: target.key
        } AS relation_type
        """,
        relation_type_id=relation_type_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"]) if record else None


async def get_relation_type_by_key(
    session: AsyncSession, key: str
) -> dict | None:
    result = await session.run(
        """
        MATCH (rt:RelationType {key: $key})
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        RETURN rt {.*,
            sourceEntityTypeKey: source.key,
            targetEntityTypeKey: target.key
        } AS relation_type
        """,
        key=key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"]) if record else None


async def update_relation_type(
    session: AsyncSession,
    relation_type_id: str,
    display_name: str | None,
    description: str | None,
) -> dict | None:
    set_clauses = ["rt.updatedAt = datetime()"]
    params: dict = {"relation_type_id": relation_type_id}
    if display_name is not None:
        set_clauses.append("rt.displayName = $display_name")
        params["display_name"] = display_name
    if description is not None:
        set_clauses.append("rt.description = $description")
        params["description"] = description

    result = await session.run(
        f"""
        MATCH (rt:RelationType {{relationTypeId: $relation_type_id}})
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        SET {', '.join(set_clauses)}
        RETURN rt {{.*,
            sourceEntityTypeKey: source.key,
            targetEntityTypeKey: target.key
        }} AS relation_type
        """,
        **params,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"]) if record else None


async def delete_relation_type(
    session: AsyncSession, relation_type_id: str
) -> bool:
    """Delete relation type and cascade to its properties only."""
    result = await session.run(
        """
        MATCH (rt:RelationType {relationTypeId: $relation_type_id})
        OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        DETACH DELETE rt, p
        RETURN count(rt) AS deleted
        """,
        relation_type_id=relation_type_id,
    )
    record = await result.single()
    return record["deleted"] > 0


# --- Property Definition ---


async def create_property(
    session: AsyncSession,
    owner_id: str,
    owner_label: str,
    property_id: str,
    key: str,
    display_name: str,
    description: str | None,
    data_type: str,
    required: bool,
    default_value: str | None,
) -> dict:
    id_field = "entityTypeId" if owner_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (owner:{owner_label} {{{id_field}: $owner_id}})
        CREATE (owner)-[:HAS_PROPERTY]->(p:PropertyDefinition {{
            propertyId: $property_id,
            key: $key,
            displayName: $display_name,
            description: $description,
            dataType: $data_type,
            required: $required,
            defaultValue: $default_value,
            createdAt: datetime(),
            updatedAt: datetime()
        }})
        RETURN p {{.*}} AS property
        """,
        owner_id=owner_id,
        property_id=property_id,
        key=key,
        display_name=display_name,
        description=description,
        data_type=data_type,
        required=required,
        default_value=default_value,
    )
    record = await result.single()
    return _convert_neo4j_types(record["property"])


async def list_properties(
    session: AsyncSession, owner_id: str, owner_label: str
) -> list[dict]:
    id_field = "entityTypeId" if owner_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (owner:{owner_label} {{{id_field}: $owner_id}})-[:HAS_PROPERTY]->(p:PropertyDefinition)
        RETURN p {{.*}} AS property ORDER BY p.key
        """,
        owner_id=owner_id,
    )
    return [_convert_neo4j_types(record["property"]) async for record in result]


async def get_property(
    session: AsyncSession, owner_id: str, owner_label: str, property_id: str
) -> dict | None:
    id_field = "entityTypeId" if owner_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (owner:{owner_label} {{{id_field}: $owner_id}})-[:HAS_PROPERTY]->(p:PropertyDefinition {{propertyId: $property_id}})
        RETURN p {{.*}} AS property
        """,
        owner_id=owner_id,
        property_id=property_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["property"]) if record else None


async def get_property_by_key(
    session: AsyncSession, owner_id: str, owner_label: str, key: str
) -> dict | None:
    id_field = "entityTypeId" if owner_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (owner:{owner_label} {{{id_field}: $owner_id}})-[:HAS_PROPERTY]->(p:PropertyDefinition {{key: $key}})
        RETURN p {{.*}} AS property
        """,
        owner_id=owner_id,
        key=key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["property"]) if record else None


async def update_property(
    session: AsyncSession,
    owner_id: str,
    owner_label: str,
    property_id: str,
    display_name: str | None,
    description: str | None,
    required: bool | None,
    default_value: str | None,
    clear_default: bool = False,
) -> dict | None:
    id_field = "entityTypeId" if owner_label == "EntityType" else "relationTypeId"
    set_clauses = ["p.updatedAt = datetime()"]
    params: dict = {"owner_id": owner_id, "property_id": property_id}
    if display_name is not None:
        set_clauses.append("p.displayName = $display_name")
        params["display_name"] = display_name
    if description is not None:
        set_clauses.append("p.description = $description")
        params["description"] = description
    if required is not None:
        set_clauses.append("p.required = $required")
        params["required"] = required
    if clear_default:
        set_clauses.append("p.defaultValue = null")
    elif default_value is not None:
        set_clauses.append("p.defaultValue = $default_value")
        params["default_value"] = default_value

    result = await session.run(
        f"""
        MATCH (owner:{owner_label} {{{id_field}: $owner_id}})-[:HAS_PROPERTY]->(p:PropertyDefinition {{propertyId: $property_id}})
        SET {', '.join(set_clauses)}
        RETURN p {{.*}} AS property
        """,
        **params,
    )
    record = await result.single()
    return _convert_neo4j_types(record["property"]) if record else None


async def delete_property(
    session: AsyncSession, owner_id: str, owner_label: str, property_id: str
) -> bool:
    id_field = "entityTypeId" if owner_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (owner:{owner_label} {{{id_field}: $owner_id}})-[:HAS_PROPERTY]->(p:PropertyDefinition {{propertyId: $property_id}})
        DETACH DELETE p
        RETURN count(p) AS deleted
        """,
        owner_id=owner_id,
        property_id=property_id,
    )
    record = await result.single()
    return record["deleted"] > 0


# --- Scope Management (INCLUDES_TYPE) ---


async def add_includes_type(
    session: AsyncSession,
    ontology_id: str,
    type_label: str,
    type_key: str,
    properties: list[str] | None,
) -> dict:
    """MERGE an INCLUDES_TYPE edge from ontology to a type node."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})
        MATCH (t:{type_label} {{key: $type_key}})
        MERGE (o)-[r:INCLUDES_TYPE]->(t)
        SET r.properties = $properties
        RETURN t.key AS key, t.{id_field} AS typeId, r.properties AS properties
        """,
        ontology_id=ontology_id,
        type_key=type_key,
        properties=properties,
    )
    record = await result.single()
    if not record:
        return None
    return {"key": record["key"], "typeId": record["typeId"], "properties": record["properties"]}


async def list_includes_types(
    session: AsyncSession,
    ontology_id: str,
    type_label: str,
) -> list[dict]:
    """List all INCLUDES_TYPE edges from ontology to a given type label."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})-[r:INCLUDES_TYPE]->(t:{type_label})
        RETURN t.key AS key, t.{id_field} AS typeId, r.properties AS properties
        ORDER BY t.key
        """,
        ontology_id=ontology_id,
    )
    items = []
    async for record in result:
        items.append({
            "key": record["key"],
            "typeId": record["typeId"],
            "properties": record["properties"],
        })
    return items


async def get_includes_type(
    session: AsyncSession,
    ontology_id: str,
    type_label: str,
    type_id: str,
) -> dict | None:
    """Get a single INCLUDES_TYPE edge."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})-[r:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        RETURN t.key AS key, t.{id_field} AS typeId, r.properties AS properties
        """,
        ontology_id=ontology_id,
        type_id=type_id,
    )
    record = await result.single()
    if not record:
        return None
    return {"key": record["key"], "typeId": record["typeId"], "properties": record["properties"]}


async def update_includes_type(
    session: AsyncSession,
    ontology_id: str,
    type_label: str,
    type_id: str,
    properties: list[str] | None,
) -> dict | None:
    """Update the properties filter on an INCLUDES_TYPE edge."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})-[r:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        SET r.properties = $properties
        RETURN t.key AS key, t.{id_field} AS typeId, r.properties AS properties
        """,
        ontology_id=ontology_id,
        type_id=type_id,
        properties=properties,
    )
    record = await result.single()
    if not record:
        return None
    return {"key": record["key"], "typeId": record["typeId"], "properties": record["properties"]}


async def remove_includes_type(
    session: AsyncSession,
    ontology_id: str,
    type_label: str,
    type_id: str,
) -> bool:
    """Remove an INCLUDES_TYPE edge."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})-[r:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        DELETE r
        RETURN count(r) AS deleted
        """,
        ontology_id=ontology_id,
        type_id=type_id,
    )
    record = await result.single()
    return record["deleted"] > 0


async def remove_all_includes_for_type(
    session: AsyncSession,
    type_label: str,
    type_id: str,
) -> int:
    """Remove all INCLUDES_TYPE edges pointing to a specific type (for cascade delete)."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        DELETE r
        RETURN count(r) AS deleted
        """,
        type_id=type_id,
    )
    record = await result.single()
    return record["deleted"]


async def find_ontologies_including_type(
    session: AsyncSession,
    type_label: str,
    type_id: str,
) -> list[str]:
    """Find all ontology keys that have INCLUDES_TYPE edges to a specific type."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology)-[:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        RETURN o.key AS key
        ORDER BY o.key
        """,
        type_id=type_id,
    )
    return [record["key"] async for record in result]


async def find_ontologies_with_explicit_property(
    session: AsyncSession,
    type_label: str,
    type_id: str,
    property_key: str,
) -> list[str]:
    """Find ontology keys with explicit property lists for a type that don't include a given property key.

    Only returns ontologies where the INCLUDES_TYPE edge has a non-null properties list
    that does NOT contain the given property_key.
    """
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        WHERE r.properties IS NOT NULL AND NOT $property_key IN r.properties
        RETURN o.key AS key
        ORDER BY o.key
        """,
        type_id=type_id,
        property_key=property_key,
    )
    return [record["key"] async for record in result]


async def add_property_to_includes_lists(
    session: AsyncSession,
    type_label: str,
    type_id: str,
    property_key: str,
) -> int:
    """Add a property key to all explicit INCLUDES_TYPE property lists for a type.

    Only modifies edges with non-null properties lists that don't already include the key.
    """
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        WHERE r.properties IS NOT NULL AND NOT $property_key IN r.properties
        SET r.properties = r.properties + $property_key
        RETURN count(r) AS updated
        """,
        type_id=type_id,
        property_key=property_key,
    )
    record = await result.single()
    return record["updated"]


async def remove_property_from_includes_lists(
    session: AsyncSession,
    type_label: str,
    type_id: str,
    property_key: str,
) -> int:
    """Remove a property key from all explicit INCLUDES_TYPE property lists for a type."""
    id_field = "entityTypeId" if type_label == "EntityType" else "relationTypeId"
    result = await session.run(
        f"""
        MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:{type_label} {{{id_field}: $type_id}})
        WHERE r.properties IS NOT NULL AND $property_key IN r.properties
        SET r.properties = [p IN r.properties WHERE p <> $property_key]
        RETURN count(r) AS updated
        """,
        type_id=type_id,
        property_key=property_key,
    )
    record = await result.single()
    return record["updated"]


# --- Full Schema (for validation and export) ---


async def get_full_schema(session: AsyncSession) -> dict:
    """Load the entire global schema + all ontologies with their INCLUDES_TYPE edges."""
    # Get all entity types with properties
    et_result = await session.run(
        """
        MATCH (et:EntityType)
        OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        WITH et, collect(p {.*}) AS properties
        RETURN et {.*} AS entity_type, properties
        ORDER BY et.key
        """
    )
    entity_types = []
    async for record in et_result:
        et = _convert_neo4j_types(dict(record["entity_type"]))
        et["properties"] = [_convert_neo4j_types(p) for p in record["properties"] if p]
        entity_types.append(et)

    # Get all relation types with properties and source/target keys
    rt_result = await session.run(
        """
        MATCH (rt:RelationType)
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        WITH rt, source, target, collect(p {.*}) AS properties
        RETURN rt {.*} AS relation_type,
               source.key AS sourceKey,
               target.key AS targetKey,
               properties
        ORDER BY rt.key
        """
    )
    relation_types = []
    async for record in rt_result:
        rt = _convert_neo4j_types(dict(record["relation_type"]))
        rt["sourceKey"] = record["sourceKey"]
        rt["targetKey"] = record["targetKey"]
        rt["properties"] = [_convert_neo4j_types(p) for p in record["properties"] if p]
        relation_types.append(rt)

    # Get all ontologies with their INCLUDES_TYPE edges
    ont_result = await session.run(
        """
        MATCH (o:Ontology)
        OPTIONAL MATCH (o)-[r:INCLUDES_TYPE]->(t)
        WITH o, collect({
            key: t.key,
            label: labels(t)[0],
            properties: r.properties
        }) AS inclusions
        RETURN o {.*} AS ontology, inclusions
        ORDER BY o.name
        """
    )
    ontologies = []
    async for record in ont_result:
        ont = _convert_neo4j_types(record["ontology"])
        raw_inclusions = record["inclusions"]
        entity_inclusions = []
        relation_inclusions = []
        for inc in raw_inclusions:
            if inc["key"] is None:
                continue
            entry = {"key": inc["key"], "properties": inc["properties"]}
            if inc["label"] == "EntityType":
                entity_inclusions.append(entry)
            elif inc["label"] == "RelationType":
                relation_inclusions.append(entry)
        ont["entityInclusions"] = entity_inclusions
        ont["relationInclusions"] = relation_inclusions
        ontologies.append(ont)

    return {
        "entityTypes": entity_types,
        "relationTypes": relation_types,
        "ontologies": ontologies,
    }


# --- AI Agent Config ---


async def list_ai_agents(session: AsyncSession, ontology_id: str) -> list[dict]:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_AI_AGENT]->(ac:AiAgentConfig)
        RETURN ac {.*} AS agent
        ORDER BY ac.name
        """,
        ontology_id=ontology_id,
    )
    return [_convert_neo4j_types(record["agent"]) async for record in result]


async def get_ai_agent_by_key(
    session: AsyncSession, ontology_id: str, agent_key: str
) -> dict | None:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_AI_AGENT]->(ac:AiAgentConfig {key: $agent_key})
        RETURN ac {.*} AS agent
        """,
        ontology_id=ontology_id,
        agent_key=agent_key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["agent"]) if record else None


async def upsert_ai_agent(
    session: AsyncSession,
    ontology_id: str,
    agent_config_id: str,
    key: str,
    name: str,
    description: str | None,
    system_prompt: str | None,
    tools: list[str] | None,
) -> tuple[dict, bool]:
    """MERGE-based upsert. Returns (record, created)."""
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})
        MERGE (o)-[:HAS_AI_AGENT]->(ac:AiAgentConfig {key: $key})
        ON CREATE SET
            ac.agentConfigId = $agent_config_id,
            ac.name = $name,
            ac.description = $description,
            ac.systemPrompt = $system_prompt,
            ac.tools = $tools,
            ac.createdAt = datetime(),
            ac.updatedAt = datetime()
        ON MATCH SET
            ac.name = $name,
            ac.description = $description,
            ac.systemPrompt = $system_prompt,
            ac.tools = $tools,
            ac.updatedAt = datetime()
        RETURN ac {.*} AS agent, ac.agentConfigId = $agent_config_id AS created
        """,
        ontology_id=ontology_id,
        agent_config_id=agent_config_id,
        key=key,
        name=name,
        description=description,
        system_prompt=system_prompt,
        tools=tools,
    )
    record = await result.single()
    return _convert_neo4j_types(record["agent"]), record["created"]


async def delete_ai_agent(
    session: AsyncSession, ontology_id: str, agent_key: str
) -> bool:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_AI_AGENT]->(ac:AiAgentConfig {key: $agent_key})
        DETACH DELETE ac
        RETURN count(ac) AS deleted
        """,
        ontology_id=ontology_id,
        agent_key=agent_key,
    )
    record = await result.single()
    return record["deleted"] > 0


async def list_ai_agents_for_export(session: AsyncSession, ontology_id: str) -> list[dict]:
    """List agents for export (key, name, description, systemPrompt, tools)."""
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_AI_AGENT]->(ac:AiAgentConfig)
        RETURN ac.key AS key, ac.name AS name, ac.description AS description,
               ac.systemPrompt AS systemPrompt, ac.tools AS tools
        ORDER BY ac.name
        """,
        ontology_id=ontology_id,
    )
    return [dict(record) async for record in result]
