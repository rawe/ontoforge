"""Tests for partial document writes: str_replace, replace_range, embedding reuse."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

from ontoforge_server.config import settings
from ontoforge_server.runtime.chunking import chunk_document
from ontoforge_server.runtime.service import sync_document_chunks
from tests.runtime.conftest import EMBEDDING, REPO, make_entity

BIO = "\n\n".join(
    f"Paragraph {i}: " + "lorem ipsum dolor sit amet. " * 10 for i in range(10)
)  # ~2900 chars, every paragraph marker unique


def _doc_schema(entity_inclusions=None):
    """Schema with a person type that has a document property."""
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
                ],
            },
        ],
        "relationTypes": [],
        "entityInclusions": entity_inclusions if entity_inclusions is not None else [],
        "relationInclusions": [],
    }


def _mock_provider(dims: int = 8) -> AsyncMock:
    provider = AsyncMock()
    provider.embed = AsyncMock(return_value=[0.1] * dims)
    return provider


def _edit_mocks(entity, updated=None):
    """Patch the full repo surface an edit touches. Returns the patch context."""
    return (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=entity),
        patch(f"{REPO}.update_entity", new_callable=AsyncMock, return_value=updated or entity),
        patch(f"{REPO}.get_chunk_embeddings_for_entity_property", new_callable=AsyncMock, return_value={}),
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock),
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock),
    )


URL = "/api/runtime/docs_view/entities/person/ent-1/documents/bio"


# ---------------------------------------------------------------------------
# str_replace
# ---------------------------------------------------------------------------


async def test_str_replace_updates_value_and_length(client):
    entity = make_entity(name="Ada", bio="Hello brave world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4], mocks[5]:
        with patch(EMBEDDING, return_value=_mock_provider()):
            resp = await client.patch(
                URL,
                json={"op": "str_replace", "oldString": "brave", "newString": "beautiful"},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["propertyKey"] == "bio"
    assert body["totalLength"] == len("Hello beautiful world")
    assert body["editedRange"] == {"offset": 6, "length": len("beautiful")}
    assert body["replacements"] == 1
    assert body["context"] == "Hello beautiful world"
    assert body["contextOffset"] == 0

    set_props = mock_update.call_args[0][3]
    assert set_props["bio"] == "Hello beautiful world"
    assert set_props["_doc_bio_length"] == len("Hello beautiful world")


async def test_str_replace_not_found_422(client):
    entity = make_entity(name="Ada", bio="Hello world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL, json={"op": "str_replace", "oldString": "missing", "newString": "x"}
        )

    assert resp.status_code == 422
    assert "not found" in resp.json()["error"]["message"]


async def test_str_replace_ambiguous_422(client):
    entity = make_entity(name="Ada", bio="one two one two")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL, json={"op": "str_replace", "oldString": "two", "newString": "three"}
        )

    assert resp.status_code == 422
    assert "2 times" in resp.json()["error"]["message"]


async def test_str_replace_replace_all(client):
    entity = make_entity(name="Ada", bio="one two one two")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={
                "op": "str_replace",
                "oldString": "two",
                "newString": "three",
                "replaceAll": True,
            },
        )

    assert resp.status_code == 200
    assert resp.json()["replacements"] == 2
    assert mock_update.call_args[0][3]["bio"] == "one three one three"


async def test_str_replace_identical_strings_422(client):
    entity = make_entity(name="Ada", bio="Hello world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL, json={"op": "str_replace", "oldString": "world", "newString": "world"}
        )

    assert resp.status_code == 422


async def test_str_replace_empty_old_string_422(client):
    entity = make_entity(name="Ada", bio="Hello world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL, json={"op": "str_replace", "oldString": "", "newString": "x"}
        )

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# replace_range
# ---------------------------------------------------------------------------


async def test_replace_range_overwrites_slice(client):
    entity = make_entity(name="Ada", bio="Hello brave world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={"op": "replace_range", "offset": 6, "length": 5, "content": "big"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["totalLength"] == len("Hello big world")
    assert body["editedRange"] == {"offset": 6, "length": 3}
    assert mock_update.call_args[0][3]["bio"] == "Hello big world"


async def test_replace_range_insert_with_zero_length(client):
    entity = make_entity(name="Ada", bio="Hello world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={"op": "replace_range", "offset": 5, "length": 0, "content": " brave"},
        )

    assert resp.status_code == 200
    assert mock_update.call_args[0][3]["bio"] == "Hello brave world"


async def test_replace_range_append_at_end(client):
    entity = make_entity(name="Ada", bio="Hello")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={"op": "replace_range", "offset": 5, "length": 0, "content": " world"},
        )

    assert resp.status_code == 200
    assert mock_update.call_args[0][3]["bio"] == "Hello world"


async def test_replace_range_on_unset_document_starts_empty(client):
    entity = make_entity(name="Ada")  # bio never written
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={"op": "replace_range", "offset": 0, "length": 0, "content": "# New doc"},
        )

    assert resp.status_code == 200
    assert mock_update.call_args[0][3]["bio"] == "# New doc"


async def test_replace_range_out_of_bounds_422(client):
    entity = make_entity(name="Ada", bio="short")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={"op": "replace_range", "offset": 3, "length": 10, "content": "x"},
        )

    assert resp.status_code == 422
    assert "exceeds" in resp.json()["error"]["message"]


async def test_replace_range_offset_beyond_end_422(client):
    entity = make_entity(name="Ada", bio="short")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={"op": "replace_range", "offset": 99, "length": 0, "content": "x"},
        )

    assert resp.status_code == 422


async def test_replace_range_expect_mismatch_409(client):
    entity = make_entity(name="Ada", bio="Hello brave world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={
                "op": "replace_range",
                "offset": 6,
                "length": 5,
                "content": "big",
                "expect": "bold",
            },
        )

    assert resp.status_code == 409


async def test_replace_range_expect_match_succeeds(client):
    entity = make_entity(name="Ada", bio="Hello brave world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4], mocks[5]:
        resp = await client.patch(
            URL,
            json={
                "op": "replace_range",
                "offset": 6,
                "length": 5,
                "content": "big",
                "expect": "brave",
            },
        )

    assert resp.status_code == 200
    assert mock_update.call_args[0][3]["bio"] == "Hello big world"


# ---------------------------------------------------------------------------
# Request/permission errors
# ---------------------------------------------------------------------------


async def test_unknown_op_422(client):
    resp = await client.patch(URL, json={"op": "delete_lines"})
    assert resp.status_code == 422


async def test_edit_404_for_non_document_property(client):
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()):
        resp = await client.patch(
            "/api/runtime/docs_view/entities/person/ent-1/documents/name",
            json={"op": "str_replace", "oldString": "a", "newString": "b"},
        )
    assert resp.status_code == 404


async def test_edit_404_for_out_of_scope_property(client):
    schema = _doc_schema(entity_inclusions=[{"key": "person", "properties": ["name"]}])
    with patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=schema):
        resp = await client.patch(
            URL, json={"op": "str_replace", "oldString": "a", "newString": "b"}
        )
    assert resp.status_code == 404


async def test_edit_404_for_missing_entity(client):
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{REPO}.get_entity", new_callable=AsyncMock, return_value=None),
    ):
        resp = await client.patch(
            URL, json={"op": "str_replace", "oldString": "a", "newString": "b"}
        )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Chunk re-sync + embedding reuse
# ---------------------------------------------------------------------------


async def test_edit_resyncs_chunks(client):
    entity = make_entity(name="Ada", bio=BIO)
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2], mocks[3], mocks[4] as mock_del, mocks[5] as mock_chunks:
        with patch(EMBEDDING, return_value=_mock_provider()):
            resp = await client.patch(
                URL,
                json={"op": "str_replace", "oldString": "Paragraph 3:", "newString": "Chapter 3 —"},
            )

    assert resp.status_code == 200
    mock_del.assert_awaited_once()
    mock_chunks.assert_awaited_once()
    rows = mock_chunks.call_args[0][3]
    new_value = BIO.replace("Paragraph 3:", "Chapter 3 —", 1)
    expected = chunk_document(
        new_value, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP
    )
    assert [r["text"] for r in rows] == [c.text for c in expected]


async def test_edit_without_provider_skips_chunk_sync(client):
    entity = make_entity(name="Ada", bio="Hello world")
    mocks = _edit_mocks(entity)

    with mocks[0], mocks[1], mocks[2] as mock_update, mocks[3], mocks[4] as mock_del, mocks[5] as mock_chunks:
        with patch(EMBEDDING, return_value=None):
            resp = await client.patch(
                URL, json={"op": "str_replace", "oldString": "world", "newString": "docs"}
            )

    assert resp.status_code == 200
    # Value + length still written; chunks untouched without a provider
    assert mock_update.call_args[0][3]["bio"] == "Hello docs"
    mock_del.assert_not_awaited()
    mock_chunks.assert_not_awaited()


async def test_sync_reuses_embeddings_for_unchanged_chunk_texts():
    """Only chunks whose text changed are re-embedded; the rest reuse stored vectors."""
    text = BIO  # long enough for multiple chunks
    chunks = chunk_document(text, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP)
    assert len(chunks) >= 2

    # Pretend every chunk except the first already has a stored embedding
    reuse_map = {c.text: [0.5] * 8 for c in chunks[1:]}
    provider = _mock_provider()

    driver = AsyncMock()
    mock_session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield mock_session

    driver.session = _session

    with (
        patch(f"{REPO}.get_chunk_embeddings_for_entity_property", new_callable=AsyncMock, return_value=reuse_map),
        patch(f"{REPO}.delete_chunks_for_entity_property", new_callable=AsyncMock),
        patch(f"{REPO}.create_document_chunks", new_callable=AsyncMock) as mock_chunks,
        patch(EMBEDDING, return_value=provider),
    ):
        await sync_document_chunks(driver, "person", "ent-1", {"bio": text})

    # Exactly one embedding call — for the one chunk not in the reuse map
    provider.embed.assert_awaited_once_with(chunks[0].text)
    rows = mock_chunks.call_args[0][3]
    assert rows[0]["_embedding"] == [0.1] * 8
    for row in rows[1:]:
        assert row["_embedding"] == [0.5] * 8
