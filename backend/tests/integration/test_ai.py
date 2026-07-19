"""Integration tests for AI-powered runtime endpoints.

Requirements:
  - Neo4j running (default: bolt://localhost:7687)
  - Ollama running with a tool-calling model (see AI_MODEL below)

Run with: uv run pytest tests/integration/test_ai.py -v -m integration
"""

import pytest

from ontoforge_server.config import settings
from ontoforge_server.core.ai import init_ai_model
from tests.integration.conftest import check_neo4j, check_ollama_model

# Model used for AI integration tests — must support tool calling
AI_MODEL = "qwen3:14b"

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
async def services_available():
    """Skip the entire module if Neo4j or Ollama aren't available."""
    if not await check_neo4j():
        pytest.skip("Neo4j not available")
    if not await check_ollama_model(AI_MODEL):
        pytest.skip(f"Ollama not available or model '{AI_MODEL}' not pulled")


@pytest.fixture(autouse=True)
def _configure_ai(services_available):
    """Enable AI provider for the duration of each test."""
    original_provider = settings.AI_PROVIDER
    original_model = settings.AI_MODEL
    settings.AI_PROVIDER = "ollama"
    settings.AI_MODEL = AI_MODEL
    init_ai_model()
    yield
    settings.AI_PROVIDER = original_provider
    settings.AI_MODEL = original_model


@pytest.fixture
async def test_ontology(integration_client):
    """Create a complete ontology with person/company/works_for and seed data.

    Uses the correct global modeling API routes:
      - Entity types at /api/model/entity-types
      - Properties at /api/model/entity-types/{id}/properties
      - Relation types at /api/model/relation-types
    """
    client = integration_client

    # 1. Create ontology
    resp = await client.post("/api/model/ontologies", json={
        "key": "ai_test",
        "name": "AI Test",
        "description": "Integration test ontology for AI endpoints",
    })
    assert resp.status_code == 201, f"Create ontology failed: {resp.text}"
    ontology_id = resp.json()["ontologyId"]

    # 2. Create entity type: person (global)
    resp = await client.post("/api/model/entity-types", json={
        "key": "person",
        "displayName": "Person",
    })
    assert resp.status_code == 201, f"Create person type failed: {resp.text}"
    person_id = resp.json()["entityTypeId"]

    for prop in [
        {"key": "name", "displayName": "Name", "dataType": "string", "required": True},
        {"key": "age", "displayName": "Age", "dataType": "integer", "required": False},
        {"key": "location", "displayName": "Location", "dataType": "string", "required": False},
    ]:
        resp = await client.post(
            f"/api/model/entity-types/{person_id}/properties", json=prop,
        )
        assert resp.status_code == 201, f"Create property {prop['key']} failed: {resp.text}"

    # 3. Create entity type: company (global)
    resp = await client.post("/api/model/entity-types", json={
        "key": "company",
        "displayName": "Company",
    })
    assert resp.status_code == 201, f"Create company type failed: {resp.text}"
    company_id = resp.json()["entityTypeId"]

    resp = await client.post(
        f"/api/model/entity-types/{company_id}/properties",
        json={"key": "name", "displayName": "Name", "dataType": "string", "required": True},
    )
    assert resp.status_code == 201

    # 4. Create relation type: works_for (global)
    resp = await client.post("/api/model/relation-types", json={
        "key": "works_for",
        "displayName": "Works For",
        "sourceEntityTypeKey": "person",
        "targetEntityTypeKey": "company",
    })
    assert resp.status_code == 201, f"Create relation type failed: {resp.text}"

    # 5. Seed test data via runtime API
    await client.post("/api/runtime/ai_test/entities/company", json={"name": "Acme Corp"})
    await client.post("/api/runtime/ai_test/entities/company", json={"name": "TechStart GmbH"})
    await client.post("/api/runtime/ai_test/entities/person", json={
        "name": "Alice", "age": 30, "location": "Berlin",
    })
    await client.post("/api/runtime/ai_test/entities/person", json={
        "name": "Bob", "age": 25, "location": "Munich",
    })

    yield "ai_test"
    # Cleanup handled by clean_db fixture


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------


