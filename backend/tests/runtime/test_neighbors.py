"""Tests for the runtime neighbors endpoint (GET /api/entities/{type}/{id}/neighbors)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

import ontoforge_server.runtime.service as svc


NOW = datetime(2025, 6, 1, tzinfo=timezone.utc)

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
        resp = await client.get("/api/entities/person/ent-person-1/neighbors")
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
            "/api/entities/person/ent-person-1/neighbors?direction=outgoing"
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
            "/api/entities/person/ent-person-1/neighbors?direction=incoming"
        )
    assert resp.status_code == 200


async def test_get_neighbors_with_relation_type_filter(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors?relationTypeKey=works_for filters by relation type."""
    with repo_patch():
        resp = await client.get(
            "/api/entities/person/ent-person-1/neighbors?relationTypeKey=works_for"
        )
    assert resp.status_code == 200


async def test_get_neighbors_entity_not_found(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors with unknown entity returns 404."""
    with repo_patch(get_entity=AsyncMock(return_value=None)):
        resp = await client.get("/api/entities/person/missing-id/neighbors")
    assert resp.status_code == 404


async def test_get_neighbors_type_not_found(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors with unknown entity type returns 404."""
    with repo_patch():
        resp = await client.get("/api/entities/nonexistent/ent-1/neighbors")
    assert resp.status_code == 404


async def test_get_neighbors_empty_result(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors returns empty list when no neighbors."""
    with repo_patch(get_neighbors=AsyncMock(return_value=[])):
        resp = await client.get("/api/entities/person/ent-person-1/neighbors")
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity"]["_id"] == "ent-person-1"
    assert len(data["neighbors"]) == 0


async def test_get_neighbors_invalid_direction(client, repo_patch):
    """GET /entities/{type}/{id}/neighbors?direction=invalid returns 422."""
    with repo_patch():
        resp = await client.get(
            "/api/entities/person/ent-person-1/neighbors?direction=invalid"
        )
    assert resp.status_code == 422
