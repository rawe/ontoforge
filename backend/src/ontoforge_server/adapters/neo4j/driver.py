"""Neo4j driver lifecycle and schema constraints.

Adapter-private: nothing outside ``adapters.neo4j`` may import the driver.
"""

import logging

from neo4j import AsyncDriver, AsyncGraphDatabase
from neo4j.exceptions import DriverError, Neo4jError

from ontoforge_server.adapters.neo4j.errors import open_session, to_store_error
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
    "CREATE CONSTRAINT agent_config_id_unique IF NOT EXISTS FOR (ac:AiAgentConfig) REQUIRE ac.agentConfigId IS UNIQUE",
    "CREATE CONSTRAINT saved_query_id_unique IF NOT EXISTS FOR (sq:SavedQuery) REQUIRE sq.savedQueryId IS UNIQUE",
]


async def _ensure_constraints(driver: AsyncDriver) -> None:
    async with open_session(driver) as session:
        for constraint in _CONSTRAINTS:
            await session.run(constraint)


async def init_driver() -> AsyncDriver:
    global _driver
    _driver = AsyncGraphDatabase.driver(
        settings.DB_URI,
        auth=(settings.DB_USER, settings.DB_PASSWORD),
    )
    try:
        await _driver.verify_connectivity()
    except (Neo4jError, DriverError) as exc:
        raise to_store_error(exc) from exc
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
