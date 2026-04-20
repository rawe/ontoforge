"""Unit tests verifying Phase 0 system properties flow through writes."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from ontoforge_server.runtime import repository


@pytest.mark.asyncio
async def test_create_entity_sets_phase0_system_properties():
    session = AsyncMock()
    record = {
        "entity": {
            "_id": "e1",
            "_entityTypeKey": "person",
            "_groupId": "default",
            "_embeddingState": "ok",
            "_embeddingVersion": 1,
            "_validAt": None,
            "_invalidAt": None,
            "name": "Alice",
        }
    }
    session.run = AsyncMock()
    session.run.return_value.single = AsyncMock(return_value=record)

    result = await repository.create_entity(
        session=session,
        entity_type_key="person",
        pascal_label="Person",
        entity_id="e1",
        properties={"name": "Alice"},
        embedding=[0.1, 0.2],
    )

    # Verify both the Cypher statement and the bound parameters.
    call = session.run.call_args
    query = call.args[0]
    kwargs = call.kwargs
    assert "_groupId" in query
    assert "_embeddingState" in query
    assert "_embeddingVersion: 1" in query
    assert kwargs["group_id"] == "default"
    assert kwargs["embedding_state"] == "ok"

    # The returned entity surfaces the Phase 0 fields.
    assert result["_groupId"] == "default"
    assert result["_embeddingState"] == "ok"
    assert result["_embeddingVersion"] == 1


@pytest.mark.asyncio
async def test_create_entity_without_embedding_marks_failed():
    session = AsyncMock()
    session.run = AsyncMock()
    session.run.return_value.single = AsyncMock(return_value={
        "entity": {
            "_id": "e1",
            "_entityTypeKey": "person",
            "_groupId": "default",
            "_embeddingState": "failed",
            "_embeddingVersion": 1,
        }
    })

    await repository.create_entity(
        session=session,
        entity_type_key="person",
        pascal_label="Person",
        entity_id="e1",
        properties={},
        embedding=None,
    )

    kwargs = session.run.call_args.kwargs
    assert kwargs["embedding_state"] == "failed"


@pytest.mark.asyncio
async def test_create_relation_sets_phase0_system_properties():
    session = AsyncMock()
    record = {
        "relation": {
            "_id": "r1",
            "_relationTypeKey": "works_for",
            "_groupId": "default",
            "_embeddingState": "ok",
            "_embeddingVersion": 1,
            "_validAt": None,
            "_invalidAt": None,
            "role": "Engineer",
        },
        "fromEntityId": "e1",
        "toEntityId": "e2",
    }
    session.run = AsyncMock()
    session.run.return_value.single = AsyncMock(return_value=record)

    result = await repository.create_relation(
        session=session,
        relation_type_key="works_for",
        rel_type_upper="WORKS_FOR",
        relation_id="r1",
        from_entity_id="e1",
        to_entity_id="e2",
        properties={"role": "Engineer"},
    )

    kwargs = session.run.call_args.kwargs
    assert kwargs["group_id"] == "default"
    assert kwargs["embedding_state"] == "ok"
    # No fact / embedding on non-semantic relations.
    assert "fact" not in kwargs
    assert "embedding" not in kwargs

    assert result["_groupId"] == "default"


@pytest.mark.asyncio
async def test_create_relation_with_fact_and_embedding():
    session = AsyncMock()
    record = {
        "relation": {
            "_id": "r1",
            "_relationTypeKey": "works_for",
            "_groupId": "default",
            "_embeddingState": "ok",
            "_embeddingVersion": 1,
            "_fact": "Alice works for Acme",
            "_factVersion": 1,
        },
        "fromEntityId": "e1",
        "toEntityId": "e2",
    }
    session.run = AsyncMock()
    session.run.return_value.single = AsyncMock(return_value=record)

    await repository.create_relation(
        session=session,
        relation_type_key="works_for",
        rel_type_upper="WORKS_FOR",
        relation_id="r1",
        from_entity_id="e1",
        to_entity_id="e2",
        properties={},
        fact="Alice works for Acme",
        fact_version=1,
        embedding=[0.1, 0.2, 0.3],
        embedding_state="ok",
        embedding_version=1,
    )

    kwargs = session.run.call_args.kwargs
    assert kwargs["fact"] == "Alice works for Acme"
    assert kwargs["fact_version"] == 1
    assert kwargs["embedding"] == [0.1, 0.2, 0.3]
