"""Tests for runtime entity instance CRUD endpoints."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from tests.runtime.conftest import ONTOLOGY_KEY


NOW = datetime(2025, 6, 1, tzinfo=timezone.utc)
PREFIX = f"/api/runtime/{ONTOLOGY_KEY}"

PERSON_ENTITY = {
    "_id": "ent-1",
    "_entityTypeKey": "person",
    "_createdAt": NOW,
    "_updatedAt": NOW,
    "name": "Alice",
    "age": 30,
    "email": "alice@example.com",
    "active": True,
}


def _mock_repo(**overrides):
    defaults = {
        "create_entity": AsyncMock(return_value=PERSON_ENTITY),
        "list_entities": AsyncMock(return_value=([PERSON_ENTITY], 1)),
        "get_entity": AsyncMock(return_value=PERSON_ENTITY),
        "update_entity": AsyncMock(return_value=PERSON_ENTITY),
        "delete_entity": AsyncMock(return_value=True),
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


# --- Create ---


async def test_create_entity_valid(client, repo_patch):
    """POST /entities/{type_key} with valid props returns 201."""
    with repo_patch():
        resp = await client.post(
            f"{PREFIX}/entities/person",
            json={"name": "Alice", "age": 30, "email": "alice@example.com"},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["_id"] == "ent-1"
    assert data["name"] == "Alice"


async def test_create_entity_missing_required_prop(client, repo_patch):
    """POST /entities/{type_key} with missing required prop returns 422."""
    with repo_patch():
        # 'name' is required for person, omitting it
        resp = await client.post(
            f"{PREFIX}/entities/person",
            json={"age": 30},
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "name" in data["error"]["details"]["fields"]


async def test_create_entity_unknown_prop(client, repo_patch):
    """POST /entities/{type_key} with an unknown property returns 422."""
    with repo_patch():
        resp = await client.post(
            f"{PREFIX}/entities/person",
            json={"name": "Alice", "nonexistent_field": "bad"},
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "nonexistent_field" in data["error"]["details"]["fields"]


async def test_create_entity_type_mismatch(client, repo_patch):
    """POST /entities/{type_key} with wrong data type returns 422."""
    with repo_patch():
        resp = await client.post(
            f"{PREFIX}/entities/person",
            json={"name": "Alice", "age": "not-a-number"},
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "age" in data["error"]["details"]["fields"]


async def test_create_entity_default_value_injection(client, repo_patch):
    """POST /entities/{type_key} injects default value for optional prop with default."""
    captured_props = {}

    async def capture_create(session, et_key, label, eid, props, embedding=None):
        captured_props.update(props)
        return {**PERSON_ENTITY, **props, "active": True}

    with repo_patch(create_entity=AsyncMock(side_effect=capture_create)):
        resp = await client.post(
            f"{PREFIX}/entities/person",
            json={"name": "Alice"},
        )
    assert resp.status_code == 201
    # 'active' is required=False with defaultValue="true" => not injected on create.
    # name is required with no default -> must be provided -> "Alice"
    assert "name" in captured_props
    assert captured_props["name"] == "Alice"


async def test_create_entity_required_with_default_injected(client, repo_patch, setup_schema_cache):
    """A required property with a default value is injected when not provided."""
    cache = setup_schema_cache
    person_def = cache.entity_types["person"]

    # Temporarily make 'active' required with a default
    original_required = person_def.properties["active"].required
    person_def.properties["active"].required = True

    captured_props = {}

    async def capture_create(session, et_key, label, eid, props, embedding=None):
        captured_props.update(props)
        return {**PERSON_ENTITY, **props}

    try:
        with repo_patch(create_entity=AsyncMock(side_effect=capture_create)):
            resp = await client.post(
                f"{PREFIX}/entities/person",
                json={"name": "Alice"},
            )
        assert resp.status_code == 201
        # 'active' is required with default "true" -> should be injected as boolean True
        assert captured_props.get("active") is True
    finally:
        person_def.properties["active"].required = original_required


async def test_create_entity_nonexistent_type(client, repo_patch):
    """POST /entities/{type_key} with a nonexistent type returns 404."""
    with repo_patch():
        resp = await client.post(
            f"{PREFIX}/entities/nonexistent",
            json={"name": "Alice"},
        )
    assert resp.status_code == 404


async def test_create_entity_boolean_type_check(client, repo_patch):
    """POST /entities/{type_key} rejects non-boolean for boolean field."""
    with repo_patch():
        resp = await client.post(
            f"{PREFIX}/entities/person",
            json={"name": "Alice", "active": 42},
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "active" in data["error"]["details"]["fields"]


# --- List ---


async def test_list_entities(client, repo_patch):
    """GET /entities/{type_key} returns paginated response."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/person")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] == 1
    assert data["limit"] == 50
    assert data["offset"] == 0
    assert len(data["items"]) == 1


async def test_list_entities_nonexistent_type(client, repo_patch):
    """GET /entities/{type_key} with unknown type returns 404."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/nonexistent")
    assert resp.status_code == 404


# --- Get ---


async def test_get_entity(client, repo_patch):
    """GET /entities/{type_key}/{id} returns the entity."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/person/ent-1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["_id"] == "ent-1"
    assert data["name"] == "Alice"


