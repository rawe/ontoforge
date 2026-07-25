"""Driver failures are translated at the persistence-port boundary.

Port contract rule 4 (``core/ports.py``): driver exceptions never cross the
port. These tests pin the translation itself, the fact that store methods are
covered by it, and the HTTP shape the client ends up with.
"""

import logging

import pytest
from neo4j.exceptions import CypherTypeError, Neo4jError, ServiceUnavailable

from ontoforge_server.adapters.neo4j import runtime_queries
from ontoforge_server.adapters.neo4j.errors import open_session
from ontoforge_server.adapters.neo4j.runtime_store import Neo4jRuntimeStore
from ontoforge_server.core.exceptions import NotFoundError, StoreError

# The message the reproduction in issue #20 produced. Nothing from it may
# reach the client: it names the vendor, the physical index, and the driver's
# own error code (decision 010).
DRIVER_MESSAGE = (
    "Vector index 'entity_embedding' has a configured dimensionality of 1024, "
    "but the provided vector has dimension 768."
)


# ---------------------------------------------------------------------------
# The translation itself
# ---------------------------------------------------------------------------


async def test_server_side_driver_error_becomes_store_error(mock_driver):
    with pytest.raises(StoreError) as excinfo:
        async with open_session(mock_driver):
            raise CypherTypeError(DRIVER_MESSAGE)

    assert isinstance(excinfo.value.__cause__, Neo4jError)
    assert excinfo.value.error_id


async def test_client_side_driver_error_becomes_store_error(mock_driver):
    """``DriverError`` is a separate hierarchy from ``Neo4jError``."""
    with pytest.raises(StoreError):
        async with open_session(mock_driver):
            raise ServiceUnavailable("Unable to retrieve routing information")


async def test_store_error_message_leaks_nothing_from_the_driver(mock_driver):
    with pytest.raises(StoreError) as excinfo:
        async with open_session(mock_driver):
            raise CypherTypeError(DRIVER_MESSAGE)

    message = str(excinfo.value)
    assert message == "A storage operation failed"
    for leak in ("neo4j", "Neo4j", "Vector index", "entity_embedding", "1024"):
        assert leak not in message


async def test_domain_exceptions_pass_through_untouched(mock_driver):
    """Only driver exceptions are translated; domain errors keep their status."""
    with pytest.raises(NotFoundError):
        async with open_session(mock_driver):
            raise NotFoundError("Entity not found")


async def test_ordinary_bugs_are_not_swallowed(mock_driver):
    with pytest.raises(TypeError):
        async with open_session(mock_driver):
            raise TypeError("unsupported operand")


async def test_driver_failure_is_logged_with_the_error_id(mock_driver, caplog):
    with caplog.at_level(logging.ERROR):
        with pytest.raises(StoreError) as excinfo:
            async with open_session(mock_driver):
                raise CypherTypeError(DRIVER_MESSAGE)

    record = next(r for r in caplog.records if "Storage failure" in r.message)
    assert excinfo.value.error_id in record.getMessage()
    # The detail withheld from the client must be present server-side.
    assert record.exc_info is not None
    assert DRIVER_MESSAGE in str(record.exc_info[1])


# ---------------------------------------------------------------------------
# Store methods are covered by it
# ---------------------------------------------------------------------------


async def test_store_method_raises_store_error(mock_driver, monkeypatch):
    async def _raise(*args, **kwargs):
        raise CypherTypeError(DRIVER_MESSAGE)

    monkeypatch.setattr(runtime_queries, "semantic_search", _raise)
    store = Neo4jRuntimeStore(mock_driver)

    with pytest.raises(StoreError):
        await store.semantic_search_all([0.1] * 768, limit=5, min_score=None)


def test_no_adapter_module_opens_an_untranslated_session():
    """``errors.open_session`` is the adapter's only door to the database.

    A new store method written as ``self._driver.session()`` would silently
    reopen the gap this fix closed, and no behavioural test would catch it.
    """
    from pathlib import Path

    import ontoforge_server.adapters.neo4j as adapter_package

    adapter_dir = Path(adapter_package.__file__).parent
    offenders = [
        path.name
        for path in sorted(adapter_dir.glob("*.py"))
        if path.name != "errors.py" and "driver.session()" in path.read_text()
    ]
    assert offenders == []


# ---------------------------------------------------------------------------
# What the client receives
# ---------------------------------------------------------------------------


async def test_saved_query_validation_does_not_reclassify_a_storage_failure(
    client, monkeypatch
):
    """Saved-query validation wraps unexpected errors as 422 — but not this one.

    Reporting a storage failure as a query-validation error would blame the
    submitted query and drop the error id the adapter logged.
    """
    from ontoforge_server.adapters.neo4j import modeling_queries

    async def _get_ontology_by_key(session, key):
        return {"ontologyId": "ont-1", "key": key, "name": "Test"}

    async def _raise(*args, **kwargs):
        raise CypherTypeError(DRIVER_MESSAGE)

    monkeypatch.setattr(
        modeling_queries, "get_ontology_by_key", _get_ontology_by_key
    )
    monkeypatch.setattr(runtime_queries, "get_full_schema", _raise)

    response = await client.put(
        "/api/model/ontologies/test_ontology/saved-queries/q1",
        json={
            "name": "Q1",
            "description": "Storage failure path",
            "steps": [{"name": "s1", "type": "oql", "oql": "MATCH (p:person) RETURN p"}],
        },
    )

    assert response.status_code == 500, response.text
    assert response.json()["error"]["code"] == "STORAGE_ERROR"


async def test_api_returns_structured_500_for_a_driver_failure(client, monkeypatch):
    async def _raise(*args, **kwargs):
        raise CypherTypeError(DRIVER_MESSAGE)

    monkeypatch.setattr(runtime_queries, "get_full_schema", _raise)

    response = await client.get("/api/runtime/test_ontology/schema")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "STORAGE_ERROR"
    assert body["error"]["message"] == "A storage operation failed"
    assert body["error"]["details"]["errorId"]
    # Not a bare 500 body, and not the driver's text.
    assert "Internal Server Error" not in response.text
    assert "entity_embedding" not in response.text
    assert "eo4j" not in response.text
