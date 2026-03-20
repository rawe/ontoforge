"""Tests for AI agent config modeling endpoints."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.modeling.service.repository"
INVALIDATE = "ontoforge_server.modeling.service._invalidate_runtime_schema_cache"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

MOCK_ONTOLOGY = {
    "ontologyId": "ont-1",
    "key": "test_onto",
    "name": "Test",
    "description": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}

MOCK_AGENT = {
    "agentConfigId": "ac-1",
    "key": "my-agent",
    "name": "My Agent",
    "description": "test desc",
    "systemPrompt": "You are helpful",
    "tools": ["get_schema"],
    "createdAt": NOW,
    "updatedAt": NOW,
}


# --- List ---


@pytest.mark.asyncio
async def test_list_ai_agents_empty(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.list_ai_agents", new_callable=AsyncMock, return_value=[]),
    ):
        resp = await client.get("/api/model/ontologies/test_onto/ai-agents")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_ai_agents_with_agents(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.list_ai_agents", new_callable=AsyncMock, return_value=[MOCK_AGENT]),
    ):
        resp = await client.get("/api/model/ontologies/test_onto/ai-agents")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    agent = body[0]
    assert agent["key"] == "my-agent"
    assert agent["name"] == "My Agent"
    assert agent["description"] == "test desc"
    assert agent["systemPrompt"] == "You are helpful"
    assert agent["tools"] == ["get_schema"]
    assert "createdAt" in agent
    assert "updatedAt" in agent


@pytest.mark.asyncio
async def test_list_ai_agents_ontology_not_found(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.get("/api/model/ontologies/nonexistent/ai-agents")
    assert resp.status_code == 404


# --- Upsert ---


@pytest.mark.asyncio
async def test_upsert_ai_agent_create(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_ai_agent", new_callable=AsyncMock, return_value=(MOCK_AGENT, True)),
        patch(INVALIDATE),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/ai-agents/my-agent",
            json={"name": "My Agent", "description": "test desc", "systemPrompt": "You are helpful", "tools": ["get_schema"]},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["key"] == "my-agent"
    assert body["name"] == "My Agent"


@pytest.mark.asyncio
async def test_upsert_ai_agent_update(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_ai_agent", new_callable=AsyncMock, return_value=(MOCK_AGENT, False)),
        patch(INVALIDATE),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/ai-agents/my-agent",
            json={"name": "My Agent"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "my-agent"


@pytest.mark.asyncio
async def test_upsert_ai_agent_ontology_not_found(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.put(
            "/api/model/ontologies/nonexistent/ai-agents/my-agent",
            json={"name": "Test"},
        )
    assert resp.status_code == 404


# --- Delete ---


@pytest.mark.asyncio
async def test_delete_ai_agent_success(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.delete_ai_agent", new_callable=AsyncMock, return_value=True),
        patch(INVALIDATE),
    ):
        resp = await client.delete("/api/model/ontologies/test_onto/ai-agents/my-agent")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_ai_agent_not_found(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.delete_ai_agent", new_callable=AsyncMock, return_value=False),
    ):
        resp = await client.delete("/api/model/ontologies/test_onto/ai-agents/nonexistent")
    assert resp.status_code == 404


# --- Key validation ---


@pytest.mark.asyncio
async def test_upsert_invalid_key(client):
    """Agent key must match ^[a-z][a-z0-9_-]*$. 'INVALID' should be rejected."""
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/ai-agents/INVALID",
            json={"name": "Test"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_reserved_default_key(client):
    """Agent key '_default' is reserved and should be rejected."""
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/ai-agents/_default",
            json={"name": "Test"},
        )
    assert resp.status_code == 422


# --- Tool validation ---


@pytest.mark.asyncio
async def test_upsert_unknown_tool(client):
    """Specifying a tool name that doesn't exist should return 422."""
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/ai-agents/my-agent",
            json={"name": "Test", "tools": ["nonexistent_tool"]},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_valid_tools(client):
    """A valid tool name should be accepted."""
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_ai_agent", new_callable=AsyncMock, return_value=(MOCK_AGENT, True)),
        patch(INVALIDATE),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/ai-agents/my-agent",
            json={"name": "Test", "tools": ["get_schema"]},
        )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_upsert_tools_null_means_all(client):
    """tools=null means 'use all available tools' and should be accepted."""
    agent_no_tools = {**MOCK_AGENT, "tools": None}
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_ai_agent", new_callable=AsyncMock, return_value=(agent_no_tools, True)),
        patch(INVALIDATE),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/ai-agents/my-agent",
            json={"name": "Test", "tools": None},
        )
    assert resp.status_code == 201
    assert resp.json()["tools"] is None


# --- Cascading delete ---


@pytest.mark.asyncio
async def test_delete_ontology_cascades_agents(client):
    """Deleting an ontology should cascade to its AI agent configs (handled by repository)."""
    with (
        patch(f"{REPO}.delete_ontology", new_callable=AsyncMock, return_value=True),
        patch(INVALIDATE),
    ):
        resp = await client.delete("/api/model/ontologies/ont-1")
    assert resp.status_code == 204
