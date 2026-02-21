from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest


NOW = datetime(2025, 1, 1, tzinfo=timezone.utc)

ONTOLOGY_DATA = {
    "ontologyId": "ont-1",
    "name": "Test Ontology",
    "description": "A test",
    "createdAt": NOW,
    "updatedAt": NOW,
}


def _mock_repo(**overrides):
    defaults = {
        "get_ontology_by_name": AsyncMock(return_value=None),
        "create_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "list_ontologies": AsyncMock(return_value=[ONTOLOGY_DATA]),
        "get_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "update_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "delete_ontology": AsyncMock(return_value=True),
    }
    defaults.update(overrides)
    return defaults


@pytest.fixture
def repo_patch():
    def _patch(**overrides):
        mocks = _mock_repo(**overrides)
        return patch.multiple(
            "ontoforge_server.modeling.service.repository", **mocks
        )

    return _patch


async def test_create_ontology(client, repo_patch):
    with repo_patch():
        resp = await client.post(
            "/api/model/ontologies",
            json={"name": "Test Ontology", "description": "A test"},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["ontologyId"] == "ont-1"
    assert data["name"] == "Test Ontology"


async def test_create_ontology_duplicate_name(client, repo_patch):
    with repo_patch(get_ontology_by_name=AsyncMock(return_value=ONTOLOGY_DATA)):
        resp = await client.post(
            "/api/model/ontologies",
            json={"name": "Test Ontology"},
        )
    assert resp.status_code == 409


async def test_list_ontologies(client, repo_patch):
    with repo_patch():
        resp = await client.get("/api/model/ontologies")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 1


async def test_get_ontology(client, repo_patch):
    with repo_patch():
        resp = await client.get("/api/model/ontologies/ont-1")
    assert resp.status_code == 200
    assert resp.json()["ontologyId"] == "ont-1"


async def test_get_ontology_not_found(client, repo_patch):
    with repo_patch(get_ontology=AsyncMock(return_value=None)):
        resp = await client.get("/api/model/ontologies/missing")
    assert resp.status_code == 404


async def test_update_ontology(client, repo_patch):
    updated = {**ONTOLOGY_DATA, "name": "Updated"}
    with repo_patch(update_ontology=AsyncMock(return_value=updated)):
        resp = await client.put(
            "/api/model/ontologies/ont-1",
            json={"name": "Updated"},
        )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"


async def test_delete_ontology(client, repo_patch):
    with repo_patch():
        resp = await client.delete("/api/model/ontologies/ont-1")
    assert resp.status_code == 204


async def test_delete_ontology_not_found(client, repo_patch):
    with repo_patch(delete_ontology=AsyncMock(return_value=False)):
        resp = await client.delete("/api/model/ontologies/missing")
    assert resp.status_code == 404


async def test_update_ontology_converts_neo4j_datetime():
    """Regression: repository.update_ontology must call _convert_neo4j_types."""
    from neo4j.time import DateTime as Neo4jDateTime
    from ontoforge_server.modeling.repository import update_ontology

    neo4j_dt = Neo4jDateTime(2025, 1, 1, 0, 0, 0, 0, tzinfo=timezone.utc)
    raw_record = {
        "ontologyId": "ont-1",
        "name": "Updated",
        "description": "A test",
        "createdAt": neo4j_dt,
        "updatedAt": neo4j_dt,
    }

    mock_result = AsyncMock()
    mock_result.single = AsyncMock(return_value={"ontology": raw_record})

    mock_session = AsyncMock()
    mock_session.run = AsyncMock(return_value=mock_result)

    result = await update_ontology(mock_session, "ont-1", "Updated", None)
    assert result is not None
    assert isinstance(result["createdAt"], datetime)
    assert isinstance(result["updatedAt"], datetime)
    assert not isinstance(result["createdAt"], Neo4jDateTime)
