"""Background reconcile worker for semantic-relation embeddings.

Per §6.4 of the relation-facts spec: periodically drain any relations whose
``_embeddingState`` is ``stale`` or ``failed``, re-render ``_fact`` against
current source + target entity data, re-embed, and persist. Failures are
retried with in-process exponential backoff; a relation that has failed more
than ``MAX_ATTEMPTS`` times is parked until the process restarts.

The worker is started from ``main.py``'s lifespan only when an embedding
provider is configured. No provider → no worker (mirrors how the
``rebuild_embeddings`` endpoint refuses to run without a provider).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from neo4j import AsyncDriver

from ontoforge_server.config import settings
from ontoforge_server.runtime.relation_embedding import (
    render_and_embed_relation_fact,
)
from ontoforge_server.runtime.service import to_upper_snake_case

logger = logging.getLogger(__name__)


# --- In-memory backoff state ---
#
# Keyed by relation `_id`. Value is `(attempts, last_attempt_epoch)`. No
# persistence across process restarts by design: a crashed / restarted process
# re-reads the DB and starts fresh, which is the desired "retry everything"
# behaviour after an outage.
BACKOFF_BASE_SECONDS = 30
BACKOFF_MAX_SECONDS = 3600
MAX_ATTEMPTS = 10


def _next_retry_delay(attempts: int) -> float:
    """Exponential backoff with a hard cap."""
    # `attempts` here is the count of failures seen so far. First retry after
    # one failure waits BASE * 2**1 = 2*BASE seconds.
    return min(BACKOFF_BASE_SECONDS * (2**attempts), BACKOFF_MAX_SECONDS)


def _should_skip_for_backoff(
    backoff: dict[str, tuple[int, float]],
    relation_id: str,
    now: float,
) -> bool:
    """Return True if the given failed relation should be deferred."""
    entry = backoff.get(relation_id)
    if entry is None:
        return False
    attempts, last_attempt = entry
    if attempts >= MAX_ATTEMPTS:
        # Parked. `drain_once` counts this as skipped up-front.
        return True
    return now < last_attempt + _next_retry_delay(attempts)


async def _fetch_relation_type_template(
    driver: AsyncDriver, relation_type_key: str
) -> tuple[str | None, bool]:
    """Return `(template_or_None, exists)` for the given relation type key.

    Exists=False means the type was deleted concurrently — the caller should
    skip the relation in that case.
    """
    async with driver.session() as session:
        result = await session.run(
            "MATCH (rt:RelationType {key: $key}) RETURN rt.factTemplate AS ft",
            key=relation_type_key,
        )
        record = await result.single()
    if record is None:
        return None, False
    return record["ft"], True


async def _fetch_relation_context(
    driver: AsyncDriver,
    relation_id: str,
    rel_type_upper: str,
) -> dict[str, Any] | None:
    """Fetch the relation + source + target props for reconciliation."""
    async with driver.session() as session:
        result = await session.run(
            f"""
            MATCH (from:_Entity)-[r:{rel_type_upper} {{_id: $id}}]->(to:_Entity)
            RETURN r {{.*}} AS rel_props,
                   from {{.*}} AS from_props,
                   to {{.*}} AS to_props
            """,
            id=relation_id,
        )
        record = await result.single()
    if record is None:
        return None
    rel_props = dict(record["rel_props"] or {})
    from_props = dict(record["from_props"] or {})
    to_props = dict(record["to_props"] or {})
    # Strip embeddings — they must never flow back into template rendering.
    rel_props.pop("_embedding", None)
    from_props.pop("_embedding", None)
    to_props.pop("_embedding", None)
    return {
        "rel_props": rel_props,
        "from_props": from_props,
        "to_props": to_props,
    }


async def _persist_success(
    driver: AsyncDriver,
    relation_id: str,
    rel_type_upper: str,
    fact: str,
    embedding: list[float],
    current_fact_version: int,
    current_embedding_version: int,
) -> None:
    new_fact_version = current_fact_version + 1
    new_embedding_version = current_embedding_version + 1
    async with driver.session() as session:
        await session.run(
            f"""
            MATCH ()-[r:{rel_type_upper} {{_id: $id}}]->()
            SET r._fact = $fact,
                r._factVersion = $fact_version,
                r._embedding = $embedding,
                r._embeddingState = 'ok',
                r._embeddingVersion = $embedding_version
            """,
            id=relation_id,
            fact=fact,
            fact_version=new_fact_version,
            embedding=embedding,
            embedding_version=new_embedding_version,
        )


async def _persist_failure(
    driver: AsyncDriver,
    relation_id: str,
    rel_type_upper: str,
) -> None:
    async with driver.session() as session:
        await session.run(
            f"""
            MATCH ()-[r:{rel_type_upper} {{_id: $id}}]->()
            SET r._embeddingState = 'failed'
            """,
            id=relation_id,
        )


async def _persist_template_cleared(
    driver: AsyncDriver,
    relation_id: str,
    rel_type_upper: str,
) -> None:
    """Template was cleared on the type — the relation is no longer semantic.

    Zero out the semantic fields and mark ok so the worker stops picking it up.
    ``_factVersion`` is set to null so the drainer's `_factVersion IS NOT NULL`
    predicate excludes this relation from future passes.
    """
    async with driver.session() as session:
        await session.run(
            f"""
            MATCH ()-[r:{rel_type_upper} {{_id: $id}}]->()
            SET r._fact = null,
                r._embedding = null,
                r._factVersion = null,
                r._embeddingState = 'ok'
            """,
            id=relation_id,
        )


async def drain_once(
    driver: AsyncDriver,
    batch_size: int,
    backoff: dict[str, tuple[int, float]],
    now: float | None = None,
) -> dict[str, int]:
    """Reconcile one batch of stale / failed semantic relations.

    Returns a dict of counters: ``processed``, ``failed``, ``skipped``. A
    ``skipped`` item is a failed relation still inside its backoff window or
    past ``MAX_ATTEMPTS``.
    """
    if now is None:
        now = time.monotonic()

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH ()-[r]-()
            WHERE r._factVersion IS NOT NULL
              AND r._embeddingState IN ['stale', 'failed']
            RETURN r._id AS id,
                   r._relationTypeKey AS rtKey,
                   r._embeddingState AS state,
                   coalesce(r._factVersion, 0) AS factVersion,
                   coalesce(r._embeddingVersion, 0) AS embeddingVersion
            ORDER BY r._embeddingState DESC
            LIMIT $batch_size
            """,
            batch_size=batch_size,
        )
        # Undirected MATCH returns each edge twice; dedupe by id.
        seen: set[str] = set()
        candidates: list[dict] = []
        async for record in result:
            rid = record["id"]
            if rid in seen:
                continue
            seen.add(rid)
            candidates.append(
                {
                    "id": rid,
                    "rtKey": record["rtKey"],
                    "state": record["state"],
                    "factVersion": record["factVersion"],
                    "embeddingVersion": record["embeddingVersion"],
                }
            )

    counters = {"processed": 0, "failed": 0, "skipped": 0}

    for item in candidates:
        relation_id = item["id"]
        rt_key = item["rtKey"]
        state = item["state"]

        # Backoff gating only applies to failed items. Stale is freshly marked
        # and should always be retried immediately.
        if state == "failed" and _should_skip_for_backoff(
            backoff, relation_id, now
        ):
            counters["skipped"] += 1
            continue

        if not rt_key:
            # Defensive: relation is missing its type key. Skip silently.
            counters["skipped"] += 1
            continue

        template, type_exists = await _fetch_relation_type_template(
            driver, rt_key
        )
        if not type_exists:
            # Relation type was deleted concurrently — skip.
            counters["skipped"] += 1
            continue

        rel_type_upper = to_upper_snake_case(rt_key)

        if template is None:
            # Template cleared: relation is no longer semantic.
            try:
                await _persist_template_cleared(
                    driver, relation_id, rel_type_upper
                )
                backoff.pop(relation_id, None)
                counters["processed"] += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Reconcile: failed to clear semantic fields for %s: %s",
                    relation_id,
                    exc,
                )
                counters["failed"] += 1
            continue

        context = await _fetch_relation_context(
            driver, relation_id, rel_type_upper
        )
        if context is None:
            # Relation disappeared between discovery and fetch.
            counters["skipped"] += 1
            continue

        try:
            result = await render_and_embed_relation_fact(
                template,
                context["from_props"],
                context["to_props"],
                context["rel_props"],
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Reconcile: render/embed raised for %s (%s): %s",
                relation_id,
                rt_key,
                exc,
            )
            # Treat as a failure with backoff.
            await _persist_failure(driver, relation_id, rel_type_upper)
            attempts, _ = backoff.get(relation_id, (0, 0.0))
            backoff[relation_id] = (attempts + 1, now)
            counters["failed"] += 1
            continue

        if result.embedding is None:
            # Provider returned None — mark failed and update backoff.
            await _persist_failure(driver, relation_id, rel_type_upper)
            attempts, _ = backoff.get(relation_id, (0, 0.0))
            backoff[relation_id] = (attempts + 1, now)
            counters["failed"] += 1
            continue

        await _persist_success(
            driver,
            relation_id,
            rel_type_upper,
            fact=result.fact,
            embedding=result.embedding,
            current_fact_version=item["factVersion"],
            current_embedding_version=item["embeddingVersion"],
        )
        backoff.pop(relation_id, None)
        counters["processed"] += 1

    return counters


async def run_reconcile_loop(driver: AsyncDriver) -> None:
    """Drain forever until cancelled.

    Exceptions inside the drainer are logged but never bubble out of the loop
    — the worker must survive transient DB / provider failures. Cancellation
    is re-raised so the lifespan can shut down cleanly.
    """
    backoff: dict[str, tuple[int, float]] = {}
    interval = settings.RECONCILE_INTERVAL_SECONDS
    batch_size = settings.RECONCILE_BATCH_SIZE

    logger.info(
        "Reconcile worker started (interval=%ss, batch=%s)",
        interval,
        batch_size,
    )
    try:
        while True:
            try:
                counters = await drain_once(driver, batch_size, backoff)
                if (
                    counters["processed"]
                    or counters["failed"]
                    or counters["skipped"]
                ):
                    logger.debug("Reconcile drain: %s", counters)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Reconcile drain failed: %s", exc)
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        logger.info("Reconcile worker cancelled")
        raise