async def test_get_entity_not_found(client, repo_patch):
    """GET /entities/{type_key}/{id} with unknown ID returns 404."""
    with repo_patch(get_entity=AsyncMock(return_value=None)):
        resp = await client.get(f"{PREFIX}/entities/person/missing-id")
    assert resp.status_code == 404


# --- Update ---


async def test_update_entity(client, repo_patch):
    """PATCH /entities/{type_key}/{id} with valid update returns 200."""
    updated = {**PERSON_ENTITY, "name": "Alice Updated"}
    with repo_patch(update_entity=AsyncMock(return_value=updated)):
        resp = await client.patch(
            f"{PREFIX}/entities/person/ent-1",
            json={"name": "Alice Updated"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Alice Updated"


async def test_update_entity_null_removes_optional(client, repo_patch):
    """PATCH with null value on optional prop removes it (passes null to repo)."""
    captured_remove = []

    async def capture_update(session, label, eid, set_props, remove_props, embedding=None, has_embedding_update=False):
        captured_remove.extend(remove_props)
        return {**PERSON_ENTITY, "email": None}

    with repo_patch(update_entity=AsyncMock(side_effect=capture_update)):
        resp = await client.patch(
            f"{PREFIX}/entities/person/ent-1",
            json={"email": None},
        )
    assert resp.status_code == 200
    assert "email" in captured_remove


async def test_update_entity_null_on_required_returns_422(client, repo_patch):
    """PATCH with null on a required prop returns 422."""
    with repo_patch():
        resp = await client.patch(
            f"{PREFIX}/entities/person/ent-1",
            json={"name": None},
        )
    assert resp.status_code == 422
    data = resp.json()
    assert "name" in data["error"]["details"]["fields"]


async def test_update_entity_not_found(client, repo_patch):
    """PATCH on a nonexistent entity returns 404."""
    with repo_patch(update_entity=AsyncMock(return_value=None)):
        resp = await client.patch(
            f"{PREFIX}/entities/person/missing-id",
            json={"name": "Updated"},
        )
    assert resp.status_code == 404


async def test_update_entity_unknown_prop(client, repo_patch):
    """PATCH with an unknown property returns 422."""
    with repo_patch():
        resp = await client.patch(
            f"{PREFIX}/entities/person/ent-1",
            json={"nonexistent_field": "value"},
        )
    assert resp.status_code == 422


# --- Delete ---


async def test_delete_entity(client, repo_patch):
    """DELETE /entities/{type_key}/{id} returns 204."""
    with repo_patch():
        resp = await client.delete(f"{PREFIX}/entities/person/ent-1")
    assert resp.status_code == 204


async def test_delete_entity_not_found(client, repo_patch):
    """DELETE on a nonexistent entity returns 404."""
    with repo_patch(delete_entity=AsyncMock(return_value=False)):
        resp = await client.delete(f"{PREFIX}/entities/person/missing-id")
    assert resp.status_code == 404


async def test_delete_entity_nonexistent_type(client, repo_patch):
    """DELETE with an unknown entity type returns 404."""
    with repo_patch():
        resp = await client.delete(f"{PREFIX}/entities/nonexistent/ent-1")
    assert resp.status_code == 404


# --- Field Projection ---


async def test_list_entities_with_fields(client, repo_patch):
    """GET /entities/{type_key}?fields=name returns only _id and name."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/person?fields=name")
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert "_id" in item
    assert "name" in item
    assert "age" not in item
    assert "email" not in item
    assert "_createdAt" not in item
    assert "_entityTypeKey" not in item


async def test_get_entity_with_fields(client, repo_patch):
    """GET /entities/{type_key}/{id}?fields=name&fields=age returns only _id, name, age."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/person/ent-1?fields=name&fields=age")
    assert resp.status_code == 200
    data = resp.json()
    assert data["_id"] == "ent-1"
    assert data["name"] == "Alice"
    assert data["age"] == 30
    assert "email" not in data
    assert "_createdAt" not in data


async def test_list_entities_with_empty_fields(client, repo_patch):
    """GET /entities/{type_key}?fields= returns only _id."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/person?fields=")
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert "_id" in item
    # Empty string field silently ignored, so only mandatory _id remains
    assert "name" not in item
    assert "age" not in item


async def test_list_entities_fields_unknown_key_ignored(client, repo_patch):
    """GET /entities/{type_key}?fields=name&fields=nonexistent returns _id and name only."""
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person?fields=name&fields=nonexistent"
        )
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert "_id" in item
    assert "name" in item
    assert "nonexistent" not in item
    assert "age" not in item


async def test_get_entity_without_fields_returns_all(client, repo_patch):
    """GET /entities/{type_key}/{id} without fields returns all properties."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/person/ent-1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["_id"] == "ent-1"
    assert data["name"] == "Alice"
    assert data["age"] == 30
    assert "email" in data
    assert "_createdAt" in data
