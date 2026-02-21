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
    name: str,
    description: str | None,
) -> dict:
    result = await session.run(
        """
        CREATE (o:Ontology {
            ontologyId: $ontology_id,
            name: $name,
            description: $description,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        RETURN o {.*} AS ontology
        """,
        ontology_id=ontology_id,
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
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})
        OPTIONAL MATCH (o)-[:HAS_ENTITY_TYPE]->(et:EntityType)
        OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(ep:PropertyDefinition)
        OPTIONAL MATCH (o)-[:HAS_RELATION_TYPE]->(rt:RelationType)
        OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(rp:PropertyDefinition)
        DETACH DELETE o, et, ep, rt, rp
        RETURN count(o) AS deleted
        """,
        ontology_id=ontology_id,
    )
    record = await result.single()
    return record["deleted"] > 0


# --- Entity Type ---


async def create_entity_type(
    session: AsyncSession,
    ontology_id: str,
    entity_type_id: str,
    key: str,
    display_name: str,
    description: str | None,
) -> dict:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})
        CREATE (o)-[:HAS_ENTITY_TYPE]->(et:EntityType {
            entityTypeId: $entity_type_id,
            key: $key,
            displayName: $display_name,
            description: $description,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        RETURN et {.*} AS entity_type
        """,
        ontology_id=ontology_id,
        entity_type_id=entity_type_id,
        key=key,
        display_name=display_name,
        description=description,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"])


async def list_entity_types(
    session: AsyncSession, ontology_id: str
) -> list[dict]:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_ENTITY_TYPE]->(et:EntityType)
        RETURN et {.*} AS entity_type ORDER BY et.key
        """,
        ontology_id=ontology_id,
    )
    return [_convert_neo4j_types(record["entity_type"]) async for record in result]


async def get_entity_type(
    session: AsyncSession, ontology_id: str, entity_type_id: str
) -> dict | None:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_ENTITY_TYPE]->(et:EntityType {entityTypeId: $entity_type_id})
        RETURN et {.*} AS entity_type
        """,
        ontology_id=ontology_id,
        entity_type_id=entity_type_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"]) if record else None


async def get_entity_type_by_key(
    session: AsyncSession, ontology_id: str, key: str
) -> dict | None:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_ENTITY_TYPE]->(et:EntityType {key: $key})
        RETURN et {.*} AS entity_type
        """,
        ontology_id=ontology_id,
        key=key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"]) if record else None


async def update_entity_type(
    session: AsyncSession,
    ontology_id: str,
    entity_type_id: str,
    display_name: str | None,
    description: str | None,
) -> dict | None:
    set_clauses = ["et.updatedAt = datetime()"]
    params: dict = {"ontology_id": ontology_id, "entity_type_id": entity_type_id}
    if display_name is not None:
        set_clauses.append("et.displayName = $display_name")
        params["display_name"] = display_name
    if description is not None:
        set_clauses.append("et.description = $description")
        params["description"] = description

    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})-[:HAS_ENTITY_TYPE]->(et:EntityType {{entityTypeId: $entity_type_id}})
        SET {', '.join(set_clauses)}
        RETURN et {{.*}} AS entity_type
        """,
        **params,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity_type"]) if record else None


async def delete_entity_type(
    session: AsyncSession, ontology_id: str, entity_type_id: str
) -> bool:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_ENTITY_TYPE]->(et:EntityType {entityTypeId: $entity_type_id})
        OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        DETACH DELETE et, p
        RETURN count(et) AS deleted
        """,
        ontology_id=ontology_id,
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


# --- Relation Type ---


async def create_relation_type(
    session: AsyncSession,
    ontology_id: str,
    relation_type_id: str,
    key: str,
    display_name: str,
    description: str | None,
    source_entity_type_id: str,
    target_entity_type_id: str,
) -> dict:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})
        MATCH (source:EntityType {entityTypeId: $source_entity_type_id})
        MATCH (target:EntityType {entityTypeId: $target_entity_type_id})
        CREATE (o)-[:HAS_RELATION_TYPE]->(rt:RelationType {
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
            sourceEntityTypeId: source.entityTypeId,
            targetEntityTypeId: target.entityTypeId
        } AS relation_type
        """,
        ontology_id=ontology_id,
        relation_type_id=relation_type_id,
        key=key,
        display_name=display_name,
        description=description,
        source_entity_type_id=source_entity_type_id,
        target_entity_type_id=target_entity_type_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"])


