"""Tests for runtime relation instance CRUD endpoints."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

import ontoforge_server.runtime.service as svc
from tests.runtime.conftest import ONTOLOGY_KEY


NOW = datetime(2025, 6, 1, tzinfo=timezone.utc)
PREFIX = f"/api/runtime/{ONTOLOGY_KEY}"

PERSON_ENTITY = {
    "_id": "ent-person-1",
    "_entityTypeKey": "person",
    "_createdAt": NOW,
    "_updatedAt": NOW,
    "name": "Alice",
}

COMPANY_ENTITY = {
    "_id": "ent-company-1",
    "_entityTypeKey": "company",
    "_createdAt": NOW,
    "_updatedAt": NOW,
    "name": "Acme Corp",
}

RELATION_DATA = {
    "_id": "rel-1",
    "_relationTypeKey": "works_for",
    "_createdAt": NOW,
    "_updatedAt": NOW,
    "fromEntityId": "ent-person-1",
    "toEntityId": "ent-company-1",
    "role": "Engineer",
}


def _mock_repo(**overrides):
    defaults = {
        "get_entity_by_id": AsyncMock(return_value=None),
        "create_relation": AsyncMock(return_value=RELATION_DATA),
        "list_relations": AsyncMock(return_value=([RELATION_DATA], 1)),
        "get_relation": AsyncMock(return_value=RELATION_DATA),
        "update_relation": AsyncMock(return_value=RELATION_DATA),
        "delete_relation": AsyncMock(return_value=True),
    }
    defaults.update(overrides)
    return defaults


@pytest.fixture
def repo_patch():
    def _patch(**overrides):
        mocks = _mock_repo(**overrides)
        return patch.multiple(
            "ontoforge_server.runtime.service.repository", **mocks
        )
    return _patch


def _entity_lookup(entity_map):
    """Create a side_effect function that returns entities by ID."""
    async def _lookup(session, entity_id):
        return entity_map.get(entity_id)
    return _lookup


# --- Create ---


async def test_create_relation_valid(client, repo_patch):
    """POST /relations/{type_key} with valid entities returns 201."""
    entity_map = {
        "ent-person-1": PERSON_ENTITY,
        "ent-company-1": COMPANY_ENTITY,
    }
    with repo_patch(
        get_entity_by_id=AsyncMock(side_effect=_entity_lookup(entity_map)),
    ):
        resp = await client.post(
            f"{PREFIX}/relations/works_for",
            json={
                "fromEntityId": "ent-person-1",
                "toEntityId": "ent-company-1",
                "role": "Engineer",
            },
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["_id"] == "rel-1"
    assert data["fromEntityId"] == "ent-person-1"
    assert data["toEntityId"] == "ent-company-1"


async def test_create_relation_source_type_mismatch(client, repo_patch):
    """POST /relations/{type_key} with wrong source entity type returns 422."""
    # works_for expects person -> company
    # Supply company -> company (source type mismatch)
    entity_map = {
        "ent-company-1": COMPANY_ENTITY,
        "ent-company-2": {**COMPANY_ENTITY, "_id": "ent-company-2"},
    }
    with repo_patch(
        get_entity_by_id=AsyncMock(side_effect=_entity_lookup(entity_map)),
    ):
        resp = await client.post(
            f"{PREFIX}/relations/works_for",
            json={
                "fromEntityId": "ent-company-1",
                "toEntityId": "ent-company-2",
            },
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "fromEntityId" in data["error"]["details"]["fields"]


async def test_create_relation_nonexistent_source_entity(client, repo_patch):
    """POST /relations/{type_key} with nonexistent source entity returns 422."""
    entity_map = {
        "ent-company-1": COMPANY_ENTITY,
    }
    with repo_patch(
        get_entity_by_id=AsyncMock(side_effect=_entity_lookup(entity_map)),
    ):
        resp = await client.post(
            f"{PREFIX}/relations/works_for",
            json={
                "fromEntityId": "nonexistent-entity",
                "toEntityId": "ent-company-1",
            },
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "fromEntityId" in data["error"]["details"]["fields"]


async def test_create_relation_nonexistent_target_entity(client, repo_patch):
    """POST /relations/{type_key} with nonexistent target entity returns 422."""
    entity_map = {
        "ent-person-1": PERSON_ENTITY,
    }
    with repo_patch(
        get_entity_by_id=AsyncMock(side_effect=_entity_lookup(entity_map)),
    ):
        resp = await client.post(
            f"{PREFIX}/relations/works_for",
            json={
                "fromEntityId": "ent-person-1",
                "toEntityId": "nonexistent-entity",
            },
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "toEntityId" in data["error"]["details"]["fields"]


async def test_create_relation_nonexistent_type(client, repo_patch):
    """POST /relations/{type_key} with unknown relation type returns 404."""
    with repo_patch():
        resp = await client.post(
            f"{PREFIX}/relations/nonexistent",
            json={
                "fromEntityId": "ent-1",
                "toEntityId": "ent-2",
            },
        )
    assert resp.status_code == 404


# --- List ---


async def test_list_relations(client, repo_patch):
    """GET /relations/{type_key} returns paginated response."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/relations/works_for")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] == 1
    assert len(data["items"]) == 1


