"""Tests for the EntityType display/projection fields (M4 §5).

Covers:
  - displayNameProperty / defaultSearchProperties round-trip on create + update
  - 422 validation when references point at undefined property keys
  - cascade-on-delete: clears displayNameProperty / prunes defaultSearchProperties
  - cascade-on-rename: dormant safety net (keys are immutable today)
"""

import logging
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.modeling.service.repository"
NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

ET_DATA = {
    "entityTypeId": "et-1",
    "key": "person",
    "displayName": "Person",
    "description": None,
    "displayNameProperty": None,
    "defaultSearchProperties": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}

PROP_NAME = {
    "propertyId": "prop-name",
    "key": "name",
    "displayName": "Name",
    "description": None,
    "dataType": "string",
    "required": True,
    "defaultValue": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}

PROP_ROLE = {
    "propertyId": "prop-role",
    "key": "role",
    "displayName": "Role",
    "description": None,
    "dataType": "string",
    "required": False,
    "defaultValue": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}


# ---------------------------------------------------------------------------
# Create — projection field validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_with_projection_fields_succeeds_when_no_props(client):
    """Setting both fields to None on create is the trivial happy path."""
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
    ):
        resp = await client.post(
            "/api/model/entity-types",
            json={"key": "person", "displayName": "Person"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["displayNameProperty"] is None
    assert body["defaultSearchProperties"] is None


@pytest.mark.asyncio
async def test_create_with_displayNameProperty_unknown_returns_422(client):
    """References to a property that doesn't exist on the type → 422."""
    resp = await client.post(
        "/api/model/entity-types",
        json={
            "key": "person",
            "displayName": "Person",
            "displayNameProperty": "name",
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "displayNameProperty" in resp.json()["error"]["details"]["fields"]


@pytest.mark.asyncio
async def test_create_with_defaultSearchProperties_unknown_returns_422(client):
    resp = await client.post(
        "/api/model/entity-types",
        json={
            "key": "person",
            "displayName": "Person",
            "defaultSearchProperties": ["name", "missing"],
        },
    )
    assert resp.status_code == 422
    assert "defaultSearchProperties" in resp.json()["error"]["details"]["fields"]


# ---------------------------------------------------------------------------
# Update — projection field validation against current properties
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_set_displayNameProperty_to_existing_property(client):
    updated = {
        **ET_DATA,
        "displayNameProperty": "name",
        "defaultSearchProperties": ["role"],
    }
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[PROP_NAME, PROP_ROLE]),
        patch(f"{REPO}.update_entity_type", new_callable=AsyncMock, return_value=updated),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1",
            json={"displayNameProperty": "name", "defaultSearchProperties": ["role"]},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["displayNameProperty"] == "name"
    assert body["defaultSearchProperties"] == ["role"]


@pytest.mark.asyncio
async def test_update_clear_displayNameProperty_to_null(client):
    """Setting displayNameProperty=null is allowed (no validation needed)."""
    updated = {**ET_DATA, "displayNameProperty": None}
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[PROP_NAME]),
        patch(f"{REPO}.update_entity_type", new_callable=AsyncMock, return_value=updated),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1",
            json={"displayNameProperty": None},
        )
    assert resp.status_code == 200
    assert resp.json()["displayNameProperty"] is None


@pytest.mark.asyncio
async def test_update_displayNameProperty_unknown_returns_422(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[PROP_NAME]),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1",
            json={"displayNameProperty": "ghost"},
        )
    assert resp.status_code == 422
    assert "displayNameProperty" in resp.json()["error"]["details"]["fields"]


@pytest.mark.asyncio
async def test_update_defaultSearchProperties_unknown_returns_422(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[PROP_NAME]),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1",
            json={"defaultSearchProperties": ["name", "ghost"]},
        )
    assert resp.status_code == 422
    assert "defaultSearchProperties" in resp.json()["error"]["details"]["fields"]


