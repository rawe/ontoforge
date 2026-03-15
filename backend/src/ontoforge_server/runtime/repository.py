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

    Loads ALL entity types and relation types globally (not scoped to ontology),
    plus INCLUDES_TYPE edges from this ontology for scope filtering.
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

    # Get ALL entity types with properties (global, no ontology traversal)
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

    # Get ALL relation types with properties and source/target keys
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

    # Load INCLUDES_TYPE edges from this ontology
    inc_result = await session.run(
        """
        MATCH (o:Ontology {ontologyId: $ontology_id})-[r:INCLUDES_TYPE]->(t)
        RETURN t.key AS key, labels(t)[0] AS label, r.properties AS properties
        """,
        ontology_id=ontology_id,
    )
    entity_inclusions = []
    relation_inclusions = []
    async for record in inc_result:
        entry = {"key": record["key"], "properties": record["properties"]}
        if record["label"] == "EntityType":
            entity_inclusions.append(entry)
        elif record["label"] == "RelationType":
            relation_inclusions.append(entry)

    return {
        "ontology": ontology,
        "entityTypes": entity_types,
        "relationTypes": relation_types,
        "entityInclusions": entity_inclusions,
        "relationInclusions": relation_inclusions,
    }


# --- Entity Instance CRUD ---


async def create_entity(
    session: AsyncSession,
    entity_type_key: str,
    pascal_label: str,
    entity_id: str,
    properties: dict,
    embedding: list[float] | None = None,
) -> dict:
    """Create an entity instance node with dual labels: _Entity and the PascalCase type label."""
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
    """List entity instances with filtering, sorting, and pagination."""
    base_where = "n._entityTypeKey = $entity_type_key"
    if where_clauses:
        where_str = f"WHERE {base_where} AND " + " AND ".join(where_clauses)
    else:
        where_str = f"WHERE {base_where}"

    params["entity_type_key"] = entity_type_key

    count_query = f"MATCH (n:_Entity:{pascal_label}) {where_str} RETURN count(n) AS total"
    count_result = await session.run(count_query, params)
    count_record = await count_result.single()
    total = count_record["total"]

    if total == 0:
        return [], 0

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
    base_where = "r._relationTypeKey = $relation_type_key"
    if where_clauses:
        where_str = f"WHERE {base_where} AND " + " AND ".join(where_clauses)
    else:
        where_str = f"WHERE {base_where}"

    params["relation_type_key"] = relation_type_key

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
    if relation_type_filter:
        rel_pattern = f"[r:{relation_type_filter}]"
    else:
        rel_pattern = "[r]"

    if direction == "both":
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
        else:
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
    entity_type_key: str,
    query_embedding: list[float],
    vector_limit: int,
    limit: int,
    min_score: float | None,
    where_clauses: list[str] | None = None,
    filter_params: dict | None = None,
    index_name: str | None = None,
) -> list[dict]:
    if index_name is None:
        index_name = f"{entity_type_key}_embedding"

    params: dict = {
        "index_name": index_name,
        "vector_limit": vector_limit,
        "query_embedding": query_embedding,
    }

    if where_clauses:
        where_str = "WHERE " + " AND ".join(where_clauses)
        params.update(filter_params or {})
        params["limit"] = limit
        query = (
            f"CALL db.index.vector.queryNodes($index_name, $vector_limit, $query_embedding) "
            f"YIELD node, score "
            f"{where_str} "
            f"RETURN node {{.*}} AS entity, score "
            f"ORDER BY score DESC "
            f"LIMIT $limit"
        )
    else:
        query = (
            f"CALL db.index.vector.queryNodes($index_name, $vector_limit, $query_embedding) "
            f"YIELD node, score "
            f"RETURN node {{.*}} AS entity, score "
            f"ORDER BY score DESC"
        )

    result = await session.run(query, params)

    items = []
    async for record in result:
        entity = _strip_embedding(_convert_neo4j_types(dict(record["entity"])))
        score = record["score"]
        if min_score is not None and score < min_score:
            continue
        items.append({"entity": entity, "score": score})

    return items
