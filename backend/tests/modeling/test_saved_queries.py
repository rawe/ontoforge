"""Tests for saved query config modeling endpoints."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.core.exceptions import NotFoundError

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

MOCK_QUERY = {
    "savedQueryId": "sq-1",
    "key": "find-people",
    "name": "Find People",
    "description": "Find people by name",
    "steps": '[{"name": "main", "type": "cypher", "cypher": "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p"}]',
    "parameters": '[{"name": "name", "description": "Name to search for", "dataType": "string"}]',
    "createdAt": NOW,
    "updatedAt": NOW,
}


# --- List ---


@pytest.mark.asyncio
async def test_list_saved_queries_empty(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.list_saved_queries", new_callable=AsyncMock, return_value=[]),
    ):
        resp = await client.get("/api/model/ontologies/test_onto/saved-queries")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_saved_queries_with_queries(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.list_saved_queries", new_callable=AsyncMock, return_value=[MOCK_QUERY]),
    ):
        resp = await client.get("/api/model/ontologies/test_onto/saved-queries")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    query = body[0]
    assert query["key"] == "find-people"
    assert query["name"] == "Find People"
    assert query["description"] == "Find people by name"
    # Steps should be deserialized from JSON string
    assert len(query["steps"]) == 1
    step = query["steps"][0]
    assert step["name"] == "main"
    assert step["type"] == "cypher"
    assert "MATCH" in step["cypher"]
    # Parameters should be deserialized from JSON string
    assert len(query["parameters"]) == 1
    assert query["parameters"][0]["name"] == "name"
    assert query["parameters"][0]["description"] == "Name to search for"
    assert query["parameters"][0]["dataType"] == "string"
    assert "createdAt" in query
    assert "updatedAt" in query


@pytest.mark.asyncio
async def test_list_saved_queries_ontology_not_found(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.get("/api/model/ontologies/nonexistent/saved-queries")
    assert resp.status_code == 404


# --- Upsert ---


@pytest.mark.asyncio
async def test_upsert_saved_query_create(client):
    """Creates a new saved query (returns 201)."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_saved_query", new_callable=AsyncMock, return_value=(MOCK_QUERY, True)),
        patch(
            "ontoforge_server.runtime.service._load_schema",
            new_callable=AsyncMock,
            side_effect=NotFoundError("not loaded"),
        ),
        patch(INVALIDATE),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/find-people",
            json={
                "name": "Find People",
                "description": "Find people by name",
                "steps": [
                    {
                        "name": "main",
                        "type": "cypher",
                        "cypher": "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p",
                    },
                ],
                "parameters": [
                    {"name": "name", "description": "Name to search for", "dataType": "string"},
                ],
            },
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["key"] == "find-people"
    assert body["name"] == "Find People"


@pytest.mark.asyncio
async def test_upsert_saved_query_rejects_document_parameter(client):
    with patch(f"{REPO}.upsert_saved_query", new_callable=AsyncMock) as mock_upsert:
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/find-people",
            json={
                "name": "Find People",
                "description": "Find people by name",
                "steps": [
                    {
                        "name": "main",
                        "type": "cypher",
                        "cypher": "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p",
                    },
                ],
                "parameters": [
                    {"name": "name", "description": "Name to search for", "dataType": "document"},
                ],
            },
        )
    assert resp.status_code == 422
    assert "scalar" in resp.json()["error"]["message"]
    mock_upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_upsert_saved_query_update(client):
    """Updates an existing saved query (returns 200)."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_saved_query", new_callable=AsyncMock, return_value=(MOCK_QUERY, False)),
        patch(
            "ontoforge_server.runtime.service._load_schema",
            new_callable=AsyncMock,
            side_effect=NotFoundError("not loaded"),
        ),
        patch(INVALIDATE),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/find-people",
            json={
                "name": "Find People",
                "description": "Find people by name",
                "steps": [
                    {
                        "name": "main",
                        "type": "cypher",
                        "cypher": "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p",
                    },
                ],
                "parameters": [
                    {"name": "name", "description": "Name to search for", "dataType": "string"},
                ],
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "find-people"


# --- Delete ---


@pytest.mark.asyncio
async def test_delete_saved_query_success(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.delete_saved_query", new_callable=AsyncMock, return_value=True),
        patch(INVALIDATE),
    ):
        resp = await client.delete("/api/model/ontologies/test_onto/saved-queries/find-people")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_saved_query_not_found(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.delete_saved_query", new_callable=AsyncMock, return_value=False),
    ):
        resp = await client.delete("/api/model/ontologies/test_onto/saved-queries/nonexistent")
    assert resp.status_code == 404


# --- Key validation ---


@pytest.mark.asyncio
async def test_upsert_invalid_key(client):
    """Query key must match ^[a-z][a-z0-9_-]*$. 'INVALID' should be rejected."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/INVALID",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {"name": "main", "type": "cypher", "cypher": "MATCH (n) RETURN n"},
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


