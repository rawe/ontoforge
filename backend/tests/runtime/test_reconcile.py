"""Unit tests for the background reconcile worker (M2 §6.4).

The tests use a scripted in-memory session/driver that simulates just enough
of the Cypher surface that ``reconcile.drain_once`` exercises:
- the discovery MATCH over stale/failed semantic relations
- the relation-type lookup for `factTemplate`
- the per-relation fetch of source/target props
- the persistence writes (success / failure / template-cleared)

Embedding is mocked at the relation_embedding module level so we never talk
to a real provider.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

# Capture the real asyncio.sleep so tests that patch reconcile.asyncio can
# still yield to the event loop without self-recursion.
_real_asyncio_sleep = asyncio.sleep
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ontoforge_server.runtime import reconcile
from ontoforge_server.runtime.reconcile import (
    BACKOFF_BASE_SECONDS,
    BACKOFF_MAX_SECONDS,
    MAX_ATTEMPTS,
    drain_once,
    run_reconcile_loop,
)


EMBED_PROVIDER_PATH = (
    "ontoforge_server.runtime.relation_embedding.get_embedding_provider"
)


# ---------------------------------------------------------------------------
# Fake driver / session infrastructure
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def __aiter__(self):
        async def gen():
            for r in self._rows:
                yield r

        return gen()

    async def single(self):
        return self._rows[0] if self._rows else None


class _FakeSession:
    """Dispatches `run()` calls to the owning FakeDriver's dispatcher."""

    def __init__(self, driver: "_FakeDriver"):
        self._driver = driver

    async def run(self, query: str, **params):
        rows = self._driver.dispatch(query, params)
        return _FakeResult(rows)


class _FakeDriver:
    """Scripted driver with a state model of relations + relation types.

    State:
      self.relation_types: {key: {"factTemplate": str | None, "exists": bool}}
      self.relations: {id: {
          "_relationTypeKey": str,
          "_embeddingState": "ok"|"stale"|"failed",
          "_factVersion": int | None,
          "_embeddingVersion": int,
          "_fact": str | None,
          "_embedding": list | None,
          "from": dict,
          "to": dict,
          "rel_props": dict,
      }}

    `dispatch(query, params)` routes queries to handlers based on distinctive
    substrings and mutates / reads the state.
    """

    def __init__(self):
        self.relation_types: dict[str, dict] = {}
        self.relations: dict[str, dict] = {}

    def session(self, **kwargs):
        @asynccontextmanager
        async def _cm():
            yield _FakeSession(self)

        return _cm()

    def dispatch(self, query: str, params: dict) -> list[dict]:
        # 1. Discovery query.
        if "WHERE r._factVersion IS NOT NULL" in query and "IN ['stale', 'failed']" in query:
            batch_size = params.get("batch_size", 50)
            rows = []
            for rid, rel in self.relations.items():
                if rel.get("_factVersion") is None:
                    continue
                if rel["_embeddingState"] not in ("stale", "failed"):
                    continue
                rows.append(
                    {
                        "id": rid,
                        "rtKey": rel["_relationTypeKey"],
                        "state": rel["_embeddingState"],
                        "factVersion": rel.get("_factVersion") or 0,
                        "embeddingVersion": rel.get("_embeddingVersion") or 0,
                    }
                )
            rows.sort(key=lambda r: r["state"], reverse=True)
            return rows[:batch_size]

        # 2. RelationType template lookup.
        if "MATCH (rt:RelationType {key: $key})" in query:
            rt = self.relation_types.get(params["key"])
            if rt is None:
                return []
            return [{"ft": rt.get("factTemplate")}]

        # 3. Relation context fetch.
        if "RETURN r {.*} AS rel_props" in query:
            rid = params["id"]
            rel = self.relations.get(rid)
            if rel is None:
                return []
            rel_props = dict(rel.get("rel_props", {}))
            rel_props.setdefault("_id", rid)
            return [
                {
                    "rel_props": rel_props,
                    "from_props": dict(rel.get("from", {})),
                    "to_props": dict(rel.get("to", {})),
                }
            ]

        # 4. Success persistence.
        if "SET r._fact = $fact" in query and "r._embeddingState = 'ok'" in query:
            rid = params["id"]
            rel = self.relations.get(rid)
            if rel is not None:
                rel["_fact"] = params["fact"]
                rel["_factVersion"] = params["fact_version"]
                rel["_embedding"] = params["embedding"]
                rel["_embeddingVersion"] = params["embedding_version"]
                rel["_embeddingState"] = "ok"
            return []

        # 5. Failure persistence.
        if "SET r._embeddingState = 'failed'" in query:
            rid = params["id"]
            rel = self.relations.get(rid)
            if rel is not None:
                rel["_embeddingState"] = "failed"
            return []

        # 6. Template-cleared persistence.
        if "SET r._fact = null" in query:
            rid = params["id"]
            rel = self.relations.get(rid)
            if rel is not None:
                rel["_fact"] = None
                rel["_embedding"] = None
                rel["_factVersion"] = None
                rel["_embeddingState"] = "ok"
            return []

        return []


