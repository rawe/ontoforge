"""Conformance test: reserved type keys are rejected by the modeling API.

Covers the reproduction in issue #19 — a colliding type key was accepted,
instance data under it counterfeited a schema object, and the modeling API
then returned 500. The rejection is required behaviour of any adapter: each
one declares its own reserved sets through the persistence port.

Requirements:
  - A database reachable through the configured adapter

Run with: uv run pytest tests/integration/test_reserved_type_keys.py -v -m integration
"""

import pytest

from tests.integration.conftest import check_database

pytestmark = pytest.mark.integration

RESERVED_ENTITY_TYPE_KEYS = [
    "ontology",
    "entity_type",
    "relation_type",
    "property_definition",
    "ai_agent_config",
    "saved_query",
]

RESERVED_RELATION_TYPE_KEYS = [
    "includes_type",
    "has_property",
    "relates_from",
    "relates_to",
    "has_ai_agent",
    "has_saved_query",
]


@pytest.fixture(scope="module")
async def services_available():
    if not await check_database():
        pytest.skip("Database not available")


@pytest.fixture
async def demo_ontology(services_available, integration_client):
    """An ontology plus one ordinary entity type, matching the issue's setup."""
    client = integration_client
    resp = await client.post(
        "/api/model/ontologies",
        json={"key": "demo", "name": "Demo Ontology"},
    )
    assert resp.status_code == 201, resp.text
    resp = await client.post(
        "/api/model/entity-types",
        json={"key": "person", "displayName": "Person"},
    )
    assert resp.status_code == 201, resp.text
    return client


@pytest.mark.parametrize("key", RESERVED_ENTITY_TYPE_KEYS)
async def test_reserved_entity_type_key_rejected(demo_ontology, key):
    resp = await demo_ontology.post(
        "/api/model/entity-types",
        json={"key": key, "displayName": "Injected"},
    )
    assert resp.status_code == 422, resp.text
    error = resp.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert key in error["message"]

    # Not persisted: it must not appear in the type list.
    listed = await demo_ontology.get("/api/model/entity-types")
    assert listed.status_code == 200
    assert key not in [et["key"] for et in listed.json()]


@pytest.mark.parametrize("key", RESERVED_RELATION_TYPE_KEYS)
async def test_reserved_relation_type_key_rejected(demo_ontology, key):
    resp = await demo_ontology.post(
        "/api/model/relation-types",
        json={
            "key": key,
            "displayName": "Injected",
            "sourceEntityTypeKey": "person",
            "targetEntityTypeKey": "person",
        },
    )
    assert resp.status_code == 422, resp.text
    error = resp.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert key in error["message"]

    listed = await demo_ontology.get("/api/model/relation-types")
    assert listed.status_code == 200
    assert key not in [rt["key"] for rt in listed.json()]


async def test_modeling_api_stays_healthy_after_rejected_keys(demo_ontology):
    """The issue's failure mode: modeling reads returned 500 once a key collided."""
    client = demo_ontology
    for key in RESERVED_ENTITY_TYPE_KEYS:
        await client.post(
            "/api/model/entity-types",
            json={"key": key, "displayName": "Injected"},
        )
        # The runtime write from the reproduction is unreachable — the type
        # never exists, so instance creation 404s rather than counterfeiting
        # a schema object.
        instance = await client.post(
            f"/api/runtime/demo/entities/{key}",
            json={"key": "injected", "name": "Injected"},
        )
        assert instance.status_code >= 400, instance.text

    ontologies = await client.get("/api/model/ontologies")
    assert ontologies.status_code == 200
    assert [o["key"] for o in ontologies.json()] == ["demo"]

    export = await client.get("/api/model/export")
    assert export.status_code == 200
    assert [et["key"] for et in export.json()["entityTypes"]] == ["person"]


async def test_pre_existing_collisions_are_detectable(demo_ontology):
    """A database written before the check still names its collided types."""
    from ontoforge_server.adapters.neo4j import modeling_queries
    from ontoforge_server.core import ports

    store = ports.get_modeling_store()
    assert await store.find_reserved_type_keys_in_use() == []

    # Plant what a pre-fix build would have written: the service now refuses,
    # so go straight at the adapter's own query function.
    async with store._driver.session() as session:
        await modeling_queries.create_entity_type(
            session, "et-collided", "ontology", "Injected", None
        )

    collisions = await store.find_reserved_type_keys_in_use()
    assert {"kind": "entityType", "key": "ontology"} in collisions

    # An instance of the collided type carries the schema label too; the
    # detection read must not mistake it for a second collided type.
    async with store._driver.session() as session:
        await session.run("CREATE (n:_Entity:Ontology {key: 'injected'})")
    assert await store.find_reserved_type_keys_in_use() == collisions


async def test_import_rejects_reserved_keys(services_available, integration_client):
    resp = await integration_client.post(
        "/api/model/import",
        json={
            "formatVersion": "3.0",
            "entityTypes": [{"key": "ontology", "displayName": "Injected"}],
            "relationTypes": [],
            "ontologies": [],
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    listed = await integration_client.get("/api/model/entity-types")
    assert listed.json() == []
