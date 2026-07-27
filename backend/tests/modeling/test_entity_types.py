from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.adapters.neo4j.modeling_queries"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

ET_DATA = {
    "entityTypeId": "et-1",
    "key": "person",
    "displayName": "Person",
    "description": "A person entity",
    "createdAt": NOW,
    "updatedAt": NOW,
}


@pytest.mark.asyncio
async def test_create_entity_type(client):
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
    ):
        resp = await client.post(
            "/api/model/entity-types",
            json={"key": "person", "displayName": "Person", "description": "A person entity"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["entityTypeId"] == "et-1"
    assert body["key"] == "person"
    assert body["displayName"] == "Person"


@pytest.mark.asyncio
async def test_create_entity_type_key_conflict(client):
    with patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=ET_DATA):
        resp = await client.post(
            "/api/model/entity-types",
            json={"key": "person", "displayName": "Person"},
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "RESOURCE_CONFLICT"


@pytest.mark.asyncio
async def test_list_entity_types(client):
    with patch(f"{REPO}.list_entity_types", new_callable=AsyncMock, return_value=[ET_DATA]):
        resp = await client.get("/api/model/entity-types")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["key"] == "person"


@pytest.mark.asyncio
async def test_get_entity_type(client):
    with patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA):
        resp = await client.get("/api/model/entity-types/et-1")
    assert resp.status_code == 200
    assert resp.json()["entityTypeId"] == "et-1"


@pytest.mark.asyncio
async def test_get_entity_type_not_found(client):
    with patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=None):
        resp = await client.get("/api/model/entity-types/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_entity_type(client):
    updated = {**ET_DATA, "displayName": "Updated Person"}
    with patch(f"{REPO}.update_entity_type", new_callable=AsyncMock, return_value=updated):
        resp = await client.put(
            "/api/model/entity-types/et-1",
            json={"displayName": "Updated Person"},
        )
    assert resp.status_code == 200
    assert resp.json()["displayName"] == "Updated Person"


@pytest.mark.asyncio
async def test_update_entity_type_not_found(client):
    with patch(f"{REPO}.update_entity_type", new_callable=AsyncMock, return_value=None):
        resp = await client.put(
            "/api/model/entity-types/nonexistent",
            json={"displayName": "Whatever"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_entity_type(client):
    with (
        patch(f"{REPO}.is_entity_type_referenced", new_callable=AsyncMock, return_value=False),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.delete_entity_type", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/model/entity-types/et-1")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_entity_type_referenced_by_relation(client):
    with patch(f"{REPO}.is_entity_type_referenced", new_callable=AsyncMock, return_value=True):
        resp = await client.delete("/api/model/entity-types/et-1")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "RESOURCE_CONFLICT"


@pytest.mark.asyncio
async def test_delete_entity_type_included_without_cascade(client):
    with (
        patch(f"{REPO}.is_entity_type_referenced", new_callable=AsyncMock, return_value=False),
        patch(
            f"{REPO}.find_ontologies_including_type",
            new_callable=AsyncMock,
            return_value=["my_ontology"],
        ),
    ):
        resp = await client.delete("/api/model/entity-types/et-1")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CASCADE_REQUIRED"
    assert "my_ontology" in resp.json()["error"]["details"]["affectedOntologies"]


@pytest.mark.asyncio
async def test_delete_entity_type_included_with_cascade(client):
    with (
        patch(f"{REPO}.is_entity_type_referenced", new_callable=AsyncMock, return_value=False),
        patch(
            f"{REPO}.find_ontologies_including_type",
            new_callable=AsyncMock,
            return_value=["my_ontology"],
        ),
        patch(f"{REPO}.remove_all_includes_for_type", new_callable=AsyncMock, return_value=1),
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.delete_entity_type", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/model/entity-types/et-1?cascade=true")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_entity_type_not_found(client):
    with (
        patch(f"{REPO}.is_entity_type_referenced", new_callable=AsyncMock, return_value=False),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.delete_entity_type", new_callable=AsyncMock, return_value=False),
    ):
        resp = await client.delete("/api/model/entity-types/nonexistent")
    assert resp.status_code == 404
