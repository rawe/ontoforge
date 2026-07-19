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
    assert "dataType" in resp.text
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


# --- New validation rules ---


def _upsert_payload(steps, parameters):
    return {
        "name": "Test Query",
        "description": "A test query",
        "steps": steps,
        "parameters": parameters,
    }


async def _upsert(client, payload):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(f"{REPO}.upsert_saved_query", new_callable=AsyncMock, return_value=(MOCK_QUERY, True)),
        patch(
            "ontoforge_server.runtime.service._load_schema",
            new_callable=AsyncMock,
            side_effect=NotFoundError("no runtime schema"),
        ),
    ):
        return await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query", json=payload
        )


@pytest.mark.asyncio
async def test_upsert_binding_from_other_step_not_shared(client):
    """A $ref satisfied only by another step's binding is rejected."""
    payload = _upsert_payload(
        steps=[
            {
                "name": "first",
                "type": "cypher",
                "cypher": "MATCH (p:person) WHERE p._id IN $ids RETURN p",
            },
            {
                "name": "second",
                "type": "cypher",
                "cypher": "MATCH (p:person) RETURN p",
                "bindings": {"ids": "{{first.p}}"},
            },
        ],
        parameters=[],
    )
    resp = await _upsert(client, payload)
    assert resp.status_code == 422
    errors = resp.json()["error"]["details"]["errors"]
    assert any("steps[0].cypher" in e and "ids" in e for e in errors)


@pytest.mark.asyncio
async def test_upsert_bindings_on_semantic_search_rejected(client):
    payload = _upsert_payload(
        steps=[
            {
                "name": "people",
                "type": "cypher",
                "cypher": "MATCH (p:person) RETURN p._id AS _id",
            },
            {
                "name": "search",
                "type": "semantic_search",
                "entityTypeKey": "skill",
                "query": "some skill",
                "bindings": {"ids": "{{people._id}}"},
            },
        ],
        parameters=[],
    )
    resp = await _upsert(client, payload)
    assert resp.status_code == 422
    errors = resp.json()["error"]["details"]["errors"]
    assert any("not supported on semantic_search" in e for e in errors)


@pytest.mark.asyncio
async def test_upsert_binding_shadows_parameter_rejected(client):
    payload = _upsert_payload(
        steps=[
            {
                "name": "first",
                "type": "cypher",
                "cypher": "MATCH (p:person) WHERE p.name = $name RETURN p._id AS _id",
            },
            {
                "name": "second",
                "type": "cypher",
                "cypher": "MATCH (p:person) WHERE p._id IN $name RETURN p",
                "bindings": {"name": "{{first._id}}"},
            },
        ],
        parameters=[
            {"name": "name", "description": "Name", "dataType": "string"},
        ],
    )
    resp = await _upsert(client, payload)
    assert resp.status_code == 422
    errors = resp.json()["error"]["details"]["errors"]
    assert any("Shadows the declared parameter" in e for e in errors)


@pytest.mark.asyncio
async def test_upsert_default_must_coerce(client):
    payload = _upsert_payload(
        steps=[
            {
                "name": "main",
                "type": "cypher",
                "cypher": "MATCH (p:person) WHERE p.age > $min_age RETURN p",
            },
        ],
        parameters=[
            {
                "name": "min_age",
                "description": "Minimum age",
                "dataType": "integer",
                "default": "not-a-number",
            },
        ],
    )
    resp = await _upsert(client, payload)
    assert resp.status_code == 422
    errors = resp.json()["error"]["details"]["errors"]
    assert any("min_age.default" in e for e in errors)


@pytest.mark.asyncio
async def test_upsert_entity_ref_requires_entity_type_key(client):
    payload = _upsert_payload(
        steps=[
            {
                "name": "main",
                "type": "cypher",
                "cypher": "MATCH (p:person {_id: $person}) RETURN p",
            },
        ],
        parameters=[
            {"name": "person", "description": "The person", "dataType": "entity_ref"},
        ],
    )
    resp = await _upsert(client, payload)
    assert resp.status_code == 422
    errors = resp.json()["error"]["details"]["errors"]
    assert any("entityTypeKey is required for entity_ref" in e for e in errors)


@pytest.mark.asyncio
async def test_upsert_entity_type_key_only_for_entity_ref(client):
    payload = _upsert_payload(
        steps=[
            {
                "name": "main",
                "type": "cypher",
                "cypher": "MATCH (p:person {name: $name}) RETURN p",
            },
        ],
        parameters=[
            {
                "name": "name",
                "description": "Name",
                "dataType": "string",
                "entityTypeKey": "person",
            },
        ],
    )
    resp = await _upsert(client, payload)
    assert resp.status_code == 422
    errors = resp.json()["error"]["details"]["errors"]
    assert any("only allowed on entity_ref" in e for e in errors)


@pytest.mark.asyncio
async def test_upsert_stores_example_questions_and_max_rows(client):
    payload = {
        "name": "Test Query",
        "description": "A test query",
        "exampleQuestions": ["Who knows Python?", "Find Python devs"],
        "maxRows": 50,
        "steps": [
            {"name": "main", "type": "cypher", "cypher": "MATCH (p:person) RETURN p"},
        ],
        "parameters": [],
    }
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(
            f"{REPO}.upsert_saved_query", new_callable=AsyncMock, return_value=(MOCK_QUERY, True)
        ) as mock_upsert,
        patch(
            "ontoforge_server.runtime.service._load_schema",
            new_callable=AsyncMock,
            side_effect=NotFoundError("no runtime schema"),
        ),
    ):
        resp = await client.put(
            "/api/model/ontologies/test_onto/saved-queries/test-query", json=payload
        )
    assert resp.status_code == 201
    kwargs = mock_upsert.call_args.kwargs
    assert kwargs["example_questions"] == ["Who knows Python?", "Find Python devs"]
    assert kwargs["max_rows"] == 50


# --- Health check ---


@pytest.mark.asyncio
async def test_saved_query_health_reports_broken_queries(client):
    from ontoforge_server.core.exceptions import ValidationError as OFValidationError

    broken_query = {
        **MOCK_QUERY,
        "key": "broken-query",
        "name": "Broken",
        "steps": '[{"name": "main", "type": "cypher", "cypher": "MATCH (x:gone) RETURN x"}]',
        "parameters": "[]",
    }

    from ontoforge_server.runtime.service import LoadedSchema, SchemaCache

    schema = SchemaCache(
        ontology_id="ont-1", ontology_key="test_onto",
        ontology_name="Test", ontology_description=None,
    )
    loaded = LoadedSchema(scoped=schema, full=schema)

    def _fail_unknown_label(cypher, scoped):
        if "gone" in cypher:
            raise OFValidationError("Unknown label: gone")
        return cypher

    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=MOCK_ONTOLOGY),
        patch(
            f"{REPO}.list_saved_queries",
            new_callable=AsyncMock,
            return_value=[MOCK_QUERY, broken_query],
        ),
        patch(
            "ontoforge_server.runtime.service._load_schema",
            new_callable=AsyncMock,
            return_value=loaded,
        ),
        patch(
            "ontoforge_server.runtime.cypher.validate_and_rewrite",
            side_effect=_fail_unknown_label,
        ),
    ):
        resp = await client.get("/api/model/ontologies/test_onto/saved-queries/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    by_key = {q["key"]: q for q in body["queries"]}
    assert by_key["find-people"]["valid"] is True
    assert by_key["broken-query"]["valid"] is False
    assert any("Unknown label" in e for e in by_key["broken-query"]["errors"])
