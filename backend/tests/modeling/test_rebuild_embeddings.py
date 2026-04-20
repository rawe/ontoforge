"""Unit tests for rebuild_embeddings streaming job.

Covers: drop-then-recreate vector indexes, entity re-embed (smoke), semantic
relation re-embed (happy path + failure), non-semantic relations untouched,
and the NDJSON stream shape.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ontoforge_server.modeling import service as modeling_service


PROVIDER_PATH = "ontoforge_server.modeling.service.get_embedding_provider"
RELATION_EMBED_PROVIDER_PATH = (
    "ontoforge_server.runtime.relation_embedding.get_embedding_provider"
)


class _FakeResult:
    """Awaitable + async-iterable fake for a Neo4j result.

    Supports:
        await result.single() -> dict (first row) or None
        async for record in result -> yields rows
    """

    def __init__(self, rows: list[dict]):
        self._rows = rows

    def __aiter__(self):
        async def gen():
            for r in self._rows:
                yield r

        return gen()

    async def single(self):
        return self._rows[0] if self._rows else None


class _ScriptedSession:
    """Session that routes `run(query, ...)` to matchers in order of registration.

    A matcher is (substring, result_provider). The *first* matcher whose
    substring appears in the query wins. Multiple calls matching the same
    matcher replay the same result. `result_provider` is a callable taking the
    params dict and returning a list[dict] (rows).
    """

    def __init__(self, matchers):
        self._matchers = matchers
        self.calls: list[tuple[str, dict]] = []

    async def run(self, query: str, **params):
        self.calls.append((query, params))
        for substring, provider in self._matchers:
            if substring in query:
                rows = provider(params)
                return _FakeResult(rows)
        # Default: empty result
        return _FakeResult([])


class _FakeDriver:
    def __init__(self, matchers):
        self.matchers = matchers
        self.sessions: list[_ScriptedSession] = []

    def session(self, **kwargs):
        sess = _ScriptedSession(self.matchers)
        self.sessions.append(sess)

        @asynccontextmanager
        async def _cm():
            yield sess

        return _cm()

    def all_queries(self) -> list[str]:
        return [q for s in self.sessions for q, _ in s.calls]


def _make_provider(dimensions: int = 4):
    provider = MagicMock()
    provider.dimensions = dimensions
    provider.embed = AsyncMock(return_value=[0.1] * dimensions)
    return provider


@pytest.mark.asyncio
async def test_rebuild_drops_then_recreates_indexes_in_order():
    """Drop of every per-type / relation / saved-query index must happen
    before any re-embedding (and before the ensure_* recreate calls).
    """
    provider = _make_provider()

    # DB has 1 entity type + 1 semantic relation type, no instances.
    def rows_for(query: str, params):
        if "MATCH (et:EntityType) RETURN et.key AS key" in query:
            return [{"key": "person"}]
        if "MATCH (rt:RelationType) WHERE rt.factTemplate IS NOT NULL RETURN rt.key" in query:
            return [{"key": "works_for"}]
        return []

    # We use a scripted session but also patch the index helpers so we can
    # assert call order independently of Cypher statements.
    matchers = [
        ("MATCH (et:EntityType) RETURN et.key", lambda p: [{"key": "person"}]),
        (
            "WHERE rt.factTemplate IS NOT NULL RETURN rt.key",
            lambda p: [{"key": "works_for"}],
        ),
        # Empty entity/relation/saved-query enumerations used later in the job.
        ("MATCH (et:EntityType)\n", lambda p: []),
        ("MATCH (rt:RelationType)\n", lambda p: []),
        ("MATCH (sq:SavedQuery)", lambda p: []),
    ]
    driver = _FakeDriver(matchers)

    order: list[str] = []

    async def rec(name):
        order.append(name)

    with (
        patch(PROVIDER_PATH, return_value=provider),
        patch(
            "ontoforge_server.modeling.service.drop_vector_index",
            new=AsyncMock(side_effect=lambda d, k: order.append(f"drop_entity:{k}")),
        ),
        patch(
            "ontoforge_server.modeling.service.drop_relation_vector_index",
            new=AsyncMock(side_effect=lambda d, k: order.append(f"drop_relation:{k}")),
        ),
        patch(
            "ontoforge_server.modeling.service.drop_saved_query_vector_index",
            new=AsyncMock(side_effect=lambda d: order.append("drop_saved_query")),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_vector_indexes",
            new=AsyncMock(side_effect=lambda d, dim: order.append(f"ensure_all:{dim}")),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_saved_query_vector_index",
            new=AsyncMock(side_effect=lambda d, dim: order.append(f"ensure_sq:{dim}")),
        ),
    ):
        # Consume the stream fully so every phase runs.
        async for _ in modeling_service.rebuild_embeddings(driver):
            pass

    # Drops must all precede ensure_* recreate calls.
    drop_idxs = [i for i, o in enumerate(order) if o.startswith("drop_")]
    ensure_idxs = [i for i, o in enumerate(order) if o.startswith("ensure_")]
    assert drop_idxs, "expected at least one drop"
    assert ensure_idxs, "expected at least one ensure"
    assert max(drop_idxs) < min(ensure_idxs), f"drops must precede ensures: {order}"

    # Specifically: entity drop, relation drop, saved-query drop all happened.
    assert "drop_entity:person" in order
    assert "drop_relation:works_for" in order
    assert "drop_saved_query" in order
    assert f"ensure_all:{provider.dimensions}" in order
    assert f"ensure_sq:{provider.dimensions}" in order


@pytest.mark.asyncio
async def test_rebuild_reembeds_semantic_relation_instances():
    """For each semantic relation instance, write back _fact / _factVersion /
    _embedding / _embeddingState / _embeddingVersion.
    """
    provider = _make_provider()

    # Captured writes.
    writes: list[dict] = []

    def matcher(query: str, params):
        if "MATCH (et:EntityType) RETURN et.key AS key ORDER" in query:
            return []  # no entity types -> skip entity loop entirely
        if "WHERE rt.factTemplate IS NOT NULL RETURN rt.key" in query:
            return [{"key": "works_for"}]
        if "MATCH (rt:RelationType)" in query and "factTemplate IS NOT NULL" in query:
            # Semantic relation type + property defs
            return [
                {
                    "key": "works_for",
                    "factTemplate": "{{ source.name }} works for {{ target.name }}",
                    "properties": [],
                }
            ]
        if "RETURN count(r) AS total" in query:
            return [{"total": 1}]
        if "RETURN r._id AS id" in query:
            return [
                {
                    "id": "rel-1",
                    "rel_props": {
                        "_id": "rel-1",
                        "_factVersion": 1,
                        "_embeddingVersion": 1,
                        "_embedding": [0.9] * 4,  # stale
                    },
                    "from_props": {"name": "Alice"},
                    "to_props": {"name": "Acme"},
                }
            ]
        if "MATCH ()-[r:WORKS_FOR {_id: $id}]->()" in query:
            writes.append(params)
            return []
        if "MATCH (sq:SavedQuery)" in query:
            return []
        if "MATCH (et:EntityType)" in query and "HAS_PROPERTY" in query:
            return []
        return []

    matchers = [("", matcher)]  # single matcher handles everything via dispatch
    driver = _FakeDriver(matchers)

    # Dispatch-based matcher: the _FakeDriver expects list of (substring,
    # provider); use one wildcard entry that calls our dispatcher.
    driver.matchers = [("", lambda params: [])]

    # Patch _ScriptedSession.run to use our dispatcher. Easier: rebuild driver
    # with per-substring routing via monkeypatching the session class is noisy.
    # Instead, wrap: redefine matchers as full-query dispatch via a wrapper
    # that always matches and calls our `matcher(query, params)`.
    class _DispatchSession(_ScriptedSession):
        async def run(self, query: str, **params):
            self.calls.append((query, params))
            rows = matcher(query, params)
            return _FakeResult(rows)

    driver.sessions = []

    def _session_factory(**kwargs):
        sess = _DispatchSession([])
        driver.sessions.append(sess)

        @asynccontextmanager
        async def _cm():
            yield sess

        return _cm()

    driver.session = _session_factory

    with (
        patch(PROVIDER_PATH, return_value=provider),
        patch(RELATION_EMBED_PROVIDER_PATH, return_value=provider),
        patch(
            "ontoforge_server.modeling.service.drop_vector_index", new=AsyncMock()
        ),
        patch(
            "ontoforge_server.modeling.service.drop_relation_vector_index",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.drop_saved_query_vector_index",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_vector_indexes",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_saved_query_vector_index",
            new=AsyncMock(),
        ),
    ):
        lines = [
            line async for line in modeling_service.rebuild_embeddings(driver)
        ]

    # Exactly one write to the relation occurred, with bumped versions + embedding.
    assert len(writes) == 1
    w = writes[0]
    assert w["id"] == "rel-1"
    assert w["fact"] == "Alice works for Acme"
    assert w["fact_version"] == 2  # bumped from 1
    assert w["embedding_version"] == 2
    assert w["embedding_state"] == "ok"
    assert w["embedding"] == [0.1] * 4

    # Stream includes a relation-type progress event and the summary references it.
    parsed = [json.loads(line) for line in lines]
    rel_progress = [
        e for e in parsed if e.get("type") == "progress" and "relationTypeKey" in e
    ]
    assert rel_progress, "expected relationTypeKey progress event"
    assert rel_progress[-1]["relationTypeKey"] == "works_for"
    assert rel_progress[-1]["processed"] == 1
    assert rel_progress[-1]["total"] == 1

    summary = parsed[-1]
    assert summary["type"] == "summary"
    assert summary["relationTypes"] == [
        {"relationTypeKey": "works_for", "processed": 1, "failed": 0}
    ]
    assert summary["totalProcessed"] == 1
    assert summary["totalFailed"] == 0


@pytest.mark.asyncio
async def test_rebuild_non_semantic_relation_types_are_untouched():
    """Relation types without a factTemplate must not show up in the relation
    discovery query result and therefore must not receive writes.
    """
    provider = _make_provider()

    writes: list[dict] = []

    def matcher(query, params):
        if "MATCH (et:EntityType) RETURN et.key AS key ORDER" in query:
            return []
        if "WHERE rt.factTemplate IS NOT NULL RETURN rt.key" in query:
            return []  # no semantic relation types
        if "MATCH (rt:RelationType)" in query and "factTemplate IS NOT NULL" in query:
            return []
        if "RETURN count(r) AS total" in query:
            return [{"total": 0}]
        if "MATCH ()-[r:" in query and "{_id: $id}" in query:
            writes.append(params)
            return []
        if "MATCH (sq:SavedQuery)" in query:
            return []
        return []

    driver = _FakeDriver([])

    class _DispatchSession(_ScriptedSession):
        async def run(self, query: str, **params):
            self.calls.append((query, params))
            return _FakeResult(matcher(query, params))

    def _session_factory(**kwargs):
        sess = _DispatchSession([])
        driver.sessions.append(sess)

        @asynccontextmanager
        async def _cm():
            yield sess

        return _cm()

    driver.session = _session_factory

    with (
        patch(PROVIDER_PATH, return_value=provider),
        patch(RELATION_EMBED_PROVIDER_PATH, return_value=provider),
        patch(
            "ontoforge_server.modeling.service.drop_vector_index", new=AsyncMock()
        ),
        patch(
            "ontoforge_server.modeling.service.drop_relation_vector_index",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.drop_saved_query_vector_index",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_vector_indexes",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_saved_query_vector_index",
            new=AsyncMock(),
        ),
    ):
        lines = [
            line async for line in modeling_service.rebuild_embeddings(driver)
        ]

    assert writes == []
    summary = json.loads(lines[-1])
    assert summary["relationTypes"] == []


@pytest.mark.asyncio
async def test_rebuild_relation_embedding_failure_counted_and_job_continues():
    """When the provider returns None for a relation fact, mark failed and
    continue — do not abort the job.
    """
    provider = MagicMock()
    provider.dimensions = 4
    # First relation embed fails (returns None), second succeeds.
    provider.embed = AsyncMock(side_effect=[None, [0.1, 0.2, 0.3, 0.4]])

    writes: list[dict] = []

    def matcher(query, params):
        if "MATCH (et:EntityType) RETURN et.key AS key ORDER" in query:
            return []
        if "WHERE rt.factTemplate IS NOT NULL RETURN rt.key" in query:
            return [{"key": "works_for"}]
        if "MATCH (rt:RelationType)" in query and "factTemplate IS NOT NULL" in query:
            return [
                {
                    "key": "works_for",
                    "factTemplate": "{{ source.name }}->{{ target.name }}",
                    "properties": [],
                }
            ]
        if "RETURN count(r) AS total" in query:
            return [{"total": 2}]
        if "RETURN r._id AS id" in query:
            return [
                {
                    "id": "rel-1",
                    "rel_props": {"_factVersion": 1, "_embeddingVersion": 1},
                    "from_props": {"name": "A"},
                    "to_props": {"name": "B"},
                },
                {
                    "id": "rel-2",
                    "rel_props": {"_factVersion": 1, "_embeddingVersion": 1},
                    "from_props": {"name": "C"},
                    "to_props": {"name": "D"},
                },
            ]
        if "MATCH ()-[r:WORKS_FOR {_id: $id}]->()" in query:
            writes.append(params)
            return []
        if "MATCH (sq:SavedQuery)" in query:
            return []
        return []

    driver = _FakeDriver([])

    class _DispatchSession(_ScriptedSession):
        async def run(self, query: str, **params):
            self.calls.append((query, params))
            return _FakeResult(matcher(query, params))

    def _session_factory(**kwargs):
        sess = _DispatchSession([])
        driver.sessions.append(sess)

        @asynccontextmanager
        async def _cm():
            yield sess

        return _cm()

    driver.session = _session_factory

    with (
        patch(PROVIDER_PATH, return_value=provider),
        patch(RELATION_EMBED_PROVIDER_PATH, return_value=provider),
        patch(
            "ontoforge_server.modeling.service.drop_vector_index", new=AsyncMock()
        ),
        patch(
            "ontoforge_server.modeling.service.drop_relation_vector_index",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.drop_saved_query_vector_index",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_vector_indexes",
            new=AsyncMock(),
        ),
        patch(
            "ontoforge_server.modeling.service.ensure_saved_query_vector_index",
            new=AsyncMock(),
        ),
    ):
        lines = [
            line async for line in modeling_service.rebuild_embeddings(driver)
        ]

    # Both relations were written (even the failed one — _fact is still stored).
    assert len(writes) == 2
    # First write has no embedding + failed state.
    assert writes[0]["embedding"] is None
    assert writes[0]["embedding_state"] == "failed"
    # Second write has embedding + ok state.
    assert writes[1]["embedding"] == [0.1, 0.2, 0.3, 0.4]
    assert writes[1]["embedding_state"] == "ok"

    summary = json.loads(lines[-1])
    assert summary["relationTypes"] == [
        {"relationTypeKey": "works_for", "processed": 1, "failed": 1}
    ]
    assert summary["totalFailed"] >= 1


@pytest.mark.asyncio
async def test_rebuild_raises_when_provider_not_configured():
    from ontoforge_server.core.exceptions import ValidationError

    driver = _FakeDriver([])
    with patch(PROVIDER_PATH, return_value=None):
        with pytest.raises(ValidationError):
            async for _ in modeling_service.rebuild_embeddings(driver):
                pass