async def test_list_relations_nonexistent_type(client, repo_patch):
    """GET /relations/{type_key} with unknown type returns 404."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/relations/nonexistent")
    assert resp.status_code == 404


# --- Get ---


async def test_get_relation(client, repo_patch):
    """GET /relations/{type_key}/{id} returns the relation."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/relations/works_for/rel-1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["_id"] == "rel-1"
    assert data["fromEntityId"] == "ent-person-1"
    assert data["toEntityId"] == "ent-company-1"


async def test_get_relation_not_found(client, repo_patch):
    """GET /relations/{type_key}/{id} with unknown ID returns 404."""
    with repo_patch(get_relation=AsyncMock(return_value=None)):
        resp = await client.get(f"{PREFIX}/relations/works_for/missing-id")
    assert resp.status_code == 404


# --- Update ---


async def test_update_relation(client, repo_patch):
    """PATCH /relations/{type_key}/{id} with valid update returns 200."""
    updated = {**RELATION_DATA, "role": "Senior Engineer"}
    with repo_patch(update_relation=AsyncMock(return_value=updated)):
        resp = await client.patch(
            f"{PREFIX}/relations/works_for/rel-1",
            json={"role": "Senior Engineer"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "Senior Engineer"


async def test_update_relation_ignores_endpoint_ids(client, repo_patch):
    """PATCH /relations/{type_key}/{id} silently ignores fromEntityId/toEntityId."""
    captured_set = {}
    captured_remove = []

    async def capture_update(session, rel_type, rid, set_props, remove_props):
        captured_set.update(set_props)
        captured_remove.extend(remove_props)
        return RELATION_DATA

    with repo_patch(update_relation=AsyncMock(side_effect=capture_update)):
        resp = await client.patch(
            f"{PREFIX}/relations/works_for/rel-1",
            json={
                "fromEntityId": "changed-id",
                "toEntityId": "changed-id",
                "role": "Manager",
            },
        )
    assert resp.status_code == 200
    # fromEntityId and toEntityId should have been stripped before validation
    assert "fromEntityId" not in captured_set
    assert "toEntityId" not in captured_set
    assert captured_set.get("role") == "Manager"


async def test_update_relation_not_found(client, repo_patch):
    """PATCH on a nonexistent relation returns 404."""
    with repo_patch(update_relation=AsyncMock(return_value=None)):
        resp = await client.patch(
            f"{PREFIX}/relations/works_for/missing-id",
            json={"role": "Updated"},
        )
    assert resp.status_code == 404


# --- Delete ---


async def test_delete_relation(client, repo_patch):
    """DELETE /relations/{type_key}/{id} returns 204."""
    with repo_patch():
        resp = await client.delete(f"{PREFIX}/relations/works_for/rel-1")
    assert resp.status_code == 204


async def test_delete_relation_not_found(client, repo_patch):
    """DELETE on a nonexistent relation returns 404."""
    with repo_patch(delete_relation=AsyncMock(return_value=False)):
        resp = await client.delete(f"{PREFIX}/relations/works_for/missing-id")
    assert resp.status_code == 404


async def test_delete_relation_nonexistent_type(client, repo_patch):
    """DELETE with an unknown relation type returns 404."""
    with repo_patch():
        resp = await client.delete(f"{PREFIX}/relations/nonexistent/rel-1")
    assert resp.status_code == 404
