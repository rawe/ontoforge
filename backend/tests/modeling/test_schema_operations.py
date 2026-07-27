from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.adapters.neo4j.modeling_queries"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

FULL_SCHEMA = {
    "entityTypes": [
        {
            "entityTypeId": "et-1",
            "key": "person",
            "displayName": "Person",
            "description": None,
            "properties": [
                {
                    "propertyId": "p-1",
                    "key": "full_name",
                    "displayName": "Full Name",
                    "dataType": "string",
                    "required": True,
                    "defaultValue": None,
                },
            ],
        },
        {
            "entityTypeId": "et-2",
            "key": "company",
            "displayName": "Company",
            "description": None,
            "properties": [],
        },
    ],
    "relationTypes": [
        {
            "relationTypeId": "rt-1",
            "key": "works_for",
            "displayName": "Works For",
            "description": None,
            "sourceKey": "person",
            "targetKey": "company",
            "properties": [],
        },
    ],
    "ontologies": [
        {
            "ontologyId": "ont-1",
            "key": "test_ontology",
            "name": "Test Ontology",
            "description": None,
            "createdAt": NOW,
            "updatedAt": NOW,
            "entityInclusions": [
                {"key": "person", "properties": ["full_name"]},
                {"key": "company", "properties": None},
            ],
            "relationInclusions": [{"key": "works_for", "properties": None}],
        },
    ],
}


# --- Validate Schema ---


@pytest.mark.asyncio
async def test_validate_schema_valid(client):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=FULL_SCHEMA),
        patch(f"{REPO}.list_ontologies", new_callable=AsyncMock, return_value=FULL_SCHEMA["ontologies"]),
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=FULL_SCHEMA["ontologies"][0]),
    ):
        resp = await client.post("/api/model/schema/validate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["errors"] == []


@pytest.mark.asyncio
async def test_validate_schema_with_errors(client):
    bad_schema = {
        "entityTypes": [
            {
                "entityTypeId": "et-1",
                "key": "person",
                "displayName": "Person",
                "properties": [
                    {
                        "key": "age",
                        "displayName": "Age",
                        "dataType": "invalid_type",
                        "required": False,
                    },
                ],
            },
        ],
        "relationTypes": [
            {
                "relationTypeId": "rt-1",
                "key": "works_for",
                "displayName": "Works For",
                "sourceKey": "nonexistent",
                "targetKey": "person",
                "properties": [],
            },
        ],
        "ontologies": [],
    }
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=bad_schema),
        patch(f"{REPO}.list_ontologies", new_callable=AsyncMock, return_value=[]),
    ):
        resp = await client.post("/api/model/schema/validate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert len(body["errors"]) >= 2
    messages = [e["message"] for e in body["errors"]]
    assert any("invalid_type" in m for m in messages)
    assert any("nonexistent" in m for m in messages)


# --- Export ---


@pytest.mark.asyncio
async def test_export_schema(client):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=FULL_SCHEMA),
        patch(f"{REPO}.list_ai_agents_for_export", new_callable=AsyncMock, return_value=[]),
    ):
        resp = await client.get("/api/model/export")
    assert resp.status_code == 200
    body = resp.json()
    assert body["formatVersion"] == "3.0"
    assert len(body["entityTypes"]) == 2
    assert len(body["relationTypes"]) == 1
    assert len(body["ontologies"]) == 1
    # Check entity type structure
    person = body["entityTypes"][0]
    assert person["key"] == "person"
    assert len(person["properties"]) == 1
    assert person["properties"][0]["key"] == "full_name"
    # Check relation type has from/to keys
    rt = body["relationTypes"][0]
    assert rt["fromEntityTypeKey"] == "person"
    assert rt["toEntityTypeKey"] == "company"
    # Check ontology includes
    ont = body["ontologies"][0]
    assert ont["key"] == "test_ontology"
    assert ont["includes"]["entityTypes"][0]["key"] == "person"
    assert ont["includes"]["relationTypes"][0]["key"] == "works_for"


