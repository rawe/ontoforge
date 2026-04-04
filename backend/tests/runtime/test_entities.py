"""Tests for runtime entity CRUD with scoped schema behavior."""

from copy import deepcopy
from unittest.mock import AsyncMock, patch

import pytest

from tests.runtime.conftest import EMBEDDING, REPO, make_entity


def _long_text_schema() -> dict:
    schema = {
        "ontology": {
            "ontologyId": "ont-1",
            "key": "full_ontology",
            "name": "Full Ontology",
            "description": None,
        },
        "entityTypes": [
            {
                "entityTypeId": "et-1",
                "key": "person",
                "displayName": "Person",
                "description": None,
                "properties": [
                    {
                        "key": "name",
                        "displayName": "Name",
                        "dataType": "string",
                        "required": True,
                        "defaultValue": None,
                    },
                    {
                        "key": "content",
                        "displayName": "Content",
                        "dataType": "string",
                        "required": False,
                        "defaultValue": None,
                    },
                ],
            },
        ],
        "relationTypes": [],
        "entityInclusions": [],
        "relationInclusions": [],
    }
    return deepcopy(schema)


# ---------------------------------------------------------------------------
# Create entity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_entity_unscoped(client, unscoped_schema):
    """Creating through an unscoped ontology validates against the full property set."""
    raw_entity = make_entity(name="Alice", age=30, email="a@b.com", active=True)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema),
        patch(f"{REPO}.create_entity", new_callable=AsyncMock, return_value=raw_entity),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/full_ontology/entities/person",
            json={"name": "Alice", "age": 30, "email": "a@b.com"},
        )

    assert resp.status_code == 201
    body = resp.json()
    # All user properties visible in unscoped ontology
    assert body["name"] == "Alice"
    assert body["age"] == 30
    assert body["email"] == "a@b.com"
    assert body["active"] is True
    assert "_id" in body


@pytest.mark.asyncio
async def test_create_entity_scoped_validates_scoped_properties(client, scoped_schema):
    """Creating through a scoped ontology validates only scoped properties.

    Defaults from the full schema are applied for out-of-scope properties.
    The response only includes scoped properties.
    """
    # Repository returns entity with ALL properties (including the default `active`)
    raw_entity = make_entity(name="Alice", email="a@b.com", active=True)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.create_entity", new_callable=AsyncMock, return_value=raw_entity) as mock_create,
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/hr_view/entities/person",
            json={"name": "Alice", "email": "a@b.com"},
        )

    assert resp.status_code == 201
    body = resp.json()

    # Scoped properties are visible
    assert body["name"] == "Alice"
    assert body["email"] == "a@b.com"

    # Out-of-scope properties are NOT visible in the response
    assert "age" not in body
    assert "active" not in body

    # System properties are always visible
    assert "_id" in body
    assert "_entityTypeKey" in body

    # Verify the repository received the default for `active` from the full schema
    call_args = mock_create.call_args
    stored_props = call_args.kwargs.get("properties") or call_args[0][4]
    assert stored_props.get("active") is True


@pytest.mark.asyncio
async def test_create_entity_scoped_rejects_unknown_property(client, scoped_schema):
    """Submitting a property not in the scoped schema produces a validation error."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/hr_view/entities/person",
            json={"name": "Alice", "age": 30},  # age is not in scoped schema
        )

    assert resp.status_code == 422
    assert "age" in resp.json()["error"]["details"]["fields"]


@pytest.mark.asyncio
async def test_create_entity_type_not_in_scope_returns_404(client, scoped_schema):
    """Entity types not included in the scoped schema return 404."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/hr_view/entities/department",
            json={"name": "Engineering"},
        )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_entity_rejects_oversized_indexed_string(client):
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_long_text_schema()),
        patch(f"{REPO}.create_entity", new_callable=AsyncMock) as mock_create,
        patch(EMBEDDING, return_value=mock_provider),
    ):
        resp = await client.post(
            "/api/runtime/full_ontology/entities/person",
            json={"name": "Alice", "content": "x" * 40000},
        )

    assert resp.status_code == 422
    assert "content" in resp.json()["error"]["details"]["fields"]
    mock_create.assert_not_called()


