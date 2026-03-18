"""Shared fixtures for integration tests.

All integration tests start from a clean Neo4j database.
"""

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from neo4j import AsyncGraphDatabase

from ontoforge_server.config import settings
from ontoforge_server.runtime.service import invalidate_loaded_schema_cache


async def check_neo4j() -> bool:
    try:
        driver = AsyncGraphDatabase.driver(
            settings.DB_URI, auth=(settings.DB_USER, settings.DB_PASSWORD)
        )
        await driver.verify_connectivity()
        await driver.close()
        return True
    except Exception:
        return False


async def check_ollama_model(model: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("http://localhost:11434/api/tags")
            if resp.status_code != 200:
                return False
            models = [m["name"] for m in resp.json().get("models", [])]
            return any(model in m for m in models)
    except Exception:
        return False


async def wipe_neo4j():
    """Delete all nodes and relationships from the database."""
    driver = AsyncGraphDatabase.driver(
        settings.DB_URI, auth=(settings.DB_USER, settings.DB_PASSWORD)
    )
    async with driver.session() as session:
        await session.run("MATCH (n) DETACH DELETE n")
    await driver.close()
    invalidate_loaded_schema_cache()


@pytest.fixture
async def clean_db():
    """Wipe Neo4j before the test. Yields, then wipes again after."""
    await wipe_neo4j()
    yield
    await wipe_neo4j()


@pytest.fixture
async def integration_client(clean_db):
    """HTTP client connected to a real app with real Neo4j.

    Depends on clean_db to ensure a fresh database.
    """
    from ontoforge_server.core.database import close_driver, init_driver
    from ontoforge_server.main import create_app

    await init_driver()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_driver()
