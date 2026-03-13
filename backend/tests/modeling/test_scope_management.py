from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.modeling.service.repository"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

ONTOLOGY_DATA = {
    "ontologyId": "ont-1",
    "key": "my_ontology",
    "name": "My Ontology",
    "description": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}

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


# --- Add Entity Type Inclusion ---


@pytest.mark.asyncio
async def test_add_includes_entity_type_all_properties(client):
    """Include entity type with properties=null (all properties)."""
    include_data = {"key": "person", "typeId": "et-1", "properties": None}
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.add_includes_type", new_callable=AsyncMock, return_value=include_data),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/entity-types",
            json={"key": "person"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["key"] == "person"
    assert body["properties"] is None


@pytest.mark.asyncio
async def test_add_includes_entity_type_with_property_filter(client):
    """Include entity type with explicit property subset."""
    include_data = {"key": "person", "typeId": "et-1", "properties": ["full_name"]}
    props = [
        {
            "propertyId": "p-1",
            "key": "full_name",
            "displayName": "Full Name",
            "dataType": "string",
            "required": False,
            "defaultValue": None,
        },
        {
            "propertyId": "p-2",
            "key": "age",
            "displayName": "Age",
            "dataType": "integer",
            "required": False,
            "defaultValue": None,
        },
    ]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=props),
        patch(f"{REPO}.add_includes_type", new_callable=AsyncMock, return_value=include_data),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/entity-types",
            json={"key": "person", "properties": ["full_name"]},
        )
    assert resp.status_code == 201
    assert resp.json()["properties"] == ["full_name"]


@pytest.mark.asyncio
async def test_add_includes_entity_type_invalid_property(client):
    """Reject inclusion with a property key that does not exist on the type."""
    props = [{"propertyId": "p-1", "key": "full_name", "displayName": "Full Name", "dataType": "string", "required": False}]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=props),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/entity-types",
            json={"key": "person", "properties": ["nonexistent"]},
        )
    assert resp.status_code == 422
    assert "nonexistent" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_add_includes_entity_type_missing_required(client):
    """Reject when explicit list omits a required property without default."""
    props = [
        {
            "propertyId": "p-1",
            "key": "full_name",
            "displayName": "Full Name",
            "dataType": "string",
            "required": True,
            "defaultValue": None,
        },
    ]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=props),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/entity-types",
            json={"key": "person", "properties": []},
        )
    assert resp.status_code == 422
    assert "full_name" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_add_includes_entity_type_not_found(client):
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/entity-types",
            json={"key": "nonexistent"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_add_includes_ontology_not_found(client):
    with patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=None):
        resp = await client.post(
            "/api/model/ontologies/nonexistent/includes/entity-types",
            json={"key": "person"},
        )
    assert resp.status_code == 404


# --- List Included Entity Types ---


@pytest.mark.asyncio
async def test_list_includes_entity_types(client):
    rows = [
        {"key": "person", "typeId": "et-1", "properties": None},
        {"key": "company", "typeId": "et-2", "properties": ["name"]},
    ]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.list_includes_types", new_callable=AsyncMock, return_value=rows),
    ):
        resp = await client.get("/api/model/ontologies/ont-1/includes/entity-types")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["key"] == "person"
    assert body[0]["properties"] is None
    assert body[1]["properties"] == ["name"]


# --- Update Entity Type Inclusion ---


@pytest.mark.asyncio
async def test_update_includes_entity_type(client):
    updated = {"key": "person", "typeId": "et-1", "properties": ["full_name", "age"]}
    props = [
        {"propertyId": "p-1", "key": "full_name", "displayName": "Full Name", "dataType": "string", "required": False},
        {"propertyId": "p-2", "key": "age", "displayName": "Age", "dataType": "integer", "required": False},
    ]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=props),
        patch(f"{REPO}.update_includes_type", new_callable=AsyncMock, return_value=updated),
    ):
        resp = await client.put(
            "/api/model/ontologies/ont-1/includes/entity-types/et-1",
            json={"properties": ["full_name", "age"]},
        )
    assert resp.status_code == 200
    assert resp.json()["properties"] == ["full_name", "age"]


@pytest.mark.asyncio
async def test_update_includes_entity_type_not_included(client):
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.update_includes_type", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.put(
            "/api/model/ontologies/ont-1/includes/entity-types/et-1",
            json={"properties": None},
        )
    assert resp.status_code == 404


# --- Remove Entity Type Inclusion ---