@pytest.mark.asyncio
async def test_update_no_projection_fields_skips_validation_lookup(client):
    """Updates that don't touch the projection fields must not pay for the lookup."""
    list_props = AsyncMock(return_value=[])
    with (
        patch(f"{REPO}.list_properties", new=list_props),
        patch(f"{REPO}.update_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1",
            json={"displayName": "Person v2"},
        )
    assert resp.status_code == 200
    list_props.assert_not_called()


# ---------------------------------------------------------------------------
# Cascade-on-delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_property_cascades_clears_references(caplog, client):
    """Deleting a property triggers cascade_clear_property_references with INFO log."""
    cascade = AsyncMock(return_value=["displayNameProperty"])
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=PROP_NAME),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.cascade_clear_property_references", new=cascade),
        patch(f"{REPO}.delete_property", new_callable=AsyncMock, return_value=True),
    ):
        with caplog.at_level(logging.INFO, logger="ontoforge_server.modeling.service"):
            resp = await client.delete("/api/model/entity-types/et-1/properties/prop-name")
    assert resp.status_code == 204
    cascade.assert_awaited_once_with(
        # session, owner_id, property_key
        cascade.await_args[0][0], "et-1", "name",
    )
    # INFO log line per affected field
    matching = [r for r in caplog.records if "auto-cleared" in r.getMessage()]
    assert len(matching) == 1
    assert "displayNameProperty" in matching[0].getMessage()


@pytest.mark.asyncio
async def test_delete_property_cascade_no_op_when_no_references(client):
    """No-op cascade still completes without error when the property is unreferenced."""
    cascade = AsyncMock(return_value=[])
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=PROP_ROLE),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.cascade_clear_property_references", new=cascade),
        patch(f"{REPO}.delete_property", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/model/entity-types/et-1/properties/prop-role")
    assert resp.status_code == 204
    cascade.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_property_on_relation_type_does_not_cascade(client):
    """RelationType properties have no display/projection fields to cascade to."""
    cascade = AsyncMock(return_value=[])
    with (
        patch(f"{REPO}.get_relation_type", new_callable=AsyncMock, return_value={
            "relationTypeId": "rt-1",
            "key": "works_for",
            "sourceEntityTypeKey": "person",
            "targetEntityTypeKey": "company",
        }),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=PROP_ROLE),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.cascade_clear_property_references", new=cascade),
        patch(f"{REPO}.delete_property", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/model/relation-types/rt-1/properties/prop-role")
    assert resp.status_code == 204
    cascade.assert_not_called()


# ---------------------------------------------------------------------------
# Cascade-on-rename (safety net — keys are immutable today)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_property_dormant_rename_cascade_when_keys_match(client):
    """No rename happens today: PropertyDefinitionUpdate has no `key` field, so
    repository.update_property returns the same key. The cascade must therefore
    NOT be invoked."""
    rename_cascade = AsyncMock(return_value=[])
    updated = {**PROP_NAME, "displayName": "Updated Name"}
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=PROP_NAME),
        patch(f"{REPO}.update_property", new_callable=AsyncMock, return_value=updated),
        patch(f"{REPO}.cascade_rename_property_references", new=rename_cascade),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1/properties/prop-name",
            json={"displayName": "Updated Name"},
        )
    assert resp.status_code == 200
    rename_cascade.assert_not_called()


@pytest.mark.asyncio
async def test_update_property_rename_cascade_runs_when_key_changes(caplog, client):
    """Synthetic test: simulate a key change at the repository layer to verify
    the cascade fires. Keys are immutable today, so this is a safety-net path
    that exercises the wiring without enabling renames at the API surface."""
    renamed_prop = {**PROP_NAME, "key": "full_name"}
    rename_cascade = AsyncMock(return_value=["displayNameProperty", "defaultSearchProperties"])
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=PROP_NAME),
        patch(f"{REPO}.update_property", new_callable=AsyncMock, return_value=renamed_prop),
        patch(f"{REPO}.cascade_rename_property_references", new=rename_cascade),
    ):
        with caplog.at_level(logging.INFO, logger="ontoforge_server.modeling.service"):
            resp = await client.put(
                "/api/model/entity-types/et-1/properties/prop-name",
                json={"displayName": "Whatever"},
            )
    assert resp.status_code == 200
    rename_cascade.assert_awaited_once()
    args, _ = rename_cascade.await_args
    # session, owner_id, old_key, new_key
    assert args[1:] == ("et-1", "name", "full_name")
    matching = [r for r in caplog.records if "auto-renamed" in r.getMessage()]
    # one log per affected field
    assert len(matching) == 2
