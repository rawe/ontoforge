"""Unit tests for repository-level side effects added in M2.

Focus: ``update_entity`` flipping adjacent semantic relations to
``_embeddingState = 'stale'`` after the primary SET runs.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from ontoforge_server.runtime import repository


def _make_session(primary_record: dict | None):
    """Return an AsyncMock session where the first `run` returns `primary_record`
    (for the primary MATCH/SET) and any subsequent runs are tracked for assertion.

    Each `session.run(...)` call is independent: its return value is a mock
    whose `.single()` is awaitable. Use `session.run.call_args_list` to
    inspect follow-up calls.
    """
    session = AsyncMock()

    # Build distinct return values per run() call.
    primary_result = MagicMock()
    primary_result.single = AsyncMock(return_value=primary_record)

    stale_result = MagicMock()
    stale_result.single = AsyncMock(return_value=None)

    # We'll have at most two calls: primary update + stale-marking.
    session.run = AsyncMock(side_effect=[primary_result, stale_result])
    return session


@pytest.mark.asyncio
async def test_update_entity_marks_adjacent_semantic_relations_stale():
    """When set_properties is non-empty, a second MATCH runs to flip adjacent
    semantic relations to stale.
    """
    primary_record = {
        "entity": {
            "_id": "e1",
            "_entityTypeKey": "person",
            "name": "Alice Updated",
        }
    }
    session = _make_session(primary_record)

    await repository.update_entity(
        session=session,
        pascal_label="Person",
        entity_id="e1",
        set_properties={"name": "Alice Updated"},
        remove_properties=[],
    )

    # Two Cypher calls: the primary update, then the stale-marking pass.
    assert session.run.await_count == 2
    stale_call = session.run.await_args_list[1]
    stale_query = stale_call.args[0]
    assert "MATCH (n:_Entity {_id: $entity_id})-[r]-()" in stale_query
    assert "r._factVersion IS NOT NULL" in stale_query
    assert "SET r._embeddingState = 'stale'" in stale_query
    assert stale_call.kwargs["entity_id"] == "e1"


@pytest.mark.asyncio
async def test_update_entity_marks_stale_on_remove_properties():
    """Removing properties counts as a mutation that warrants stale-marking."""
    primary_record = {
        "entity": {
            "_id": "e1",
            "_entityTypeKey": "person",
        }
    }
    session = _make_session(primary_record)

    await repository.update_entity(
        session=session,
        pascal_label="Person",
        entity_id="e1",
        set_properties={},
        remove_properties=["nickname"],
    )

    assert session.run.await_count == 2


@pytest.mark.asyncio
async def test_update_entity_noop_skips_stale_marking():
    """Empty set + empty remove → no stale-marking statement runs."""
    primary_record = {
        "entity": {
            "_id": "e1",
            "_entityTypeKey": "person",
        }
    }
    session = _make_session(primary_record)

    await repository.update_entity(
        session=session,
        pascal_label="Person",
        entity_id="e1",
        set_properties={},
        remove_properties=[],
    )

    # Only the primary SET _updatedAt = datetime() ran; no second statement.
    assert session.run.await_count == 1


@pytest.mark.asyncio
async def test_update_entity_returns_none_when_entity_missing():
    """No primary match → no stale-marking, returns None."""
    session = _make_session(None)

    result = await repository.update_entity(
        session=session,
        pascal_label="Person",
        entity_id="missing",
        set_properties={"name": "x"},
        remove_properties=[],
    )
    assert result is None
    # Only the primary statement ran — the stale pass is behind a record check.
    assert session.run.await_count == 1


# ---------------------------------------------------------------------------
# End-to-end side-effect tests (repository against fake driver)
# ---------------------------------------------------------------------------
#
# These exercise the same behavior but frame the assertions in terms of
# semantic- vs structural-relation state — matching the M2 test-plan names.


class _FakeSingleResult:
    def __init__(self, record: dict | None):
        self._record = record

    async def single(self):
        return self._record


class _StateSession:
    """In-memory stand-in that tracks relation states by id.

    Supports just enough Cypher to exercise `update_entity`:
    - the primary update MATCH/SET returns a fake entity record.
    - the stale-marking MATCH flips relations whose ``_factVersion`` is set and
      which are ``connected`` to the target entity.
    """

    def __init__(self, relations: dict[str, dict]):
        # relations: id -> {"_factVersion": int|None, "_embeddingState": str,
        #                    "endpoints": (source_id, target_id)}
        self.relations = relations
        self.calls: list[tuple[str, dict]] = []

    async def run(self, query: str, **params):
        self.calls.append((query, params))
        # Primary entity update: first call in a pair.
        if "MATCH (n:_Entity:" in query and "RETURN n {.*}" in query:
            return _FakeSingleResult(
                {"entity": {"_id": params.get("entity_id", "e?")}}
            )
        # Stale-marking pass.
        if "WHERE r._factVersion IS NOT NULL" in query and "SET r._embeddingState = 'stale'" in query:
            entity_id = params["entity_id"]
            for _, rel in self.relations.items():
                src, tgt = rel["endpoints"]
                if entity_id in (src, tgt) and rel.get("_factVersion") is not None:
                    rel["_embeddingState"] = "stale"
            return _FakeSingleResult(None)
        return _FakeSingleResult(None)


@pytest.mark.asyncio
async def test_update_entity_marks_target_side_too():
    """The undirected match flips relations regardless of whether the updated
    entity is the source or the target.
    """
    relations = {
        "r-out": {
            "_factVersion": 1,
            "_embeddingState": "ok",
            "endpoints": ("e1", "e2"),
        },
        "r-in": {
            "_factVersion": 1,
            "_embeddingState": "ok",
            "endpoints": ("e3", "e1"),
        },
    }
    session = _StateSession(relations)

    await repository.update_entity(
        session=session,
        pascal_label="Person",
        entity_id="e1",
        set_properties={"name": "x"},
        remove_properties=[],
    )

    assert relations["r-out"]["_embeddingState"] == "stale"
    assert relations["r-in"]["_embeddingState"] == "stale"


@pytest.mark.asyncio
async def test_update_entity_does_not_touch_structural_relations():
    """Structural relations have ``_factVersion = None`` and must stay ``ok``."""
    relations = {
        "r-sem": {
            "_factVersion": 1,
            "_embeddingState": "ok",
            "endpoints": ("e1", "e2"),
        },
        "r-struct": {
            "_factVersion": None,
            "_embeddingState": "ok",
            "endpoints": ("e1", "e3"),
        },
    }
    session = _StateSession(relations)

    await repository.update_entity(
        session=session,
        pascal_label="Person",
        entity_id="e1",
        set_properties={"name": "updated"},
        remove_properties=[],
    )

    assert relations["r-sem"]["_embeddingState"] == "stale"
    assert relations["r-struct"]["_embeddingState"] == "ok"


@pytest.mark.asyncio
async def test_update_entity_noop_preserves_ok_state():
    """Empty updates must not flip any relation to stale."""
    relations = {
        "r-sem": {
            "_factVersion": 1,
            "_embeddingState": "ok",
            "endpoints": ("e1", "e2"),
        },
    }
    session = _StateSession(relations)

    await repository.update_entity(
        session=session,
        pascal_label="Person",
        entity_id="e1",
        set_properties={},
        remove_properties=[],
    )

    assert relations["r-sem"]["_embeddingState"] == "ok"
    # Exactly one Cypher statement (primary) fired.
    assert len(session.calls) == 1
