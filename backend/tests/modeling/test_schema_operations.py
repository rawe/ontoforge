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

FULL_SCHEMA = {
    "ontology": ONTOLOGY_DATA,
    "entityTypes": [
        {
            "entityTypeId": "et-1",
            "key": "person",
            "displayName": "Person",
            "description": None,
            "createdAt": NOW,
            "updatedAt": NOW,
            "properties": [
                {
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
            ],
        },
    ],
    "relationTypes": [
        {
            "relationTypeId": "rt-1",
            "key": "knows",
            "displayName": "Knows",
            "description": None,
            "sourceEntityTypeId": "et-1",
            "targetEntityTypeId": "et-1",
            "sourceKey": "person",
            "targetKey": "person",
            "createdAt": NOW,
            "updatedAt": NOW,
            "properties": [],
        },
    ],
}


IMPORT_PAYLOAD = {
    "formatVersion": "1.0",
    "ontology": {
        "ontologyId": "ont-new",
        "key": "test_ontology",
        "name": "Test",
        "description": None,
    },
    "entityTypes": [],
    "relationTypes": [],
}


def _mock_repo(**overrides):
    defaults = {
        "get_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "get_ontology_by_key": AsyncMock(return_value=None),
        "get_ontology_by_name": AsyncMock(return_value=None),
        "get_full_schema": AsyncMock(return_value=FULL_SCHEMA),
        "create_ontology": AsyncMock(return_value=ONTOLOGY_DATA),
        "delete_ontology": AsyncMock(return_value=True),
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


async def test_validate_schema_returns_valid(client, repo_patch):
    """Regression: validate endpoint works when get_full_schema returns proper data."""
    with repo_patch():
        resp = await client.post("/api/model/ontologies/ont-1/validate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["errors"] == []


async def test_export_ontology_returns_payload(client, repo_patch):
    """Regression: export endpoint works when get_full_schema returns proper data."""
    with repo_patch():
        resp = await client.get("/api/model/ontologies/ont-1/export")
    assert resp.status_code == 200
    data = resp.json()
    assert data["formatVersion"] == "1.0"
    assert data["ontology"]["ontologyId"] == "ont-1"
    assert data["ontology"]["key"] == "test_ontology"
    assert len(data["entityTypes"]) == 1
    assert data["entityTypes"][0]["key"] == "person"
    assert len(data["relationTypes"]) == 1
    assert data["relationTypes"][0]["key"] == "knows"


async def test_import_ontology_name_conflict_returns_409(client, repo_patch):
    """Regression: importing with a name that already exists returns 409, not 500."""
    existing_other = {
        "ontologyId": "ont-other",
        "key": "other_key",
        "name": "Test",
        "description": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    with repo_patch(
        get_ontology=AsyncMock(return_value=None),
        get_ontology_by_name=AsyncMock(return_value=existing_other),
    ):
        resp = await client.post("/api/model/import", json=IMPORT_PAYLOAD)
    assert resp.status_code == 409
    assert "already exists" in resp.json()["error"]["message"]


async def test_import_ontology_key_conflict_returns_409(client, repo_patch):
    """Importing with a key that already exists on a different ontology returns 409."""
    existing_other = {
        "ontologyId": "ont-other",
        "key": "test_ontology",
        "name": "Other Name",
        "description": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    with repo_patch(
        get_ontology=AsyncMock(return_value=None),
        get_ontology_by_key=AsyncMock(return_value=existing_other),
    ):
        resp = await client.post("/api/model/import", json=IMPORT_PAYLOAD)
    assert resp.status_code == 409
    assert "already exists" in resp.json()["error"]["message"]
