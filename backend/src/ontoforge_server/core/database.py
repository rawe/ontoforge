from neo4j import AsyncGraphDatabase, AsyncDriver

from ontoforge_server.config import settings

_driver: AsyncDriver | None = None

_CONSTRAINTS = [
    "CREATE CONSTRAINT ontology_id_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE",
    "CREATE CONSTRAINT ontology_name_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.name IS UNIQUE",
    "CREATE CONSTRAINT entity_type_id_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE",
    "CREATE CONSTRAINT relation_type_id_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE",
    "CREATE CONSTRAINT property_id_unique IF NOT EXISTS FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE",
]


async def _ensure_constraints(driver: AsyncDriver) -> None:
    async with driver.session() as session:
        for constraint in _CONSTRAINTS:
            await session.run(constraint)


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