# ---------------------------------------------------------------------------
# Get entity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_entity_scoped_filters_properties(client, scoped_schema):
    """GET entity through scoped ontology returns only scoped properties."""
    raw_entity = make_entity(name="Alice", age=30, email="a@b.com", active=True)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw_entity),
    ):
        resp = await client.get("/api/runtime/hr_view/entities/person/ent-1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Alice"
    assert body["email"] == "a@b.com"
    assert "age" not in body
    assert "active" not in body


@pytest.mark.asyncio
async def test_get_entity_unscoped_returns_all_properties(client, unscoped_schema):
    """GET entity through unscoped ontology returns all properties."""
    raw_entity = make_entity(name="Alice", age=30, email="a@b.com", active=True)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw_entity),
    ):
        resp = await client.get("/api/runtime/full_ontology/entities/person/ent-1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Alice"
    assert body["age"] == 30
    assert body["email"] == "a@b.com"
    assert body["active"] is True


@pytest.mark.asyncio
async def test_get_entity_not_found(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.get("/api/runtime/hr_view/entities/person/no-such-id")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# List entities
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_entities_scoped_filters_properties(client, scoped_schema):
    """Listing entities through scoped ontology filters properties on every item."""
    raw_entities = [
        make_entity(entity_id="ent-1", name="Alice", age=30, email="a@b.com", active=True),
        make_entity(entity_id="ent-2", name="Bob", age=25, email="b@b.com", active=False),
    ]

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.list_entities", new_callable=AsyncMock, return_value=(raw_entities, 2)),
    ):
        resp = await client.get("/api/runtime/hr_view/entities/person")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    for item in body["items"]:
        assert "name" in item
        assert "email" in item
        assert "age" not in item
        assert "active" not in item


# ---------------------------------------------------------------------------
# Update entity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_entity_scoped(client, scoped_schema):
    """Update validates against scoped properties; no defaults re-applied."""
    updated_entity = make_entity(name="Alice Updated", age=30, email="new@b.com", active=True)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.update_entity", new_callable=AsyncMock, return_value=updated_entity),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.patch(
            "/api/runtime/hr_view/entities/person/ent-1",
            json={"email": "new@b.com"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "new@b.com"
    assert body["name"] == "Alice Updated"
    # Out-of-scope properties are filtered from response
    assert "age" not in body
    assert "active" not in body


@pytest.mark.asyncio
async def test_update_entity_rejects_out_of_scope_property(client, scoped_schema):
    """Updating an out-of-scope property is rejected as unknown."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.patch(
            "/api/runtime/hr_view/entities/person/ent-1",
            json={"age": 31},
        )

    assert resp.status_code == 422
    assert "age" in resp.json()["error"]["details"]["fields"]


@pytest.mark.asyncio
async def test_update_entity_rejects_oversized_indexed_string(client):
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)
    current_entity = make_entity(name="Alice", content="short")

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_long_text_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=current_entity),
        patch(f"{REPO}.update_entity", new_callable=AsyncMock) as mock_update,
        patch(EMBEDDING, return_value=mock_provider),
    ):
        resp = await client.patch(
            "/api/runtime/full_ontology/entities/person/ent-1",
            json={"content": "x" * 40000},
        )

    assert resp.status_code == 422
    assert "content" in resp.json()["error"]["details"]["fields"]
    mock_update.assert_not_called()


# ---------------------------------------------------------------------------
# Delete entity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_entity(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.delete_entity", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/runtime/hr_view/entities/person/ent-1")

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_entity_type_not_in_scope(client, scoped_schema):
    """Deleting an entity whose type is not in scope returns 404."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
    ):
        resp = await client.delete("/api/runtime/hr_view/entities/department/ent-99")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_entity_not_found(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.delete_entity", new_callable=AsyncMock, return_value=False),
    ):
        resp = await client.delete("/api/runtime/hr_view/entities/person/no-such-id")

    assert resp.status_code == 404
