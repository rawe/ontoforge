"""Tests for document-aware semantic search (searchIn, RRF fusion, matchedVia)."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.core.exceptions import ValidationError
from ontoforge_server.runtime.service import (
    EntityTypeDef,
    LoadedSchema,
    PropertyDef,
    SchemaCache,
    semantic_search,
)

SERVICE = "ontoforge_server.runtime.service"


def _prop(key: str, data_type: str = "string", required: bool = False) -> PropertyDef:
    return PropertyDef(
        key=key, display_name=key.title(), description=None,
        data_type=data_type, required=required, default_value=None,
    )


def _make_cache(
    person_props: dict[str, PropertyDef] | None = None,
    include_company: bool = False,
) -> SchemaCache:
    cache = SchemaCache(
        ontology_id="ont-1",
        ontology_key="test",
        ontology_name="Test",
        ontology_description=None,
    )
    cache.entity_types["person"] = EntityTypeDef(
        key="person", display_name="Person", description=None,
        properties=person_props if person_props is not None else {
            "name": _prop("name", required=True),
            "age": _prop("age", "integer"),
            "bio": _prop("bio", "document"),
            "notes": _prop("notes", "document"),
        },
    )
    if include_company:
        cache.entity_types["company"] = EntityTypeDef(
            key="company", display_name="Company", description=None,
            properties={
                "name": _prop("name", required=True),
                "profile": _prop("profile", "document"),
            },
        )
    return cache


def _make_loaded(**kwargs) -> LoadedSchema:
    cache = _make_cache(**kwargs)
    return LoadedSchema(scoped=cache, full=cache)


def _chunk_hit(
    entity_id: str,
    score: float,
    property_key: str = "bio",
    start: int = 0,
    length: int = 500,
    text: str = "chunk text " * 40,  # > 200 chars
    index: int = 0,
) -> dict:
    return {
        "chunk": {
            "_id": f"chunk-{entity_id}-{property_key}-{index}",
            "_entityId": entity_id,
            "_entityTypeKey": "person",
            "_propertyKey": property_key,
            "_index": index,
            "startChar": start,
            "charLength": length,
            "text": text,
        },
        "score": score,
    }


def _person(entity_id: str, name: str, **props) -> dict:
    return {
        "_id": entity_id,
        "_entityTypeKey": "person",
        "name": name,
        **props,
    }


@pytest.fixture
def mock_driver():
    driver = AsyncMock()
    session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield session

    driver.session = _session
    return driver


@pytest.fixture
def mock_provider():
    provider = AsyncMock()
    provider.embed = AsyncMock(return_value=[0.1] * 8)
    return provider


def _patched(loaded, provider):
    return (
        patch(f"{SERVICE}._load_schema", return_value=loaded),
        patch(f"{SERVICE}.get_embedding_provider", return_value=provider),
        patch(f"{SERVICE}.repository"),
    )


# ---------------------------------------------------------------------------
# searchIn validation
# ---------------------------------------------------------------------------


async def test_invalid_search_in_raises(mock_driver, mock_provider):
    p1, p2, p3 = _patched(_make_loaded(), mock_provider)
    with p1, p2, p3:
        with pytest.raises(ValidationError, match="searchIn"):
            await semantic_search(
                "test", "q", None, 10, None, mock_driver, search_in="bogus"
            )


# ---------------------------------------------------------------------------
# searchIn=documents
# ---------------------------------------------------------------------------


async def test_documents_mode_ranks_dedupes_and_shapes_matched_via(mock_driver, mock_provider):
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        # bio index: two chunks of e1 (best 0.9), one of e2; notes index: empty
        def _search_chunks(session, label, index_name, embedding, limit):
            if index_name == "person_document_bio_embedding":
                return [
                    _chunk_hit("e1", 0.9, start=1500, length=1400, index=1),
                    _chunk_hit("e2", 0.8),
                    _chunk_hit("e1", 0.7, index=0),
                ]
            return []

        mock_repo.search_document_chunks = AsyncMock(side_effect=_search_chunks)
        mock_repo.get_entities_by_ids = AsyncMock(return_value={
            "e1": _person("e1", "Ada", bio="x" * 4000, _doc_bio_length=4000),
            "e2": _person("e2", "Grace", bio="y" * 3000),
        })
        result = await semantic_search(
            "test", "analytical engines", None, 10, None, mock_driver,
            search_in="documents",
        )

    assert result["total"] == 2
    first, second = result["results"]

    # Best chunk per entity wins; ranking by raw chunk score
    assert first["entity"]["_id"] == "e1"
    assert first["score"] == 0.9
    assert second["entity"]["_id"] == "e2"
    assert second["score"] == 0.8

    # matchedVia shape (no chunkIndex in the API)
    mv = first["matchedVia"]
    assert mv["source"] == "document"
    assert mv["propertyKey"] == "bio"
    assert mv["charOffset"] == 1500
    assert mv["charLength"] == 1400
    assert mv["similarity"] == 0.9
    assert len(mv["snippet"]) <= 200
    assert "chunkIndex" not in mv
    assert "_index" not in mv

    # Entity payloads carry document stubs, never content
    assert first["entity"]["bio"] == {"document": True, "length": 4000}
    assert "_doc_bio_length" not in first["entity"]


async def test_documents_mode_snippets_false_omits_snippet(mock_driver, mock_provider):
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.search_document_chunks = AsyncMock(
            side_effect=lambda *a, **k: [_chunk_hit("e1", 0.9)]
            if a[2] == "person_document_bio_embedding" else []
        )
        mock_repo.get_entities_by_ids = AsyncMock(
            return_value={"e1": _person("e1", "Ada")}
        )
        result = await semantic_search(
            "test", "q", None, 10, None, mock_driver,
            search_in="documents", snippets=False,
        )

    assert "snippet" not in result["results"][0]["matchedVia"]


async def test_documents_mode_min_score_filters_chunks(mock_driver, mock_provider):
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.search_document_chunks = AsyncMock(
            side_effect=lambda *a, **k: [
                _chunk_hit("e1", 0.9), _chunk_hit("e2", 0.5),
            ] if a[2] == "person_document_bio_embedding" else []
        )
        mock_repo.get_entities_by_ids = AsyncMock(
            return_value={"e1": _person("e1", "Ada")}
        )
        result = await semantic_search(
            "test", "q", None, 10, 0.8, mock_driver, search_in="documents",
        )

    assert result["total"] == 1
    assert result["results"][0]["entity"]["_id"] == "e1"


async def test_documents_mode_queries_only_in_scope_virtual_indexes(mock_driver, mock_provider):
    """A lens excluding `notes` from person never touches PersonDocumentNotes."""
    scoped = _make_cache(person_props={
        "name": _prop("name", required=True),
        "bio": _prop("bio", "document"),
    })
    full = _make_cache()
    loaded = LoadedSchema(scoped=scoped, full=full)

    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.search_document_chunks = AsyncMock(return_value=[])
        mock_repo.get_entities_by_ids = AsyncMock(return_value={})
        await semantic_search(
            "test", "q", None, 10, None, mock_driver, search_in="documents",
        )

        calls = mock_repo.search_document_chunks.call_args_list
        queried = {(c[0][1], c[0][2]) for c in calls}
        assert queried == {("PersonDocumentBio", "person_document_bio_embedding")}


async def test_documents_mode_type_filter_narrows_indexes(mock_driver, mock_provider):
    loaded = _make_loaded(include_company=True)
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.search_document_chunks = AsyncMock(return_value=[])
        mock_repo.get_entities_by_ids = AsyncMock(return_value={})
        await semantic_search(
            "test", "q", "person", 10, None, mock_driver, search_in="documents",
        )

        queried = {
            c[0][2] for c in mock_repo.search_document_chunks.call_args_list
        }
        assert queried == {
            "person_document_bio_embedding",
            "person_document_notes_embedding",
        }


async def test_documents_mode_no_document_properties_returns_empty(mock_driver, mock_provider):
    loaded = _make_loaded(person_props={"name": _prop("name", required=True)})
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.search_document_chunks = AsyncMock(return_value=[])
        result = await semantic_search(
            "test", "q", None, 10, None, mock_driver, search_in="documents",
        )

    assert result["total"] == 0
    mock_repo.search_document_chunks.assert_not_awaited()


async def test_documents_mode_applies_property_filters_to_parents(mock_driver, mock_provider):
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.search_document_chunks = AsyncMock(
            side_effect=lambda *a, **k: [
                _chunk_hit("e1", 0.9), _chunk_hit("e2", 0.8),
            ] if a[2] == "person_document_bio_embedding" else []
        )
        mock_repo.get_entities_by_ids = AsyncMock(return_value={
            "e1": _person("e1", "Ada", age=30),
            "e2": _person("e2", "Grace", age=20),
        })
        result = await semantic_search(
            "test", "q", "person", 10, None, mock_driver,
            filters={"age__gt": "25"}, search_in="documents",
        )

    assert result["total"] == 1
    assert result["results"][0]["entity"]["_id"] == "e1"


# ---------------------------------------------------------------------------
# searchIn=entities
# ---------------------------------------------------------------------------


async def test_entities_mode_keeps_raw_similarity_and_adds_matched_via(mock_driver, mock_provider):
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[
            {"entity": _person("e1", "Ada"), "score": 0.95},
        ])
        result = await semantic_search(
            "test", "q", "person", 10, None, mock_driver, search_in="entities",
        )

    hit = result["results"][0]
    assert hit["score"] == 0.95
    assert hit["matchedVia"] == {"source": "entity", "similarity": 0.95}


async def test_entities_mode_never_queries_chunk_indexes(mock_driver, mock_provider):
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        mock_repo.search_document_chunks = AsyncMock(return_value=[])
        await semantic_search(
            "test", "q", "person", 10, None, mock_driver, search_in="entities",
        )

    mock_repo.search_document_chunks.assert_not_awaited()


# ---------------------------------------------------------------------------
# searchIn=all (RRF fusion)
# ---------------------------------------------------------------------------


async def test_all_mode_fuses_rankings_with_rrf(mock_driver, mock_provider):
    """e1 appears in both rankings (rank 1 + rank 2), e2/e3 in one each."""
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[
            {"entity": _person("e1", "Ada"), "score": 0.95},
            {"entity": _person("e2", "Grace"), "score": 0.85},
        ])
        mock_repo.search_document_chunks = AsyncMock(
            side_effect=lambda *a, **k: [
                _chunk_hit("e3", 0.9), _chunk_hit("e1", 0.8, start=300),
            ] if a[2] == "person_document_bio_embedding" else []
        )
        mock_repo.get_entities_by_ids = AsyncMock(return_value={
            "e3": _person("e3", "Alan"),
            "e1": _person("e1", "Ada"),
        })
        result = await semantic_search(
            "test", "q", "person", 10, None, mock_driver, search_in="all",
        )

    results = {r["entity"]["_id"]: r for r in result["results"]}
    assert result["total"] == 3

    # RRF: score = sum over rankings of 1/(60 + rank)
    assert results["e1"]["score"] == pytest.approx(1 / 61 + 1 / 62)
    assert results["e2"]["score"] == pytest.approx(1 / 62)
    assert results["e3"]["score"] == pytest.approx(1 / 61)

    # Fused ordering: e1 (both) first
    assert result["results"][0]["entity"]["_id"] == "e1"

    # Document matchedVia wins for e1 (carries retrieval coordinates)
    assert results["e1"]["matchedVia"]["source"] == "document"
    assert results["e1"]["matchedVia"]["charOffset"] == 300
    assert results["e1"]["matchedVia"]["similarity"] == 0.8
    # Entity-only hit carries the minimal matchedVia
    assert results["e2"]["matchedVia"] == {"source": "entity", "similarity": 0.85}
    # Document-only hit
    assert results["e3"]["matchedVia"]["source"] == "document"


async def test_all_mode_applies_limit_after_fusion(mock_driver, mock_provider):
    loaded = _make_loaded()
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[
            {"entity": _person(f"e{i}", f"P{i}"), "score": 0.9 - i * 0.01}
            for i in range(5)
        ])
        mock_repo.search_document_chunks = AsyncMock(
            side_effect=lambda *a, **k: [
                _chunk_hit(f"d{i}", 0.9 - i * 0.01) for i in range(5)
            ] if a[2] == "person_document_bio_embedding" else []
        )
        mock_repo.get_entities_by_ids = AsyncMock(return_value={
            f"d{i}": _person(f"d{i}", f"D{i}") for i in range(5)
        })
        result = await semantic_search(
            "test", "q", "person", 3, None, mock_driver, search_in="all",
        )

    assert result["total"] == 3


async def test_all_mode_without_documents_matches_entity_ranking_order(mock_driver, mock_provider):
    """With no document properties, `all` degrades to the entity ranking."""
    loaded = _make_loaded(person_props={"name": _prop("name", required=True)})
    p1, p2, p3 = _patched(loaded, mock_provider)
    with p1, p2, p3 as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[
            {"entity": _person("e1", "Ada"), "score": 0.95},
            {"entity": _person("e2", "Grace"), "score": 0.85},
        ])
        result = await semantic_search(
            "test", "q", "person", 10, None, mock_driver,
        )

    assert [r["entity"]["_id"] for r in result["results"]] == ["e1", "e2"]
    assert result["results"][0]["matchedVia"] == {
        "source": "entity", "similarity": 0.95,
    }
