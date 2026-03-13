"""Tests for runtime schema introspection endpoints with scope filtering."""

from unittest.mock import AsyncMock, patch

import pytest

from tests.runtime.conftest import REPO


# ---------------------------------------------------------------------------
# GET /schema
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_schema_scoped(client, scoped_schema):
    """GET /schema through a scoped ontology returns only included types with filtered properties."""
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema):
        resp = await client.get("/api/runtime/hr_view/schema")

    assert resp.status_code == 200
    body = resp.json()

    # Ontology metadata
    assert body["ontology"]["key"] == "hr_view"

    # Only included entity types
    et_keys = {et["key"] for et in body["entityTypes"]}
    assert et_keys == {"person", "company"}
    assert "department" not in et_keys

    # Person entity type has only scoped properties
    person_et = next(et for et in body["entityTypes"] if et["key"] == "person")
    prop_keys = {p["key"] for p in person_et["properties"]}
    assert prop_keys == {"name", "email"}
    assert "age" not in prop_keys
    assert "active" not in prop_keys

    # Company entity type has all properties (properties=None in inclusion)
    company_et = next(et for et in body["entityTypes"] if et["key"] == "company")
    assert {p["key"] for p in company_et["properties"]} == {"name"}

    # Only included relation types
    rt_keys = {rt["key"] for rt in body["relationTypes"]}
    assert rt_keys == {"works_for"}
    assert "belongs_to" not in rt_keys


@pytest.mark.asyncio
async def test_get_schema_unscoped(client, unscoped_schema):
    """GET /schema through an unscoped ontology returns the full schema."""
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema):
        resp = await client.get("/api/runtime/full_ontology/schema")

    assert resp.status_code == 200
    body = resp.json()

    et_keys = {et["key"] for et in body["entityTypes"]}
    assert et_keys == {"person", "company", "department"}

    rt_keys = {rt["key"] for rt in body["relationTypes"]}
    assert rt_keys == {"works_for", "belongs_to"}

    # Person has all 4 properties
    person_et = next(et for et in body["entityTypes"] if et["key"] == "person")
    prop_keys = {p["key"] for p in person_et["properties"]}
    assert prop_keys == {"name", "age", "email", "active"}


@pytest.mark.asyncio
async def test_get_schema_ontology_not_found(client):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=None):
        resp = await client.get("/api/runtime/nonexistent/schema")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /schema/entity-types
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_entity_types_scoped(client, scoped_schema):
    """Lists only entity types included in the scoped schema."""
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema):
        resp = await client.get("/api/runtime/hr_view/schema/entity-types")

    assert resp.status_code == 200
    body = resp.json()
    keys = {et["key"] for et in body}
    assert keys == {"person", "company"}


@pytest.mark.asyncio
async def test_list_entity_types_unscoped(client, unscoped_schema):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema):
        resp = await client.get("/api/runtime/full_ontology/schema/entity-types")

    assert resp.status_code == 200
    body = resp.json()
    keys = {et["key"] for et in body}
    assert keys == {"person", "company", "department"}


# ---------------------------------------------------------------------------
# GET /schema/entity-types/{key}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_entity_type_scoped(client, scoped_schema):
    """Getting a scoped entity type returns only its scoped properties."""
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema):
        resp = await client.get("/api/runtime/hr_view/schema/entity-types/person")

    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "person"
    prop_keys = {p["key"] for p in body["properties"]}
    assert prop_keys == {"name", "email"}


@pytest.mark.asyncio
async def test_get_entity_type_not_in_scope(client, scoped_schema):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema):
        resp = await client.get("/api/runtime/hr_view/schema/entity-types/department")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /schema/relation-types
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_relation_types_scoped(client, scoped_schema):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema):
        resp = await client.get("/api/runtime/hr_view/schema/relation-types")

    assert resp.status_code == 200
    body = resp.json()
    keys = {rt["key"] for rt in body}
    assert keys == {"works_for"}


@pytest.mark.asyncio
async def test_list_relation_types_unscoped(client, unscoped_schema):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema):
        resp = await client.get("/api/runtime/full_ontology/schema/relation-types")

    assert resp.status_code == 200
    body = resp.json()
    keys = {rt["key"] for rt in body}
    assert keys == {"works_for", "belongs_to"}


# ---------------------------------------------------------------------------
# GET /schema/relation-types/{key}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_relation_type_scoped(client, scoped_schema):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema):
        resp = await client.get("/api/runtime/hr_view/schema/relation-types/works_for")

    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "works_for"
    prop_keys = {p["key"] for p in body["properties"]}
    assert prop_keys == {"role", "since"}


@pytest.mark.asyncio
async def test_get_relation_type_not_in_scope(client, scoped_schema):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema):
        resp = await client.get("/api/runtime/hr_view/schema/relation-types/belongs_to")

    assert resp.status_code == 404
