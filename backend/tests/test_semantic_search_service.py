"""Tests for semantic search service layer."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.runtime.service import (
    PropertyDef,
    EntityTypeDef,
    SchemaCache,
    semantic_search,
)


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
    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=None):
        with pytest.raises(ValidationError, match="EMBEDDING_PROVIDER"):
            await semantic_search("test", "engineers", "person", 10, None, mock_driver)


async def test_search_unknown_type_raises(mock_driver):
    """Semantic search raises NotFoundError for unknown entity type."""
    mock_provider = MagicMock()
    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
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

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=search_results)
        result = await semantic_search("test", "find Alice", "person", 10, None, mock_driver)

    assert result["query"] == "find Alice"
    assert result["total"] == 1
    assert result["results"][0]["entity"]["name"] == "Alice"
    assert result["results"][0]["score"] == 0.95


async def test_search_embed_failure_raises(mock_driver):
    """Search raises if query embedding fails."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=None)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(ValidationError, match="Failed to generate embedding"):
            await semantic_search("test", "query", "person", 10, None, mock_driver)


# --- No filters: no over-fetch ---


async def test_no_filters_passes_limit_as_vector_limit(mock_driver, mock_session):
    """Without filters, vector_limit equals limit (no over-fetch)."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        await semantic_search("test", "query", "person", 10, None, mock_driver)

        call_kwargs = mock_repo.semantic_search.call_args
        assert call_kwargs[1].get("where_clauses") is None
        assert call_kwargs[1].get("filter_params") is None
        # positional: session, entity_type_key, query_embedding, vector_limit, limit, min_score
        assert call_kwargs[0][3] == 10  # vector_limit == limit
        assert call_kwargs[0][4] == 10  # limit


# --- Filters: over-fetch and WHERE clauses ---


async def test_equality_filter_passes_where_clauses(mock_driver, mock_session):
    """Equality filter generates WHERE clause and over-fetches."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
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
        assert "node.location" in where_clauses[0]
        assert filter_params["flt_0"] == "Berlin"
        # Over-fetch: min(10*5, 500) = 50
        assert call_kwargs[0][3] == 50  # vector_limit


async def test_operator_filter_passes_correct_clauses(mock_driver, mock_session):
    """Operator filter (age__gt) generates correct WHERE clause."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
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
        assert "node.age >" in where_clauses[0]
        assert filter_params["flt_0"] == 25  # coerced to int


async def test_unknown_filter_property_raises(mock_driver):
    """Unknown filter property returns ValidationError."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(ValidationError, match="Unknown filter property"):
            await semantic_search(
                "test", "query", "person", 10, None, mock_driver,
                filters={"nonexistent": "value"},
            )


async def test_overfetch_capped_at_500(mock_driver, mock_session):
    """Over-fetch is capped at 500 even with high limit."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = AsyncMock(return_value=[])
        await semantic_search(
            "test", "query", "person", 100, None, mock_driver,
            filters={"location": "Berlin"},
        )

        call_kwargs = mock_repo.semantic_search.call_args
        # min(100*5, 500) = 500
        assert call_kwargs[0][3] == 500  # vector_limit


async def test_multiple_filters(mock_driver, mock_session):
    """Multiple filters generate multiple WHERE clauses."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
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
