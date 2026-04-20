from datetime import date, datetime, timezone
from typing import Any

from neo4j import AsyncSession
from neo4j.graph import Node, Relationship
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
    """Create an entity instance node with dual labels: _Entity and the PascalCase type label.

    Every entity also receives the Phase 0 system properties: ``_groupId``,
    ``_validAt``, ``_invalidAt``, ``_embeddingState`` and ``_embeddingVersion``.
    """
    embedding_clause = ", _embedding: $embedding" if embedding is not None else ""
    embedding_state = "ok" if embedding is not None else "failed"
    result = await session.run(
        f"""
        CREATE (n:_Entity:{pascal_label} {{
            _id: $entity_id,
            _entityTypeKey: $entity_type_key,
            _createdAt: datetime(),
            _updatedAt: datetime(),
            _groupId: $group_id,
            _validAt: null,
            _invalidAt: null,
            _embeddingState: $embedding_state,
            _embeddingVersion: 1{embedding_clause}
        }})
        SET n += $properties
        RETURN n {{.*}} AS entity
        """,
        entity_id=entity_id,
        entity_type_key=entity_type_key,
        properties=properties,
        embedding=embedding,
        group_id="default",
        embedding_state=embedding_state,
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
        # Re-embed: refresh the embedding and reflect its state.
        if embedding is not None:
            set_clause += ", n._embedding = $embedding, n._embeddingState = 'ok'"
        else:
            set_clause += ", n._embedding = null, n._embeddingState = 'failed'"
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

    # M2 §6.2: when user properties actually changed, flip every adjacent
    # semantic relation to stale so the background reconcile worker re-renders
    # the fact against the updated entity props. Undirected `-[r]-()` covers
    # source- and target-facing edges in one pass; the `_factVersion IS NOT
    # NULL` predicate isolates semantic relations from structural ones.
    if set_properties or remove_properties:
        await session.run(
            """
            MATCH (n:_Entity {_id: $entity_id})-[r]-()
            WHERE r._factVersion IS NOT NULL
            SET r._embeddingState = 'stale'
            """,
            entity_id=entity_id,
        )

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
    fact: str | None = None,
    fact_version: int | None = None,
    embedding: list[float] | None = None,
    embedding_state: str = "ok",
    embedding_version: int = 1,
) -> dict:
    """Create a relation edge with Phase 0 system properties.

    Semantic relations additionally receive ``_fact``, ``_factVersion``, and
    ``_embedding`` / ``_embeddingState`` / ``_embeddingVersion`` per §6.1.
    Non-semantic relations still carry the Phase 0 reservations (``_groupId``,
    ``_validAt``, ``_invalidAt``) but leave the embedding state at ``"ok"``.
    """
    extra_clauses: list[str] = []
    params: dict = {
        "from_entity_id": from_entity_id,
        "to_entity_id": to_entity_id,
        "relation_id": relation_id,
        "relation_type_key": relation_type_key,
        "properties": properties,
        "group_id": "default",
        "embedding_state": embedding_state,
        "embedding_version": embedding_version,
    }
    if fact is not None:
        extra_clauses.append("_fact: $fact")
        params["fact"] = fact
    if fact_version is not None:
        extra_clauses.append("_factVersion: $fact_version")
        params["fact_version"] = fact_version
    if embedding is not None:
        extra_clauses.append("_embedding: $embedding")
        params["embedding"] = embedding

    extra_fragment = ("," + ", ".join(extra_clauses)) if extra_clauses else ""

    result = await session.run(
        f"""
        MATCH (from:_Entity {{_id: $from_entity_id}})
        MATCH (to:_Entity {{_id: $to_entity_id}})
        CREATE (from)-[r:{rel_type_upper} {{
            _id: $relation_id,
            _relationTypeKey: $relation_type_key,
            _createdAt: datetime(),
            _updatedAt: datetime(),
            _groupId: $group_id,
            _validAt: null,
            _invalidAt: null,
            _embeddingState: $embedding_state,
            _embeddingVersion: $embedding_version{extra_fragment}
        }}]->(to)
        SET r += $properties
        RETURN r {{.*}} AS relation,
               from._id AS fromEntityId,
               to._id AS toEntityId
        """,
        **params,
    )
    record = await result.single()
    rel = _convert_neo4j_types(record["relation"])
    rel.pop("_embedding", None)
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
        rel.pop("_embedding", None)
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
    rel.pop("_embedding", None)
    rel["fromEntityId"] = record["fromEntityId"]
    rel["toEntityId"] = record["toEntityId"]
    return rel


