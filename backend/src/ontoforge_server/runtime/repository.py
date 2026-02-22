from datetime import date, datetime, timezone

from neo4j import AsyncSession
from neo4j.time import Date as Neo4jDate
from neo4j.time import DateTime as Neo4jDateTime


def _convert_neo4j_types(data: dict) -> dict:
    """Convert Neo4j-specific types (DateTime, Date) to Python stdlib types."""
    result = {}
    for key, value in data.items():
        if isinstance(value, Neo4jDateTime):
            result[key] = value.to_native().replace(tzinfo=timezone.utc) if value.tzinfo else datetime(
                value.year, value.month, value.day,
                value.hour, value.minute, value.second,
                value.nanosecond // 1000,
                tzinfo=timezone.utc,
            )
        elif isinstance(value, Neo4jDate):
            result[key] = date(value.year, value.month, value.day)
        else:
            result[key] = value
    return result


# --- Database Management ---


async def wipe_database(session: AsyncSession) -> None:
    """Delete all nodes and relationships."""
    await session.run("MATCH (n) DETACH DELETE n")


async def drop_all_constraints(session: AsyncSession) -> None:
    """Drop all constraints and indexes (except system lookup indexes)."""
    result = await session.run("SHOW CONSTRAINTS")
    records = [record async for record in result]
    for record in records:
        name = record["name"]
        await session.run(f"DROP CONSTRAINT {name} IF EXISTS")

    result = await session.run("SHOW INDEXES")
    records = [record async for record in result]
    for record in records:
        # Skip lookup indexes (system indexes that cannot be dropped)
        if record.get("type") == "LOOKUP":
            continue
        name = record["name"]
        await session.run(f"DROP INDEX {name} IF EXISTS")


async def create_schema_constraints(session: AsyncSession) -> None:
    """Create schema node constraints (same structure as Model DB)."""
    constraints = [
        "CREATE CONSTRAINT ontology_id_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE",
        "CREATE CONSTRAINT entity_type_id_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE",
        "CREATE CONSTRAINT relation_type_id_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE",
        "CREATE CONSTRAINT property_id_unique IF NOT EXISTS FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE",
    ]
    for c in constraints:
        await session.run(c)


async def create_instance_constraints(session: AsyncSession) -> None:
    """Create instance-specific constraints and indexes."""
    await session.run(
        "CREATE CONSTRAINT entity_instance_id_unique IF NOT EXISTS "
        "FOR (n:_Entity) REQUIRE n._id IS UNIQUE"
    )
    await session.run(
        "CREATE INDEX entity_type_key_index IF NOT EXISTS "
        "FOR (n:_Entity) ON (n._entityTypeKey)"
    )


# --- Schema Import (for provisioning) ---


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
        RETURN rt {.*} AS relation_type
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


# --- Schema Reading (for cache rebuild from DB) ---


