"""Tests for the runtime data wipe endpoint (DELETE /api/runtime/{ontologyKey}/data)."""

from unittest.mock import AsyncMock, patch

import pytest

import ontoforge_server.runtime.service as svc
from tests.runtime.conftest import ONTOLOGY_KEY


PREFIX = f"/api/runtime/{ONTOLOGY_KEY}"


def _mock_repo(**overrides):
    defaults = {
        "wipe_instance_data": AsyncMock(return_value=(5, 3)),
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


async def test_wipe_data_returns_counts(client, repo_patch):
    """DELETE /data returns counts of deleted entities and relations."""
    with repo_patch():
        resp = await client.delete(f"{PREFIX}/data")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ontologyKey"] == ONTOLOGY_KEY
    assert data["entitiesDeleted"] == 5
    assert data["relationsDeleted"] == 3


async def test_wipe_data_passes_entity_type_keys(client, repo_patch):
    """DELETE /data passes the correct entity type keys to the repository."""
    captured_keys = []

    async def capture_wipe(session, entity_type_keys):
        captured_keys.extend(entity_type_keys)
        return (0, 0)

    with repo_patch(wipe_instance_data=AsyncMock(side_effect=capture_wipe)):
        resp = await client.delete(f"{PREFIX}/data")

    assert resp.status_code == 200
    assert set(captured_keys) == {"person", "company"}


async def test_wipe_data_empty_db(client, repo_patch):
    """DELETE /data with no instance data returns zero counts."""
    with repo_patch(wipe_instance_data=AsyncMock(return_value=(0, 0))):
        resp = await client.delete(f"{PREFIX}/data")

    assert resp.status_code == 200
    data = resp.json()
    assert data["entitiesDeleted"] == 0
    assert data["relationsDeleted"] == 0


async def test_wipe_data_unknown_ontology(client):
    """DELETE /data for an unknown ontology returns 404."""
    resp = await client.delete("/api/runtime/nonexistent_ontology/data")
    assert resp.status_code == 404
