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

PROPERTY_DATA = {
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


def _mock_repo(**overrides):
    defaults = {
        "get_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "get_entity_type": AsyncMock(return_value=ENTITY_TYPE_DATA),
        "get_relation_type": AsyncMock(return_value=None),
        "get_property_by_key": AsyncMock(return_value=None),
        "create_property": AsyncMock(return_value=PROPERTY_DATA),
        "list_properties": AsyncMock(return_value=[PROPERTY_DATA]),
        "get_property": AsyncMock(return_value=PROPERTY_DATA),
        "update_property": AsyncMock(return_value=PROPERTY_DATA),
        "delete_property": AsyncMock(return_value=True),
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


BASE = "/api/model/ontologies/ont-1/entity-types/et-1/properties"


async def test_add_property(client, repo_patch):
    with repo_patch():
        resp = await client.post(
            BASE,
            json={
                "key": "full_name",
                "displayName": "Full Name",
                "dataType": "string",
            },
        )
    assert resp.status_code == 201
    assert resp.json()["key"] == "full_name"
    assert resp.json()["propertyId"] == "prop-1"


async def test_add_property_duplicate_key(client, repo_patch):
    with repo_patch(get_property_by_key=AsyncMock(return_value=PROPERTY_DATA)):
        resp = await client.post(
            BASE,
            json={
                "key": "full_name",
                "displayName": "Full Name",
                "dataType": "string",
            },
        )
    assert resp.status_code == 409


async def test_list_properties(client, repo_patch):
    with repo_patch():
        resp = await client.get(BASE)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 1


async def test_update_property(client, repo_patch):
    updated = {**PROPERTY_DATA, "displayName": "Updated Name"}
    with repo_patch(update_property=AsyncMock(return_value=updated)):
        resp = await client.put(
            f"{BASE}/prop-1",
            json={"displayName": "Updated Name"},
        )
    assert resp.status_code == 200
    assert resp.json()["displayName"] == "Updated Name"


async def test_delete_property(client, repo_patch):
    with repo_patch():
        resp = await client.delete(f"{BASE}/prop-1")
    assert resp.status_code == 204


async def test_property_response_without_default_value(client, repo_patch):
    """Regression: PropertyDefinitionResponse must accept missing defaultValue."""
    prop_no_default = {
        "propertyId": "prop-2",
        "key": "age",
        "displayName": "Age",
        "description": None,
        "dataType": "integer",
        "required": True,
        "createdAt": NOW,
        "updatedAt": NOW,
        # defaultValue intentionally omitted
    }
    with repo_patch(create_property=AsyncMock(return_value=prop_no_default)):
        resp = await client.post(
            BASE,
            json={
                "key": "age",
                "displayName": "Age",
                "dataType": "integer",
                "required": True,
            },
        )
    assert resp.status_code == 201
    assert resp.json()["defaultValue"] is None


def test_property_definition_response_schema_no_default():
    """Regression: PropertyDefinitionResponse accepts dict without defaultValue key."""
    from ontoforge_server.modeling.schemas import PropertyDefinitionResponse

    data = {
        "propertyId": "prop-3",
        "key": "email",
        "displayName": "Email",
        "description": None,
        "dataType": "string",
        "required": False,
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    resp = PropertyDefinitionResponse.model_validate(data)
    assert resp.default_value is None


def test_export_property_schema_no_default():
    """Regression: ExportProperty accepts dict without defaultValue key."""
    from ontoforge_server.modeling.schemas import ExportProperty

    data = {
        "key": "email",
        "displayName": "Email",
        "description": None,
        "dataType": "string",
        "required": False,
    }
    prop = ExportProperty.model_validate(data)
    assert prop.default_value is None
