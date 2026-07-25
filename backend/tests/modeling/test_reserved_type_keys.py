"""Type keys reserved by the storage adapter are rejected at creation time.

The reserved sets are declared by the adapter (its schema objects' physical
names) and reach the modeling service through the persistence port as plain
type keys. See issue #19.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.adapters.neo4j import ddl

REPO = "ontoforge_server.adapters.neo4j.modeling_queries"

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

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


# --- Adapter-declared sets ---


def test_reserved_entity_type_keys_match_schema_labels():
    assert ddl.reserved_entity_type_keys() == set(RESERVED_ENTITY_TYPE_KEYS)


def test_reserved_relation_type_keys_match_schema_relationship_types():
    assert ddl.reserved_relation_type_keys() == set(RESERVED_RELATION_TYPE_KEYS)


def test_reserved_entity_type_keys_round_trip_to_schema_labels():
    """Every reserved key must actually produce a schema label, or it guards nothing."""
    produced = {ddl._to_pascal_case(k) for k in ddl.reserved_entity_type_keys()}
    assert produced == set(ddl.SCHEMA_LABELS)


def test_reserved_relation_type_keys_round_trip_to_schema_relationship_types():
    produced = {k.upper() for k in ddl.reserved_relation_type_keys()}
    assert produced == set(ddl.SCHEMA_RELATIONSHIP_TYPES)


# --- Entity types ---


@pytest.mark.asyncio
@pytest.mark.parametrize("key", RESERVED_ENTITY_TYPE_KEYS)
async def test_create_entity_type_rejects_reserved_key(client, key):
    create = AsyncMock()
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", create),
    ):
        resp = await client.post(
            "/api/model/entity-types",
            json={"key": key, "displayName": "Injected"},
        )
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert key in error["message"]
    assert "reserved" in error["message"]
    create.assert_not_awaited()


@pytest.mark.asyncio
async def test_reserved_entity_type_message_names_no_vendor(client):
    """Decision 010: no storage vendor or physical name in the public surface."""
    with patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None):
        resp = await client.post(
            "/api/model/entity-types",
            json={"key": "ontology", "displayName": "Injected"},
        )
    message = resp.json()["error"]["message"]
    assert "neo4j" not in message.lower()
    assert "label" not in message.lower()
    assert "Ontology" not in message  # the physical label never leaks


@pytest.mark.asyncio
async def test_create_entity_type_allows_near_miss_key(client):
    """Only exact collisions are reserved — 'ontology_note' is a fine key."""
    et_data = {
        "entityTypeId": "et-1",
        "key": "ontology_note",
        "displayName": "Ontology Note",
        "description": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", new_callable=AsyncMock, return_value=et_data),
    ):
        resp = await client.post(
            "/api/model/entity-types",
            json={"key": "ontology_note", "displayName": "Ontology Note"},
        )
    assert resp.status_code == 201


# --- Relation types ---


@pytest.mark.asyncio
@pytest.mark.parametrize("key", RESERVED_RELATION_TYPE_KEYS)
async def test_create_relation_type_rejects_reserved_key(client, key):
    create = AsyncMock()
    with (
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value={"key": "person"}),
        patch(f"{REPO}.create_relation_type", create),
    ):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": key,
                "displayName": "Injected",
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "person",
            },
        )
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert key in error["message"]
    assert "reserved" in error["message"]
    create.assert_not_awaited()


@pytest.mark.asyncio
async def test_reserved_relation_type_message_names_no_vendor(client):
    with (
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value={"key": "person"}),
    ):
        resp = await client.post(
            "/api/model/relation-types",
            json={
                "key": "has_property",
                "displayName": "Injected",
                "sourceEntityTypeKey": "person",
                "targetEntityTypeKey": "person",
            },
        )
    message = resp.json()["error"]["message"]
    assert "neo4j" not in message.lower()
    assert "HAS_PROPERTY" not in message  # the physical type never leaks


# --- Startup detection of pre-existing collisions ---


@pytest.mark.asyncio
async def test_startup_warns_about_reserved_keys_already_stored(mock_driver, caplog):
    from ontoforge_server.adapters.neo4j.modeling_store import Neo4jModelingStore
    from ontoforge_server.core import ports
    from ontoforge_server.main import _warn_about_reserved_type_keys_in_use

    collisions = [
        {"kind": "entityType", "key": "ontology"},
        {"kind": "relationType", "key": "has_property"},
    ]
    with (
        patch.object(ports, "_modeling_store", Neo4jModelingStore(mock_driver)),
        patch(
            f"{REPO}.find_reserved_type_keys_in_use",
            new_callable=AsyncMock,
            return_value=collisions,
        ),
        caplog.at_level("WARNING"),
    ):
        await _warn_about_reserved_type_keys_in_use()

    assert "ontology" in caplog.text
    assert "has_property" in caplog.text
    assert "reserved key" in caplog.text


@pytest.mark.asyncio
async def test_startup_silent_without_collisions(mock_driver, caplog):
    from ontoforge_server.adapters.neo4j.modeling_store import Neo4jModelingStore
    from ontoforge_server.core import ports
    from ontoforge_server.main import _warn_about_reserved_type_keys_in_use

    with (
        patch.object(ports, "_modeling_store", Neo4jModelingStore(mock_driver)),
        patch(
            f"{REPO}.find_reserved_type_keys_in_use",
            new_callable=AsyncMock,
            return_value=[],
        ),
        caplog.at_level("WARNING"),
    ):
        await _warn_about_reserved_type_keys_in_use()

    assert caplog.text == ""


# --- Import ---


@pytest.mark.asyncio
async def test_import_rejects_reserved_entity_type_key(client):
    create = AsyncMock()
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", create),
    ):
        resp = await client.post(
            "/api/model/import",
            json={
                "formatVersion": "3.0",
                "entityTypes": [{"key": "ontology", "displayName": "Injected"}],
                "relationTypes": [],
                "ontologies": [],
            },
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "ontology" in resp.json()["error"]["message"]
    create.assert_not_awaited()


@pytest.mark.asyncio
async def test_import_rejects_reserved_relation_type_key(client):
    create = AsyncMock()
    et_data = {
        "entityTypeId": "et-1",
        "key": "person",
        "displayName": "Person",
        "description": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    with (
        patch(f"{REPO}.get_entity_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_entity_type", new_callable=AsyncMock, return_value=et_data),
        patch(f"{REPO}.get_relation_type_by_key", new_callable=AsyncMock, return_value=None),
        patch(f"{REPO}.create_relation_type", create),
    ):
        resp = await client.post(
            "/api/model/import",
            json={
                "formatVersion": "3.0",
                "entityTypes": [{"key": "person", "displayName": "Person"}],
                "relationTypes": [
                    {
                        "key": "has_property",
                        "displayName": "Injected",
                        "fromEntityTypeKey": "person",
                        "toEntityTypeKey": "person",
                        "properties": [],
                    },
                ],
                "ontologies": [],
            },
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "has_property" in resp.json()["error"]["message"]
    create.assert_not_awaited()