async def update_relation(
    session: AsyncSession,
    rel_type_upper: str,
    relation_id: str,
    set_properties: dict,
    remove_properties: list[str],
    fact: str | None = None,
    fact_version: int | None = None,
    embedding: list[float] | None = None,
    has_embedding_update: bool = False,
    embedding_state: str | None = None,
) -> dict | None:
    set_clause = (
        "SET r += $set_properties, r._updatedAt = datetime()"
        if set_properties
        else "SET r._updatedAt = datetime()"
    )
    extra_set_params: dict = {}
    if fact is not None:
        set_clause += ", r._fact = $fact"
        extra_set_params["fact"] = fact
    if fact_version is not None:
        set_clause += ", r._factVersion = $fact_version"
        extra_set_params["fact_version"] = fact_version
    if has_embedding_update:
        if embedding is not None:
            set_clause += ", r._embedding = $embedding, r._embeddingState = 'ok'"
            extra_set_params["embedding"] = embedding
        else:
            set_clause += ", r._embedding = null, r._embeddingState = 'failed'"
    elif embedding_state is not None:
        set_clause += ", r._embeddingState = $embedding_state"
        extra_set_params["embedding_state"] = embedding_state

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
        **extra_set_params,
    )
    record = await result.single()
    if not record:
        return None
    rel = _convert_neo4j_types(record["relation"])
    rel.pop("_embedding", None)
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
    pascal_label: str,
    entity_type_key: str,
    query_embedding: list[float],
    limit: int,
    min_score: float | None,
    where_clauses: list[str] | None = None,
    filter_params: dict | None = None,
    index_name: str | None = None,
) -> list[dict]:
    """Semantic search using the Cypher 25 SEARCH clause with in-index filtering."""
    if index_name is None:
        index_name = f"{entity_type_key}_embedding"

    params: dict = {
        "query_embedding": query_embedding,
        "limit": limit,
    }

    in_index_where = ""
    if where_clauses:
        in_index_where = "WHERE " + " AND ".join(where_clauses)
        params.update(filter_params or {})

    query = (
        f"MATCH (n:{pascal_label}) "
        f"SEARCH n IN ("
        f"VECTOR INDEX {index_name} "
        f"FOR $query_embedding "
        f"{in_index_where} "
        f"LIMIT $limit"
        f") SCORE AS score "
        f"RETURN n {{.*}} AS entity, score"
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


# --- Cypher Query ---


def _convert_record_value(value: Any) -> Any:
    """Convert a single Neo4j record value to a JSON-friendly Python type."""
    if isinstance(value, Node):
        data = _strip_embedding(_convert_neo4j_types(dict(value)))
        return data
    if isinstance(value, Relationship):
        return _convert_neo4j_types(dict(value))
    if isinstance(value, Neo4jDateTime):
        native = value.to_native()
        return native.replace(tzinfo=timezone.utc) if value.tzinfo else datetime(
            value.year, value.month, value.day,
            value.hour, value.minute, value.second,
            value.nanosecond // 1000,
            tzinfo=timezone.utc,
        )
    if isinstance(value, Neo4jDate):
        return date(value.year, value.month, value.day)
    if isinstance(value, list):
        return [_convert_record_value(v) for v in value]
    if isinstance(value, dict):
        return {k: _convert_record_value(v) for k, v in value.items()}
    return value


async def execute_cypher_read(
    session: AsyncSession,
    cypher: str,
    params: dict[str, Any] | None = None,
) -> tuple[list[str], list[dict]]:
    """Execute a read-only Cypher query and return (columns, rows).

    Each row is a dict mapping column names to converted Python values.
    Nodes and Relationships are returned as plain dicts of their properties.
    """
    result = await session.run(cypher, parameters=(params or {}))
    columns = list(result.keys())
    rows: list[dict] = []
    async for record in result:
        row: dict[str, Any] = {}
        for col in columns:
            row[col] = _convert_record_value(record[col])
        rows.append(row)
    return columns, rows


# --- AI Agent Config ---


async def get_ai_agent_configs(
    session: AsyncSession, ontology_key: str
) -> list[dict]:
    """Query AiAgentConfig nodes for an ontology by key."""
    result = await session.run(
        """
        MATCH (o:Ontology {key: $ontology_key})-[:HAS_AI_AGENT]->(ac:AiAgentConfig)
        RETURN ac.key AS key, ac.name AS name, ac.description AS description,
               ac.systemPrompt AS systemPrompt, ac.tools AS tools
        ORDER BY ac.name
        """,
        ontology_key=ontology_key,
    )
    return [dict(record) async for record in result]


async def get_saved_queries(
    session: AsyncSession, ontology_key: str
) -> list[dict]:
    """Query SavedQuery nodes for an ontology by key."""
    result = await session.run(
        """
        MATCH (o:Ontology {key: $ontology_key})-[:HAS_SAVED_QUERY]->(sq:SavedQuery)
        RETURN sq.key AS key, sq.name AS name, sq.description AS description,
               sq.steps AS steps, sq.parameters AS parameters
        ORDER BY sq.name
        """,
        ontology_key=ontology_key,
    )
    return [dict(record) async for record in result]


async def search_saved_queries(
    session: AsyncSession,
    query_embedding: list[float],
    ontology_key: str,
    limit: int,
    min_score: float | None,
) -> list[dict]:
    """Semantic search over SavedQuery descriptions using the vector index.

    Scoped to a single ontology via in-index filtering on _ontologyKey.
    """
    query = (
        "MATCH (sq:SavedQuery) "
        "SEARCH sq IN ("
        "VECTOR INDEX saved_query_embedding "
        "FOR $query_embedding "
        "WHERE sq._ontologyKey = $ontology_key "
        "LIMIT $limit"
        ") SCORE AS score "
        "RETURN sq.key AS key, sq.name AS name, sq.description AS description, "
        "sq.parameters AS parameters, score"
    )

    result = await session.run(
        query,
        query_embedding=query_embedding,
        ontology_key=ontology_key,
        limit=limit,
    )

    items = []
    async for record in result:
        score = record["score"]
        if min_score is not None and score < min_score:
            continue
        items.append({
            "key": record["key"],
            "name": record["name"],
            "description": record["description"],
            "parameters": record["parameters"],
            "score": score,
        })
    return items
