"""Tests for semantic search service layer."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.runtime.service import (
    PropertyDef,
    EntityTypeDef,
    SchemaCache,
    LoadedSchema,
    semantic_search,
)


def _make_loaded(entity_type_keys: list[str] | None = None) -> LoadedSchema:
    cache = _make_cache(entity_type_keys)
    return LoadedSchema(scoped=cache, full=cache)


def _make_loaded_scoped(scoped_keys: list[str], full_keys: list[str]) -> LoadedSchema:
    return LoadedSchema(scoped=_make_cache(scoped_keys), full=_make_cache(full_keys))


def _make_cache(entity_type_keys: list[str] | None = None) -> SchemaCache:
    """Build a minimal SchemaCache for testing."""
    cache = SchemaCache(
        ontology_id="ont-1",
        ontology_key="test",
        ontology_name="Test",
        ontology_description=None,
    )
    for key in (entity_type_keys or ["person"]):
        props = {
            "name": PropertyDef(
                key="name", display_name="Name", description=None,
                data_type="string", required=True, default_value=None,
            ),
        }
        if key == "person":
            props["age"] = PropertyDef(
                key="age", display_name="Age", description=None,
                data_type="integer", required=False, default_value=None,
            )
            props["location"] = PropertyDef(
                key="location", display_name="Location", description=None,
                data_type="string", required=False, default_value=None,
            )
        cache.entity_types[key] = EntityTypeDef(
            key=key,
            display_name=key.title(),
            description=None,
            properties=props,
        )
    return cache


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
def mock_session(mock_driver):
    session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield session

    mock_driver.session = _session
    return session


# --- Basic behavior tests ---


async def test_search_disabled_raises(mock_driver):
    """Semantic search raises ValidationError when provider is not configured."""
    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=None):
        with pytest.raises(ValidationError, match="EMBEDDING_PROVIDER"):
            await semantic_search("test", "engineers", "person", 10, None, mock_driver)


async def test_search_unknown_type_raises(mock_driver):
    """Semantic search raises NotFoundError for unknown entity type."""
    mock_provider = MagicMock()
    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(NotFoundError, match="nonexistent"):
            await semantic_search("test", "query", "nonexistent", 10, None, mock_driver)


async def test_search_single_type(mock_driver, mock_session):
    """Type-scoped search calls repository with correct parameters."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    search_results = [
        {"entity": {"_id": "e1", "name": "Alice"}, "score": 0.95},
    ]

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search("test", "find Alice", "person", 10, None, mock_driver)

    assert result["query"] == "find Alice"
    assert result["total"] == 1
    assert result["results"][0]["entity"]["name"] == "Alice"
    # Default searchIn=all fuses rankings via RRF; the raw cosine similarity
    # lives in matchedVia.
    assert result["results"][0]["score"] == pytest.approx(1 / 61)
    assert result["results"][0]["matchedVia"] == {
        "source": "entity",
        "similarity": 0.95,
    }


async def test_search_embed_failure_raises(mock_driver):
    """Search raises if query embedding fails."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=None)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(ValidationError, match="Failed to generate embedding"):
            await semantic_search("test", "query", "person", 10, None, mock_driver)


# --- No filters: limit passed directly (no over-fetch) ---


async def test_no_filters_passes_limit_directly(mock_driver, mock_session):
    """Without filters, limit is passed directly to repository (no over-fetch)."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        await semantic_search("test", "query", "person", 10, None, mock_driver)

        call_kwargs = mock_repo.semantic_search.call_args
        assert call_kwargs[1].get("where_clauses") is None
        assert call_kwargs[1].get("filter_params") is None
        # positional: session, pascal_label, entity_type_key, query_embedding, limit, min_score
        assert call_kwargs[0][1] == "Person"  # pascal_label
        assert call_kwargs[0][2] == "person"  # entity_type_key
        assert call_kwargs[0][4] == 10  # limit (no over-fetch)


