"""A real driver failure reaches the client as a structured error.

Unlike the rest of this directory, this module is deliberately adapter-specific:
inducing a genuine driver failure means putting the database into a state the
code does not expect, which can only be done past the port. It reproduces the
condition from issue #20 — a vector index whose dimensionality no longer
matches the configured embedding model — and asserts the response shape the
persistence port promises, rather than the bare 500 that condition used to
produce.

Requirements:
  - Neo4j running (default: bolt://localhost:7687)
  - Ollama running with embedding model (default: nomic-embed-text)

Run with: uv run pytest tests/integration/test_store_errors.py -v -m integration
"""

import asyncio

import pytest

from ontoforge_server.adapters.neo4j import ddl, get_driver
from ontoforge_server.adapters.neo4j.errors import open_session
from ontoforge_server.config import settings
from ontoforge_server.core.embedding import (
    close_embedding_provider,
    get_embedding_provider,
    init_embedding_provider,
)
from tests.integration.conftest import check_database, check_ollama_model

EMBEDDING_MODEL = "nomic-embed-text"

#: Any width the embedding model does not produce.
MISMATCHED_DIMENSIONS = 1024

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


@pytest.fixture
async def mismatched_entity_index():
    """Rebuild the shared entity vector index at the wrong width, then restore.

    Restoration runs even when the test fails: leaving a mismatched index
    behind would break every later semantic-search test in the suite.
    """
    index_name = ddl.ENTITY_VECTOR_INDEX_NAME
    driver = await get_driver()

    async with open_session(driver) as session:
        await session.run(f"DROP INDEX {index_name} IF EXISTS")
    await ddl.ensure_entity_vector_index(driver, MISMATCHED_DIMENSIONS)
    await _await_index_online(index_name)
    try:
        yield
    finally:
        async with open_session(driver) as session:
            await session.run(f"DROP INDEX {index_name} IF EXISTS")
        await ddl.ensure_entity_vector_index(
            driver, get_embedding_provider().dimensions
        )
        await _await_index_online(index_name)


@pytest.fixture
async def search_ontology(integration_client):
    resp = await integration_client.post(
        "/api/model/ontologies",
        json={"key": "store_error_test", "name": "Store Error Test"},
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
    return "store_error_test"


async def test_driver_failure_returns_a_structured_error(
    integration_client, search_ontology, mismatched_entity_index
):
    resp = await integration_client.get(
        f"/api/runtime/{search_ontology}/search/semantic",
        params={"q": "anything", "searchIn": "entities"},
    )

    assert resp.status_code == 500, resp.text
    body = resp.json()
    assert body["error"]["code"] == "STORAGE_ERROR"
    assert body["error"]["message"] == "A storage operation failed"
    assert body["error"]["details"]["errorId"]


async def test_driver_failure_leaks_no_storage_detail(
    integration_client, search_ontology, mismatched_entity_index
):
    """The response must not echo what the driver said (decision 010)."""
    resp = await integration_client.get(
        f"/api/runtime/{search_ontology}/search/semantic",
        params={"q": "anything", "searchIn": "entities"},
    )

    assert resp.status_code == 500
    text = resp.text
    for leak in (
        "eo4j",  # matches "Neo4j" and "neo4j"
        "Cypher",
        "entity_embedding",
        "dimensionality",
        "Vector index",
        "Internal Server Error",
        str(MISMATCHED_DIMENSIONS),
    ):
        assert leak not in text, f"driver detail '{leak}' reached the client"


async def test_semantic_search_works_again_after_the_index_is_restored(
    integration_client, search_ontology
):
    """Guards the fixture's restore step: a leftover bad index would hide here."""
    resp = await integration_client.post(
        f"/api/runtime/{search_ontology}/entities/person", json={"name": "Alice Chen"}
    )
    assert resp.status_code == 201, resp.text

    resp = await integration_client.get(
        f"/api/runtime/{search_ontology}/search/semantic",
        params={"q": "Alice", "searchIn": "entities"},
    )
    assert resp.status_code == 200, resp.text
