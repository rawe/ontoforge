"""Tests for document properties: coercion, stubs, chunk sync, and the document endpoint."""

from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.config import settings
from ontoforge_server.runtime.chunking import chunk_document
from ontoforge_server.runtime.service import coerce_value
from tests.runtime.conftest import EMBEDDING, REPO, make_entity

BIO = "# Biography\n\nAda Lovelace wrote about the analytical engine. " * 30  # ~1800 chars


def _doc_schema(entity_inclusions=None):
    """Schema with a person type that has two document properties."""
    return {
        "ontology": {
            "ontologyId": "ont-1",
            "key": "docs_view",
            "name": "Docs View",
            "description": None,
        },
        "entityTypes": [
            {
                "entityTypeId": "et-1",
                "key": "person",
                "displayName": "Person",
                "description": None,
                "properties": [
                    {"key": "name", "displayName": "Name", "dataType": "string", "required": True, "defaultValue": None},
                    {"key": "bio", "displayName": "Bio", "dataType": "document", "required": False, "defaultValue": None},
                    {"key": "notes", "displayName": "Notes", "dataType": "document", "required": False, "defaultValue": None},
                ],
            },
        ],
        "relationTypes": [],
        "entityInclusions": entity_inclusions if entity_inclusions is not None else [],
        "relationInclusions": [],
    }


# ---------------------------------------------------------------------------
# Coercion + config
# ---------------------------------------------------------------------------


def test_coerce_document_returns_str():
    assert coerce_value("# Hello", "document", "bio") == "# Hello"
    assert coerce_value(42, "document", "bio") == "42"
    assert coerce_value(None, "document", "bio") is None


def test_chunk_config_defaults():
    assert settings.DOCUMENT_CHUNK_SIZE == 1500
    assert settings.DOCUMENT_CHUNK_OVERLAP == 200


# ---------------------------------------------------------------------------
# Read-model stubs
# ---------------------------------------------------------------------------


async def test_get_entity_stubs_document_with_stored_length(client):
    raw = make_entity(name="Ada", bio=BIO, _doc_bio_length=40213)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
    ):
        resp = await client.get("/api/runtime/docs_view/entities/person/ent-1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Ada"
    assert body["bio"] == {"document": True, "length": 40213}
    assert "_doc_bio_length" not in body
    # Unset document property stays absent (no stub for missing values)
    assert "notes" not in body


async def test_get_entity_stub_length_falls_back_to_value_length(client):
    raw = make_entity(name="Ada", bio=BIO)  # no stored _doc_bio_length

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
    ):
        resp = await client.get("/api/runtime/docs_view/entities/person/ent-1")

    assert resp.json()["bio"] == {"document": True, "length": len(BIO)}


async def test_list_entities_stubs_documents(client):
    raw = make_entity(name="Ada", bio=BIO, _doc_bio_length=len(BIO))

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.list_entities", new_callable=AsyncMock, return_value=([raw], 1)),
    ):
        resp = await client.get("/api/runtime/docs_view/entities/person")

    item = resp.json()["items"][0]
    assert item["bio"] == {"document": True, "length": len(BIO)}
    assert "_doc_bio_length" not in item


async def test_fields_projection_returns_raw_document_value(client):
    raw = make_entity(name="Ada", bio=BIO, _doc_bio_length=len(BIO))

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
    ):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1?fields=bio"
        )

    body = resp.json()
    assert body["bio"] == BIO  # raw value explicitly requested
    assert "_doc_bio_length" not in body


# ---------------------------------------------------------------------------
# Document read endpoint
# ---------------------------------------------------------------------------


async def test_get_document_full(client):
    raw = make_entity(name="Ada", bio=BIO)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
    ):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/bio"
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "propertyKey": "bio",
        "content": BIO,
        "offset": 0,
        "length": len(BIO),
        "totalLength": len(BIO),
    }


async def test_get_document_slice(client):
    raw = make_entity(name="Ada", bio=BIO)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
    ):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/bio"
            "?offset=100&limit=50"
        )

    body = resp.json()
    assert body["content"] == BIO[100:150]
    assert body["offset"] == 100
    assert body["length"] == 50
    assert body["totalLength"] == len(BIO)


async def test_get_document_offset_beyond_end_returns_empty(client):
    raw = make_entity(name="Ada", bio="short")

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
    ):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/bio?offset=100"
        )

    body = resp.json()
    assert body["content"] == ""
    assert body["length"] == 0
    assert body["totalLength"] == 5


async def test_get_document_unset_value_returns_empty(client):
    raw = make_entity(name="Ada")  # bio never written

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
    ):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/bio"
        )

    assert resp.status_code == 200
    assert resp.json()["content"] == ""
    assert resp.json()["totalLength"] == 0


async def test_get_document_404_for_non_document_property(client):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/name"
        )
    assert resp.status_code == 404


async def test_get_document_404_for_unknown_property(client):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/nonexistent"
        )
    assert resp.status_code == 404


async def test_get_document_404_for_out_of_scope_property(client):
    """A lens excluding bio from person must 404 the document endpoint."""
    schema = _doc_schema(entity_inclusions=[{"key": "person", "properties": ["name"]}])
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=schema):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/bio"
        )
    assert resp.status_code == 404


async def test_get_document_404_for_missing_entity(client):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.get(
            "/api/runtime/docs_view/entities/person/ent-1/documents/bio"
        )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Chunk sync on create / update
# ---------------------------------------------------------------------------