@pytest.mark.asyncio
async def test_export_schema_empty(client):
    empty = {"entityTypes": [], "relationTypes": [], "ontologies": []}
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=empty):
        resp = await client.get("/api/model/export")
    assert resp.status_code == 200
    body = resp.json()
    assert body["formatVersion"] == "3.0"
    assert body["entityTypes"] == []
    assert body["relationTypes"] == []
    assert body["ontologies"] == []


# --- Import ---


@pytest.mark.asyncio
async def test_import_schema(client):
    ont_data = {
        "ontologyId": "ont-new",
        "key": "imported",
        "name": "Imported",
        "description": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", new_callable=AsyncMock, return_value={}),
        patch(f"{REPO}.create_property", new_callable=AsyncMock, return_value={}),
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_relation_type", new_callable=AsyncMock, return_value={}),
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_ontology", new_callable=AsyncMock, return_value=ont_data),
        patch(f"{REPO}.add_includes_type", new_callable=AsyncMock, return_value={"key": "person", "properties": None}),
    ):
        resp = await client.post(
            "/api/model/import",
            json={
                "formatVersion": "2.0",
                "entityTypes": [
                    {
                        "key": "person",
                        "displayName": "Person",
                        "properties": [
                            {
                                "key": "full_name",
                                "displayName": "Full Name",
                                "dataType": "string",
                                "required": True,
                            },
                        ],
                    },
                ],
                "relationTypes": [
                    {
                        "key": "works_for",
                        "displayName": "Works For",
                        "fromEntityTypeKey": "person",
                        "toEntityTypeKey": "person",
                        "properties": [],
                    },
                ],
                "ontologies": [
                    {
                        "key": "imported",
                        "name": "Imported",
                        "includes": {
                            "entityTypes": [{"key": "person"}],
                            "relationTypes": [{"key": "works_for"}],
                        },
                    },
                ],
            },
        )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["ontologies"]) == 1
    assert body["ontologies"][0]["key"] == "imported"


@pytest.mark.asyncio
async def test_import_schema_entity_type_conflict(client):
    existing_et = {"entityTypeId": "et-existing", "key": "person"}
    with patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=existing_et):
        resp = await client.post(
            "/api/model/import",
            json={
                "formatVersion": "2.0",
                "entityTypes": [{"key": "person", "displayName": "Person"}],
                "relationTypes": [],
                "ontologies": [],
            },
        )
    assert resp.status_code == 409
    assert "person" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_import_rejects_document_saved_query_parameter(client):
    ont_data = {
        "ontologyId": "ont-new",
        "key": "imported",
        "name": "Imported",
        "description": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    with (
        patch(f"{REPO}.get_ontology_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_ontology", new_callable=AsyncMock, return_value=ont_data),
        patch(f"{REPO}.upsert_saved_query", new_callable=AsyncMock) as mock_upsert,
    ):
        resp = await client.post(
            "/api/model/import",
            json={
                "formatVersion": "2.2",
                "entityTypes": [],
                "relationTypes": [],
                "ontologies": [
                    {
                        "key": "imported",
                        "name": "Imported",
                        "savedQueries": [
                            {
                                "key": "find-people",
                                "name": "Find People",
                                "description": "Find people by name",
                                "steps": [
                                    {
                                        "name": "main",
                                        "type": "oql",
                                        "oql": "MATCH (p:person) RETURN p",
                                    },
                                ],
                                "parameters": [
                                    {
                                        "name": "bio",
                                        "description": "A document",
                                        "dataType": "document",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        )
    assert resp.status_code == 422
    assert "scalar" in resp.json()["error"]["message"]
    mock_upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_import_schema_missing_source_entity_type(client):
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", new_callable=AsyncMock, return_value={}),
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.post(
            "/api/model/import",
            json={
                "formatVersion": "2.0",
                "entityTypes": [{"key": "person", "displayName": "Person"}],
                "relationTypes": [
                    {
                        "key": "works_for",
                        "displayName": "Works For",
                        "fromEntityTypeKey": "nonexistent",
                        "toEntityTypeKey": "person",
                    },
                ],
                "ontologies": [],
            },
        )
    assert resp.status_code == 422
    assert "nonexistent" in resp.json()["error"]["message"]
