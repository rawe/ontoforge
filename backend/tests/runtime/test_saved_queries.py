"""Tests for runtime saved query functions (service-level)."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.core.ai import SavedQueryConfig, SavedQueryParameter, StepConfig
from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.runtime.service import (
    LoadedSchema,
    SchemaCache,
    execute_saved_query,
    _resolve_bindings,
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
    steps=[
        StepConfig(
            name="main",
            type="oql",
            oql="MATCH (p:person) WHERE p.name CONTAINS $name RETURN p",
        ),
    ],
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
    assert len(config.steps) == 1
    assert config.steps[0].type == "oql"
    assert config.steps[0].oql == "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p"
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
    """Verify the saved queries return correct structure (key, name, description, steps, parameters)."""
    loaded = _make_loaded_schema(saved_queries={"find-people": FIND_PEOPLE_QUERY})

    # Simulate what a list tool would do: iterate over saved_queries
    queries = []
    for _key, config in loaded.saved_queries.items():
        queries.append({
            "key": config.key,
            "name": config.name,
            "description": config.description,
            "steps": [
                {"name": s.name, "type": s.type}
                for s in config.steps
            ],
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
    assert len(q["steps"]) == 1
    assert q["steps"][0]["type"] == "oql"
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


# --- Binding resolution ---


def test_resolve_bindings_basic():
    """Resolve bindings collects field values from step results."""
    step_results = {
        "skills": [
            {"_id": "id-1", "name": "Python"},
            {"_id": "id-2", "name": "Go"},
        ],
    }
    bindings = {"skill_ids": "{{skills._id}}"}
    resolved = _resolve_bindings(bindings, step_results)
    assert resolved == {"skill_ids": ["id-1", "id-2"]}


def test_resolve_bindings_empty_results():
    """Resolve bindings with empty step results returns empty list."""
    step_results = {"skills": []}
    bindings = {"skill_ids": "{{skills._id}}"}
    resolved = _resolve_bindings(bindings, step_results)
    assert resolved == {"skill_ids": []}


def test_resolve_bindings_missing_field():
    """Resolve bindings skips rows where field is missing."""
    step_results = {
        "skills": [
            {"_id": "id-1", "name": "Python"},
            {"name": "Go"},  # no _id
        ],
    }
    bindings = {"skill_ids": "{{skills._id}}"}
    resolved = _resolve_bindings(bindings, step_results)
    assert resolved == {"skill_ids": ["id-1"]}


def test_resolve_bindings_invalid_expression():
    """Invalid binding expression raises ValidationError."""
    step_results = {"skills": [{"_id": "id-1"}]}
    bindings = {"ids": "invalid_expr"}
    with pytest.raises(ValidationError, match="Invalid binding expression"):
        _resolve_bindings(bindings, step_results)


# --- Multi-step pipeline ---


MULTI_STEP_QUERY = SavedQueryConfig(
    key="skilled-persons",
    name="Skilled Persons",
    description="Find persons by skill",
    steps=[
        StepConfig(
            name="skills",
            type="semantic_search",
            entity_type_key="skill",
            query="$skill_query",
            limit=5,
        ),
        StepConfig(
            name="persons",
            type="oql",
            oql="MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id IN $skill_ids RETURN p",
            bindings={"skill_ids": "{{skills._id}}"},
        ),
    ],
    parameters=[
        SavedQueryParameter(name="skill_query", description="Skill to search for", data_type="string"),
    ],
)


@pytest.mark.asyncio
async def test_multi_step_pipeline_execution():
    """Multi-step pipeline: semantic_search -> oql with binding."""
    loaded = _make_loaded_schema(saved_queries={"skilled-persons": MULTI_STEP_QUERY})

    # Set up driver mock with proper async context manager for session
    from ontoforge_server.adapters.neo4j.runtime_store import Neo4jRuntimeStore

    mock_session = AsyncMock()
    mock_driver = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield mock_session

    mock_driver.session = _session
    store = Neo4jRuntimeStore(mock_driver)

    # Mock semantic_search to return skill entities
    mock_search_result = {
        "results": [
            {"entity": {"_id": "skill-1", "name": "Python"}, "_score": 0.95},
            {"entity": {"_id": "skill-2", "name": "Machine Learning"}, "_score": 0.85},
        ],
        "query": "machine learning",
        "total": 2,
    }

    # Mock query execution to return persons
    mock_cypher_result = (
        ["p"],
        [{"p": {"_id": "person-1", "name": "Alice"}}],
    )

    with (
        patch(
            "ontoforge_server.runtime.service._load_schema",
            new_callable=AsyncMock,
            return_value=loaded,
        ),
        patch(
            "ontoforge_server.runtime.service.semantic_search",
            new_callable=AsyncMock,
            return_value=mock_search_result,
        ) as mock_ss,
        patch(
            "ontoforge_server.core.oql.get_return_variables",
            return_value={},
        ),
        patch(
            "ontoforge_server.core.oql.parse_and_validate",
            return_value="validated-query-sentinel",
        ),
        patch(
            "ontoforge_server.adapters.neo4j.oql_compiler.compile_query",
            return_value="MATCH (p:Person)-[:HAS_SKILL]->(s:Skill) WHERE s._id IN $skill_ids RETURN p",
        ),
        patch(
            "ontoforge_server.adapters.neo4j.runtime_queries.execute_cypher_read",
            new_callable=AsyncMock,
            return_value=mock_cypher_result,
        ) as mock_cypher,
    ):
        result = await execute_saved_query(
            "test_onto", "skilled-persons", {"skill_query": "machine learning"}, store
        )

    # Verify semantic search was called with substituted query
    mock_ss.assert_awaited_once()
    ss_args = mock_ss.call_args
    assert ss_args[0][1] == "machine learning"  # query text
    assert ss_args[0][2] == "skill"  # entity_type_key

    # Verify the query step ran with binding-resolved params
    mock_cypher.assert_awaited_once()
    cypher_params = mock_cypher.call_args[1]["params"]
    assert cypher_params["skill_ids"] == ["skill-1", "skill-2"]  # from binding resolution

    # Result should be from the last step (oql)
    assert result["columns"] == ["p"]
    assert len(result["results"]) == 1
