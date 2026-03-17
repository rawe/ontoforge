import logging

from neo4j import AsyncGraphDatabase, AsyncDriver

from ontoforge_server.config import settings

logger = logging.getLogger(__name__)

_driver: AsyncDriver | None = None

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
]


def _to_pascal_case(key: str) -> str:
    """Convert a snake_case key to PascalCase."""
    return "".join(segment.capitalize() for segment in key.split("_"))


async def _ensure_constraints(driver: AsyncDriver) -> None:
    async with driver.session() as session:
        for constraint in _CONSTRAINTS:
            await session.run(constraint)


async def ensure_vector_indexes(driver: AsyncDriver, dimensions: int) -> None:
    """Create vector indexes for all existing entity types (IF NOT EXISTS).

    New indexes include a WITH clause listing all current properties for
    in-index filtering (Neo4j 2026+ SEARCH clause). Existing indexes are
    left untouched.
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
    with_clause = ""
    if filter_properties:
        props = ", ".join(f"n.{p}" for p in filter_properties)
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

    await drop_vector_index(driver, entity_type_key)
    await create_vector_index(
        driver, entity_type_key, dimensions, filter_properties=property_keys
    )


async def init_driver() -> AsyncDriver:
    global _driver
    _driver = AsyncGraphDatabase.driver(
        settings.DB_URI,
        auth=(settings.DB_USER, settings.DB_PASSWORD),
    )
    await _driver.verify_connectivity()
    await _ensure_constraints(_driver)
    return _driver


async def get_driver() -> AsyncDriver:
    assert _driver is not None, "Neo4j driver not initialized"
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None
