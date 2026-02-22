"""Runtime test fixtures.

Provides a FastAPI app with mocked Neo4j driver and schema cache.
"""

import json
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.schemas import (
    ExportEntityType,
    ExportOntology,
    ExportProperty,
    ExportRelationType,
)
from ontoforge_server.runtime.service import _build_schema_cache

import ontoforge_server.runtime.service as svc


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "test_ontology.json"

# The ontology key used in the test fixture, used for route prefixes
ONTOLOGY_KEY = "test_ontology"


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


@asynccontextmanager
async def _noop_lifespan(app):
    yield


@pytest.fixture
def runtime_app(mock_driver):
    """Create a unified app with mocked driver and no-op lifespan."""
    with patch("ontoforge_server.main.lifespan", _noop_lifespan):
        from ontoforge_server.main import create_app

        app = create_app()
    app.dependency_overrides[get_driver] = lambda: mock_driver
    return app


@pytest.fixture
async def client(runtime_app):
    """Async HTTP client wired to the app."""
    transport = ASGITransport(app=runtime_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def setup_schema_cache(test_ontology_payload):
    """Pre-populate the schema caches dict for every test.

    Tests that need no cache (e.g. testing the 'ontology not found' path)
    should explicitly clear ``svc._schema_caches`` inside the test body.
    """
    data = test_ontology_payload
    ont = data["ontology"]
    ontology_export = ExportOntology(
        ontologyId=ont["ontologyId"],
        key=ont["key"],
        name=ont["name"],
        description=ont.get("description"),
    )
    entity_types = [
        ExportEntityType(
            key=et["key"],
            displayName=et["displayName"],
            description=et.get("description"),
            properties=[
                ExportProperty(
                    key=p["key"],
                    displayName=p["displayName"],
                    description=p.get("description"),
                    dataType=p["dataType"],
                    required=p["required"],
                    defaultValue=p.get("defaultValue"),
                )
                for p in et.get("properties", [])
            ],
        )
        for et in data["entityTypes"]
    ]
    relation_types = [
        ExportRelationType(
            key=rt["key"],
            displayName=rt["displayName"],
            description=rt.get("description"),
            fromEntityTypeKey=rt["fromEntityTypeKey"],
            toEntityTypeKey=rt["toEntityTypeKey"],
            properties=[
                ExportProperty(
                    key=p["key"],
                    displayName=p["displayName"],
                    description=p.get("description"),
                    dataType=p["dataType"],
                    required=p["required"],
                    defaultValue=p.get("defaultValue"),
                )
                for p in rt.get("properties", [])
            ],
        )
        for rt in data["relationTypes"]
    ]
    cache = _build_schema_cache(ontology_export, entity_types, relation_types)
    svc._schema_caches[ONTOLOGY_KEY] = cache
    yield
    svc._schema_caches.clear()
