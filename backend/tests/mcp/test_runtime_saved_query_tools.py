"""Tests for dynamic saved-query tools on the runtime MCP server."""

from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.core.ai import SavedQueryConfig, SavedQueryParameter, StepConfig
from ontoforge_server.mcp.mount import current_ontology_key
from ontoforge_server.mcp.runtime import (
    SAVED_QUERY_TOOL_PREFIX,
    _saved_query_input_schema,
    _saved_query_tool_description,
    runtime_mcp,
)
from ontoforge_server.runtime.service import LoadedSchema, SchemaCache

PEOPLE_BY_SKILL = SavedQueryConfig(
    key="people_by_skill",
    name="People by Skill",
    description="Find people that have a given skill",
    example_questions=["Who knows Python?"],
    steps=[
        StepConfig(
            name="main",
            type="cypher",
            cypher="MATCH (p:person)-[:has_skill]->(s:skill {_id: $skill}) RETURN p",
        ),
    ],
    parameters=[
        SavedQueryParameter(
            name="skill",
            description="The skill",
            data_type="entity_ref",
            entity_type_key="skill",
        ),
        SavedQueryParameter(
            name="limit",
            description="Max people",
            data_type="integer",
            default=10,
        ),
    ],
)


def _loaded_schema() -> LoadedSchema:
    schema = SchemaCache(
        ontology_id="ont-1",
        ontology_key="test_onto",
        ontology_name="Test",
        ontology_description=None,
    )
    return LoadedSchema(
        scoped=schema,
        full=schema,
        saved_queries={"people_by_skill": PEOPLE_BY_SKILL},
    )


def test_input_schema_marks_defaults_optional():
    schema = _saved_query_input_schema(PEOPLE_BY_SKILL)
    assert schema["type"] == "object"
    assert schema["required"] == ["skill"]
    assert schema["properties"]["limit"]["type"] == "integer"
    assert schema["properties"]["limit"]["default"] == 10
    assert schema["properties"]["skill"]["type"] == "string"
    assert "skill" in schema["properties"]["skill"]["description"]


def test_tool_description_includes_example_questions():
    description = _saved_query_tool_description(PEOPLE_BY_SKILL)
    assert "People by Skill" in description
    assert "Who knows Python?" in description


@pytest.mark.asyncio
async def test_list_tools_includes_saved_queries():
    token = current_ontology_key.set("test_onto")
    try:
        with (
            patch(
                "ontoforge_server.mcp.runtime.get_driver",
                new_callable=AsyncMock,
                return_value=AsyncMock(),
            ),
            patch(
                "ontoforge_server.runtime.service._load_schema",
                new_callable=AsyncMock,
                return_value=_loaded_schema(),
            ),
        ):
            tools = await runtime_mcp.list_tools()
    finally:
        current_ontology_key.reset(token)

    by_name = {t.name: t for t in tools}
    tool_name = f"{SAVED_QUERY_TOOL_PREFIX}people_by_skill"
    assert tool_name in by_name
    tool = by_name[tool_name]
    assert tool.title == "People by Skill"
    assert tool.inputSchema["required"] == ["skill"]
    # Static tools are still present
    assert "run_saved_query" in by_name
    assert "list_saved_queries" in by_name


@pytest.mark.asyncio
async def test_call_tool_dispatches_to_saved_query():
    token = current_ontology_key.set("test_onto")
    try:
        with (
            patch(
                "ontoforge_server.mcp.runtime.get_driver",
                new_callable=AsyncMock,
                return_value=AsyncMock(),
            ),
            patch(
                "ontoforge_server.runtime.service._load_schema",
                new_callable=AsyncMock,
                return_value=_loaded_schema(),
            ),
            patch(
                "ontoforge_server.mcp.runtime.service.execute_saved_query",
                new_callable=AsyncMock,
                return_value={"columns": ["p"], "results": [], "pipeline": []},
            ) as mock_execute,
        ):
            result = await runtime_mcp.call_tool(
                f"{SAVED_QUERY_TOOL_PREFIX}people_by_skill",
                {"skill": "skill-1"},
            )
    finally:
        current_ontology_key.reset(token)

    mock_execute.assert_awaited_once_with(
        "test_onto", "people_by_skill", {"skill": "skill-1"}, mock_execute.call_args[0][3]
    )
    assert result["columns"] == ["p"]