@pytest.mark.asyncio
async def test_remove_includes_entity_type(client):
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.remove_includes_type", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete(
            "/api/model/ontologies/ont-1/includes/entity-types/et-1"
        )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_remove_includes_entity_type_not_found(client):
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.remove_includes_type", new_callable=AsyncMock, return_value=False),
    ):
        resp = await client.delete(
            "/api/model/ontologies/ont-1/includes/entity-types/et-1"
        )
    assert resp.status_code == 404


# --- Relation Type Inclusion ---


@pytest.mark.asyncio
async def test_add_includes_relation_type(client):
    """Include relation type when its source/target entity types are already included."""
    include_data = {"key": "works_for", "typeId": "rt-1", "properties": None}
    entity_inclusions = [
        {"key": "person", "typeId": "et-1", "properties": None},
        {"key": "company", "typeId": "et-2", "properties": None},
    ]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=RT_DATA),
        patch(f"{REPO}.list_includes_types", new_callable=AsyncMock, return_value=entity_inclusions),
        patch(f"{REPO}.add_includes_type", new_callable=AsyncMock, return_value=include_data),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/relation-types",
            json={"key": "works_for"},
        )
    assert resp.status_code == 201
    assert resp.json()["key"] == "works_for"


@pytest.mark.asyncio
async def test_add_includes_relation_type_source_not_included(client):
    """Reject when source entity type is not included in the ontology."""
    entity_inclusions = [
        {"key": "company", "typeId": "et-2", "properties": None},
    ]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=RT_DATA),
        patch(f"{REPO}.list_includes_types", new_callable=AsyncMock, return_value=entity_inclusions),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/relation-types",
            json={"key": "works_for"},
        )
    assert resp.status_code == 422
    assert "person" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_add_includes_relation_type_no_entity_scoping(client):
    """Allow relation inclusion when ontology has no entity scoping (empty entity inclusions)."""
    include_data = {"key": "works_for", "typeId": "rt-1", "properties": None}
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=RT_DATA),
        patch(f"{REPO}.list_includes_types", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.add_includes_type", new_callable=AsyncMock, return_value=include_data),
    ):
        resp = await client.post(
            "/api/model/ontologies/ont-1/includes/relation-types",
            json={"key": "works_for"},
        )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_list_includes_relation_types(client):
    rows = [{"key": "works_for", "typeId": "rt-1", "properties": None}]
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.list_includes_types", new_callable=AsyncMock, return_value=rows),
    ):
        resp = await client.get("/api/model/ontologies/ont-1/includes/relation-types")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["key"] == "works_for"


@pytest.mark.asyncio
async def test_remove_includes_relation_type(client):
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.remove_includes_type", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete(
            "/api/model/ontologies/ont-1/includes/relation-types/rt-1"
        )
    assert resp.status_code == 204


# --- Ontology Validation ---


@pytest.mark.asyncio
async def test_validate_ontology_valid(client):
    schema = {
        "entityTypes": [
            {
                "entityTypeId": "et-1",
                "key": "person",
                "displayName": "Person",
                "properties": [
                    {"key": "full_name", "displayName": "Full Name", "dataType": "string", "required": True, "defaultValue": None},
                ],
            },
        ],
        "relationTypes": [],
        "ontologies": [
            {
                "ontologyId": "ont-1",
                "key": "my_ontology",
                "name": "My Ontology",
                "entityInclusions": [{"key": "person", "properties": ["full_name"]}],
                "relationInclusions": [],
            },
        ],
    }
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=schema),
    ):
        resp = await client.post("/api/model/ontologies/ont-1/validate")
    assert resp.status_code == 200
    assert resp.json()["valid"] is True


@pytest.mark.asyncio
async def test_validate_ontology_missing_required_property(client):
    schema = {
        "entityTypes": [
            {
                "entityTypeId": "et-1",
                "key": "person",
                "displayName": "Person",
                "properties": [
                    {"key": "full_name", "displayName": "Full Name", "dataType": "string", "required": True, "defaultValue": None},
                ],
            },
        ],
        "relationTypes": [],
        "ontologies": [
            {
                "ontologyId": "ont-1",
                "key": "my_ontology",
                "name": "My Ontology",
                "entityInclusions": [{"key": "person", "properties": []}],
                "relationInclusions": [],
            },
        ],
    }
    with (
        patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=ONTOLOGY_DATA),
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=schema),
    ):
        resp = await client.post("/api/model/ontologies/ont-1/validate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert any("full_name" in e["message"] for e in body["errors"])


@pytest.mark.asyncio
async def test_validate_ontology_not_found(client):
    with patch(f"{REPO}.get_ontology", new_callable=AsyncMock, return_value=None):
        resp = await client.post("/api/model/ontologies/nonexistent/validate")
    assert resp.status_code == 404
