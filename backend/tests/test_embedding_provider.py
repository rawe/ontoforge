"""Tests for embedding provider abstraction."""

from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from ontoforge_server.core.embedding import (
    OllamaEmbeddingProvider,
    create_embedding_provider,
)


@pytest.fixture
def mock_client():
    return AsyncMock()


@pytest.fixture
def provider(mock_client):
    return OllamaEmbeddingProvider(
        model="nomic-embed-text",
        base_url="http://localhost:11434",
        client=mock_client,
    )


async def test_embed_success(provider, mock_client):
    """Successful embed returns list of floats."""
    mock_response = MagicMock()
    mock_response.json.return_value = {"embedding": [0.1, 0.2, 0.3]}
    mock_response.raise_for_status = MagicMock()
    mock_client.post.return_value = mock_response

    result = await provider.embed("hello world")

    assert result == [0.1, 0.2, 0.3]
    mock_client.post.assert_called_once_with(
        "http://localhost:11434/api/embeddings",
        json={"model": "nomic-embed-text", "prompt": "hello world"},
    )


async def test_embed_error_returns_none(provider, mock_client):
    """Network error returns None (graceful degradation)."""
    mock_client.post.side_effect = Exception("Connection refused")

    result = await provider.embed("hello world")

    assert result is None


async def test_embed_http_error_returns_none(provider, mock_client):
    """HTTP error status returns None."""
    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = Exception("500 Server Error")
    mock_client.post.return_value = mock_response

    result = await provider.embed("test")

    assert result is None


def test_dimensions(provider):
    """OllamaEmbeddingProvider reports 768 dimensions."""
    assert provider.dimensions == 768


def test_factory_ollama():
    """Factory creates OllamaEmbeddingProvider for 'ollama'."""
    client = AsyncMock()
    provider = create_embedding_provider("ollama", "nomic-embed-text", "http://localhost:11434", client)
    assert isinstance(provider, OllamaEmbeddingProvider)


def test_factory_unknown_raises():
    """Factory raises ValueError for unknown provider."""
    client = AsyncMock()
    with pytest.raises(ValueError, match="Unknown embedding provider"):
        create_embedding_provider("unknown", "model", "http://localhost", client)
