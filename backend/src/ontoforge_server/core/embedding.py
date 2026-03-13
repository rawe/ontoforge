import logging
from abc import ABC, abstractmethod

import httpx

from ontoforge_server.config import settings

logger = logging.getLogger(__name__)

_provider: "EmbeddingProvider | None" = None
_client: httpx.AsyncClient | None = None

_DEFAULT_DIMENSIONS = {
    "ollama": 768,
    "openai": 1536,
}


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, text: str) -> list[float] | None:
        """Generate an embedding vector for the given text.

        Returns None on error (caller proceeds without embedding).
        """

    @property
    @abstractmethod
    def dimensions(self) -> int:
        """Return the dimensionality of the embedding vectors."""


class OllamaEmbeddingProvider(EmbeddingProvider):
    def __init__(
        self, model: str, base_url: str, dims: int, client: httpx.AsyncClient,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._dims = dims
        self._client = client

    async def embed(self, text: str) -> list[float] | None:
        try:
            response = await self._client.post(
                f"{self._base_url}/api/embeddings",
                json={"model": self._model, "prompt": text},
            )
            response.raise_for_status()
            return response.json()["embedding"]
        except Exception as exc:
            logger.warning("Embedding failed: %s", exc)
            return None

    @property
    def dimensions(self) -> int:
        return self._dims


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """OpenAI-compatible embedding provider.

    Works with any API that follows the OpenAI embeddings format
    (OpenAI, Azure OpenAI, vLLM, LM Studio, etc.).
    """

    def __init__(
        self,
        model: str,
        base_url: str,
        api_key: str,
        dims: int,
        client: httpx.AsyncClient,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._dims = dims
        self._client = client

    async def embed(self, text: str) -> list[float] | None:
        try:
            response = await self._client.post(
                f"{self._base_url}/v1/embeddings",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"input": text, "model": self._model},
            )
            response.raise_for_status()
            return response.json()["data"][0]["embedding"]
        except Exception as exc:
            logger.warning("Embedding failed: %s", exc)
            return None

    @property
    def dimensions(self) -> int:
        return self._dims


def _resolve_dimensions(provider: str) -> int:
    if settings.EMBEDDING_DIMENSIONS is not None:
        return settings.EMBEDDING_DIMENSIONS
    default = _DEFAULT_DIMENSIONS.get(provider)
    if default is not None:
        return default
    raise ValueError(
        f"EMBEDDING_DIMENSIONS is required for provider '{provider}'"
    )


def create_embedding_provider(
    provider: str, model: str, base_url: str, client: httpx.AsyncClient,
) -> EmbeddingProvider:
    dims = _resolve_dimensions(provider)
    if provider == "ollama":
        return OllamaEmbeddingProvider(model, base_url, dims, client)
    if provider == "openai":
        api_key = settings.EMBEDDING_API_KEY
        if not api_key:
            raise ValueError("EMBEDDING_API_KEY is required for the openai provider")
        return OpenAIEmbeddingProvider(model, base_url, api_key, dims, client)
    raise ValueError(f"Unknown embedding provider: '{provider}'")


async def init_embedding_provider() -> None:
    global _provider, _client
    if not settings.EMBEDDING_PROVIDER:
        logger.info("EMBEDDING_PROVIDER not set — semantic search disabled")
        return
    _client = httpx.AsyncClient(timeout=30.0)
    _provider = create_embedding_provider(
        settings.EMBEDDING_PROVIDER,
        settings.EMBEDDING_MODEL,
        settings.EMBEDDING_BASE_URL,
        _client,
    )
    logger.info(
        "Embedding provider initialized: %s (%s, %d dimensions)",
        settings.EMBEDDING_PROVIDER,
        settings.EMBEDDING_MODEL,
        _provider.dimensions,
    )


async def close_embedding_provider() -> None:
    global _provider, _client
    if _client is not None:
        await _client.aclose()
        _client = None
    _provider = None


def get_embedding_provider() -> "EmbeddingProvider | None":
    return _provider
