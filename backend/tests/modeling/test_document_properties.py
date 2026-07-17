"""Tests for modeling-side document property lifecycle (indexes + chunk cascade)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

SERVICE = "ontoforge_server.modeling.service"
REPO = f"{SERVICE}.repository"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

ET_DATA = {
    "entityTypeId": "et-1",
    "key": "person",
    "displayName": "Person",
    "description": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}

DOC_PROP_DATA = {
    "propertyId": "prop-1",
    "key": "bio",
    "displayName": "Bio",
    "description": None,
    "dataType": "document",
    "required": False,
    "defaultValue": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}


def _provider(dims: int = 8) -> MagicMock:
    provider = MagicMock()
    provider.dimensions = dims
    return provider


@pytest.mark.asyncio
async def test_create_document_property_accepts_type_and_creates_chunk_index(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_property", new_callable=AsyncMock, return_value=DOC_PROP_DATA),
        patch(f"{SERVICE}.get_embedding_provider", return_value=_provider()),
        patch(f"{SERVICE}.rebuild_vector_index", new_callable=AsyncMock),
        patch(f"{SERVICE}.create_document_vector_index", new_callable=AsyncMock) as mock_idx,
    ):
        resp = await client.post(
            "/api/model/entity-types/et-1/properties",
            json={"key": "bio", "displayName": "Bio", "dataType": "document"},
        )

    assert resp.status_code == 201
    assert resp.json()["dataType"] == "document"
    mock_idx.assert_awaited_once()
    args = mock_idx.call_args[0]
    assert args[1] == "person"  # entity type key
    assert args[2] == "bio"  # property key
    assert args[3] == 8  # provider dimensions


@pytest.mark.asyncio
async def test_create_document_property_without_provider_creates_no_chunk_index(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_property", new_callable=AsyncMock, return_value=DOC_PROP_DATA),
        patch(f"{SERVICE}.get_embedding_provider", return_value=None),
        patch(f"{SERVICE}.create_document_vector_index", new_callable=AsyncMock) as mock_idx,
    ):
        resp = await client.post(
            "/api/model/entity-types/et-1/properties",
            json={"key": "bio", "displayName": "Bio", "dataType": "document"},
        )

    assert resp.status_code == 201
    mock_idx.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_document_property_drops_chunks_and_index(client):
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=DOC_PROP_DATA),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.delete_property", new_callable=AsyncMock, return_value=True),
        patch(f"{SERVICE}.get_embedding_provider", return_value=None),
        patch(f"{SERVICE}.runtime_repository") as mock_runtime_repo,
        patch(f"{SERVICE}.drop_document_vector_index", new_callable=AsyncMock) as mock_drop,
    ):
        mock_runtime_repo.delete_chunks_for_virtual_type = AsyncMock()
        resp = await client.delete("/api/model/entity-types/et-1/properties/prop-1")

    assert resp.status_code == 204
    mock_runtime_repo.delete_chunks_for_virtual_type.assert_awaited_once()
    chunk_args = mock_runtime_repo.delete_chunks_for_virtual_type.call_args[0]
    assert chunk_args[1] == "person"
    assert chunk_args[2] == "bio"
    mock_drop.assert_awaited_once()
    assert mock_drop.call_args[0][1] == "person"
    assert mock_drop.call_args[0][2] == "bio"


@pytest.mark.asyncio
async def test_delete_string_property_leaves_chunks_alone(client):
    string_prop = {**DOC_PROP_DATA, "key": "name", "dataType": "string"}
    with (
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.get_property", new_callable=AsyncMock, return_value=string_prop),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.delete_property", new_callable=AsyncMock, return_value=True),
        patch(f"{SERVICE}.get_embedding_provider", return_value=None),
        patch(f"{SERVICE}.runtime_repository") as mock_runtime_repo,
        patch(f"{SERVICE}.drop_document_vector_index", new_callable=AsyncMock) as mock_drop,
    ):
        mock_runtime_repo.delete_chunks_for_virtual_type = AsyncMock()
        resp = await client.delete("/api/model/entity-types/et-1/properties/prop-1")

    assert resp.status_code == 204
    mock_runtime_repo.delete_chunks_for_virtual_type.assert_not_awaited()
    mock_drop.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_entity_type_cascades_document_artifacts(client):
    doc_props = [
        {**DOC_PROP_DATA},
        {**DOC_PROP_DATA, "propertyId": "prop-2", "key": "name", "dataType": "string"},
    ]
    with (
        patch(f"{REPO}.is_entity_type_referenced", new_callable=AsyncMock, return_value=False),
        patch(f"{REPO}.find_ontologies_including_type", new_callable=AsyncMock, return_value=[]),
        patch(f"{REPO}.get_entity_type", new_callable=AsyncMock, return_value=ET_DATA),
        patch(f"{REPO}.list_properties", new_callable=AsyncMock, return_value=doc_props),
        patch(f"{REPO}.delete_entity_type", new_callable=AsyncMock, return_value=True),
        patch(f"{SERVICE}.get_embedding_provider", return_value=None),
        patch(f"{SERVICE}.runtime_repository") as mock_runtime_repo,
        patch(f"{SERVICE}.drop_document_vector_index", new_callable=AsyncMock) as mock_drop,
    ):
        mock_runtime_repo.delete_chunks_for_virtual_type = AsyncMock()
        resp = await client.delete("/api/model/entity-types/et-1")

    assert resp.status_code == 204
    # Only the document property cascades chunk/index cleanup
    mock_runtime_repo.delete_chunks_for_virtual_type.assert_awaited_once()
    assert mock_runtime_repo.delete_chunks_for_virtual_type.call_args[0][2] == "bio"
    mock_drop.assert_awaited_once()
