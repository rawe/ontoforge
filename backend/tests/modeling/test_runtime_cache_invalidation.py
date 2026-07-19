"""Tests that modeling writes invalidate the runtime schema cache."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.adapters.neo4j import modeling_queries, runtime_queries
from ontoforge_server.adapters.neo4j.modeling_store import Neo4jModelingStore
from ontoforge_server.adapters.neo4j.runtime_store import Neo4jRuntimeStore
from ontoforge_server.modeling.schemas import OntologyCreate
from ontoforge_server.modeling import service as modeling_service
from ontoforge_server.runtime import service as runtime_service
from tests.runtime.conftest import _make_full_schema


@pytest.mark.asyncio
async def test_create_ontology_invalidates_runtime_schema_cache(mock_driver):
    schema = _make_full_schema(ontology_key="hr_view")
    store = Neo4jRuntimeStore(mock_driver)

    with patch.object(runtime_queries, "get_full_schema", new=AsyncMock(return_value=schema)) as mock_get_schema:
        await runtime_service.get_full_schema("hr_view", store)
        await runtime_service.get_full_schema("hr_view", store)

        assert mock_get_schema.await_count == 1

        created = {
            "ontologyId": "ont-2",
            "key": "new_view",
            "name": "New View",
            "description": None,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }

        with (
            patch.object(modeling_queries, "get_ontology_by_key", new=AsyncMock(return_value=None)),
            patch.object(modeling_queries, "get_ontology_by_name", new=AsyncMock(return_value=None)),
            patch.object(modeling_queries, "create_ontology", new=AsyncMock(return_value=created)),
        ):
            await modeling_service.create_ontology(
                OntologyCreate(key="new_view", name="New View"),
                Neo4jModelingStore(mock_driver),
            )

        await runtime_service.get_full_schema("hr_view", store)

    assert mock_get_schema.await_count == 2