def _mock_embedding_provider(embedding: list[float] | None):
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=embedding)
    return provider


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drain_once_no_stale_items_returns_zero():
    driver = _FakeDriver()
    # One semantic relation, but already ok.
    driver.relation_types["works_for"] = {
        "factTemplate": "{{ source.name }} works for {{ target.name }}"
    }
    driver.relations["r1"] = {
        "_relationTypeKey": "works_for",
        "_embeddingState": "ok",
        "_factVersion": 1,
        "_embeddingVersion": 1,
        "from": {"name": "Alice"},
        "to": {"name": "Acme"},
        "rel_props": {},
    }

    backoff: dict = {}
    counters = await drain_once(driver, batch_size=50, backoff=backoff, now=0.0)
    assert counters == {"processed": 0, "failed": 0, "skipped": 0}


@pytest.mark.asyncio
async def test_drain_once_processes_stale_item():
    driver = _FakeDriver()
    driver.relation_types["works_for"] = {
        "factTemplate": "{{ source.name }} works for {{ target.name }}"
    }
    driver.relations["r1"] = {
        "_relationTypeKey": "works_for",
        "_embeddingState": "stale",
        "_factVersion": 3,
        "_embeddingVersion": 3,
        "from": {"name": "Alice"},
        "to": {"name": "Acme"},
        "rel_props": {"role": "Engineer"},
    }

    provider = _mock_embedding_provider([0.1, 0.2, 0.3])
    with patch(EMBED_PROVIDER_PATH, return_value=provider):
        counters = await drain_once(driver, batch_size=50, backoff={}, now=0.0)

    assert counters == {"processed": 1, "failed": 0, "skipped": 0}
    rel = driver.relations["r1"]
    assert rel["_embeddingState"] == "ok"
    assert rel["_factVersion"] == 4  # bumped from 3
    assert rel["_embeddingVersion"] == 4
    assert rel["_fact"] == "Alice works for Acme"
    assert rel["_embedding"] == [0.1, 0.2, 0.3]


@pytest.mark.asyncio
async def test_drain_once_respects_batch_size():
    driver = _FakeDriver()
    driver.relation_types["works_for"] = {
        "factTemplate": "{{ source.name }} works for {{ target.name }}"
    }
    # Seed 5 stale items.
    for i in range(5):
        driver.relations[f"r{i}"] = {
            "_relationTypeKey": "works_for",
            "_embeddingState": "stale",
            "_factVersion": 1,
            "_embeddingVersion": 1,
            "from": {"name": f"A{i}"},
            "to": {"name": f"B{i}"},
            "rel_props": {},
        }

    provider = _mock_embedding_provider([0.0])
    with patch(EMBED_PROVIDER_PATH, return_value=provider):
        counters = await drain_once(driver, batch_size=3, backoff={}, now=0.0)

    assert counters["processed"] == 3
    assert counters["failed"] == 0
    # Two items remain stale.
    remaining = [
        r for r in driver.relations.values() if r["_embeddingState"] == "stale"
    ]
    assert len(remaining) == 2


@pytest.mark.asyncio
async def test_drain_once_handles_failed_with_backoff():
    driver = _FakeDriver()
    driver.relation_types["works_for"] = {
        "factTemplate": "{{ source.name }} -> {{ target.name }}"
    }
    driver.relations["r1"] = {
        "_relationTypeKey": "works_for",
        "_embeddingState": "stale",
        "_factVersion": 1,
        "_embeddingVersion": 1,
        "from": {"name": "A"},
        "to": {"name": "B"},
        "rel_props": {},
    }

    provider = _mock_embedding_provider(None)  # always fails
    backoff: dict = {}

    # First drain: item goes from stale → failed and is recorded in backoff.
    with patch(EMBED_PROVIDER_PATH, return_value=provider):
        counters = await drain_once(driver, batch_size=50, backoff=backoff, now=0.0)
    assert counters["failed"] == 1
    assert counters["skipped"] == 0
    assert driver.relations["r1"]["_embeddingState"] == "failed"
    assert "r1" in backoff
    assert backoff["r1"][0] == 1

    # Second drain immediately: the now-failed item should be skipped (still
    # inside its backoff window).
    with patch(EMBED_PROVIDER_PATH, return_value=provider):
        counters = await drain_once(driver, batch_size=50, backoff=backoff, now=1.0)
    assert counters == {"processed": 0, "failed": 0, "skipped": 1}
    # Still only 1 attempt recorded.
    assert backoff["r1"][0] == 1

    # Third drain with time advanced past the backoff window: retry allowed.
    far_future = BACKOFF_BASE_SECONDS * 4 + 100  # well past first retry delay
    with patch(EMBED_PROVIDER_PATH, return_value=provider):
        counters = await drain_once(
            driver, batch_size=50, backoff=backoff, now=far_future
        )
    # Still failed, but another attempt was tried → attempts bumped.
    assert counters["failed"] == 1
    assert backoff["r1"][0] == 2


