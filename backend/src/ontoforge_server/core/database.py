import logging
from typing import Any

from neo4j import AsyncGraphDatabase, AsyncDriver

from ontoforge_server.config import settings
from ontoforge_server.core.exceptions import ValidationError

logger = logging.getLogger(__name__)

_driver: AsyncDriver | None = None
MAX_VECTOR_FILTER_VALUE_BYTES = 32766

_CONSTRAINTS = [
    "CREATE CONSTRAINT ontology_id_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE",
    "CREATE CONSTRAINT ontology_key_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.key IS UNIQUE",
    "CREATE CONSTRAINT ontology_name_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.name IS UNIQUE",
    "CREATE CONSTRAINT entity_type_id_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE",
    "CREATE CONSTRAINT entity_type_key_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.key IS UNIQUE",
    "CREATE CONSTRAINT relation_type_id_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE",
    "CREATE CONSTRAINT relation_type_key_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.key IS UNIQUE",
    "CREATE CONSTRAINT property_id_unique IF NOT EXISTS FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE",
    "CREATE CONSTRAINT entity_instance_id_unique IF NOT EXISTS FOR (n:_Entity) REQUIRE n._id IS UNIQUE",
    "CREATE INDEX entity_type_key_index IF NOT EXISTS FOR (n:_Entity) ON (n._entityTypeKey)",
    "CREATE CONSTRAINT agent_config_id_unique IF NOT EXISTS FOR (ac:AiAgentConfig) REQUIRE ac.agentConfigId IS UNIQUE",
    "CREATE CONSTRAINT saved_query_id_unique IF NOT EXISTS FOR (sq:SavedQuery) REQUIRE sq.savedQueryId IS UNIQUE",
]


def _to_pascal_case(key: str) -> str:
    """Convert a snake_case key to PascalCase."""
    return "".join(segment.capitalize() for segment in key.split("_"))


def validate_vector_indexed_properties(
    entity_type_key: str,
    properties: dict[str, Any],
    filter_properties: list[str],
    entity_id: str | None = None,
) -> None:
    """Reject string values that Neo4j cannot safely store in vector index metadata."""
    for property_key in filter_properties:
        value = properties.get(property_key)
        if value is None or not isinstance(value, str):
            continue
        value_bytes = len(value.encode("utf-8"))
        if value_bytes <= MAX_VECTOR_FILTER_VALUE_BYTES:
            continue

        entity_ref = f" on entity '{entity_id}'" if entity_id else ""
        raise ValidationError(
            f"Property '{property_key}'{entity_ref} is too large for semantic indexing "
            f"on type '{entity_type_key}' ({value_bytes} bytes > "
            f"{MAX_VECTOR_FILTER_VALUE_BYTES} bytes)",
            details={
                "fields": {
                    property_key: (
                        "Value exceeds Neo4j's semantic-index size limit "
                        f"({value_bytes} bytes > {MAX_VECTOR_FILTER_VALUE_BYTES} bytes)"
                    )
                }
            },
        )


async def _validate_existing_vector_indexed_properties(
    driver: AsyncDriver,
    pascal_label: str,
    entity_type_key: str,
    filter_properties: list[str],
) -> None:
    if not filter_properties:
        return

    async with driver.session() as session:
        result = await session.run(
            f"MATCH (n:{pascal_label}) RETURN n._id AS entity_id, n {{.*}} AS properties"
        )
        async for record in result:
            validate_vector_indexed_properties(
                entity_type_key,
                record["properties"] or {},
                filter_properties,
                entity_id=record["entity_id"],
            )


async def _drop_failed_index_if_exists(driver: AsyncDriver, index_name: str) -> None:
    async with driver.session() as session:
        result = await session.run(
            "SHOW INDEXES YIELD name, state WHERE name = $name RETURN state",
            name=index_name,
        )
        record = await result.single()
        if record and record["state"] == "FAILED":
            await session.run(f"DROP INDEX {index_name} IF EXISTS")
            logger.warning("Dropped failed vector index before recreate: %s", index_name)


