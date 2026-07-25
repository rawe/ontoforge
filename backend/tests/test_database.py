import logging
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.adapters.neo4j import ddl
from ontoforge_server.adapters.neo4j.ddl import (
    MAX_VECTOR_FILTER_VALUE_BYTES,
    validate_vector_indexed_properties,
)
from ontoforge_server.core.exceptions import ValidationError


def test_validate_vector_indexed_properties_accepts_short_strings():
    validate_vector_indexed_properties(
        "section",
        {"heading": "Short text", "order": 1},
        ["heading", "order"],
        entity_id="ent-1",
    )


def test_validate_vector_indexed_properties_rejects_utf8_byte_overflow():
    oversized = "x" * (MAX_VECTOR_FILTER_VALUE_BYTES + 1)

    with pytest.raises(ValidationError, match="Property 'content' on entity 'ent-1' is too large"):
        validate_vector_indexed_properties(
            "section",
            {"content": oversized},
            ["content"],
            entity_id="ent-1",
        )


# --- Vector index dimension drift -----------------------------------------


@asynccontextmanager
async def _fake_session(session):
    yield session


def _patch_reconcile(existing_dimensions: int | None):
    """Patch the two database calls _reconcile_index_dimensions makes."""
    session = AsyncMock()
    return (
        patch.object(
            ddl,
            "_existing_vector_index_dimensions",
            AsyncMock(return_value=existing_dimensions),
        ),
        patch.object(ddl, "open_session", lambda driver: _fake_session(session)),
        session,
    )


async def _reconcile(existing_dimensions, recreate, caplog):
    """Reconcile a 'person' index against a 768-wide model.

    Returns the mocked session and the logged messages themselves — not
    ``caplog.text``, which prefixes each line with the adapter's module path.
    """
    dims_patch, session_patch, session = _patch_reconcile(existing_dimensions)
    with dims_patch, session_patch, caplog.at_level(logging.INFO):
        await ddl._reconcile_index_dimensions(
            object(), "person_embedding", "entity type 'person'", 768, recreate
        )
    return session, "\n".join(r.getMessage() for r in caplog.records)


async def test_matching_dimensions_are_left_alone(caplog):
    session, text = await _reconcile(768, False, caplog)

    session.run.assert_not_awaited()
    assert text == ""


async def test_absent_index_is_left_to_the_create_statement(caplog):
    session, text = await _reconcile(None, False, caplog)

    session.run.assert_not_awaited()
    assert text == ""


async def test_mismatch_warns_without_dropping_the_index(caplog):
    session, text = await _reconcile(1024, False, caplog)

    session.run.assert_not_awaited()
    assert "entity type 'person'" in text
    assert "1024" in text and "768" in text
    assert "/api/model/rebuild-embeddings" in text


async def test_mismatch_warning_names_no_vendor_or_index(caplog):
    """Decision 010: operator-facing text stays in API vocabulary."""
    _, text = await _reconcile(1024, False, caplog)

    for leak in ("eo4j", "Cypher", "person_embedding", "VECTOR INDEX", "label"):
        assert leak not in text, f"'{leak}' leaked into the warning"


async def test_mismatch_is_dropped_when_recreation_is_requested(caplog):
    session, text = await _reconcile(1024, True, caplog)

    session.run.assert_awaited_once()
    assert "DROP INDEX person_embedding" in session.run.await_args.args[0]
    assert "entity type 'person'" in text
    assert [r.levelno for r in caplog.records] == [logging.INFO]
