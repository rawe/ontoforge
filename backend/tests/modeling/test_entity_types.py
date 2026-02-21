from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest


NOW = datetime(2025, 1, 1, tzinfo=timezone.utc)

ONTOLOGY_DATA = {
    "ontologyId": "ont-1",
    "name": "Test",
    "description": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}

ENTITY_TYPE_DATA = {
    "entityTypeId": "et-1",
    "key": "person",
    "displayName": "Person",
    "description": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}


def _mock_repo(**overrides):
    defaults = {
        "get_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "get_entity_type_by_key": AsyncMock(return_value=None),
        "create_entity_type": AsyncMock(return_value=ENTITY_TYPE_DATA),
        "list_entity_types": AsyncMock(return_value=[ENTITY_TYPE_DATA]),
        "get_entity_type": AsyncMock(return_value=ENTITY_TYPE_DATA),
        "update_entity_type": AsyncMock(return_value=ENTITY_TYPE_DATA),
        "delete_entity_type": AsyncMock(return_value=True),
        "is_entity_type_referenced": AsyncMock(return_value=False),
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


async def test_create_entity_type(client, repo_patch):
    with repo_patch():
        resp = await client.post(
            "/api/model/ontologies/ont-1/entity-types",
            json={"key": "person", "displayName": "Person"},
        )
    assert resp.status_code == 201
    assert resp.json()["key"] == "person"
    assert resp.json()["entityTypeId"] == "et-1"


async def test_create_entity_type_duplicate_key(client, repo_patch):
    with repo_patch(get_entity_type_by_key=AsyncMock(return_value=ENTITY_TYPE_DATA)):
        resp = await client.post(
            "/api/model/ontologies/ont-1/entity-types",
            json={"key": "person", "displayName": "Person"},
        )
    assert resp.status_code == 409


async def test_create_entity_type_invalid_key(client, repo_patch):
    with repo_patch():
        resp = await client.post(
            "/api/model/ontologies/ont-1/entity-types",
            json={"key": "Invalid-Key!", "displayName": "Bad"},
        )
    assert resp.status_code == 422


async def test_list_entity_types(client, repo_patch):
    with repo_patch():
        resp = await client.get("/api/model/ontologies/ont-1/entity-types")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 1


async def test_get_entity_type(client, repo_patch):
    with repo_patch():
        resp = await client.get("/api/model/ontologies/ont-1/entity-types/et-1")
    assert resp.status_code == 200
    assert resp.json()["entityTypeId"] == "et-1"


async def test_update_entity_type(client, repo_patch):
    updated = {**ENTITY_TYPE_DATA, "displayName": "Updated Person"}
    with repo_patch(update_entity_type=AsyncMock(return_value=updated)):
        resp = await client.put(
            "/api/model/ontologies/ont-1/entity-types/et-1",
            json={"displayName": "Updated Person"},
        )
    assert resp.status_code == 200
    assert resp.json()["displayName"] == "Updated Person"


async def test_delete_entity_type(client, repo_patch):
    with repo_patch():
        resp = await client.delete("/api/model/ontologies/ont-1/entity-types/et-1")
    assert resp.status_code == 204


async def test_delete_entity_type_in_use(client, repo_patch):
    with repo_patch(is_entity_type_referenced=AsyncMock(return_value=True)):
        resp = await client.delete("/api/model/ontologies/ont-1/entity-types/et-1")
    assert resp.status_code == 409
