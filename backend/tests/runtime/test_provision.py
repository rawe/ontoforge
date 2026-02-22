"""Tests for the runtime provision endpoint (POST /api/provision)."""

from unittest.mock import AsyncMock, patch

import pytest

import ontoforge_server.runtime.service as svc


def _mock_repo(**overrides):
    defaults = {
        "wipe_database": AsyncMock(),
        "drop_all_constraints": AsyncMock(),
        "create_schema_constraints": AsyncMock(),
        "create_ontology": AsyncMock(return_value={}),
        "create_entity_type": AsyncMock(return_value={}),
        "create_relation_type": AsyncMock(return_value={}),
        "create_property": AsyncMock(return_value={}),
        "create_instance_constraints": AsyncMock(),
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


async def test_provision_valid_payload(client, repo_patch, test_ontology_payload):
    """Provision with a valid ontology payload returns 200 and a summary."""
    svc._schema_cache = None  # start clean

    with repo_patch():
        resp = await client.post("/api/provision", json=test_ontology_payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ontologyId"] == "test-ontology-001"
    assert data["name"] == "Test Ontology"
    assert data["entityTypeCount"] == 2
    assert data["relationTypeCount"] == 1

    # Schema cache should be populated after provision
    assert svc._schema_cache is not None
    assert svc._schema_cache.ontology_name == "Test Ontology"


async def test_provision_reserved_label_collision(client, repo_patch, test_ontology_payload):
    """Provision rejects entity types whose PascalCase label collides with reserved labels."""
    # "entity_type" -> "EntityType" which is reserved
    test_ontology_payload["entityTypes"].append({
        "key": "entity_type",
        "displayName": "Entity Type (Bad)",
        "description": None,
        "properties": [],
    })

    with repo_patch():
        resp = await client.post("/api/provision", json=test_ontology_payload)

    assert resp.status_code == 422
    data = resp.json()
    assert "reserved" in data["error"]["message"].lower() or "collide" in data["error"]["message"].lower()


async def test_provision_replaces_previous_data(client, repo_patch, test_ontology_payload):
    """Provisioning is idempotent: it wipes and re-creates all data."""
    mocks = _mock_repo()
    with patch.multiple("ontoforge_server.runtime.service.repository", **mocks):
        # First provision
        resp1 = await client.post("/api/provision", json=test_ontology_payload)
        assert resp1.status_code == 200

        # Second provision
        resp2 = await client.post("/api/provision", json=test_ontology_payload)
        assert resp2.status_code == 200

    # wipe_database should have been called twice
    assert mocks["wipe_database"].call_count == 2
    assert mocks["drop_all_constraints"].call_count == 2


async def test_provision_calls_repository_steps_in_order(client, repo_patch, test_ontology_payload):
    """Provision executes wipe, drop constraints, create constraints, import, instance constraints."""
    call_order = []

    async def track_wipe(*a, **kw):
        call_order.append("wipe")

    async def track_drop(*a, **kw):
        call_order.append("drop")

    async def track_schema_constraints(*a, **kw):
        call_order.append("schema_constraints")

    async def track_create_ontology(*a, **kw):
        call_order.append("create_ontology")
        return {}

    async def track_instance_constraints(*a, **kw):
        call_order.append("instance_constraints")

    with repo_patch(
        wipe_database=AsyncMock(side_effect=track_wipe),
        drop_all_constraints=AsyncMock(side_effect=track_drop),
        create_schema_constraints=AsyncMock(side_effect=track_schema_constraints),
        create_ontology=AsyncMock(side_effect=track_create_ontology),
        create_instance_constraints=AsyncMock(side_effect=track_instance_constraints),
    ):
        resp = await client.post("/api/provision", json=test_ontology_payload)

    assert resp.status_code == 200
    assert call_order == [
        "wipe",
        "drop",
        "schema_constraints",
        "create_ontology",
        "instance_constraints",
    ]