def _mock_provider(dims: int = 8) -> AsyncMock:
    provider = AsyncMock()
    provider.embed = AsyncMock(return_value=[0.1] * dims)
    return provider


async def test_create_entity_stores_length_and_writes_chunks(client):
    raw = make_entity(name="Ada", bio=BIO, _doc_bio_length=len(BIO))

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.create_entity", new_callable=AsyncMock, return_value=raw) as mock_create,
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock) as mock_del,
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock) as mock_chunks,
        patch(EMBEDDING, return_value=_mock_provider()),
    ):
        resp = await client.post(
            "/api/runtime/docs_view/entities/person",
            json={"name": "Ada", "bio": BIO},
        )

    assert resp.status_code == 201
    # Response carries the stub, never the content
    assert resp.json()["bio"] == {"document": True, "length": len(BIO)}

    # Stored properties include the raw value plus the internal length
    stored = mock_create.call_args[0][4]
    assert stored["bio"] == BIO
    assert stored["_doc_bio_length"] == len(BIO)

    # Chunks: old ones deleted, new ones created under the virtual label
    mock_del.assert_awaited_once()
    assert mock_del.call_args[0][2] == "bio"
    mock_chunks.assert_awaited_once()
    call = mock_chunks.call_args
    assert call[0][2] == "PersonDocumentBio"  # virtual label
    rows = call[0][3]
    expected = chunk_document(
        BIO, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP
    )
    assert len(rows) == len(expected)
    for index, (row, chunk) in enumerate(zip(rows, expected)):
        assert row["_entityTypeKey"] == "person"
        assert row["_propertyKey"] == "bio"
        assert row["_index"] == index
        assert row["startChar"] == chunk.start_char
        assert row["charLength"] == chunk.char_length
        assert row["text"] == chunk.text
        assert row["_embedding"] == [0.1] * 8
        assert "_id" in row and "_entityId" in row


async def test_create_entity_without_provider_writes_no_chunks(client):
    raw = make_entity(name="Ada", bio=BIO, _doc_bio_length=len(BIO))

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.create_entity", new_callable=AsyncMock, return_value=raw) as mock_create,
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock) as mock_del,
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock) as mock_chunks,
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/docs_view/entities/person",
            json={"name": "Ada", "bio": BIO},
        )

    assert resp.status_code == 201
    # Value + length still stored — the type works without embeddings
    stored = mock_create.call_args[0][4]
    assert stored["bio"] == BIO
    assert stored["_doc_bio_length"] == len(BIO)
    mock_del.assert_not_awaited()
    mock_chunks.assert_not_awaited()


async def test_create_entity_large_document_passes_vector_metadata_validation(client):
    """Document values are excluded from the 32,766-byte in-index metadata limit."""
    huge = "x" * 40000
    raw = make_entity(name="Ada", bio=huge, _doc_bio_length=len(huge))

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.create_entity", new_callable=AsyncMock, return_value=raw),
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock),
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock),
        patch(EMBEDDING, return_value=_mock_provider()),
    ):
        resp = await client.post(
            "/api/runtime/docs_view/entities/person",
            json={"name": "Ada", "bio": huge},
        )

    assert resp.status_code == 201


async def test_update_document_property_rechunks_and_updates_length(client):
    raw = make_entity(name="Ada", bio="new text", _doc_bio_length=8)

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.update_entity", new_callable=AsyncMock, return_value=raw) as mock_update,
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock) as mock_del,
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock) as mock_chunks,
        patch(EMBEDDING, return_value=_mock_provider()),
    ):
        resp = await client.patch(
            "/api/runtime/docs_view/entities/person/ent-1",
            json={"bio": "new text"},
        )

    assert resp.status_code == 200
    set_props = mock_update.call_args[0][3]
    assert set_props["bio"] == "new text"
    assert set_props["_doc_bio_length"] == 8
    # Document-only change must NOT re-embed the entity itself
    assert mock_update.call_args[1]["has_embedding_update"] is False
    mock_del.assert_awaited_once()
    mock_chunks.assert_awaited_once()


async def test_update_removing_document_property_deletes_chunks(client):
    raw = make_entity(name="Ada")

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.update_entity", new_callable=AsyncMock, return_value=raw) as mock_update,
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock) as mock_del,
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock) as mock_chunks,
        patch(EMBEDDING, return_value=_mock_provider()),
    ):
        resp = await client.patch(
            "/api/runtime/docs_view/entities/person/ent-1",
            json={"bio": None},
        )

    assert resp.status_code == 200
    remove_props = mock_update.call_args[0][4]
    assert "bio" in remove_props
    assert "_doc_bio_length" in remove_props
    mock_del.assert_awaited_once()
    mock_chunks.assert_not_awaited()


async def test_update_other_property_leaves_chunks_untouched(client):
    """Updating a non-document property must not touch any chunks."""
    raw = make_entity(name="Grace", bio=BIO, _doc_bio_length=len(BIO))

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=raw),
        patch(f"{REPO}.update_entity", new_callable=AsyncMock, return_value=raw),
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock) as mock_del,
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock) as mock_chunks,
        patch(EMBEDDING, return_value=_mock_provider()),
    ):
        resp = await client.patch(
            "/api/runtime/docs_view/entities/person/ent-1",
            json={"name": "Grace"},
        )

    assert resp.status_code == 200
    mock_del.assert_not_awaited()
    mock_chunks.assert_not_awaited()
