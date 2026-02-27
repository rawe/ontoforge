import logging
from abc import ABC, abstractmethod

import httpx

from ontoforge_server.config import settings

logger = logging.getLogger(__name__)

_provider: "EmbeddingProvider | None" = None
_client: httpx.AsyncClient | None = None


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
    def __init__(self, model: str, base_url: str, client: httpx.AsyncClient) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
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
        return 768


def create_embedding_provider(
    provider: str, model: str, base_url: str, client: httpx.AsyncClient,
) -> EmbeddingProvider:
    if provider == "ollama":
        return OllamaEmbeddingProvider(model, base_url, client)
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
        "Embedding provider initialized: %s (%s)",
        settings.EMBEDDING_PROVIDER,
        settings.EMBEDDING_MODEL,
    )


async def close_embedding_provider() -> None:
    global _provider, _client
    if _client is not None:
        await _client.aclose()
        _client = None
    _provider = None


def get_embedding_provider() -> "EmbeddingProvider | None":
    return _provider
