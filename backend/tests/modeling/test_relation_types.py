from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest


NOW = datetime(2025, 1, 1, tzinfo=timezone.utc)

ONTOLOGY_DATA = {
    "ontologyId": "ont-1",
    "key": "test_ontology",
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

ENTITY_TYPE_DATA_2 = {
    "entityTypeId": "et-2",
    "key": "company",
    "displayName": "Company",
    "description": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}

RELATION_TYPE_DATA = {
    "relationTypeId": "rt-1",
    "key": "works_at",
    "displayName": "Works At",
    "description": None,
    "sourceEntityTypeId": "et-1",
    "targetEntityTypeId": "et-2",
    "createdAt": NOW,
    "updatedAt": NOW,
}


def _get_entity_type_side_effect(session, ontology_id, entity_type_id):
    if entity_type_id == "et-1":
        return ENTITY_TYPE_DATA
    if entity_type_id == "et-2":
        return ENTITY_TYPE_DATA_2
    return None


def _mock_repo(**overrides):
    defaults = {
        "get_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "get_relation_type_by_key": AsyncMock(return_value=None),
        "get_entity_type": AsyncMock(side_effect=_get_entity_type_side_effect),
        "create_relation_type": AsyncMock(return_value=RELATION_TYPE_DATA),
        "list_relation_types": AsyncMock(return_value=[RELATION_TYPE_DATA]),
        "get_relation_type": AsyncMock(return_value=RELATION_TYPE_DATA),
        "delete_relation_type": AsyncMock(return_value=True),
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


async def test_create_relation_type(client, repo_patch):
    with repo_patch():
        resp = await client.post(
            "/api/model/ontologies/ont-1/relation-types",
            json={
                "key": "works_at",
                "displayName": "Works At",
                "sourceEntityTypeId": "et-1",
                "targetEntityTypeId": "et-2",
            },
        )
    assert resp.status_code == 201
    assert resp.json()["key"] == "works_at"
    assert resp.json()["sourceEntityTypeId"] == "et-1"
    assert resp.json()["targetEntityTypeId"] == "et-2"


async def test_create_relation_type_invalid_source(client, repo_patch):
    def _bad_source(session, ontology_id, entity_type_id):
        if entity_type_id == "et-2":
            return ENTITY_TYPE_DATA_2
        return None

    with repo_patch(get_entity_type=AsyncMock(side_effect=_bad_source)):
        resp = await client.post(
            "/api/model/ontologies/ont-1/relation-types",
            json={
                "key": "works_at",
                "displayName": "Works At",
                "sourceEntityTypeId": "nonexistent",
                "targetEntityTypeId": "et-2",
            },
        )
    assert resp.status_code == 422


async def test_list_relation_types(client, repo_patch):
    with repo_patch():
        resp = await client.get("/api/model/ontologies/ont-1/relation-types")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 1


async def test_delete_relation_type(client, repo_patch):
    with repo_patch():
        resp = await client.delete("/api/model/ontologies/ont-1/relation-types/rt-1")
    assert resp.status_code == 204
