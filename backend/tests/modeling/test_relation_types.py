from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.modeling.service.repository"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

SOURCE_ET = {
    "entityTypeId": "et-src",
    "key": "person",
    "displayName": "Person",
    "createdAt": NOW,
    "updatedAt": NOW,
}

TARGET_ET = {
    "entityTypeId": "et-tgt",
    "key": "company",
    "displayName": "Company",
    "createdAt": NOW,
    "updatedAt": NOW,
}

RT_DATA = {
    "relationTypeId": "rt-1",
    "key": "works_for",
    "displayName": "Works For",
    "description": None,
    "sourceEntityTypeKey": "person",
    "targetEntityTypeKey": "company",
    "createdAt": NOW,
    "updatedAt": NOW,
}


@pytest.mark.asyncio
async def test_create_relation_type(client):
    with (
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, side_effect=[SOURCE_ET, TARGET_ET]),
        patch(f"{REPO}.create_relation_type", new_callable=AsyncMock, return_value=RT_DATA),
    ):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": "works_for",
                "displayName": "Works For",
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "company",
            },
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["relationTypeId"] == "rt-1"
    assert body["sourceEntityTypeKey"] == "person"
    assert body["targetEntityTypeKey"] == "company"


@pytest.mark.asyncio
async def test_create_relation_type_key_conflict(client):
    with patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=RT_DATA):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": "works_for",
                "displayName": "Works For",
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "company",
            },
        )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_relation_type_source_not_found(client):
    with (
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": "works_for",
                "displayName": "Works For",
                "sourceEntityTypeKey": "nonexistent",
                "targetEntityTypeKey": "company",
            },
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "nonexistent" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_create_relation_type_target_not_found(client):
    with (
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(
            f"{REPO}.get_entity_type_by_key",
            new_callable=AsyncMock,
            side_effect=[SOURCE_ET, None],
        ),
    ):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": "works_for",
                "displayName": "Works For",
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "nonexistent",
            },
        )
    assert resp.status_code == 422
    assert "nonexistent" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_list_relation_types(client):
    with patch(f"{REPO}.list_relation_types", new_callable=AsyncMock, return_value=[RT_DATA]):
        resp = await client.get("/api/model/relation-types")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["key"] == "works_for"


@pytest.mark.asyncio
async def test_get_relation_type(client):
    with patch(f"{REPO}.get_relation_type", new_callable=AsyncMock, return_value=RT_DATA):
        resp = await client.get("/api/model/relation-types/rt-1")
    assert resp.status_code == 200
    assert resp.json()["key"] == "works_for"


@pytest.mark.asyncio
async def test_get_relation_type_not_found(client):
    with patch(f"{REPO}.get_relation_type", new_callable=AsyncMock, return_value=None):
        resp = await client.get("/api/model/relation-types/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_relation_type(client):
    updated = {**RT_DATA, "displayName": "Employed By"}
    with patch(f"{REPO}.update_relation_type", new_callable=AsyncMock, return_value=updated):
        resp = await client.put(
            "/api/model/relation-types/rt-1",
            json={"displayName": "Employed By"},
        )
    assert resp.status_code == 200
    assert resp.json()["displayName"] == "Employed By"


@pytest.mark.asyncio
async def test_update_relation_type_not_found(client):
    with patch(f"{REPO}.update_relation_type", new_callable=AsyncMock, return_value=None):
        resp = await client.put(
            "/api/model/relation-types/nonexistent",
            json={"displayName": "Whatever"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_relation_type(client):
    with (
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.delete_relation_type", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/model/relation-types/rt-1")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_relation_type_included_without_cascade(client):
    with patch(
        f"{REPO}.find_ontologies_including_type",
        new_callable=AsyncMock,
        return_value=["my_ontology"],
    ):
        resp = await client.delete("/api/model/relation-types/rt-1")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CASCADE_REQUIRED"


@pytest.mark.asyncio
async def test_delete_relation_type_with_cascade(client):
    with (
        patch(
            f"{REPO}.find_ontologies_including_type",
            new_callable=AsyncMock,
            return_value=["my_ontology"],
        ),
        patch(f"{REPO}.remove_all_includes_for_type", new_callable=AsyncMock, return_value=1),
        patch(f"{REPO}.delete_relation_type", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/model/relation-types/rt-1?cascade=true")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_relation_type_not_found(client):
    with (
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.delete_relation_type", new_callable=AsyncMock, return_value=False),
    ):
        resp = await client.delete("/api/model/relation-types/nonexistent")
    assert resp.status_code == 404
