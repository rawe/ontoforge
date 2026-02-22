"""Runtime test fixtures.

Provides a runtime-mode FastAPI app with mocked Neo4j driver and schema cache.
"""

import json
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.schemas import ExportPayload
from ontoforge_server.runtime.service import _build_schema_cache

import ontoforge_server.runtime.service as svc


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "test_ontology.json"


@pytest.fixture
def test_ontology_payload():
    """Load the test ontology fixture as a raw dict."""
    return json.loads(FIXTURE_PATH.read_text())


@pytest.fixture
def mock_driver():
    """Create a mock Neo4j async driver."""
    driver = AsyncMock()
    session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield session

    driver.session = _session
    return driver


@pytest.fixture
def mock_session(mock_driver):
    """Access the mock session directly for setting up return values."""
    session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield session

    mock_driver.session = _session
    return session


@pytest.fixture
def runtime_app(mock_driver):
    """Create a runtime-mode app with mocked driver and no-op lifespan.

    Patches settings in the main module to set SERVER_MODE='runtime',
    and replaces the lifespan so it does not attempt real DB connections.
    """

    @asynccontextmanager
    async def _noop_lifespan(app):
        yield

    mock_settings = MagicMock()
    mock_settings.SERVER_MODE = "runtime"
    mock_settings.DB_URI = "bolt://localhost:7688"
    mock_settings.DB_USER = "neo4j"
    mock_settings.DB_PASSWORD = "test"
    mock_settings.PORT = 8001

    with (
        patch("ontoforge_server.main.settings", mock_settings),
        patch("ontoforge_server.main.lifespan", _noop_lifespan),
    ):
        from ontoforge_server.main import create_app

        app = create_app()
        app.dependency_overrides[get_driver] = lambda: mock_driver
        return app


@pytest.fixture
async def client(runtime_app):
    """Async HTTP client wired to the runtime app."""
    transport = ASGITransport(app=runtime_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def setup_schema_cache(test_ontology_payload):
    """Pre-populate the schema cache for every test.

    Tests that need no cache (e.g. testing the 'not provisioned' path)
    should explicitly set ``svc._schema_cache = None`` inside the test body.
    """
    payload = ExportPayload.model_validate(test_ontology_payload)
    svc._schema_cache = _build_schema_cache(payload)
    yield
    svc._schema_cache = None