async def get_full_schema(session: AsyncSession) -> dict | None:
    """Read the full provisioned schema from the Instance DB.

    Returns None if no Ontology node exists (not provisioned).
    """
    # Get ontology (there should be exactly one or zero)
    ont_result = await session.run(
        "MATCH (o:Ontology) RETURN o {.*} AS ontology LIMIT 1"
    )
    ont_record = await ont_result.single()
    if not ont_record:
        return None

    ontology = _convert_neo4j_types(ont_record["ontology"])
    ontology_id = ontology["ontologyId"]

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

    # Get relation types with properties and source/target keys
    rt_result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[:HAS_RELATION_TYPE]->(rt:RelationType)
        MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
        MATCH (rt)-[:RELATES_TO]->(target:EntityType)
        OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
        WITH rt, source, target, collect(p {.*}) AS properties
        RETURN rt {.*} AS relation_type,
               source.key AS sourceKey,
               target.key AS targetKey,
               properties
        ORDER BY rt.key
        """,
        ontology_id=ontology_id,
    )
    relation_types = []
    async for record in rt_result:
        rt = _convert_neo4j_types(dict(record["relation_type"]))
        rt["sourceKey"] = record["sourceKey"]
        rt["targetKey"] = record["targetKey"]
        rt["properties"] = [_convert_neo4j_types(p) for p in record["properties"] if p]
        relation_types.append(rt)

    return {
        "ontology": ontology,
        "entityTypes": entity_types,
        "relationTypes": relation_types,
    }


# --- Entity Instance CRUD ---


async def create_entity(
    session: AsyncSession,
    entity_type_key: str,
    pascal_label: str,
    entity_id: str,
    properties: dict,
) -> dict:
    """Create an entity instance node with dual labels: _Entity and the PascalCase type label.

    The pascal_label comes from the SchemaCache (safe for Cypher label interpolation).
    All property values are passed via the $properties map parameter.
    """
    result = await session.run(
        f"""
        CREATE (n:_Entity:{pascal_label} {{
            _id: $entity_id,
            _entityTypeKey: $entity_type_key,
            _createdAt: datetime(),
            _updatedAt: datetime()
        }})
        SET n += $properties
        RETURN n {{.*}} AS entity
        """,
        entity_id=entity_id,
        entity_type_key=entity_type_key,
        properties=properties,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity"])


async def list_entities(
    session: AsyncSession,
    pascal_label: str,
    entity_type_key: str,
    where_clauses: list[str],
    params: dict,
    sort_field: str,
    order: str,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    """List entity instances with filtering, sorting, and pagination.

    Returns (items, total_count).
    The pascal_label and sort_field come from the service layer (validated against the schema).
    """
    base_where = "n._entityTypeKey = $entity_type_key"
    if where_clauses:
        where_str = f"WHERE {base_where} AND " + " AND ".join(where_clauses)
    else:
        where_str = f"WHERE {base_where}"

    params["entity_type_key"] = entity_type_key

    # Count query
    count_query = f"MATCH (n:_Entity:{pascal_label}) {where_str} RETURN count(n) AS total"
    count_result = await session.run(count_query, params)
    count_record = await count_result.single()
    total = count_record["total"]

    if total == 0:
        return [], 0

    # Data query with sort/pagination
    data_query = f"""
        MATCH (n:_Entity:{pascal_label}) {where_str}
        RETURN n {{.*}} AS entity
        ORDER BY n.{sort_field} {order}
        SKIP $offset LIMIT $limit
    """
    params["offset"] = offset
    params["limit"] = limit
    data_result = await session.run(data_query, params)
    items = [_convert_neo4j_types(record["entity"]) async for record in data_result]

    return items, total


async def get_entity(
    session: AsyncSession,
    pascal_label: str,
    entity_id: str,
) -> dict | None:
    """Get a single entity instance by ID."""
    result = await session.run(
        f"MATCH (n:_Entity:{pascal_label} {{_id: $entity_id}}) RETURN n {{.*}} AS entity",
        entity_id=entity_id,
    )
    record = await result.single()
    if not record:
        return None
    return _convert_neo4j_types(record["entity"])


async def update_entity(
    session: AsyncSession,
    pascal_label: str,
    entity_id: str,
    set_properties: dict,
    remove_properties: list[str],
) -> dict | None:
    """Partial update: set some properties, remove others (null values).

    set_properties: dict of {key: coerced_value} to set
    remove_properties: list of property keys to remove (nulled out)
    """
    set_clause = (
        "SET n += $set_properties, n._updatedAt = datetime()"
        if set_properties
        else "SET n._updatedAt = datetime()"
    )
    remove_clause = (
        " ".join(f"REMOVE n.{k}" for k in remove_properties)
        if remove_properties
        else ""
    )

    result = await session.run(
        f"""
        MATCH (n:_Entity:{pascal_label} {{_id: $entity_id}})
        {set_clause}
        {remove_clause}
        RETURN n {{.*}} AS entity
        """,
        entity_id=entity_id,
        set_properties=set_properties or {},
    )
    record = await result.single()
    if not record:
        return None
    return _convert_neo4j_types(record["entity"])


async def delete_entity(
    session: AsyncSession,
    pascal_label: str,
    entity_id: str,
) -> bool:
    """Delete an entity with DETACH DELETE. Returns True if deleted, False if not found."""
    result = await session.run(
        f"""
        MATCH (n:_Entity:{pascal_label} {{_id: $entity_id}})
        DETACH DELETE n
        RETURN count(*) AS deleted
        """,
        entity_id=entity_id,
    )
    record = await result.single()
    return record["deleted"] > 0


# --- Relation Instance CRUD ---


async def get_entity_by_id(session: AsyncSession, entity_id: str) -> dict | None:
    """Get any entity by _id (regardless of type label)."""
    result = await session.run(
        "MATCH (n:_Entity {_id: $entity_id}) RETURN n {.*} AS entity",
        entity_id=entity_id,
    )
    record = await result.single()
    return _convert_neo4j_types(record["entity"]) if record else None


async def create_relation(
    session: AsyncSession,
    relation_type_key: str,
    rel_type_upper: str,
    relation_id: str,
    from_entity_id: str,
    to_entity_id: str,
    properties: dict,
) -> dict:
    """Create a relation instance between two entity nodes."""
    result = await session.run(
        f"""
        MATCH (from:_Entity {{_id: $from_entity_id}})
        MATCH (to:_Entity {{_id: $to_entity_id}})
        CREATE (from)-[r:{rel_type_upper} {{
            _id: $relation_id,
            _relationTypeKey: $relation_type_key,
            _createdAt: datetime(),
            _updatedAt: datetime()
        }}]->(to)
        SET r += $properties
        RETURN r {{.*}} AS relation,
               from._id AS fromEntityId,
               to._id AS toEntityId
        """,
        from_entity_id=from_entity_id,
        to_entity_id=to_entity_id,
        relation_id=relation_id,
        relation_type_key=relation_type_key,
        properties=properties,
    )
    record = await result.single()
    rel = _convert_neo4j_types(record["relation"])
    rel["fromEntityId"] = record["fromEntityId"]
    rel["toEntityId"] = record["toEntityId"]
    return rel


async def list_relations(
    session: AsyncSession,
    rel_type_upper: str,
    relation_type_key: str,
    where_clauses: list[str],
    params: dict,
    sort_field: str,
    order: str,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    """List relation instances with filtering and pagination."""
    base_where = "r._relationTypeKey = $relation_type_key"
    if where_clauses:
        where_str = f"WHERE {base_where} AND " + " AND ".join(where_clauses)
    else:
        where_str = f"WHERE {base_where}"

    params["relation_type_key"] = relation_type_key

    # Count query
    count_query = f"""
        MATCH (from:_Entity)-[r:{rel_type_upper}]->(to:_Entity)
        {where_str}
        RETURN count(r) AS total
    """
    count_result = await session.run(count_query, params)
    count_record = await count_result.single()
    total = count_record["total"]

    if total == 0:
        return [], 0

    # Data query with sort/pagination
    data_query = f"""
        MATCH (from:_Entity)-[r:{rel_type_upper}]->(to:_Entity)
        {where_str}
        RETURN r {{.*}} AS relation,
               from._id AS fromEntityId,
               to._id AS toEntityId
        ORDER BY r.{sort_field} {order}
        SKIP $offset LIMIT $limit
    """
    params["offset"] = offset
    params["limit"] = limit
    data_result = await session.run(data_query, params)
    items = []
    async for record in data_result:
        rel = _convert_neo4j_types(record["relation"])
        rel["fromEntityId"] = record["fromEntityId"]
        rel["toEntityId"] = record["toEntityId"]
        items.append(rel)

    return items, total


async def get_relation(
    session: AsyncSession,
    rel_type_upper: str,
    relation_id: str,
) -> dict | None:
    """Get a single relation instance by ID."""
    result = await session.run(
        f"""
        MATCH (from:_Entity)-[r:{rel_type_upper} {{_id: $relation_id}}]->(to:_Entity)
        RETURN r {{.*}} AS relation,
               from._id AS fromEntityId,
               to._id AS toEntityId
        """,
        relation_id=relation_id,
    )
    record = await result.single()
    if not record:
        return None
    rel = _convert_neo4j_types(record["relation"])
    rel["fromEntityId"] = record["fromEntityId"]
    rel["toEntityId"] = record["toEntityId"]
    return rel


async def update_relation(
    session: AsyncSession,
    rel_type_upper: str,
    relation_id: str,
    set_properties: dict,
    remove_properties: list[str],
) -> dict | None:
    """Partial update of a relation instance."""
    set_clause = (
        "SET r += $set_properties, r._updatedAt = datetime()"
        if set_properties
        else "SET r._updatedAt = datetime()"
    )
    remove_clause = (
        " ".join(f"REMOVE r.{k}" for k in remove_properties)
        if remove_properties
        else ""
    )

    result = await session.run(
        f"""
        MATCH (from:_Entity)-[r:{rel_type_upper} {{_id: $relation_id}}]->(to:_Entity)
        {set_clause}
        {remove_clause}
        RETURN r {{.*}} AS relation,
               from._id AS fromEntityId,
               to._id AS toEntityId
        """,
        relation_id=relation_id,
        set_properties=set_properties or {},
    )
    record = await result.single()
    if not record:
        return None
    rel = _convert_neo4j_types(record["relation"])
    rel["fromEntityId"] = record["fromEntityId"]
    rel["toEntityId"] = record["toEntityId"]
    return rel


async def delete_relation(
    session: AsyncSession,
    rel_type_upper: str,
    relation_id: str,
) -> bool:
    """Delete a relation instance. Returns True if deleted."""
    result = await session.run(
        f"MATCH ()-[r:{rel_type_upper} {{_id: $relation_id}}]->() DELETE r RETURN count(*) AS deleted",
        relation_id=relation_id,
    )
    record = await result.single()
    return record["deleted"] > 0


# --- Graph Traversal ---


async def get_neighbors(
    session: AsyncSession,
    entity_id: str,
    direction: str,
    relation_type_filter: str | None,
    limit: int,
) -> list[dict]:
    """Get neighbors of an entity via relationships.

    Returns a list of dicts with 'relation' and 'entity' keys.
    The relation dict includes a 'direction' field ('outgoing' or 'incoming').
    """
    if relation_type_filter:
        rel_pattern = f"[r:{relation_type_filter}]"
    else:
        rel_pattern = "[r]"

    if direction == "both":
        # Run separate queries to determine direction per relationship
        out_query = f"""
            MATCH (n:_Entity {{_id: $entity_id}})-{rel_pattern}->(neighbor:_Entity)
            RETURN r {{.*}} AS relation, neighbor {{.*}} AS neighbor_entity
            LIMIT $limit
        """
        out_result = await session.run(out_query, entity_id=entity_id, limit=limit)
        results = []
        async for record in out_result:
            rel = _convert_neo4j_types(dict(record["relation"]))
            rel["direction"] = "outgoing"
            results.append({
                "relation": rel,
                "entity": _convert_neo4j_types(dict(record["neighbor_entity"])),
            })

        remaining = limit - len(results)
        if remaining > 0:
            in_query = f"""
                MATCH (n:_Entity {{_id: $entity_id}})<-{rel_pattern}-(neighbor:_Entity)
                RETURN r {{.*}} AS relation, neighbor {{.*}} AS neighbor_entity
                LIMIT $remaining_limit
            """
            in_result = await session.run(
                in_query, entity_id=entity_id, remaining_limit=remaining
            )
            async for record in in_result:
                rel = _convert_neo4j_types(dict(record["relation"]))
                rel["direction"] = "incoming"
                results.append({
                    "relation": rel,
                    "entity": _convert_neo4j_types(dict(record["neighbor_entity"])),
                })

        return results
    else:
        if direction == "outgoing":
            match_clause = f"MATCH (n:_Entity {{_id: $entity_id}})-{rel_pattern}->(neighbor:_Entity)"
        else:  # incoming
            match_clause = f"MATCH (n:_Entity {{_id: $entity_id}})<-{rel_pattern}-(neighbor:_Entity)"

        query = f"""
            {match_clause}
            RETURN r {{.*}} AS relation, neighbor {{.*}} AS neighbor_entity
            LIMIT $limit
        """
        result = await session.run(query, entity_id=entity_id, limit=limit)
        results = []
        async for record in result:
            rel = _convert_neo4j_types(dict(record["relation"]))
            rel["direction"] = direction
            results.append({
                "relation": rel,
                "entity": _convert_neo4j_types(dict(record["neighbor_entity"])),
            })
        return results