async def list_relation_types(
    session: AsyncSession, ontology_id: str
) -> list[dict]:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_RELATION_TYPE]->(rt:RelationType)
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        RETURN rt {.*,
            sourceEntityTypeId: source.entityTypeId,
            targetEntityTypeId: target.entityTypeId
        } AS relation_type ORDER BY rt.key
        """,
        ontology_id=ontology_id,
    )
    return [_convert_neo4j_types(record["relation_type"]) async for record in result]


async def get_relation_type(
    session: AsyncSession, ontology_id: str, relation_type_id: str
) -> dict | None:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_RELATION_TYPE]->(rt:RelationType {relationTypeId: $relation_type_id})
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        RETURN rt {.*,
            sourceEntityTypeId: source.entityTypeId,
            targetEntityTypeId: target.entityTypeId
        } AS relation_type
        """,
        ontology_id=ontology_id,
        relation_type_id=relation_type_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"]) if record else None


async def get_relation_type_by_key(
    session: AsyncSession, ontology_id: str, key: str
) -> dict | None:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_RELATION_TYPE]->(rt:RelationType {key: $key})
        RETURN rt {.*} AS relation_type
        """,
        ontology_id=ontology_id,
        key=key,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"]) if record else None


async def update_relation_type(
    session: AsyncSession,
    ontology_id: str,
    relation_type_id: str,
    display_name: str | None,
    description: str | None,
) -> dict | None:
    set_clauses = ["rt.updatedAt = datetime()"]
    params: dict = {"ontology_id": ontology_id, "relation_type_id": relation_type_id}
    if display_name is not None:
        set_clauses.append("rt.displayName = $display_name")
        params["display_name"] = display_name
    if description is not None:
        set_clauses.append("rt.description = $description")
        params["description"] = description

    result = await session.run(
        f"""
        MATCH (o:Ontology {{ontologyId: $ontology_id}})-[:HAS_RELATION_TYPE]->(rt:RelationType {{relationTypeId: $relation_type_id}})
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        SET {', '.join(set_clauses)}
        RETURN rt {{.*,
            sourceEntityTypeId: source.entityTypeId,
            targetEntityTypeId: target.entityTypeId
        }} AS relation_type
        """,
        **params,
    )
    record = await result.single()
    return _convert_neo4j_types(record["relation_type"]) if record else None


async def delete_relation_type(
    session: AsyncSession, ontology_id: str, relation_type_id: str
) -> bool:
    result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_RELATION_TYPE]->(rt:RelationType {relationTypeId: $relation_type_id})
        OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        DETACH DELETE rt, p
        RETURN count(rt) AS deleted
        """,
        ontology_id=ontology_id,
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


# --- Full Schema (for validation and export) ---


async def get_full_schema(session: AsyncSession, ontology_id: str) -> dict | None:
    # Get ontology
    ont_result = await session.run(
        "MATCH (o:Ontology {ontologyId: $ontology_id}) RETURN o {.*} AS ontology",
        ontology_id=ontology_id,
    )
    ont_record = await ont_result.single()
    if not ont_record:
        return None

    # Get entity types with properties
    et_result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_ENTITY_TYPE]->(et:EntityType)
        OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        WITH et, collect(p {.*}) AS properties
        RETURN et {.*} AS entity_type, properties
        ORDER BY et.key
        """,
        ontology_id=ontology_id,
    )
    entity_types = []
    async for record in et_result:
        et = _convert_neo4j_types(dict(record["entity_type"]))
        et["properties"] = [_convert_neo4j_types(p) for p in record["properties"] if p]
        entity_types.append(et)

    # Get relation types with properties and source/target
    rt_result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_RELATION_TYPE]->(rt:RelationType)
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        WITH rt, source, target, collect(p {.*}) AS properties
        RETURN rt {.*} AS relation_type,
               source.entityTypeId AS sourceEntityTypeId,
               source.key AS sourceKey,
               target.entityTypeId AS targetEntityTypeId,
               target.key AS targetKey,
               properties
        ORDER BY rt.key
        """,
        ontology_id=ontology_id,
    )
    relation_types = []
    async for record in rt_result:
        rt = _convert_neo4j_types(dict(record["relation_type"]))
        rt["sourceEntityTypeId"] = record["sourceEntityTypeId"]
        rt["targetEntityTypeId"] = record["targetEntityTypeId"]
        rt["sourceKey"] = record["sourceKey"]
        rt["targetKey"] = record["targetKey"]
        rt["properties"] = [_convert_neo4j_types(p) for p in record["properties"] if p]
        relation_types.append(rt)

    return {
        "ontology": _convert_neo4j_types(ont_record["ontology"]),
        "entityTypes": entity_types,
        "relationTypes": relation_types,
    }
