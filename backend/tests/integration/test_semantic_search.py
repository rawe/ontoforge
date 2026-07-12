"""Integration tests for semantic search.

Requirements:
  - Neo4j running (default: bolt://localhost:7687)
  - Ollama running with embedding model (default: nomic-embed-text)

Run with: uv run pytest tests/integration/test_semantic_search.py -v -m integration
"""

import pytest

from ontoforge_server.config import settings
from ontoforge_server.core.embedding import (
    close_embedding_provider,
    init_embedding_provider,
)
from tests.integration.conftest import check_neo4j, check_ollama_model

EMBEDDING_MODEL = "nomic-embed-text"

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
async def services_available():
    """Skip the entire module if Neo4j or Ollama aren't available."""
    if not await check_neo4j():
        pytest.skip("Neo4j not available")
    if not await check_ollama_model(EMBEDDING_MODEL):
        pytest.skip(f"Ollama not available or model '{EMBEDDING_MODEL}' not pulled")


@pytest.fixture(autouse=True)
async def _configure_embedding(services_available):
    """Enable embedding provider for the duration of each test."""
    original = settings.EMBEDDING_PROVIDER
    settings.EMBEDDING_PROVIDER = "ollama"
    await init_embedding_provider()
    yield
    await close_embedding_provider()
    settings.EMBEDDING_PROVIDER = original


@pytest.fixture
async def test_ontology(integration_client):
    """Create a test ontology with a person entity type and properties."""
    client = integration_client

    # Create ontology
    resp = await client.post("/api/model/ontologies", json={
        "key": "search_test",
        "name": "Search Test",
        "description": "Integration test ontology for semantic search",
    })
    assert resp.status_code == 201, f"Create ontology failed: {resp.text}"
    ontology_id = resp.json()["ontologyId"]

    # Create entity type: person (global route)
    resp = await client.post("/api/model/entity-types", json={
        "key": "person",
        "displayName": "Person",
    })
    assert resp.status_code == 201, f"Create person type failed: {resp.text}"
    et_id = resp.json()["entityTypeId"]

    # Add properties
    for prop in [
        {"key": "name", "displayName": "Name", "dataType": "string", "required": True},
        {"key": "role", "displayName": "Role", "dataType": "string", "required": False},
        {"key": "bio", "displayName": "Bio", "dataType": "string", "required": False},
        {"key": "age", "displayName": "Age", "dataType": "integer", "required": False},
    ]:
        resp = await client.post(
            f"/api/model/entity-types/{et_id}/properties", json=prop,
        )
        assert resp.status_code == 201

    yield {"ontology_id": ontology_id, "ontology_key": "search_test", "entity_type_id": et_id}
    # Cleanup handled by clean_db fixture


async def test_create_entity_generates_embedding(integration_client, test_ontology):
    """Creating an entity via runtime API generates an embedding."""
    key = test_ontology["ontology_key"]
    resp = await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice Chen",
        "role": "Senior Engineer",
        "bio": "Builds distributed systems and mentors junior developers",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "_embedding" not in data
    assert data["name"] == "Alice Chen"


async def test_semantic_search_returns_results(integration_client, test_ontology):
    """Semantic search finds entities by meaning."""
    key = test_ontology["ontology_key"]

    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice Chen",
        "role": "Backend Engineer",
        "bio": "Expert in distributed systems and microservices",
    })
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Bob Smith",
        "role": "Marketing Manager",
        "bio": "Leads brand strategy and market research",
    })

    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic",
        params={"q": "distributed systems engineer", "type": "person"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0
    assert len(data["results"]) > 0
    assert data["results"][0]["entity"]["name"] == "Alice Chen"
    assert data["results"][0]["score"] > 0


async def test_semantic_search_type_scoped(integration_client, test_ontology):
    """Type-scoped search only returns entities of the specified type."""
    key = test_ontology["ontology_key"]

    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Charlie",
        "role": "Developer",
    })

    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic",
        params={"q": "developer", "type": "person"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0
    for item in data["results"]:
        assert item["entity"]["_entityTypeKey"] == "person"


async def test_semantic_search_cross_type(integration_client, test_ontology):
    """Cross-type search without a type param spans multiple entity types."""
    key = test_ontology["ontology_key"]

    # The shared _Entity index is normally ensured at app startup; the test
    # client skips the lifespan, so create it explicitly.
    from ontoforge_server.core.database import ensure_entity_vector_index, get_driver
    from ontoforge_server.core.embedding import get_embedding_provider

    driver = await get_driver()
    provider = get_embedding_provider()
    await ensure_entity_vector_index(driver, provider.dimensions)

    # Second entity type: company
    resp = await integration_client.post("/api/model/entity-types", json={
        "key": "company",
        "displayName": "Company",
    })
    assert resp.status_code == 201, f"Create company type failed: {resp.text}"
    company_id = resp.json()["entityTypeId"]
    resp = await integration_client.post(
        f"/api/model/entity-types/{company_id}/properties",
        json={"key": "name", "displayName": "Name", "dataType": "string", "required": True},
    )
    assert resp.status_code == 201

    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice Chen",
        "role": "Backend Engineer",
        "bio": "Expert in distributed systems and microservices",
    })
    await integration_client.post(f"/api/runtime/{key}/entities/company", json={
        "name": "Distributed Systems Consulting",
    })

    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic",
        params={"q": "distributed systems", "limit": 10},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0
    type_keys = {item["entity"]["_entityTypeKey"] for item in data["results"]}
    assert {"person", "company"} <= type_keys


async def test_semantic_search_cross_type_rejects_filters(integration_client, test_ontology):
    """Property filters without a type are rejected — they are per entity type."""
    key = test_ontology["ontology_key"]

    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic",
        params={"q": "anything", "filter.name": "Alice"},
    )
    assert resp.status_code == 422
    assert "require 'type'" in resp.json()["error"]["message"]


async def test_semantic_search_disabled_without_provider(integration_client, test_ontology):
    """Search returns error when embedding provider is not configured."""
    key = test_ontology["ontology_key"]

    from ontoforge_server.core import embedding
    original = embedding._provider
    embedding._provider = None

    try:
        resp = await integration_client.get(
            f"/api/runtime/{key}/search/semantic",
            params={"q": "test query", "type": "person"},
        )
        assert resp.status_code == 422
        assert "EMBEDDING_PROVIDER" in resp.json()["error"]["message"]
    finally:
        embedding._provider = original
