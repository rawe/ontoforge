"""Semantic-relation write-path helper.

Renders the ``_fact`` string from a relation type's ``factTemplate`` against
source + target entity data and the relation's own props, then attempts a
synchronous embed via the configured provider. Mirrors the existing entity
try-sync embed path: on provider failure the relation is still written, but
with ``_embeddingState = "failed"`` and no ``_embedding``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from ontoforge_server.core.embedding import get_embedding_provider
from ontoforge_server.modeling.fact_template import render_fact

logger = logging.getLogger(__name__)

# Phase 1: templates are never updated at runtime, so `_factVersion` is a
# per-relation-type constant. This becomes dynamic in M2.
DEFAULT_FACT_VERSION = 1


@dataclass
class RelationEmbeddingResult:
    fact: str
    fact_version: int
    embedding: list[float] | None
    embedding_state: str  # "ok" | "failed"
    embedding_version: int


def _build_context(props: dict[str, Any]) -> dict[str, Any]:
    """Return a template context dict from a raw Neo4j node/edge dict.

    User properties are exposed alongside ``displayName`` (which for entities
    maps to the entity type's declared displayName property if present, or the
    system-generated label if not).
    """
    ctx = dict(props)
    # Do NOT leak embeddings into templates.
    ctx.pop("_embedding", None)
    return ctx


async def render_and_embed_relation_fact(
    template: str,
    source_data: dict[str, Any],
    target_data: dict[str, Any],
    relation_data: dict[str, Any],
) -> RelationEmbeddingResult:
    """Render the fact template and try to embed it.

    Always returns a result — embedding failures surface as
    ``embedding_state = "failed"`` with ``embedding = None``.
    """
    fact = render_fact(
        template,
        _build_context(source_data),
        _build_context(target_data),
        _build_context(relation_data),
    )

    provider = get_embedding_provider()
    if provider is None:
        return RelationEmbeddingResult(
            fact=fact,
            fact_version=DEFAULT_FACT_VERSION,
            embedding=None,
            embedding_state="failed",
            embedding_version=DEFAULT_FACT_VERSION,
        )

    try:
        embedding = await provider.embed(fact)
    except Exception as exc:  # pragma: no cover - provider-specific
        logger.warning("Relation fact embedding failed: %s", exc)
        embedding = None

    return RelationEmbeddingResult(
        fact=fact,
        fact_version=DEFAULT_FACT_VERSION,
        embedding=embedding,
        embedding_state="ok" if embedding is not None else "failed",
        embedding_version=DEFAULT_FACT_VERSION,
    )
