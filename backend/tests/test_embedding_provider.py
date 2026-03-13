"""Tests for embedding provider abstraction."""

from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from ontoforge_server.core.embedding import (
    OllamaEmbeddingProvider,
    OpenAIEmbeddingProvider,
    create_embedding_provider,
)


@pytest.fixture
def mock_client():
    return AsyncMock()


# --- Ollama ---


@pytest.fixture
def ollama_provider(mock_client):
    return OllamaEmbeddingProvider(
        model="nomic-embed-text",
        base_url="http://localhost:11434",
        dims=768,
        client=mock_client,
    )


async def test_ollama_embed_success(ollama_provider, mock_client):
    """Successful embed returns list of floats."""
    mock_response = MagicMock()
    mock_response.json.return_value = {"embedding": [0.1, 0.2, 0.3]}
    mock_response.raise_for_status = MagicMock()
    mock_client.post.return_value = mock_response

    result = await ollama_provider.embed("hello world")

    assert result == [0.1, 0.2, 0.3]
    mock_client.post.assert_called_once_with(
        "http://localhost:11434/api/embeddings",
        json={"model": "nomic-embed-text", "prompt": "hello world"},
    )


async def test_ollama_embed_error_returns_none(ollama_provider, mock_client):
    """Network error returns None (graceful degradation)."""
    mock_client.post.side_effect = Exception("Connection refused")

    result = await ollama_provider.embed("hello world")

    assert result is None


async def test_ollama_embed_http_error_returns_none(ollama_provider, mock_client):
    """HTTP error status returns None."""
    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = Exception("500 Server Error")
    mock_client.post.return_value = mock_response

    result = await ollama_provider.embed("test")

    assert result is None


def test_ollama_dimensions(ollama_provider):
    """OllamaEmbeddingProvider reports configured dimensions."""
    assert ollama_provider.dimensions == 768


# --- OpenAI-compatible ---


@pytest.fixture
def openai_provider(mock_client):
    return OpenAIEmbeddingProvider(
        model="text-embedding-3-small",
        base_url="https://api.openai.com",
        api_key="sk-test-key",
        dims=1536,
        client=mock_client,
    )


async def test_openai_embed_success(openai_provider, mock_client):
    """Successful OpenAI embed returns list of floats."""
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "data": [{"embedding": [0.4, 0.5, 0.6], "index": 0}],
        "model": "text-embedding-3-small",
    }
    mock_response.raise_for_status = MagicMock()
    mock_client.post.return_value = mock_response

    result = await openai_provider.embed("hello world")

    assert result == [0.4, 0.5, 0.6]
    mock_client.post.assert_called_once_with(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": "Bearer sk-test-key"},
        json={"input": "hello world", "model": "text-embedding-3-small"},
    )


async def test_openai_embed_error_returns_none(openai_provider, mock_client):
    """Network error returns None (graceful degradation)."""
    mock_client.post.side_effect = Exception("Connection refused")

    result = await openai_provider.embed("hello world")

    assert result is None


def test_openai_dimensions(openai_provider):
    """OpenAIEmbeddingProvider reports configured dimensions."""
    assert openai_provider.dimensions == 1536


# --- Factory ---


@patch("ontoforge_server.core.embedding.settings")
def test_factory_ollama(mock_settings):
    """Factory creates OllamaEmbeddingProvider for 'ollama'."""
    mock_settings.EMBEDDING_DIMENSIONS = None
    client = AsyncMock()
    provider = create_embedding_provider("ollama", "nomic-embed-text", "http://localhost:11434", client)
    assert isinstance(provider, OllamaEmbeddingProvider)
    assert provider.dimensions == 768


@patch("ontoforge_server.core.embedding.settings")
def test_factory_openai(mock_settings):
    """Factory creates OpenAIEmbeddingProvider for 'openai'."""
    mock_settings.EMBEDDING_DIMENSIONS = None
    mock_settings.EMBEDDING_API_KEY = "sk-test"
    client = AsyncMock()
    provider = create_embedding_provider("openai", "text-embedding-3-small", "https://api.openai.com", client)
    assert isinstance(provider, OpenAIEmbeddingProvider)
    assert provider.dimensions == 1536


@patch("ontoforge_server.core.embedding.settings")
def test_factory_openai_requires_api_key(mock_settings):
    """Factory raises ValueError when API key is missing for openai."""
    mock_settings.EMBEDDING_DIMENSIONS = None
    mock_settings.EMBEDDING_API_KEY = None
    client = AsyncMock()
    with pytest.raises(ValueError, match="EMBEDDING_API_KEY is required"):
        create_embedding_provider("openai", "text-embedding-3-small", "https://api.openai.com", client)


@patch("ontoforge_server.core.embedding.settings")
def test_factory_custom_dimensions(mock_settings):
    """Factory uses EMBEDDING_DIMENSIONS when set."""
    mock_settings.EMBEDDING_DIMENSIONS = 3072
    mock_settings.EMBEDDING_API_KEY = "sk-test"
    client = AsyncMock()
    provider = create_embedding_provider("openai", "text-embedding-3-large", "https://api.openai.com", client)
    assert provider.dimensions == 3072


@patch("ontoforge_server.core.embedding.settings")
def test_factory_unknown_raises(mock_settings):
    """Factory raises ValueError for unknown provider."""
    mock_settings.EMBEDDING_DIMENSIONS = 768
    client = AsyncMock()
    with pytest.raises(ValueError, match="Unknown embedding provider"):
        create_embedding_provider("unknown", "model", "http://localhost", client)
