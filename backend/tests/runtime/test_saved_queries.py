"""Tests for runtime saved query functions (service-level)."""

from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.core.ai import SavedQueryConfig, SavedQueryParameter
from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.runtime.service import (
    LoadedSchema,
    SchemaCache,
    execute_saved_query,
)


def _make_schema_cache(
    ontology_key: str = "test_onto",
    ontology_name: str = "Test",
    ontology_description: str | None = None,
) -> SchemaCache:
    return SchemaCache(
        ontology_id="ont-1",
        ontology_key=ontology_key,
        ontology_name=ontology_name,
        ontology_description=ontology_description,
    )


FIND_PEOPLE_QUERY = SavedQueryConfig(
    key="find-people",
    name="Find People",
    description="Find people by name",
    cypher="MATCH (p:person) WHERE p.name CONTAINS $name RETURN p",
    parameters=[
        SavedQueryParameter(name="name", description="Name to search", data_type="string"),
    ],
)


def _make_loaded_schema(
    saved_queries: dict[str, SavedQueryConfig] | None = None,
) -> LoadedSchema:
    schema = _make_schema_cache()
    return LoadedSchema(
        scoped=schema,
        full=schema,
        saved_queries=saved_queries if saved_queries is not None else {},
    )


# --- LoadedSchema saved_queries field ---


@pytest.mark.asyncio
async def test_saved_queries_loaded_into_schema():
    """Verify that saved queries are part of LoadedSchema."""
    loaded = _make_loaded_schema(saved_queries={"find-people": FIND_PEOPLE_QUERY})

    assert "find-people" in loaded.saved_queries
    config = loaded.saved_queries["find-people"]
    assert config.key == "find-people"
    assert config.name == "Find People"
    assert config.description == "Find people by name"
    assert config.cypher == "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p"
    assert len(config.parameters) == 1
    assert config.parameters[0].name == "name"
    assert config.parameters[0].data_type == "string"


@pytest.mark.asyncio
async def test_saved_queries_empty_by_default():
    """Verify LoadedSchema defaults to empty dict for saved_queries."""
    schema = _make_schema_cache()
    loaded = LoadedSchema(scoped=schema, full=schema)
    assert loaded.saved_queries == {}


# --- list saved queries tool structure ---


@pytest.mark.asyncio
async def test_list_saved_queries_tool():
    """Verify the saved queries return correct structure (key, name, description, parameters)."""
    loaded = _make_loaded_schema(saved_queries={"find-people": FIND_PEOPLE_QUERY})

    # Simulate what a list tool would do: iterate over saved_queries
    queries = []
    for _key, config in loaded.saved_queries.items():
        queries.append({
            "key": config.key,
            "name": config.name,
            "description": config.description,
            "parameters": [
                {
                    "name": p.name,
                    "description": p.description,
                    "dataType": p.data_type,
                }
                for p in config.parameters
            ],
        })

    assert len(queries) == 1
    q = queries[0]
    assert q["key"] == "find-people"
    assert q["name"] == "Find People"
    assert q["description"] == "Find people by name"
    assert len(q["parameters"]) == 1
    assert q["parameters"][0]["name"] == "name"
    assert q["parameters"][0]["dataType"] == "string"


# --- execute_saved_query validation ---


@pytest.mark.asyncio
async def test_execute_saved_query_missing_param():
    """Missing required param raises ValidationError."""
    loaded = _make_loaded_schema(saved_queries={"find-people": FIND_PEOPLE_QUERY})
    mock_driver = AsyncMock()

    with patch(
        "ontoforge_server.runtime.service._load_schema",
        new_callable=AsyncMock,
        return_value=loaded,
    ):
        with pytest.raises(ValidationError, match="Missing required parameters"):
            await execute_saved_query("test_onto", "find-people", {}, mock_driver)


@pytest.mark.asyncio
async def test_execute_saved_query_extra_param():
    """Extra param raises ValidationError."""
    loaded = _make_loaded_schema(saved_queries={"find-people": FIND_PEOPLE_QUERY})
    mock_driver = AsyncMock()

    with patch(
        "ontoforge_server.runtime.service._load_schema",
        new_callable=AsyncMock,
        return_value=loaded,
    ):
        with pytest.raises(ValidationError, match="Unknown parameters"):
            await execute_saved_query(
                "test_onto", "find-people", {"name": "Alice", "extra": "bad"}, mock_driver
            )


@pytest.mark.asyncio
async def test_execute_saved_query_not_found():
    """Unknown query key raises NotFoundError."""
    loaded = _make_loaded_schema(saved_queries={})
    mock_driver = AsyncMock()

    with patch(
        "ontoforge_server.runtime.service._load_schema",
        new_callable=AsyncMock,
        return_value=loaded,
    ):
        with pytest.raises(NotFoundError, match="Saved query 'nonexistent' not found"):
            await execute_saved_query("test_onto", "nonexistent", {}, mock_driver)