# --- Filters: in-index WHERE clauses (no over-fetch) ---


async def test_equality_filter_no_overfetch(mock_driver, mock_session):
    """Equality filter generates WHERE clause without over-fetching."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        await semantic_search(
            "test", "engineers", "person", 10, None, mock_driver,
            filters={"location": "Berlin"},
        )

        call_kwargs = mock_repo.semantic_search.call_args
        where_clauses = call_kwargs[1]["where_clauses"]
        filter_params = call_kwargs[1]["filter_params"]
        assert len(where_clauses) == 1
        assert "n.location" in where_clauses[0]
        assert filter_params["flt_0"] == "Berlin"
        # No over-fetch: limit is passed directly
        assert call_kwargs[0][4] == 10  # limit


async def test_operator_filter_passes_correct_clauses(mock_driver, mock_session):
    """Operator filter (age__gt) generates correct WHERE clause."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        await semantic_search(
            "test", "engineers", "person", 10, None, mock_driver,
            filters={"age__gt": "25"},
        )

        call_kwargs = mock_repo.semantic_search.call_args
        where_clauses = call_kwargs[1]["where_clauses"]
        filter_params = call_kwargs[1]["filter_params"]
        assert len(where_clauses) == 1
        assert "n.age >" in where_clauses[0]
        assert filter_params["flt_0"] == 25  # coerced to int


async def test_unknown_filter_property_raises(mock_driver):
    """Unknown filter property returns ValidationError."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(ValidationError, match="Unknown filter property"):
            await semantic_search(
                "test", "query", "person", 10, None, mock_driver,
                filters={"nonexistent": "value"},
            )


async def test_contains_filter_rejected_on_semantic_search(mock_driver):
    """__contains filter is rejected on semantic search (not supported by in-index WHERE)."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(ValidationError, match="__contains.*not supported"):
            await semantic_search(
                "test", "query", "person", 10, None, mock_driver,
                filters={"name__contains": "Ali"},
            )


async def test_multiple_filters(mock_driver, mock_session):
    """Multiple filters generate multiple WHERE clauses."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        await semantic_search(
            "test", "query", "person", 10, None, mock_driver,
            filters={"location": "Berlin", "age__gte": "25"},
        )

        call_kwargs = mock_repo.semantic_search.call_args
        where_clauses = call_kwargs[1]["where_clauses"]
        assert len(where_clauses) == 2


# --- Field Projection ---


async def test_search_with_fields_projects_entities(mock_driver, mock_session):
    """Field projection strips entity properties, keeps _id and score."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    search_results = [
        {
            "entity": {
                "_id": "e1",
                "_entityTypeKey": "person",
                "name": "Alice",
                "age": 30,
                "location": "Berlin",
            },
            "score": 0.95,
        },
    ]

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search(
            "test", "find Alice", "person", 10, None, mock_driver,
            fields=["name"],
        )

    entity = result["results"][0]["entity"]
    assert entity["_id"] == "e1"
    assert entity["name"] == "Alice"
    assert "age" not in entity
    assert "location" not in entity
    assert "_entityTypeKey" not in entity
    # score is on the result wrapper, not the entity; raw similarity in matchedVia
    assert result["results"][0]["matchedVia"]["similarity"] == 0.95


