"""Tests for the runtime neighbors endpoint (GET /api/runtime/{ontologyKey}/entities/{type}/{id}/neighbors)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

import ontoforge_server.runtime.service as svc
from tests.runtime.conftest import ONTOLOGY_KEY


NOW = datetime(2025, 6, 1, tzinfo=timezone.utc)
PREFIX = f"/api/runtime/{ONTOLOGY_KEY}"

PERSON_ENTITY = {
    "_id": "ent-person-1",
    "_entityTypeKey": "person",
    "_createdAt": NOW,
    "_updatedAt": NOW,
    "name": "Alice",
}

COMPANY_ENTITY = {
    "_id": "ent-company-1",
    "_entityTypeKey": "company",
    "_createdAt": NOW,
    "_updatedAt": NOW,
    "name": "Acme Corp",
}

NEIGHBOR_DATA = [
    {
        "relation": {
            "_id": "rel-1",
            "_relationTypeKey": "works_for",
            "_createdAt": NOW,
            "_updatedAt": NOW,
            "direction": "outgoing",
        },
        "entity": COMPANY_ENTITY,
    }
]


def _mock_repo(**overrides):
    defaults = {
        "get_entity": AsyncMock(return_value=PERSON_ENTITY),
        "get_neighbors": AsyncMock(return_value=NEIGHBOR_DATA),
    }
    defaults.update(overrides)
    return defaults


@pytest.fixture
def repo_patch():
    def _patch(**overrides):
        mocks = _mock_repo(**overrides)
        return patch.multiple(
            "ontoforge_server.runtime.service.repository", **mocks
        )
    return _patch


async def test_get_neighbors(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors returns entity + neighbors."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/person/ent-person-1/neighbors")
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity"]["_id"] == "ent-person-1"
    assert len(data["neighbors"]) == 1
    assert data["neighbors"][0]["relation"]["direction"] == "outgoing"
    assert data["neighbors"][0]["entity"]["_id"] == "ent-company-1"


async def test_get_neighbors_with_direction_filter(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors?direction=outgoing filters by direction."""
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors?direction=outgoing"
        )
    assert resp.status_code == 200
    # The direction param is passed to repository; just verify the endpoint accepts it
    data = resp.json()
    assert "entity" in data
    assert "neighbors" in data


async def test_get_neighbors_with_incoming_direction(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors?direction=incoming is accepted."""
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors?direction=incoming"
        )
    assert resp.status_code == 200


async def test_get_neighbors_with_relation_type_filter(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors?relationTypeKey=works_for filters by relation type."""
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors?relationTypeKey=works_for"
        )
    assert resp.status_code == 200


async def test_get_neighbors_entity_not_found(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors with unknown entity returns 404."""
    with repo_patch(get_entity=AsyncMock(return_value=None)):
        resp = await client.get(f"{PREFIX}/entities/person/missing-id/neighbors")
    assert resp.status_code == 404


async def test_get_neighbors_type_not_found(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors with unknown entity type returns 404."""
    with repo_patch():
        resp = await client.get(f"{PREFIX}/entities/nonexistent/ent-1/neighbors")
    assert resp.status_code == 404


async def test_get_neighbors_empty_result(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors returns empty list when no neighbors."""
    with repo_patch(get_neighbors=AsyncMock(return_value=[])):
        resp = await client.get(f"{PREFIX}/entities/person/ent-person-1/neighbors")
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity"]["_id"] == "ent-person-1"
    assert len(data["neighbors"]) == 0


async def test_get_neighbors_invalid_direction(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors?direction=invalid returns 422."""
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors?direction=invalid"
        )
    assert resp.status_code == 422


# --- Field Projection ---


async def test_get_neighbors_with_fields(client, repo_patch):
    """GET /neighbors?fields=name projects entity properties.

    Center entity gets only _id + requested fields.
    Neighbor entities get _id + _entityTypeKey + requested fields.
    """
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors?fields=name"
        )
    assert resp.status_code == 200
    data = resp.json()
    # Center entity: _id + name only (no _entityTypeKey, no _createdAt)
    center = data["entity"]
    assert center["_id"] == "ent-person-1"
    assert center["name"] == "Alice"
    assert "_entityTypeKey" not in center
    assert "_createdAt" not in center
    # Neighbor entity: _id + _entityTypeKey + name
    neighbor_entity = data["neighbors"][0]["entity"]
    assert neighbor_entity["_id"] == "ent-company-1"
    assert neighbor_entity["_entityTypeKey"] == "company"
    assert neighbor_entity["name"] == "Acme Corp"
    assert "_createdAt" not in neighbor_entity


async def test_get_neighbors_with_relation_fields(client, repo_patch):
    """GET /neighbors?relationFields=direction projects relation properties.

    Relation always includes _id, _relationTypeKey, direction.
    """
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors?relationFields="
        )
    assert resp.status_code == 200
    data = resp.json()
    relation = data["neighbors"][0]["relation"]
    # Always included
    assert relation["_id"] == "rel-1"
    assert relation["_relationTypeKey"] == "works_for"
    assert relation["direction"] == "outgoing"
    # Timestamps stripped
    assert "_createdAt" not in relation


async def test_get_neighbors_with_both_fields(client, repo_patch):
    """GET /neighbors?fields=name&relationFields= applies both projections."""
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors?fields=name&relationFields="
        )
    assert resp.status_code == 200
    data = resp.json()
    # Entity projection
    assert "_createdAt" not in data["entity"]
    assert data["entity"]["name"] == "Alice"
    # Relation projection
    relation = data["neighbors"][0]["relation"]
    assert "_createdAt" not in relation
    assert relation["_id"] == "rel-1"


async def test_get_neighbors_without_fields_returns_all(client, repo_patch):
    """GET /neighbors without fields returns full data (backward compatible)."""
    with repo_patch():
        resp = await client.get(
            f"{PREFIX}/entities/person/ent-person-1/neighbors"
        )
    assert resp.status_code == 200
    data = resp.json()
    # Full entity data
    assert "_entityTypeKey" in data["entity"]
    assert "name" in data["entity"]
    # Full relation data
    assert "_relationTypeKey" in data["neighbors"][0]["relation"]
    assert "direction" in data["neighbors"][0]["relation"]
    # Full neighbor entity data
    assert "_entityTypeKey" in data["neighbors"][0]["entity"]
    assert "name" in data["neighbors"][0]["entity"]
