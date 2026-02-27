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


FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "test_ontology.json"

# The ontology key used in the test fixture, used for route prefixes
ONTOLOGY_KEY = "test_ontology"

# Module-level cache reference for tests that need to modify it
_test_cache = None


def _build_test_cache(data: dict):
    """Build a SchemaCache from the test fixture data."""
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
    return _build_schema_cache(ontology_export, entity_types, relation_types)


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


@pytest.fixture
def schema_cache(test_ontology_payload):
    """Build and return the test schema cache for direct access in tests."""
    return _build_test_cache(test_ontology_payload)


@pytest.fixture(autouse=True)
def setup_schema_cache(test_ontology_payload):
    """Patch _load_schema to return the test schema cache.

    Tests that need the 'ontology not found' path should override this by
    patching _load_schema to raise NotFoundError.
    """
    global _test_cache
    _test_cache = _build_test_cache(test_ontology_payload)

    with patch(
        "ontoforge_server.runtime.service._load_schema",
        return_value=_test_cache,
    ):
        yield _test_cache

    _test_cache = None
