from datetime import date, datetime, timezone

from neo4j import AsyncSession
from neo4j.time import Date as Neo4jDate
from neo4j.time import DateTime as Neo4jDateTime


def _strip_embedding(data: dict) -> dict:
    """Remove _embedding from entity dict (768 floats should never appear in API responses)."""
    data.pop("_embedding", None)
    return data


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


# --- Schema Reading (for cache rebuild from DB) ---


async def get_full_schema(session: AsyncSession, ontology_key: str) -> dict | None:
    """Read the full schema for a specific ontology by key.

    Returns None if no matching Ontology node exists.
    """
    ont_result = await session.run(
        "MATCH (o:Ontology {key: $key}) RETURN o {.*} AS ontology",
        key=ontology_key,
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


async def get_all_ontology_keys(session: AsyncSession) -> list[str]:
    """Return all ontology keys in the database."""
    result = await session.run("MATCH (o:Ontology) RETURN o.key AS key ORDER BY o.key")
    return [record["key"] async for record in result]


# --- Instance Data Wipe ---


async def wipe_instance_data(
    session: AsyncSession, entity_type_keys: list[str],
) -> tuple[int, int]:
    """Delete all entity instances (and their relationships) for the given entity type keys.

    Returns (entities_deleted, relations_deleted).
    """
    # First count relationships that will be deleted
    rel_result = await session.run(
        """
        MATCH (n:_Entity)-[r]-()
        WHERE n._entityTypeKey IN $keys
        RETURN count(DISTINCT r) AS rel_count
        """,
        keys=entity_type_keys,
    )
    rel_record = await rel_result.single()
    relations_deleted = rel_record["rel_count"]

    # Delete entities with DETACH DELETE (removes relationships too)
    del_result = await session.run(
        """
        MATCH (n:_Entity)
        WHERE n._entityTypeKey IN $keys
        DETACH DELETE n
        RETURN count(n) AS deleted
        """,
        keys=entity_type_keys,
    )
    del_record = await del_result.single()
    entities_deleted = del_record["deleted"]

    return entities_deleted, relations_deleted


# --- Entity Instance CRUD ---


async def create_entity(
    session: AsyncSession,
    entity_type_key: str,
    pascal_label: str,
    entity_id: str,
    properties: dict,
    embedding: list[float] | None = None,
) -> dict:
    """Create an entity instance node with dual labels: _Entity and the PascalCase type label.

    The pascal_label comes from the SchemaCache (safe for Cypher label interpolation).
    All property values are passed via the $properties map parameter.
    """
    embedding_clause = ", _embedding: $embedding" if embedding is not None else ""
    result = await session.run(
        f"""
        CREATE (n:_Entity:{pascal_label} {{
            _id: $entity_id,
            _entityTypeKey: $entity_type_key,
            _createdAt: datetime(),
            _updatedAt: datetime(){embedding_clause}
        }})
        SET n += $properties
        RETURN n {{.*}} AS entity
        """,
        entity_id=entity_id,
        entity_type_key=entity_type_key,
        properties=properties,
        embedding=embedding,
    )
    record = await result.single()
    return _strip_embedding(_convert_neo4j_types(record["entity"]))


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
    items = [_strip_embedding(_convert_neo4j_types(record["entity"])) async for record in data_result]

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
    return _strip_embedding(_convert_neo4j_types(record["entity"]))


async def update_entity(
    session: AsyncSession,
    pascal_label: str,
    entity_id: str,
    set_properties: dict,
    remove_properties: list[str],
    embedding: list[float] | None = None,
    has_embedding_update: bool = False,
) -> dict | None:
    """Partial update: set some properties, remove others (null values).

    set_properties: dict of {key: coerced_value} to set
    remove_properties: list of property keys to remove (nulled out)
    embedding: new embedding vector (or None to clear)
    has_embedding_update: True if embedding should be written (even if None)
    """
    set_clause = (
        "SET n += $set_properties, n._updatedAt = datetime()"
        if set_properties
        else "SET n._updatedAt = datetime()"
    )
    if has_embedding_update:
        set_clause += ", n._embedding = $embedding"
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
        embedding=embedding,
    )
    record = await result.single()
    if not record:
        return None
    return _strip_embedding(_convert_neo4j_types(record["entity"]))


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
    return _strip_embedding(_convert_neo4j_types(record["entity"])) if record else None


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
                "entity": _strip_embedding(_convert_neo4j_types(dict(record["neighbor_entity"]))),
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
                    "entity": _strip_embedding(_convert_neo4j_types(dict(record["neighbor_entity"]))),
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
                "entity": _strip_embedding(_convert_neo4j_types(dict(record["neighbor_entity"]))),
            })
        return results


# --- Semantic Search ---


async def semantic_search(
    session: AsyncSession,
    pascal_label: str | None,
    entity_type_key: str | None,
    query_embedding: list[float],
    limit: int,
    min_score: float | None,
    index_name: str | None = None,
) -> list[dict]:
    """Vector similarity search on entity embeddings.

    If pascal_label/index_name are provided, searches a single type's index.
    Returns list of dicts with 'entity' and 'score' keys.
    """
    if index_name is None and entity_type_key is not None:
        index_name = f"{entity_type_key}_embedding"

    result = await session.run(
        f"CALL db.index.vector.queryNodes($index_name, $limit, $query_embedding) "
        f"YIELD node, score "
        f"RETURN node {{.*}} AS entity, score "
        f"ORDER BY score DESC",
        index_name=index_name,
        limit=limit,
        query_embedding=query_embedding,
    )

    items = []
    async for record in result:
        entity = _strip_embedding(_convert_neo4j_types(dict(record["entity"])))
        score = record["score"]
        if min_score is not None and score < min_score:
            continue
        items.append({"entity": entity, "score": score})

    return items
