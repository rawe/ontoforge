"""Shared fixtures for integration tests.

This is the adapter conformance suite: it talks to a real database through
the persistence port, selected by ``DB_BACKEND`` (plus the adapter's own
connection settings). All tests start from a wiped database.
"""

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from ontoforge_server.core import ports
from ontoforge_server.runtime.service import invalidate_loaded_schema_cache


async def check_database() -> bool:
    """True when the configured database adapter can connect."""
    try:
        await ports.init_stores()
        await ports.close_stores()
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


async def wipe_database():
    """Delete all stored data through the active adapter."""
    await ports.init_stores()
    await ports.wipe_database()
    await ports.close_stores()
    invalidate_loaded_schema_cache()



@pytest.fixture
async def clean_db():
    """Wipe the database before the test. Yields, then wipes again after."""
    await wipe_database()
    yield
    await wipe_database()


@pytest.fixture
async def integration_client(clean_db):
    """HTTP client connected to a real app with a real database.

    Depends on clean_db to ensure a fresh database.
    """
    from ontoforge_server.main import create_app

    await ports.init_stores()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await ports.close_stores()