async def test_search_without_fields_returns_all(mock_driver, mock_session):
    """Without fields param, full entity data is returned."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    search_results = [
        {
            "entity": {
                "_id": "e1",
                "_entityTypeKey": "person",
                "name": "Alice",
                "age": 30,
            },
            "score": 0.9,
        },
    ]

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search(
            "test", "find Alice", "person", 10, None, mock_driver,
        )

    entity = result["results"][0]["entity"]
    assert entity["_id"] == "e1"
    assert entity["name"] == "Alice"
    assert entity["age"] == 30
    assert entity["_entityTypeKey"] == "person"


# --- Cross-type search (no entity_type_key) ---


async def test_cross_type_search_uses_shared_index(mock_driver, mock_session):
    """Without a type, search hits the shared _Entity index with the plain limit."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    search_results = [
        {"entity": {"_id": "e1", "_entityTypeKey": "person", "name": "Alice"}, "score": 0.95},
        {"entity": {"_id": "e2", "_entityTypeKey": "company", "name": "Acme"}, "score": 0.9},
    ]

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded(["person", "company"])), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search("test", "query", None, 10, None, mock_driver)

        call_args = mock_repo.semantic_search.call_args
        assert call_args[0][1] == "_Entity"  # pascal_label
        assert call_args[0][4] == 10  # limit (unscoped: no over-fetch)
        assert call_args[1]["index_name"] == "entity_embedding"

    assert result["total"] == 2
    assert result["results"][0]["entity"]["_entityTypeKey"] == "person"
    assert result["results"][1]["entity"]["_entityTypeKey"] == "company"


async def test_cross_type_search_scoped_overfetches_and_filters(mock_driver, mock_session):
    """A scoped ontology over-fetches and drops results of excluded types."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    search_results = [
        {"entity": {"_id": "e1", "_entityTypeKey": "company", "name": "Acme"}, "score": 0.95},
        {"entity": {"_id": "e2", "_entityTypeKey": "person", "name": "Alice"}, "score": 0.9},
    ]

    loaded = _make_loaded_scoped(["person"], ["person", "company"])
    with patch("ontoforge_server.runtime.service._load_schema", return_value=loaded), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search("test", "query", None, 10, None, mock_driver)

        call_args = mock_repo.semantic_search.call_args
        assert call_args[0][4] == 50  # limit * 5 over-fetch

    assert result["total"] == 1
    assert result["results"][0]["entity"]["_entityTypeKey"] == "person"


async def test_cross_type_search_truncates_to_limit(mock_driver, mock_session):
    """Over-fetched results are truncated to the requested limit after filtering."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    search_results = [
        {"entity": {"_id": f"e{i}", "_entityTypeKey": "person", "name": f"P{i}"}, "score": 0.9}
        for i in range(5)
    ]

    loaded = _make_loaded_scoped(["person"], ["person", "company"])
    with patch("ontoforge_server.runtime.service._load_schema", return_value=loaded), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search("test", "query", None, 2, None, mock_driver)

    assert result["total"] == 2


async def test_cross_type_search_rejects_filters(mock_driver):
    """Property filters require a type — they are defined per entity type."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(ValidationError, match="require 'type'"):
            await semantic_search(
                "test", "query", None, 10, None, mock_driver,
                filters={"location": "Berlin"},
            )


async def test_cross_type_search_fields_keeps_type_key(mock_driver, mock_session):
    """Field projection on cross-type search always keeps _id and _entityTypeKey."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    search_results = [
        {
            "entity": {
                "_id": "e1",
                "_entityTypeKey": "person",
                "name": "Alice",
                "age": 30,
            },
            "score": 0.95,
        },
    ]

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_loaded()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search(
            "test", "query", None, 10, None, mock_driver,
            fields=["name"],
        )

    entity = result["results"][0]["entity"]
    assert entity["_id"] == "e1"
    assert entity["_entityTypeKey"] == "person"
    assert entity["name"] == "Alice"
    assert "age" not in entity


async def test_cross_type_search_empty_scope_returns_empty(mock_driver, mock_session):
    """An ontology whose scope includes no entity types returns no results."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    loaded = LoadedSchema(scoped=_make_cache([]), full=_make_cache(["person"]))
    loaded.scoped.entity_types.clear()

    with patch("ontoforge_server.runtime.service._load_schema", return_value=loaded), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        result = await semantic_search("test", "query", None, 10, None, mock_driver)

    assert result["total"] == 0
    mock_repo.semantic_search.assert_not_called()
