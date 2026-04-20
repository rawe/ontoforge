"""Unit tests for M2 side effects in modeling service.

Focus: ``update_relation_type`` marking every existing instance of the type
as ``_embeddingState = 'stale'`` whenever ``factTemplate`` is touched
(set / changed / cleared).
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.modeling.service.repository"
PROVIDER = "ontoforge_server.modeling.service.get_embedding_provider"
CREATE_REL_INDEX = (
    "ontoforge_server.modeling.service.create_relation_vector_index"
)

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

RT_BASE = {
    "relationTypeId": "rt-1",
    "key": "works_for",
    "displayName": "Works For",
    "description": None,
    "sourceEntityTypeKey": "person",
    "targetEntityTypeKey": "company",
    "createdAt": NOW,
    "updatedAt": NOW,
}

SOURCE_ET = {
    "entityTypeId": "et-src",
    "key": "person",
    "displayName": "Person",
    "createdAt": NOW,
    "updatedAt": NOW,
}

TARGET_ET = {
    "entityTypeId": "et-tgt",
    "key": "company",
    "displayName": "Company",
    "createdAt": NOW,
    "updatedAt": NOW,
}


def _stale_calls(mock_driver) -> list:
    """Return every `session.run` call whose query marks relation instances stale."""
    # conftest.mock_driver hands out the same session every time, so all run
    # calls are on the same AsyncMock.
    session = mock_driver.session.__wrapped__ if hasattr(mock_driver.session, "__wrapped__") else None
    # Simpler: we captured the session via the factory; pick it off the fixture below.
    return []


@pytest.mark.asyncio
async def test_update_relation_type_sets_fact_template_marks_instances_stale(
    client, mock_driver
):
    """Adding a factTemplate to a non-semantic type flips its instances to stale."""
    updated = {
        **RT_BASE,
        "factTemplate": "{{ source.displayName }} works for {{ target.displayName }}",
    }
    with (
        patch(
            f"{REPO}.get_relation_type",
            new_callable=AsyncMock,
            return_value={
                **RT_BASE,
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "company",
            },
        ),
        patch(
            f"{REPO}.get_entity_type_by_key",
            new_callable=AsyncMock,
            side_effect=[SOURCE_ET, TARGET_ET],
        ),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.update_relation_type", new_callable=AsyncMock, return_value=updated),
        patch(PROVIDER, return_value=None),
        patch(CREATE_REL_INDEX, new_callable=AsyncMock),
    ):
        resp = await client.put(
            "/api/model/relation-types/rt-1",
            json={
                "factTemplate": "{{ source.displayName }} works for {{ target.displayName }}",
            },
        )

    assert resp.status_code == 200
    # The mock_driver fixture hands out the same session; assert the stale
    # pass fired against it.
    # Find the mock_session by re-invoking session().
    async with mock_driver.session() as s:
        queries = [
            c.args[0] for c in s.run.await_args_list if c.args
        ]
    stale_queries = [
        q for q in queries
        if "SET r._embeddingState = 'stale'" in q
        and "r._relationTypeKey = $key" in q
    ]
    assert len(stale_queries) == 1, queries


@pytest.mark.asyncio
async def test_update_relation_type_changes_fact_template_marks_instances_stale(
    client, mock_driver
):
    """Changing the factTemplate still triggers the stale pass."""
    updated = {
        **RT_BASE,
        "factTemplate": "new template {{ source.displayName }}",
    }
    with (
        patch(
            f"{REPO}.get_relation_type",
            new_callable=AsyncMock,
            return_value={
                **RT_BASE,
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "company",
                "factTemplate": "old template {{ source.displayName }}",
            },
        ),
        patch(
            f"{REPO}.get_entity_type_by_key",
            new_callable=AsyncMock,
            side_effect=[SOURCE_ET, TARGET_ET],
        ),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.update_relation_type", new_callable=AsyncMock, return_value=updated),
        patch(PROVIDER, return_value=None),
        patch(CREATE_REL_INDEX, new_callable=AsyncMock),
    ):
        resp = await client.put(
            "/api/model/relation-types/rt-1",
            json={"factTemplate": "new template {{ source.displayName }}"},
        )

    assert resp.status_code == 200
    async with mock_driver.session() as s:
        queries = [c.args[0] for c in s.run.await_args_list if c.args]
    assert any(
        "SET r._embeddingState = 'stale'" in q and "r._relationTypeKey = $key" in q
        for q in queries
    )


@pytest.mark.asyncio
async def test_update_relation_type_clears_fact_template_marks_instances_stale(
    client, mock_driver
):
    """Clearing the factTemplate (to null) still runs the stale pass.

    The reconcile worker then picks each instance up and zeros out `_fact` /
    `_embedding` since the template no longer exists.
    """
    updated = {**RT_BASE, "factTemplate": None}
    with (
        patch(f"{REPO}.update_relation_type", new_callable=AsyncMock, return_value=updated),
        patch(PROVIDER, return_value=None),
        patch(CREATE_REL_INDEX, new_callable=AsyncMock),
    ):
        resp = await client.put(
            "/api/model/relation-types/rt-1",
            json={"factTemplate": None},
        )

    assert resp.status_code == 200
    async with mock_driver.session() as s:
        queries = [c.args[0] for c in s.run.await_args_list if c.args]
    assert any(
        "SET r._embeddingState = 'stale'" in q and "r._relationTypeKey = $key" in q
        for q in queries
    )


@pytest.mark.asyncio
async def test_update_relation_type_unrelated_patch_does_not_touch_instances(
    client, mock_driver
):
    """Patching only displayName (no fact_template_provided) skips stale pass."""
    updated = {**RT_BASE, "displayName": "New Display"}
    with (
        patch(f"{REPO}.update_relation_type", new_callable=AsyncMock, return_value=updated),
        patch(PROVIDER, return_value=None),
    ):
        resp = await client.put(
            "/api/model/relation-types/rt-1",
            json={"displayName": "New Display"},
        )

    assert resp.status_code == 200
    async with mock_driver.session() as s:
        queries = [c.args[0] for c in s.run.await_args_list if c.args]
    stale_queries = [
        q for q in queries
        if "SET r._embeddingState = 'stale'" in q
        and "r._relationTypeKey = $key" in q
    ]
    assert stale_queries == []
