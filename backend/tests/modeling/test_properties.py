from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.adapters.neo4j.modeling_queries"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

ET_DATA = {
    "entityTypeId": "et-1",
    "key": "person",
    "displayName": "Person",
    "description": None,
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

PROP_DATA = {
    "propertyId": "prop-1",
    "key": "full_name",
    "displayName": "Full Name",
    "description": None,
    "dataType": "string",
    "required": False,
    "defaultValue": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}


# --- Entity Type Properties ---


@pytest.mark.asyncio
async def test_create_entity_type_property(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_property", new_callable=AsyncMock, return_value=PROP_DATA),
    ):
        resp = await client.post(
            "/api/model/entity-types/et-1/properties",
            json={"key": "full_name", "displayName": "Full Name", "dataType": "string"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["propertyId"] == "prop-1"
    assert body["key"] == "full_name"
    assert body["dataType"] == "string"


@pytest.mark.asyncio
async def test_create_property_key_conflict(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property_by_key", new_callable=AsyncMock, return_value=PROP_DATA),
    ):
        resp = await client.post(
            "/api/model/entity-types/et-1/properties",
            json={"key": "full_name", "displayName": "Full Name", "dataType": "string"},
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "RESOURCE_CONFLICT"


@pytest.mark.asyncio
async def test_create_property_owner_not_found(client):
    with patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=None):
        resp = await client.post(
            "/api/model/entity-types/nonexistent/properties",
            json={"key": "full_name", "displayName": "Full Name", "dataType": "string"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_entity_type_properties(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[PROP_DATA]),
    ):
        resp = await client.get("/api/model/entity-types/et-1/properties")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["key"] == "full_name"


@pytest.mark.asyncio
async def test_update_entity_type_property(client):
    updated = {**PROP_DATA, "displayName": "Name", "required": True}
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.update_property", new_callable=AsyncMock, return_value=updated),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1/properties/prop-1",
            json={"displayName": "Name", "required": True},
        )
    assert resp.status_code == 200
    assert resp.json()["displayName"] == "Name"


@pytest.mark.asyncio
async def test_update_property_not_found(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.update_property", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.put(
            "/api/model/entity-types/et-1/properties/nonexistent",
            json={"displayName": "Name"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_entity_type_property(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=PROP_DATA),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.delete_property", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/model/entity-types/et-1/properties/prop-1")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_property_not_found(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.delete("/api/model/entity-types/et-1/properties/nonexistent")
    assert resp.status_code == 404


# --- Relation Type Properties ---


@pytest.mark.asyncio
async def test_create_relation_type_property(client):
    with (
        patch(f"{REPO}.get_relation_type", new_callable=AsyncMock, return_value=RT_DATA),
        patch(f"{REPO}.get_property_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_property", new_callable=AsyncMock, return_value=PROP_DATA),
    ):
        resp = await client.post(
            "/api/model/relation-types/rt-1/properties",
            json={"key": "full_name", "displayName": "Full Name", "dataType": "string"},
        )
    assert resp.status_code == 201
    assert resp.json()["key"] == "full_name"


# --- Required Property Cascade ---


@pytest.mark.asyncio
async def test_create_required_property_no_default_cascade_needed(client):
    """Creating required prop without default when ontologies have explicit prop lists."""
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property_by_key", new_callable=AsyncMock, return_value=None),
        patch(
            f"{REPO}.find_ontologies_with_explicit_property",
            new_callable=AsyncMock,
            return_value=["my_ontology"],
        ),
    ):
        resp = await client.post(
            "/api/model/entity-types/et-1/properties",
            json={
                "key": "email",
                "displayName": "Email",
                "dataType": "string",
                "required": True,
            },
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CASCADE_REQUIRED"


@pytest.mark.asyncio
async def test_create_required_property_no_default_with_cascade(client):
    """Creating required prop without default with ?cascade=true auto-adds to lists."""
    required_prop = {**PROP_DATA, "key": "email", "required": True}
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property_by_key", new_callable=AsyncMock, return_value=None),
        patch(
            f"{REPO}.find_ontologies_with_explicit_property",
            new_callable=AsyncMock,
            return_value=["my_ontology"],
        ),
        patch(f"{REPO}.add_property_to_includes_lists", new_callable=AsyncMock, return_value=1),
        patch(f"{REPO}.create_property", new_callable=AsyncMock, return_value=required_prop),
    ):
        resp = await client.post(
            "/api/model/entity-types/et-1/properties?cascade=true",
            json={
                "key": "email",
                "displayName": "Email",
                "dataType": "string",
                "required": True,
            },
        )
    assert resp.status_code == 201
    assert resp.json()["required"] is True


@pytest.mark.asyncio
async def test_delete_property_with_cascade(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=PROP_DATA),
        patch(
            f"{REPO}.find_ontologies_including_type",
            new_callable=AsyncMock,
            return_value=["my_ontology"],
        ),
        patch(f"{REPO}.remove_property_from_includes_lists", new_callable=AsyncMock, return_value=1),
        patch(f"{REPO}.delete_property", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete(
            "/api/model/entity-types/et-1/properties/prop-1?cascade=true"
        )
    assert resp.status_code == 204
