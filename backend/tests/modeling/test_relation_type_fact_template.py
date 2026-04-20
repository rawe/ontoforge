"""Tests for the factTemplate field on relation types (create / update / I/O)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

REPO = "ontoforge_server.modeling.service.repository"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

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

RT_DATA = {
    "relationTypeId": "rt-1",
    "key": "works_for",
    "displayName": "Works For",
    "description": None,
    "sourceEntityTypeKey": "person",
    "targetEntityTypeKey": "company",
    "factTemplate": "{{ source.displayName }} works for {{ target.displayName }}",
    "createdAt": NOW,
    "updatedAt": NOW,
}


@pytest.mark.asyncio
async def test_create_relation_type_with_fact_template(client):
    with (
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(
            f"{REPO}.get_entity_type_by_key",
            new_callable=AsyncMock,
            side_effect=[SOURCE_ET, TARGET_ET, SOURCE_ET, TARGET_ET],
        ),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.create_relation_type", new_callable=AsyncMock, return_value=RT_DATA),
    ):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": "works_for",
                "displayName": "Works For",
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "company",
                "factTemplate": "{{ source.displayName }} works for {{ target.displayName }}",
            },
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["factTemplate"] == "{{ source.displayName }} works for {{ target.displayName }}"


@pytest.mark.asyncio
async def test_create_relation_type_invalid_fact_template(client):
    with (
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(
            f"{REPO}.get_entity_type_by_key",
            new_callable=AsyncMock,
            side_effect=[SOURCE_ET, TARGET_ET, SOURCE_ET, TARGET_ET],
        ),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=[]),
    ):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": "works_for",
                "displayName": "Works For",
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "company",
                # 'for' tag is disallowed
                "factTemplate": "{% for x in source %}{{ x }}{% endfor %}",
            },
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "factTemplate" in resp.json()["error"]["message"] or "tag" in resp.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_update_relation_type_with_fact_template(client):
    updated = {**RT_DATA, "factTemplate": "{{ source.displayName }} @ {{ target.displayName }}"}
    with (
        patch(
            f"{REPO}.get_relation_type",
            new_callable=AsyncMock,
            return_value={
                **RT_DATA,
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
    ):
        resp = await client.put(
            "/api/model/relation-types/rt-1",
            json={"factTemplate": "{{ source.displayName }} @ {{ target.displayName }}"},
        )
    assert resp.status_code == 200
    assert resp.json()["factTemplate"] == "{{ source.displayName }} @ {{ target.displayName }}"


@pytest.mark.asyncio
async def test_export_import_preserves_fact_template():
    """Round-trip: factTemplate survives ExportRelationType serialize/deserialize."""
    from ontoforge_server.core.schemas import ExportRelationType

    original = ExportRelationType(
        key="works_for",
        displayName="Works For",
        description=None,
        fromEntityTypeKey="person",
        toEntityTypeKey="company",
        factTemplate="{{ source.displayName }} works for {{ target.displayName }}",
        properties=[],
    )
    dumped = original.model_dump(by_alias=True)
    assert dumped["factTemplate"] == "{{ source.displayName }} works for {{ target.displayName }}"
    roundtrip = ExportRelationType.model_validate(dumped)
    assert roundtrip.fact_template == original.fact_template