@pytest.mark.asyncio
async def test_drain_once_skips_after_max_attempts():
    driver = _FakeDriver()
    driver.relation_types["works_for"] = {
        "factTemplate": "{{ source.name }}"
    }
    driver.relations["r1"] = {
        "_relationTypeKey": "works_for",
        "_embeddingState": "failed",
        "_factVersion": 1,
        "_embeddingVersion": 1,
        "from": {"name": "A"},
        "to": {"name": "B"},
        "rel_props": {},
    }
    # Pre-load the backoff map past MAX_ATTEMPTS.
    backoff = {"r1": (MAX_ATTEMPTS, 0.0)}

    provider = _mock_embedding_provider([0.1])
    with patch(EMBED_PROVIDER_PATH, return_value=provider):
        # Use a far-future `now` to rule out backoff-window gating alone.
        counters = await drain_once(
            driver,
            batch_size=50,
            backoff=backoff,
            now=BACKOFF_MAX_SECONDS * 10,
        )
    assert counters == {"processed": 0, "failed": 0, "skipped": 1}
    # Relation state unchanged.
    assert driver.relations["r1"]["_embeddingState"] == "failed"


@pytest.mark.asyncio
async def test_drain_once_clears_state_when_template_null():
    driver = _FakeDriver()
    # Relation type still exists but its template was cleared.
    driver.relation_types["works_for"] = {"factTemplate": None}
    driver.relations["r1"] = {
        "_relationTypeKey": "works_for",
        "_embeddingState": "stale",
        "_factVersion": 2,
        "_embeddingVersion": 2,
        "_fact": "Alice works for Acme",
        "_embedding": [0.1, 0.2],
        "from": {"name": "Alice"},
        "to": {"name": "Acme"},
        "rel_props": {},
    }

    counters = await drain_once(driver, batch_size=50, backoff={}, now=0.0)
    assert counters == {"processed": 1, "failed": 0, "skipped": 0}
    rel = driver.relations["r1"]
    assert rel["_embeddingState"] == "ok"
    assert rel["_fact"] is None
    assert rel["_embedding"] is None
    assert rel["_factVersion"] is None


@pytest.mark.asyncio
async def test_run_reconcile_loop_cancellation():
    """The loop must exit cleanly on cancellation."""
    driver = _FakeDriver()

    # Short-circuit the inter-iteration sleep so the loop doesn't burn time
    # in CI. We patch the reconcile module's `asyncio` binding so the sleep
    # yields to the event loop (letting cancellation land) without actually
    # waiting. The test itself still uses the real `asyncio.sleep`.
    class _FakeAsyncio:
        CancelledError = asyncio.CancelledError

        @staticmethod
        async def sleep(_s):
            # Yield to the event loop so task.cancel() can land, but don't
            # actually wait — use asyncio's real zero-delay sleep by reaching
            # out through the module path before it was patched.
            await _real_asyncio_sleep(0)

    with (
        patch(EMBED_PROVIDER_PATH, return_value=_mock_embedding_provider([0.1])),
        patch.object(reconcile, "asyncio", _FakeAsyncio),
    ):
        task = asyncio.create_task(run_reconcile_loop(driver))
        # Give the loop a chance to enter its first iteration.
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_run_reconcile_loop_absorbs_drainer_exceptions():
    """A raised exception inside `drain_once` must not kill the loop."""
    driver = _FakeDriver()

    calls = {"n": 0}

    async def flaky_drain(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return {"processed": 0, "failed": 0, "skipped": 0}

    class _FakeAsyncio:
        CancelledError = asyncio.CancelledError

        @staticmethod
        async def sleep(_s):
            # Yield to the event loop so task.cancel() can land, but don't
            # actually wait — use asyncio's real zero-delay sleep by reaching
            # out through the module path before it was patched.
            await _real_asyncio_sleep(0)

    with (
        patch("ontoforge_server.runtime.reconcile.drain_once", flaky_drain),
        patch.object(reconcile, "asyncio", _FakeAsyncio),
    ):
        task = asyncio.create_task(run_reconcile_loop(driver))
        # Yield enough turns for both iterations to run.
        for _ in range(5):
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert calls["n"] >= 2
