"""Tests for runtime neighbor traversal with scope filtering."""

from unittest.mock import AsyncMock, patch

import pytest

from tests.runtime.conftest import REPO, NOW, make_entity


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_neighbor(
    *,
    relation_type_key: str,
    direction: str,
    neighbor_entity_type_key: str,
    neighbor_id: str,
    relation_props: dict | None = None,
    entity_props: dict | None = None,
) -> dict:
    """Build a raw neighbor dict as returned by repository.get_neighbors."""
    rel = {
        "_id": f"rel-{neighbor_id}",
        "_relationTypeKey": relation_type_key,
        "_createdAt": NOW,
        "_updatedAt": NOW,
        "direction": direction,
    }
    if relation_props:
        rel.update(relation_props)

    ent = {
        "_id": neighbor_id,
        "_entityTypeKey": neighbor_entity_type_key,
        "_createdAt": NOW,
        "_updatedAt": NOW,
    }
    if entity_props:
        ent.update(entity_props)

    return {"relation": rel, "entity": ent}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_neighbors_filtered_by_scoped_relation_types(client, scoped_schema):
    """Neighbors connected via out-of-scope relation types are excluded."""
    center = make_entity(entity_type_key="person", entity_id="ent-1", name="Alice", email="a@b.com")

    # Repository returns neighbors for both works_for and belongs_to
    raw_neighbors = [
        _make_neighbor(
            relation_type_key="works_for",
            direction="outgoing",
            neighbor_entity_type_key="company",
            neighbor_id="ent-2",
            relation_props={"role": "Engineer", "since": "2024-01-15"},
            entity_props={"name": "Acme"},
        ),
        _make_neighbor(
            relation_type_key="belongs_to",  # NOT in scoped schema
            direction="outgoing",
            neighbor_entity_type_key="company",
            neighbor_id="ent-3",
            entity_props={"name": "OtherCorp"},
        ),
    ]

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=center),
        patch(f"{REPO}.get_neighbors", new_callable=AsyncMock, return_value=raw_neighbors),
    ):
        resp = await client.get("/api/runtime/hr_view/entities/person/ent-1/neighbors")

    assert resp.status_code == 200
    body = resp.json()

    # Only the works_for neighbor should remain
    assert len(body["neighbors"]) == 1
    assert body["neighbors"][0]["relation"]["_relationTypeKey"] == "works_for"


@pytest.mark.asyncio
async def test_neighbor_entity_properties_filtered_to_scope(client, scoped_schema):
    """Neighbor entity properties are filtered according to scoped schema."""
    center = make_entity(entity_type_key="person", entity_id="ent-1", name="Alice", email="a@b.com", age=30)

    raw_neighbors = [
        _make_neighbor(
            relation_type_key="works_for",
            direction="outgoing",
            neighbor_entity_type_key="company",
            neighbor_id="ent-2",
            relation_props={"role": "Engineer"},
            entity_props={"name": "Acme"},
        ),
    ]

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=center),
        patch(f"{REPO}.get_neighbors", new_callable=AsyncMock, return_value=raw_neighbors),
    ):
        resp = await client.get("/api/runtime/hr_view/entities/person/ent-1/neighbors")

    assert resp.status_code == 200
    body = resp.json()

    # Center entity: only scoped properties (name, email — not age)
    assert body["entity"]["name"] == "Alice"
    assert body["entity"]["email"] == "a@b.com"
    assert "age" not in body["entity"]

    # Neighbor entity (company: all props visible via properties=None)
    neighbor_entity = body["neighbors"][0]["entity"]
    assert neighbor_entity["name"] == "Acme"


@pytest.mark.asyncio
async def test_neighbor_relation_properties_filtered(client):
    """Relation properties on neighbor edges are filtered to scoped properties."""
    from tests.runtime.conftest import _make_full_schema

    schema = _make_full_schema(
        ontology_key="restricted_view",
        entity_inclusions=[
            {"key": "person", "properties": None},
            {"key": "company", "properties": None},
        ],
        relation_inclusions=[
            {"key": "works_for", "properties": ["role"]},  # 'since' hidden
        ],
    )
    center = make_entity(entity_type_key="person", entity_id="ent-1", name="Alice")

    raw_neighbors = [
        _make_neighbor(
            relation_type_key="works_for",
            direction="outgoing",
            neighbor_entity_type_key="company",
            neighbor_id="ent-2",
            relation_props={"role": "Engineer", "since": "2024-01-15"},
            entity_props={"name": "Acme"},
        ),
    ]

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=center),
        patch(f"{REPO}.get_neighbors", new_callable=AsyncMock, return_value=raw_neighbors),
    ):
        resp = await client.get("/api/runtime/restricted_view/entities/person/ent-1/neighbors")

    assert resp.status_code == 200
    body = resp.json()
    rel = body["neighbors"][0]["relation"]
    assert rel["role"] == "Engineer"
    assert "since" not in rel


@pytest.mark.asyncio
async def test_neighbors_entity_type_not_in_scope(client, scoped_schema):
    """Requesting neighbors for an entity type not in scope returns 404."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
    ):
        resp = await client.get("/api/runtime/hr_view/entities/department/ent-1/neighbors")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_neighbors_entity_not_found(client, scoped_schema):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.get("/api/runtime/hr_view/entities/person/no-such-id/neighbors")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_neighbors_unscoped_returns_all(client, unscoped_schema):
    """Unscoped ontology returns neighbors for all relation types."""
    center = make_entity(
        entity_type_key="person", entity_id="ent-1", name="Alice", age=30, email="a@b.com"
    )

    raw_neighbors = [
        _make_neighbor(
            relation_type_key="works_for",
            direction="outgoing",
            neighbor_entity_type_key="company",
            neighbor_id="ent-2",
            relation_props={"role": "Engineer"},
            entity_props={"name": "Acme"},
        ),
        _make_neighbor(
            relation_type_key="belongs_to",
            direction="outgoing",
            neighbor_entity_type_key="company",
            neighbor_id="ent-3",
            entity_props={"name": "ParentCo"},
        ),
    ]

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=center),
        patch(f"{REPO}.get_neighbors", new_callable=AsyncMock, return_value=raw_neighbors),
    ):
        resp = await client.get("/api/runtime/full_ontology/entities/person/ent-1/neighbors")

    assert resp.status_code == 200
    body = resp.json()

    # Both neighbors visible in unscoped ontology
    assert len(body["neighbors"]) == 2
    rel_types = {n["relation"]["_relationTypeKey"] for n in body["neighbors"]}
    assert rel_types == {"works_for", "belongs_to"}

    # Center entity has all properties
    assert body["entity"]["age"] == 30
