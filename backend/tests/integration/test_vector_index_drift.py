"""A pre-existing vector index whose width no longer matches the model.

Reproduces issue #21 against a real database: a vector index fixes its width
at creation, so changing the embedding model leaves indexes that reject every
vector the new model produces. `CREATE ... IF NOT EXISTS` never notices, and
the index stays ONLINE — so the failed-index check does not either.

Like `test_store_errors`, this module reaches past the persistence port: the
condition can only be induced by putting the database into a state the code
does not produce on its own. What it asserts is port-level behaviour — startup
reports the drift and changes nothing; the rebuild operation repairs it.

Requirements:
  - Neo4j running (default: bolt://localhost:7687)
  - Ollama running with embedding model (default: nomic-embed-text)

Run with: uv run pytest tests/integration/test_vector_index_drift.py -v -m integration
"""

import asyncio
import logging

import pytest

from ontoforge_server.adapters.neo4j import ddl, get_driver
from ontoforge_server.adapters.neo4j.errors import open_session
from ontoforge_server.config import settings
from ontoforge_server.core import ports
from ontoforge_server.core.embedding import (
    close_embedding_provider,
    get_embedding_provider,
    init_embedding_provider,
)
from tests.integration.conftest import check_database, check_ollama_model

EMBEDDING_MODEL = "nomic-embed-text"

#: Any width the embedding model does not produce.
MISMATCHED_DIMENSIONS = 1024

ONTOLOGY_KEY = "index_drift_test"

#: The two index-creation paths the reconcile has to be wired into: the
#: cross-type index and the per-entity-type one.
DRIFTING_INDEXES = (ddl.ENTITY_VECTOR_INDEX_NAME, "person_embedding")

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
async def services_available():
    if not await check_database():
        pytest.skip("Neo4j not available")
    if not await check_ollama_model(EMBEDDING_MODEL):
        pytest.skip(f"Ollama not available or model '{EMBEDDING_MODEL}' not pulled")


@pytest.fixture(autouse=True)
async def _configure_embedding(services_available):
    original = settings.EMBEDDING_PROVIDER
    settings.EMBEDDING_PROVIDER = "ollama"
    await init_embedding_provider()
    yield
    await close_embedding_provider()
    settings.EMBEDDING_PROVIDER = original


async def _await_index_online(index_name: str, timeout: float = 15.0) -> None:
    driver = await get_driver()
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        async with open_session(driver) as session:
            result = await session.run(
                "SHOW VECTOR INDEXES YIELD name, state WHERE name = $name RETURN state",
                name=index_name,
            )
            record = await result.single()
        if record and record["state"] == "ONLINE":
            return
        await asyncio.sleep(0.2)
    raise AssertionError(f"Index {index_name} did not come online within {timeout}s")


async def _index_dimensions(index_name: str) -> int | None:
    return await ddl._existing_vector_index_dimensions(await get_driver(), index_name)


async def _rebuild_at(index_name: str, dimensions: int) -> None:
    driver = await get_driver()
    async with open_session(driver) as session:
        await session.run(f"DROP INDEX {index_name} IF EXISTS")
    if index_name == ddl.ENTITY_VECTOR_INDEX_NAME:
        await ddl.ensure_entity_vector_index(driver, dimensions)
    else:
        await ddl.create_vector_index(
            driver, index_name.removesuffix("_embedding"), dimensions
        )
    await _await_index_online(index_name)


@pytest.fixture
async def drift_ontology(integration_client):
    """An ontology with one entity type, one entity, and its indexes at 768."""
    resp = await integration_client.post(
        "/api/model/ontologies",
        json={"key": ONTOLOGY_KEY, "name": "Index Drift Test"},
    )
    assert resp.status_code == 201, resp.text

    resp = await integration_client.post(
        "/api/model/entity-types", json={"key": "person", "displayName": "Person"}
    )
    assert resp.status_code == 201, resp.text
    entity_type_id = resp.json()["entityTypeId"]

    resp = await integration_client.post(
        f"/api/model/entity-types/{entity_type_id}/properties",
        json={
            "key": "name",
            "displayName": "Name",
            "dataType": "string",
            "required": True,
        },
    )
    assert resp.status_code == 201, resp.text

    resp = await integration_client.post(
        f"/api/runtime/{ONTOLOGY_KEY}/entities/person", json={"name": "Alice Chen"}
    )
    assert resp.status_code == 201, resp.text
    return ONTOLOGY_KEY


@pytest.fixture
async def drifted_indexes(drift_ontology):
    """Rebuild both indexes at the wrong width, then restore.

    Restoration runs even when the test fails: leaving a mismatched index
    behind would break every later semantic-search test in the suite.
    """
    for index_name in DRIFTING_INDEXES:
        await _rebuild_at(index_name, MISMATCHED_DIMENSIONS)
    try:
        yield drift_ontology
    finally:
        width = get_embedding_provider().dimensions
        for index_name in DRIFTING_INDEXES:
            if await _index_dimensions(index_name) != width:
                await _rebuild_at(index_name, width)


async def test_startup_reports_drift_and_changes_nothing(drifted_indexes, caplog):
    """The defect itself: startup used to log 'ensured' for every one of these."""
    provider = get_embedding_provider()

    with caplog.at_level(logging.WARNING, logger="ontoforge_server.adapters.neo4j.ddl"):
        await ports.ensure_semantic_indexes(provider.dimensions)

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == len(DRIFTING_INDEXES), warnings
    reported = "\n".join(warnings)
    assert "entity type 'person'" in reported
    assert "search across all entity types" in reported
    assert str(MISMATCHED_DIMENSIONS) in reported
    assert str(provider.dimensions) in reported
    assert "/api/model/rebuild-embeddings" in reported

    for index_name in DRIFTING_INDEXES:
        assert await _index_dimensions(index_name) == MISMATCHED_DIMENSIONS


async def test_startup_warning_names_no_vendor_or_physical_index(
    drifted_indexes, caplog
):
    """Decision 010: operator-facing text stays in API vocabulary."""
    with caplog.at_level(logging.WARNING, logger="ontoforge_server.adapters.neo4j.ddl"):
        await ports.ensure_semantic_indexes(get_embedding_provider().dimensions)

    reported = "\n".join(r.getMessage() for r in caplog.records)
    for leak in ("eo4j", "Cypher", "VECTOR INDEX", "Person", *DRIFTING_INDEXES):
        assert leak not in reported, f"'{leak}' leaked into the warning"


async def test_rebuild_repairs_the_drift_and_semantic_search_works_again(
    integration_client, drifted_indexes
):
    """The remedy the warning names has to be the one that works."""
    resp = await integration_client.get(
        f"/api/runtime/{drifted_indexes}/search/semantic",
        params={"q": "Alice", "searchIn": "entities"},
    )
    assert resp.status_code == 500, "expected the drift to break search first"

    resp = await integration_client.post("/api/model/rebuild-embeddings")
    assert resp.status_code == 200, resp.text

    width = get_embedding_provider().dimensions
    for index_name in DRIFTING_INDEXES:
        await _await_index_online(index_name)
        assert await _index_dimensions(index_name) == width

    resp = await integration_client.get(
        f"/api/runtime/{drifted_indexes}/search/semantic",
        params={"q": "Alice", "searchIn": "entities"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] > 0
