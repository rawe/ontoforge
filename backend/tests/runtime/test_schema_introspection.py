"""Tests for runtime schema introspection endpoints (GET /api/runtime/{ontologyKey}/schema/...)."""

import pytest

import ontoforge_server.runtime.service as svc
from tests.runtime.conftest import ONTOLOGY_KEY

PREFIX = f"/api/runtime/{ONTOLOGY_KEY}"


async def test_get_schema_provisioned(client):
    """GET /schema when provisioned returns the full schema."""
    resp = await client.get(f"{PREFIX}/schema")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ontology"]["ontologyId"] == "test-ontology-001"
    assert data["ontology"]["key"] == "test_ontology"
    assert data["ontology"]["name"] == "Test Ontology"
    assert len(data["entityTypes"]) == 2
    assert len(data["relationTypes"]) == 1


async def test_get_schema_not_provisioned(client):
    """GET /schema when ontology not loaded returns 404."""
    svc._schema_caches.clear()
    resp = await client.get(f"{PREFIX}/schema")
    assert resp.status_code == 404


async def test_list_entity_types(client):
    """GET /schema/entity-types returns all entity types."""
    resp = await client.get(f"{PREFIX}/schema/entity-types")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 2
    keys = {et["key"] for et in data}
    assert keys == {"person", "company"}


async def test_get_entity_type_by_key(client):
    """GET /schema/entity-types/{{key}} returns a single entity type."""
    resp = await client.get(f"{PREFIX}/schema/entity-types/person")
    assert resp.status_code == 200
    data = resp.json()
    assert data["key"] == "person"
    assert data["displayName"] == "Person"
    assert len(data["properties"]) == 4  # name, age, email, active


async def test_get_entity_type_not_found(client):
    """GET /schema/entity-types/{{key}} with unknown key returns 404."""
    resp = await client.get(f"{PREFIX}/schema/entity-types/nonexistent")
    assert resp.status_code == 404


async def test_list_relation_types(client):
    """GET /schema/relation-types returns all relation types."""
    resp = await client.get(f"{PREFIX}/schema/relation-types")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["key"] == "works_for"


async def test_get_relation_type_by_key(client):
    """GET /schema/relation-types/{{key}} returns a single relation type."""
    resp = await client.get(f"{PREFIX}/schema/relation-types/works_for")
    assert resp.status_code == 200
    data = resp.json()
    assert data["key"] == "works_for"
    assert data["displayName"] == "Works For"
    assert data["fromEntityTypeKey"] == "person"
    assert data["toEntityTypeKey"] == "company"
    assert len(data["properties"]) == 2  # since, role


async def test_get_relation_type_not_found(client):
    """GET /schema/relation-types/{{key}} with unknown key returns 404."""
    resp = await client.get(f"{PREFIX}/schema/relation-types/nonexistent")
    assert resp.status_code == 404


async def test_entity_type_properties_include_metadata(client):
    """Entity type properties include all expected fields from the schema."""
    resp = await client.get(f"{PREFIX}/schema/entity-types/person")
    assert resp.status_code == 200
    props = resp.json()["properties"]
    name_prop = next(p for p in props if p["key"] == "name")
    assert name_prop["dataType"] == "string"
    assert name_prop["required"] is True
    assert name_prop["defaultValue"] is None

    active_prop = next(p for p in props if p["key"] == "active")
    assert active_prop["dataType"] == "boolean"
    assert active_prop["required"] is False
    assert active_prop["defaultValue"] == "true"
