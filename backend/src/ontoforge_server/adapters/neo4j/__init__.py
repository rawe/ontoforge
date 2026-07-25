"""Neo4j persistence adapter.

Implements the persistence port (see ``core/ports.py``) on Neo4j. Everything
Neo4j-specific — the bolt driver, Cypher text, labels, index DDL, driver
temporal types — lives inside this package and must not be imported from
anywhere else in the server.
"""

from ontoforge_server.adapters.neo4j.driver import close_driver, get_driver, init_driver
from ontoforge_server.adapters.neo4j.errors import open_session


async def create_stores():
    """Initialize the Neo4j adapter and return (modeling_store, runtime_store)."""
    from ontoforge_server.adapters.neo4j.modeling_store import Neo4jModelingStore
    from ontoforge_server.adapters.neo4j.runtime_store import Neo4jRuntimeStore

    driver = await init_driver()
    return Neo4jModelingStore(driver), Neo4jRuntimeStore(driver)


async def close_stores() -> None:
    await close_driver()


async def ensure_semantic_indexes(dimensions: int) -> None:
    """Ensure all vector indexes exist for the configured dimensions."""
    from ontoforge_server.adapters.neo4j import ddl

    await ddl.ensure_vector_indexes(await get_driver(), dimensions)


async def wipe() -> None:
    """Delete all stored data. Test support only — never used by the app."""
    driver = await get_driver()
    async with open_session(driver) as session:
        await session.run("MATCH (n) DETACH DELETE n")
