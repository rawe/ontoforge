"""Tests for runtime relation CRUD with scoped schema behavior."""

from unittest.mock import AsyncMock, patch

import pytest

from tests.runtime.conftest import EMBEDDING, REPO, make_entity, make_relation


# ---------------------------------------------------------------------------
# Create relation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_relation(client, scoped_schema):
    """Create a relation through a scoped ontology. Response is property-filtered."""
    source = make_entity(entity_type_key="person", entity_id="ent-1", name="Alice")
    target = make_entity(entity_type_key="company", entity_id="ent-2", name="Acme")
    raw_relation = make_relation(role="Engineer", since="2024-01-15")

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_entity_by_id", new_callable=AsyncMock, side_effect=[source, target]),
        patch(f"{REPO}.create_relation", new_callable=AsyncMock, return_value=raw_relation),
    ):
        resp = await client.post(
            "/api/runtime/hr_view/relations/works_for",
            json={"fromEntityId": "ent-1", "toEntityId": "ent-2", "role": "Engineer"},
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["_id"] == "rel-1"
    assert body["fromEntityId"] == "ent-1"
    assert body["toEntityId"] == "ent-2"
    # works_for has properties=None in inclusions, so all props visible
    assert body["role"] == "Engineer"


@pytest.mark.asyncio
async def test_create_relation_type_not_in_scope(client, scoped_schema):
    """Creating a relation whose type is not in the scoped schema returns 404."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
    ):
        resp = await client.post(
            "/api/runtime/hr_view/relations/belongs_to",
            json={"fromEntityId": "ent-1", "toEntityId": "ent-2"},
        )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Get relation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_relation_scoped(client, scoped_schema):
    """GET relation through scoped ontology returns only scoped properties."""
    raw_relation = make_relation(role="Engineer", since="2024-01-15")

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_relation", new_callable=AsyncMock, return_value=raw_relation),
    ):
        resp = await client.get("/api/runtime/hr_view/relations/works_for/rel-1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["_id"] == "rel-1"
    assert body["role"] == "Engineer"
    assert body["fromEntityId"] == "ent-1"
    assert body["toEntityId"] == "ent-2"


@pytest.mark.asyncio
async def test_get_relation_with_property_filtered_scope(client):
    """When a relation inclusion filters to specific properties, only those appear."""
    from tests.runtime.conftest import _make_full_schema

    schema = _make_full_schema(
        ontology_key="restricted_view",
        entity_inclusions=[
            {"key": "person", "properties": None},
            {"key": "company", "properties": None},
        ],
        relation_inclusions=[
            {"key": "works_for", "properties": ["role"]},  # only 'role' visible, 'since' hidden
        ],
    )
    raw_relation = make_relation(role="Engineer", since="2024-01-15")

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=schema),
        patch(f"{REPO}.get_relation", new_callable=AsyncMock, return_value=raw_relation),
    ):
        resp = await client.get("/api/runtime/restricted_view/relations/works_for/rel-1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "Engineer"
    assert "since" not in body


@pytest.mark.asyncio
async def test_get_relation_not_found(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_relation", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.get("/api/runtime/hr_view/relations/works_for/no-such-id")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# List relations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_relations_scoped(client, scoped_schema):
    raw_relations = [
        make_relation(relation_id="rel-1", role="Engineer"),
        make_relation(relation_id="rel-2", role="Manager"),
    ]

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.list_relations", new_callable=AsyncMock, return_value=(raw_relations, 2)),
    ):
        resp = await client.get("/api/runtime/hr_view/relations/works_for")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2


@pytest.mark.asyncio
async def test_list_relations_type_not_in_scope(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
    ):
        resp = await client.get("/api/runtime/hr_view/relations/belongs_to")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update relation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_relation_scoped(client, scoped_schema):
    updated = make_relation(role="Senior Engineer", since="2024-01-15")

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.update_relation", new_callable=AsyncMock, return_value=updated),
    ):
        resp = await client.patch(
            "/api/runtime/hr_view/relations/works_for/rel-1",
            json={"role": "Senior Engineer"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "Senior Engineer"


@pytest.mark.asyncio
async def test_update_relation_type_not_in_scope(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
    ):
        resp = await client.patch(
            "/api/runtime/hr_view/relations/belongs_to/rel-1",
            json={"name": "X"},
        )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete relation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_relation(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.delete_relation", new_callable=AsyncMock, return_value=True),
    ):
        resp = await client.delete("/api/runtime/hr_view/relations/works_for/rel-1")

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_relation_type_not_in_scope(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
    ):
        resp = await client.delete("/api/runtime/hr_view/relations/belongs_to/rel-1")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_relation_not_found(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.delete_relation", new_callable=AsyncMock, return_value=False),
    ):
        resp = await client.delete("/api/runtime/hr_view/relations/works_for/no-such-id")

    assert resp.status_code == 404