# --- Parameter cross-check ---


@pytest.mark.asyncio
async def test_upsert_param_in_cypher_not_declared(client):
    """Param $age in cypher but not in parameters should return 422."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {
                        "name": "main",
                        "type": "cypher",
                        "cypher": "MATCH (p:person) WHERE p.age > $age RETURN p",
                    },
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_param_declared_not_in_steps(client):
    """Param declared but not referenced in any step should return 422."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {"name": "main", "type": "cypher", "cypher": "MATCH (p:person) RETURN p"},
                ],
                "parameters": [
                    {"name": "unused", "description": "Not used", "dataType": "string"},
                ],
            },
        )
    assert resp.status_code == 422


# --- Pipeline validation ---


@pytest.mark.asyncio
async def test_upsert_empty_steps_rejected(client):
    """Empty steps array should be rejected by Pydantic."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_invalid_step_type(client):
    """Invalid step type should be rejected."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {"name": "main", "type": "invalid_type", "cypher": "MATCH (n) RETURN n"},
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_duplicate_step_names(client):
    """Duplicate step names should return 422."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {"name": "main", "type": "cypher", "cypher": "MATCH (n) RETURN n"},
                    {"name": "main", "type": "cypher", "cypher": "MATCH (m) RETURN m"},
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_binding_references_nonexistent_step(client):
    """Binding referencing non-existent step should return 422."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {
                        "name": "main",
                        "type": "cypher",
                        "cypher": "MATCH (p:person) WHERE p._id IN $ids RETURN p",
                        "bindings": {"ids": "{{nonexistent._id}}"},
                    },
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_binding_references_later_step(client):
    """Binding referencing a later step (not earlier) should return 422."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {
                        "name": "first",
                        "type": "cypher",
                        "cypher": "MATCH (p:person) WHERE p._id IN $ids RETURN p",
                        "bindings": {"ids": "{{second._id}}"},
                    },
                    {
                        "name": "second",
                        "type": "cypher",
                        "cypher": "MATCH (n) RETURN n",
                    },
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_cypher_step_missing_cypher(client):
    """Cypher step without cypher field should return 422."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {"name": "main", "type": "cypher"},
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_semantic_search_step_missing_fields(client):
    """Semantic search step without required fields should return 422."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query",
            json={
                "name": "Test",
                "description": "test",
                "steps": [
                    {"name": "search", "type": "semantic_search"},
                ],
                "parameters": [],
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_multi_step_pipeline_valid(client):
    """Multi-step pipeline with valid bindings should succeed."""

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_saved_query", new_callable=AsyncMock, return_value=(MOCK_QUERY, True)),
        patch(
            "ontoforge_server.runtime.service._load_schema",
            new_callable=AsyncMock,
            side_effect=NotFoundError("not loaded"),
        ),
        patch(INVALIDATE),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/find-skilled-persons",
            json={
                "name": "Find Skilled Persons",
                "description": "Search for a skill, then find persons with that skill",
                "steps": [
                    {
                        "name": "skills",
                        "type": "semantic_search",
                        "entityTypeKey": "skill",
                        "query": "$skill_query",
                        "limit": 5,
                    },
                    {
                        "name": "results",
                        "type": "cypher",
                        "cypher": "MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id IN $skill_ids RETURN p",
                        "bindings": {"skill_ids": "{{skills._id}}"},
                    },
                ],
                "parameters": [
                    {"name": "skill_query", "description": "Skill to search for", "dataType": "string"},
                ],
            },
        )
    assert resp.status_code == 201


# --- Cascading delete ---


@pytest.mark.asyncio
async def test_delete_ontology_cascades_queries(client):
    """Deleting an ontology should cascade to its saved queries (handled by repository)."""
    with (
        patch(f"{REPO}.delete_ontology", new_callable=AsyncMock, return_value=True),
        patch(INVALIDATE),
    ):
        resp = await client.delete("/api/model/ontologies/ont-1")
    assert resp.status_code == 204
