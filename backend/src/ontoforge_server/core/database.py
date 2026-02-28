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
    "CREATE CONSTRAINT relation_type_id_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE",
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
    """Create vector indexes for all existing entity types across all ontologies."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (o:Ontology)-[:HAS_ENTITY_TYPE]->(et:EntityType)
            RETURN et.key AS key
            """
        )
        keys = [record["key"] async for record in result]

    for key in keys:
        await create_vector_index(driver, key, dimensions)


async def create_vector_index(driver: AsyncDriver, entity_type_key: str, dimensions: int) -> None:
    """Create a vector index for the given entity type label."""
    pascal_label = _to_pascal_case(entity_type_key)
    index_name = f"{entity_type_key}_embedding"
    query = (
        f"CREATE VECTOR INDEX {index_name} IF NOT EXISTS "
        f"FOR (n:{pascal_label}) ON (n._embedding) "
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
