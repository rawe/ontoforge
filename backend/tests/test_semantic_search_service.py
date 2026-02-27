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
        cache.entity_types[key] = EntityTypeDef(
            key=key,
            display_name=key.title(),
            description=None,
            properties={
                "name": PropertyDef(
                    key="name", display_name="Name", description=None,
                    data_type="string", required=True, default_value=None,
                ),
            },
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


async def test_search_disabled_raises(mock_driver):
    """Semantic search raises ValidationError when provider is not configured."""
    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=None):
        with pytest.raises(ValidationError, match="EMBEDDING_PROVIDER"):
            await semantic_search("test", "engineers", None, 10, None, mock_driver)


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


async def test_search_cross_type(mock_driver, mock_session):
    """Cross-type search merges results from multiple types sorted by score."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=[0.1] * 768)

    person_results = [
        {"entity": {"_id": "p1", "name": "Alice"}, "score": 0.90},
    ]
    company_results = [
        {"entity": {"_id": "c1", "name": "Acme"}, "score": 0.95},
    ]

    call_count = 0

    async def mock_semantic_search(session, *args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return person_results
        return company_results

    with patch("ontoforge_server.runtime.service._load_schema",
               return_value=_make_cache(["person", "company"])), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider), \
         patch("ontoforge_server.runtime.service.repository") as mock_repo:
        mock_repo.semantic_search = mock_semantic_search
        result = await semantic_search("test", "search query", None, 10, None, mock_driver)

    assert result["total"] == 2
    # Should be sorted by score descending
    assert result["results"][0]["score"] == 0.95
    assert result["results"][1]["score"] == 0.90


async def test_search_embed_failure_raises(mock_driver):
    """Search raises if query embedding fails."""
    mock_provider = AsyncMock()
    mock_provider.embed = AsyncMock(return_value=None)

    with patch("ontoforge_server.runtime.service._load_schema", return_value=_make_cache()), \
         patch("ontoforge_server.runtime.service.get_embedding_provider", return_value=mock_provider):
        with pytest.raises(ValidationError, match="Failed to generate embedding"):
            await semantic_search("test", "query", None, 10, None, mock_driver)
