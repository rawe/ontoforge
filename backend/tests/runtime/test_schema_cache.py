"""Tests for runtime schema caching."""

from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.runtime import service
from tests.runtime.conftest import _make_full_schema


@pytest.mark.asyncio
async def test_runtime_schema_reuses_cached_loaded_schema(mock_driver):
    schema = _make_full_schema(
        ontology_key="hr_view",
        entity_inclusions=[
            {"key": "person", "properties": ["name", "email"]},
            {"key": "company", "properties": None},
        ],
        relation_inclusions=[
            {"key": "works_for", "properties": None},
        ],
    )

    with patch.object(service.repository, "get_full_schema", new=AsyncMock(return_value=schema)) as mock_get_schema:
        first = await service.get_full_schema("hr_view", mock_driver)
        second = await service.get_full_schema("hr_view", mock_driver)

    assert first.ontology.key == "hr_view"
    assert second.ontology.key == "hr_view"
    assert mock_get_schema.await_count == 1
