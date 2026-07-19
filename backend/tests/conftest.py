from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from ontoforge_server.adapters.neo4j.driver import get_driver
from ontoforge_server.core.ports import get_modeling_store, get_runtime_store


@asynccontextmanager
async def _noop_lifespan(app):
    yield


@pytest.fixture(autouse=True)
def clear_runtime_schema_cache():
    from ontoforge_server.runtime import service as runtime_service

    runtime_service.invalidate_loaded_schema_cache()
    yield
    runtime_service.invalidate_loaded_schema_cache()


@pytest.fixture
def mock_driver():
    driver = AsyncMock()
    mock_session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield mock_session

    driver.session = _session
    return driver


@pytest.fixture
def app(mock_driver):
    from ontoforge_server.adapters.neo4j.modeling_store import Neo4jModelingStore
    from ontoforge_server.adapters.neo4j.runtime_store import Neo4jRuntimeStore

    with patch("ontoforge_server.main.lifespan", _noop_lifespan):
        from ontoforge_server.main import create_app

        application = create_app()
    application.dependency_overrides[get_driver] = lambda: mock_driver
    # Stores wrap the mocked driver; tests stub the adapter query modules.
    application.dependency_overrides[get_modeling_store] = (
        lambda: Neo4jModelingStore(mock_driver)
    )
    application.dependency_overrides[get_runtime_store] = (
        lambda: Neo4jRuntimeStore(mock_driver)
    )
    return application


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
