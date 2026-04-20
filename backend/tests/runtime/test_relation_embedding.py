"""Unit tests for the semantic-relation write path (render + embed)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ontoforge_server.runtime.relation_embedding import (
    DEFAULT_FACT_VERSION,
    render_and_embed_relation_fact,
)


EMBED_PROVIDER = "ontoforge_server.runtime.relation_embedding.get_embedding_provider"


@pytest.mark.asyncio
async def test_render_and_embed_success():
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])

    with patch(EMBED_PROVIDER, return_value=provider):
        result = await render_and_embed_relation_fact(
            template="{{ source.displayName }} works for {{ target.displayName }}",
            source_data={"displayName": "Alice"},
            target_data={"displayName": "Acme"},
            relation_data={"role": "Engineer"},
        )

    assert result.fact == "Alice works for Acme"
    assert result.fact_version == DEFAULT_FACT_VERSION
    assert result.embedding == [0.1, 0.2, 0.3]
    assert result.embedding_state == "ok"
    assert result.embedding_version == DEFAULT_FACT_VERSION


@pytest.mark.asyncio
async def test_render_and_embed_embedding_failure():
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=None)

    with patch(EMBED_PROVIDER, return_value=provider):
        result = await render_and_embed_relation_fact(
            template="{{ source.displayName }} -> {{ target.displayName }}",
            source_data={"displayName": "A"},
            target_data={"displayName": "B"},
            relation_data={},
        )

    assert result.fact == "A -> B"
    assert result.embedding is None
    assert result.embedding_state == "failed"


@pytest.mark.asyncio
async def test_render_and_embed_no_provider_marks_failed():
    with patch(EMBED_PROVIDER, return_value=None):
        result = await render_and_embed_relation_fact(
            template="{{ source.displayName }}",
            source_data={"displayName": "A"},
            target_data={},
            relation_data={},
        )

    assert result.fact == "A"
    assert result.embedding is None
    assert result.embedding_state == "failed"


@pytest.mark.asyncio
async def test_render_and_embed_template_error_propagates():
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.0])

    with patch(EMBED_PROVIDER, return_value=provider):
        with pytest.raises(ValueError):
            # Oversize rendered output should raise.
            big = "x" * 2001
            await render_and_embed_relation_fact(
                template="{{ relation.big }}",
                source_data={},
                target_data={},
                relation_data={"big": big},
            )
