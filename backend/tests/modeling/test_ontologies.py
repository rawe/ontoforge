from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.modeling.service.repository"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

ONTOLOGY_DATA = {
    "ontologyId": "ont-1",
    "key": "test_ontology",
    "name": "Test Ontology",
    "description": "A test ontology",
    "createdAt": NOW,
    "updatedAt": NOW,
}


@pytest.mark.asyncio
async def test_create_ontology(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.get_ontology_by_name", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
    ):
        resp = await client.post(
            "/api/model/ontologies",
            json={"key": "test_ontology", "name": "Test Ontology", "description": "A test ontology"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["ontologyId"] == "ont-1"
    assert body["key"] == "test_ontology"
    assert body["name"] == "Test Ontology"


@pytest.mark.asyncio
async def test_create_ontology_key_conflict(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
    ):
        resp = await client.post(
            "/api/model/ontologies",
            json={"key": "test_ontology", "name": "Other Name"},
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "RESOURCE_CONFLICT"


@pytest.mark.asyncio
async def test_create_ontology_name_conflict(client):
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.get_ontology_by_name", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
    ):
        resp = await client.post(
            "/api/model/ontologies",
            json={"key": "other_key", "name": "Test Ontology"},
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "RESOURCE_CONFLICT"


@pytest.mark.asyncio
async def test_list_ontologies(client):
    with patch(f"{REPO}.list_ontologies", new_callable=AsyncMock, return_value=[ONTOLOGY_DATA]):
        resp = await client.get("/api/model/ontologies")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["key"] == "test_ontology"


@pytest.mark.asyncio
async def test_get_ontology(client):
    with patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA):
        resp = await client.get("/api/model/ontologies/ont-1")
    assert resp.status_code == 200
    assert resp.json()["ontologyId"] == "ont-1"


@pytest.mark.asyncio
async def test_get_ontology_not_found(client):
    with patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=None):
        resp = await client.get("/api/model/ontologies/nonexistent")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


@pytest.mark.asyncio
async def test_update_ontology(client):
    updated = {**ONTOLOGY_DATA, "name": "Updated Name"}
    with (
        patch(f"{REPO}.get_ontology_by_name", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.update_ontology", new_callable=AsyncMock, return_value=updated),
    ):
        resp = await client.put(
            "/api/model/ontologies/ont-1",
            json={"name": "Updated Name"},
        )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_update_ontology_name_conflict(client):
    other = {**ONTOLOGY_DATA, "ontologyId": "ont-2"}
    with (
        patch(f"{REPO}.get_ontology_by_name", new_callable=AsyncMock, return_value=other),
    ):
        resp = await client.put(
            "/api/model/ontologies/ont-1",
            json={"name": "Test Ontology"},
        )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_update_ontology_not_found(client):
    with (
        patch(f"{REPO}.get_ontology_by_name", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.update_ontology", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.put(
            "/api/model/ontologies/nonexistent",
            json={"name": "Whatever"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_ontology(client):
    with patch(f"{REPO}.delete_ontology", new_callable=AsyncMock, return_value=True):
        resp = await client.delete("/api/model/ontologies/ont-1")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_ontology_not_found(client):
    with patch(f"{REPO}.delete_ontology", new_callable=AsyncMock, return_value=False):
        resp = await client.delete("/api/model/ontologies/nonexistent")
    assert resp.status_code == 404