async def test_features_endpoint_shows_ai_enabled(integration_client):
    resp = await integration_client.get("/api/runtime/features")
    assert resp.status_code == 200
    assert resp.json()["ai"] is True


# ---------------------------------------------------------------------------
# AI Query (NL → OQL)
# ---------------------------------------------------------------------------


async def test_ai_query_returns_answer(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/query", json={
        "question": "How many persons are there?",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert isinstance(data["answer"], str)
    assert len(data["answer"]) > 0


async def test_ai_query_returns_query_and_results(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/query", json={
        "question": "List all companies",
    })
    assert resp.status_code == 200
    data = resp.json()
    # The executed query should be captured from the tool call, and the
    # deprecated "cypher" field must mirror it during the deprecation window.
    if data["query"] is not None:
        assert isinstance(data["query"], str)
    assert data["cypher"] == data["query"]
    if data["results"] is not None:
        assert "columns" in data["results"]
        assert "results" in data["results"]


async def test_ai_query_empty_question_rejected(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/query", json={
        "question": "",
    })
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# AI Extract (text → structured entities)
# ---------------------------------------------------------------------------


async def test_ai_extract_returns_entities(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/extract", json={
        "text": "Charlie is 28 years old and lives in Hamburg. He works at DataFlow Inc.",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "entities" in data
    assert len(data["entities"]) >= 1
    assert data["created"] is False
    # Extracted types should be from our schema
    type_keys = [e["entityTypeKey"] for e in data["entities"]]
    assert any(k in type_keys for k in ["person", "company"])


async def test_ai_extract_with_type_filter(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/extract", json={
        "text": "Eve works at GlobalTech.",
        "entityTypes": ["person"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["entities"]) >= 1


async def test_ai_extract_with_create(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/extract", json={
        "text": "Dave is 35 years old.",
        "entityTypes": ["person"],
        "create": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["created"] is True

    # Verify entity was persisted
    list_resp = await integration_client.get(
        "/api/runtime/ai_test/entities/person",
        params={"q": "Dave"},
    )
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert any("Dave" in item.get("name", "") for item in items)


async def test_ai_extract_empty_text_rejected(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/extract", json={
        "text": "",
    })
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# AI Chat (conversational Q&A with tools)
# ---------------------------------------------------------------------------


async def test_ai_chat_returns_reply(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/chat", json={
        "message": "How many companies are in the database?",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "reply" in data
    assert isinstance(data["reply"], str)
    assert len(data["reply"]) > 0
    assert "toolCalls" not in data or data["toolCalls"] is None


async def test_ai_chat_with_tool_calls(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/chat", json={
        "message": "List all persons",
        "includeToolCalls": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "reply" in data
    assert "toolCalls" in data
    assert isinstance(data["toolCalls"], list)
    if len(data["toolCalls"]) > 0:
        tc = data["toolCalls"][0]
        assert "tool" in tc
        assert "args" in tc


async def test_ai_chat_with_history(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/chat", json={
        "message": "And how old is she?",
        "history": [
            {"role": "user", "content": "How many persons are there?"},
            {"role": "assistant", "content": "There are 2 persons: Alice and Bob."},
        ],
    })
    # Accept 200 (success) — the LLM may or may not resolve the reference
    # but the endpoint should not error
    assert resp.status_code == 200
    data = resp.json()
    assert "reply" in data
    assert isinstance(data["reply"], str)


async def test_ai_chat_empty_message_rejected(integration_client, test_ontology):
    resp = await integration_client.post("/api/runtime/ai_test/ai/chat", json={
        "message": "",
    })
    assert resp.status_code == 422