async def _ensure_constraints(driver: AsyncDriver) -> None:
    async with driver.session() as session:
        for constraint in _CONSTRAINTS:
            await session.run(constraint)


async def ensure_vector_indexes(driver: AsyncDriver, dimensions: int) -> None:
    """Create vector indexes for all existing entity types (IF NOT EXISTS).

    New indexes include a WITH clause listing all current properties for
    in-index filtering (Neo4j 2026+ SEARCH clause). Existing indexes are
    left untouched.

    Also creates per-relation-type vector indexes for every relation type that
    has a non-null ``factTemplate`` (semantic relation types). These carry a
    fixed in-index filter list of Phase 0 reserved system properties.
    """
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (et:EntityType)
            OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
            RETURN et.key AS key, collect(p.key) AS property_keys
            """
        )
        entity_types = [
            {"key": record["key"], "property_keys": record["property_keys"]}
            async for record in result
        ]

    for et in entity_types:
        await create_vector_index(
            driver, et["key"], dimensions, filter_properties=et["property_keys"]
        )

    # Semantic relation types (factTemplate IS NOT NULL) → per-type relation index.
    async with driver.session() as session:
        rt_result = await session.run(
            "MATCH (rt:RelationType) WHERE rt.factTemplate IS NOT NULL "
            "RETURN rt.key AS key"
        )
        rel_type_keys = [record["key"] async for record in rt_result]

    for rt_key in rel_type_keys:
        await create_relation_vector_index(driver, rt_key, dimensions)

    # Saved query vector index (for semantic search over descriptions)
    await ensure_saved_query_vector_index(driver, dimensions)


async def drop_saved_query_vector_index(driver: AsyncDriver) -> None:
    """Drop the SavedQuery vector index if it exists (idempotent)."""
    async with driver.session() as session:
        await session.run("DROP INDEX saved_query_embedding IF EXISTS")
    logger.info("Vector index dropped: saved_query_embedding")


async def ensure_saved_query_vector_index(
    driver: AsyncDriver, dimensions: int
) -> None:
    """Create the vector index for SavedQuery descriptions (IF NOT EXISTS).

    Uses _ontologyKey as an in-index filter property so that semantic search
    can be scoped to a single ontology in one query.
    """
    query = (
        "CREATE VECTOR INDEX saved_query_embedding IF NOT EXISTS "
        "FOR (sq:SavedQuery) ON (sq._embedding) "
        "WITH [sq._ontologyKey] "
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: 'cosine'}}}}"
    )
    async with driver.session() as session:
        await session.run(query)
    logger.info("Vector index ensured: saved_query_embedding")


async def create_vector_index(
    driver: AsyncDriver,
    entity_type_key: str,
    dimensions: int,
    filter_properties: list[str] | None = None,
) -> None:
    """Create a vector index for the given entity type label.

    When *filter_properties* is provided, the index is created with a WITH
    clause so that those properties are stored alongside vectors for in-index
    filtering (Neo4j 2026+ SEARCH clause).
    """
    pascal_label = _to_pascal_case(entity_type_key)
    index_name = f"{entity_type_key}_embedding"
    selected_properties = [p for p in (filter_properties or []) if p]
    await _validate_existing_vector_indexed_properties(
        driver, pascal_label, entity_type_key, selected_properties
    )
    await _drop_failed_index_if_exists(driver, index_name)
    with_clause = ""
    if selected_properties:
        props = ", ".join(f"n.{p}" for p in selected_properties)
        with_clause = f"WITH [{props}] "
    query = (
        f"CREATE VECTOR INDEX {index_name} IF NOT EXISTS "
        f"FOR (n:{pascal_label}) ON (n._embedding) "
        f"{with_clause}"
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: 'cosine'}}}}"
    )
    async with driver.session() as session:
        await session.run(query)
    logger.info("Vector index ensured: %s", index_name)


async def drop_vector_index(driver: AsyncDriver, entity_type_key: str) -> None:
    """Drop the vector index for the given entity type."""
    index_name = f"{entity_type_key}_embedding"
    async with driver.session() as session:
        await session.run(f"DROP INDEX {index_name} IF EXISTS")
    logger.info("Vector index dropped: %s", index_name)


# --- Relation vector indexes (per semantic relation type) ---


def _to_upper_snake_case(key: str) -> str:
    return key.upper()


async def create_relation_vector_index(
    driver: AsyncDriver,
    relation_type_key: str,
    dimensions: int,
) -> None:
    """Create a relationship vector index for a semantic relation type.

    Idempotent (``IF NOT EXISTS``). The in-index property list mirrors the
    Phase 0 reservations so future temporal / group filters can be pushed into
    the SEARCH clause without re-indexing.
    """
    index_name = f"{relation_type_key}_relation_embedding"
    rel_type_upper = _to_upper_snake_case(relation_type_key)
    await _drop_failed_index_if_exists(driver, index_name)
    query = (
        f"CREATE VECTOR INDEX {index_name} IF NOT EXISTS "
        f"FOR ()-[r:{rel_type_upper}]-() ON (r._embedding) "
        f"WITH [r._groupId, r._validAt, r._invalidAt, r._relationTypeKey] "
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: 'cosine'}}}}"
    )
    async with driver.session() as session:
        await session.run(query)
    logger.info("Relation vector index ensured: %s", index_name)


async def drop_relation_vector_index(
    driver: AsyncDriver, relation_type_key: str
) -> None:
    index_name = f"{relation_type_key}_relation_embedding"
    async with driver.session() as session:
        await session.run(f"DROP INDEX {index_name} IF EXISTS")
    logger.info("Relation vector index dropped: %s", index_name)


async def rebuild_vector_index(
    driver: AsyncDriver, entity_type_key: str, dimensions: int
) -> None:
    """Drop and recreate the vector index with current properties.

    Called when properties are added or removed from an entity type so that
    the in-index filter properties stay in sync with the schema.
    """
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (et:EntityType {key: $key})
            OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
            RETURN collect(p.key) AS property_keys
            """,
            key=entity_type_key,
        )
        record = await result.single()
        property_keys = record["property_keys"] if record else []

    await _validate_existing_vector_indexed_properties(
        driver, _to_pascal_case(entity_type_key), entity_type_key, property_keys
    )
    await drop_vector_index(driver, entity_type_key)
    await create_vector_index(
        driver, entity_type_key, dimensions, filter_properties=property_keys
    )


