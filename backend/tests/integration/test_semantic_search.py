"""Integration tests for semantic search.

Requires running Neo4j and Ollama instances. Skip if unavailable.
Run with: uv run pytest tests/integration/ -v
"""

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from ontoforge_server.config import settings
from ontoforge_server.core.database import close_driver, init_driver, get_driver
from ontoforge_server.core.embedding import (
    close_embedding_provider,
    get_embedding_provider,
    init_embedding_provider,
)
from ontoforge_server.main import create_app


async def _check_neo4j():
    """Check if Neo4j is reachable."""
    try:
        from neo4j import AsyncGraphDatabase
        driver = AsyncGraphDatabase.driver(
            settings.DB_URI, auth=(settings.DB_USER, settings.DB_PASSWORD)
        )
        await driver.verify_connectivity()
        await driver.close()
        return True
    except Exception:
        return False


async def _check_ollama():
    """Check if Ollama is reachable and has the required model."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.EMBEDDING_BASE_URL}/api/tags")
            if resp.status_code != 200:
                return False
            models = [m["name"] for m in resp.json().get("models", [])]
            return any(settings.EMBEDDING_MODEL in m for m in models)
    except Exception:
        return False


# These tests require both Neo4j and Ollama
pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
async def services_available():
    """Skip the entire module if Neo4j or Ollama aren't available."""
    neo4j_ok = await _check_neo4j()
    if not neo4j_ok:
        pytest.skip("Neo4j not available")
    ollama_ok = await _check_ollama()
    if not ollama_ok:
        pytest.skip("Ollama not available or model not pulled")


@pytest.fixture
async def setup_driver(services_available):
    """Initialize and tear down the Neo4j driver."""
    # Temporarily set embedding provider for tests
    original = settings.EMBEDDING_PROVIDER
    settings.EMBEDDING_PROVIDER = "ollama"
    driver = await init_driver()
    await init_embedding_provider()
    yield driver
    await close_embedding_provider()
    await close_driver()
    settings.EMBEDDING_PROVIDER = original


@pytest.fixture
async def client(setup_driver):
    """Async HTTP client wired to the real app."""
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def test_ontology(client):
    """Create a test ontology with entity types, yield key, clean up after."""
    # Create ontology
    resp = await client.post("/api/model/ontologies", json={
        "key": "search_test",
        "name": "Search Test",
        "description": "Integration test ontology for semantic search",
    })
    assert resp.status_code == 201
    ontology_id = resp.json()["ontologyId"]

    # Create entity type: person
    resp = await client.post(f"/api/model/ontologies/{ontology_id}/entity-types", json={
        "key": "person",
        "displayName": "Person",
    })
    assert resp.status_code == 201
    et_id = resp.json()["entityTypeId"]

    # Add properties
    for prop in [
        {"key": "name", "displayName": "Name", "dataType": "string", "required": True},
        {"key": "role", "displayName": "Role", "dataType": "string", "required": False},
        {"key": "bio", "displayName": "Bio", "dataType": "string", "required": False},
        {"key": "age", "displayName": "Age", "dataType": "integer", "required": False},
    ]:
        resp = await client.post(
            f"/api/model/ontologies/{ontology_id}/entity-types/{et_id}/properties",
            json=prop,
        )
        assert resp.status_code == 201

    yield {"ontology_id": ontology_id, "ontology_key": "search_test", "entity_type_id": et_id}

    # Cleanup: delete ontology (cascades to entity types and instances)
    await client.delete(f"/api/model/ontologies/{ontology_id}")


async def test_create_entity_generates_embedding(client, test_ontology):
    """Creating an entity via runtime API generates an embedding."""
    key = test_ontology["ontology_key"]
    resp = await client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice Chen",
        "role": "Senior Engineer",
        "bio": "Builds distributed systems and mentors junior developers",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "_embedding" not in data  # embedding should be stripped from response
    assert data["name"] == "Alice Chen"


async def test_semantic_search_returns_results(client, test_ontology):
    """Semantic search finds entities by meaning."""
    key = test_ontology["ontology_key"]

    # Create entities
    await client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice Chen",
        "role": "Backend Engineer",
        "bio": "Expert in distributed systems and microservices",
    })
    await client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Bob Smith",
        "role": "Marketing Manager",
        "bio": "Leads brand strategy and market research",
    })

    # Search for engineering-related entities
    resp = await client.get(f"/api/runtime/{key}/search/semantic", params={
        "q": "distributed systems engineer",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0
    assert len(data["results"]) > 0
    # Alice should rank higher for this query
    assert data["results"][0]["entity"]["name"] == "Alice Chen"
    assert data["results"][0]["score"] > 0


async def test_semantic_search_type_scoped(client, test_ontology):
    """Type-scoped search only returns entities of the specified type."""
    key = test_ontology["ontology_key"]

    await client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Charlie",
        "role": "Developer",
    })

    resp = await client.get(f"/api/runtime/{key}/search/semantic", params={
        "q": "developer",
        "type": "person",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0
    for item in data["results"]:
        assert item["entity"]["_entityTypeKey"] == "person"


async def test_semantic_search_disabled_without_provider(client, test_ontology):
    """Search returns error when embedding provider is not configured."""
    key = test_ontology["ontology_key"]

    # Temporarily disable the provider
    from ontoforge_server.core import embedding
    original = embedding._provider
    embedding._provider = None

    try:
        resp = await client.get(f"/api/runtime/{key}/search/semantic", params={
            "q": "test query",
        })
        assert resp.status_code == 422
        assert "EMBEDDING_PROVIDER" in resp.json()["error"]["message"]
    finally:
        embedding._provider = original