async def _backfill_phase0_system_properties(driver: AsyncDriver) -> None:
    """One-shot idempotent backfill of Phase 0 system properties on every entity
    and every relation edge.

    Sets ``_groupId = "default"``, ``_embeddingState`` (derived from the presence
    of ``_embedding``), and ``_embeddingVersion = 1`` on rows where those fields
    are null. Leaves ``_validAt`` and ``_invalidAt`` null — temporal is deferred.
    """
    async with driver.session() as session:
        await session.run(
            """
            MATCH (n:_Entity)
            WHERE n._groupId IS NULL
            SET n._groupId = 'default',
                n._embeddingState = coalesce(
                    n._embeddingState,
                    CASE WHEN n._embedding IS NULL THEN 'failed' ELSE 'ok' END
                ),
                n._embeddingVersion = coalesce(n._embeddingVersion, 1)
            """
        )
        await session.run(
            """
            MATCH ()-[r]-()
            WHERE r._id IS NOT NULL AND r._groupId IS NULL
            SET r._groupId = 'default',
                r._embeddingState = coalesce(
                    r._embeddingState,
                    CASE WHEN r._embedding IS NULL THEN 'failed' ELSE 'ok' END
                ),
                r._embeddingVersion = coalesce(r._embeddingVersion, 1)
            """
        )


async def init_driver() -> AsyncDriver:
    global _driver
    _driver = AsyncGraphDatabase.driver(
        settings.DB_URI,
        auth=(settings.DB_USER, settings.DB_PASSWORD),
    )
    await _driver.verify_connectivity()
    await _ensure_constraints(_driver)
    await _backfill_phase0_system_properties(_driver)
    return _driver


async def get_driver() -> AsyncDriver:
    assert _driver is not None, "Neo4j driver not initialized"
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None
