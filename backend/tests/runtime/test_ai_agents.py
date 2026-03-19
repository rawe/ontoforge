"""Tests for runtime AI agent functions (service-level)."""

from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.core.ai import AgentConfig, DEFAULT_AGENT_CONFIG
from ontoforge_server.runtime.ai_service import build_agent_card, list_runtime_agents
from ontoforge_server.runtime.service import (
    EntityTypeDef,
    LoadedSchema,
    PropertyDef,
    RelationTypeDef,
    SchemaCache,
)


def _make_schema_cache(
    ontology_key: str = "test_onto",
    ontology_name: str = "Test Ontology",
    ontology_description: str | None = None,
) -> SchemaCache:
    return SchemaCache(
        ontology_id="ont-1",
        ontology_key=ontology_key,
        ontology_name=ontology_name,
        ontology_description=ontology_description,
        entity_types={
            "person": EntityTypeDef(
                key="person",
                display_name="Person",
                description=None,
                properties={
                    "name": PropertyDef(
                        key="name",
                        display_name="Name",
                        description=None,
                        data_type="string",
                        required=True,
                        default_value=None,
                    ),
                },
            ),
            "company": EntityTypeDef(
                key="company",
                display_name="Company",
                description=None,
                properties={},
            ),
        },
        relation_types={
            "works_for": RelationTypeDef(
                key="works_for",
                display_name="Works For",
                description=None,
                from_entity_type_key="person",
                to_entity_type_key="company",
                properties={},
            ),
        },
    )


TEST_AGENT_CONFIG = AgentConfig(
    key="my-agent",
    name="My Agent",
    description="A custom agent",
    system_prompt="You are a test agent",
    tools=["get_schema"],
)


# --- list_runtime_agents ---


@pytest.mark.asyncio
async def test_list_runtime_agents():
    """Should return the default agent plus any configured agents."""
    schema_cache = _make_schema_cache()
    loaded = LoadedSchema(
        scoped=schema_cache,
        full=schema_cache,
        agent_configs={"my-agent": TEST_AGENT_CONFIG},
    )
    mock_driver = AsyncMock()

    with patch(
        "ontoforge_server.runtime.ai_service.service._load_schema",
        new_callable=AsyncMock,
        return_value=loaded,
    ):
        agents = await list_runtime_agents("test_onto", mock_driver)

    assert len(agents) == 2
    # First should be the default agent
    assert agents[0]["key"] == "_default"
    assert agents[0]["name"] == DEFAULT_AGENT_CONFIG.name
    # Second should be the configured agent
    assert agents[1]["key"] == "my-agent"
    assert agents[1]["name"] == "My Agent"
    assert agents[1]["description"] == "A custom agent"


@pytest.mark.asyncio
async def test_list_runtime_agents_no_configured():
    """With no configured agents, should return only the default."""
    schema_cache = _make_schema_cache()
    loaded = LoadedSchema(
        scoped=schema_cache,
        full=schema_cache,
        agent_configs={},
    )
    mock_driver = AsyncMock()

    with patch(
        "ontoforge_server.runtime.ai_service.service._load_schema",
        new_callable=AsyncMock,
        return_value=loaded,
    ):
        agents = await list_runtime_agents("test_onto", mock_driver)

    assert len(agents) == 1
    assert agents[0]["key"] == "_default"


# --- build_agent_card ---


def test_build_agent_card():
    """Should build an A2A agent card with all fields."""
    schema_cache = _make_schema_cache()
    card = build_agent_card(TEST_AGENT_CONFIG, schema_cache, "http://localhost:8000")

    assert card["name"] == "My Agent"
    assert card["description"] == "A custom agent"
    assert card["url"] == "http://localhost:8000/api/runtime/test_onto/ai/agents/my-agent/a2a"
    assert card["version"] == "0.1.0"
    assert card["capabilities"]["streaming"] is False
    assert "skills" in card
    assert len(card["skills"]) == 1


def test_build_agent_card_default_agent():
    """Default agent card should use the default A2A URL path."""
    schema_cache = _make_schema_cache()
    card = build_agent_card(DEFAULT_AGENT_CONFIG, schema_cache, "http://localhost:8000")

    assert card["name"] == DEFAULT_AGENT_CONFIG.name
    assert card["url"] == "http://localhost:8000/api/runtime/test_onto/ai/a2a"


def test_build_agent_card_auto_description():
    """When agent description is None, should auto-generate from schema types."""
    agent_no_desc = AgentConfig(
        key="auto-desc",
        name="Auto Desc Agent",
        description=None,
        system_prompt=None,
        tools=None,
    )
    schema_cache = _make_schema_cache(ontology_name="HR Ontology")
    card = build_agent_card(agent_no_desc, schema_cache, "http://localhost:8000")

    # Auto-generated description should mention entity and relation types
    assert "person" in card["description"]
    assert "company" in card["description"]
    assert "works_for" in card["description"]
    assert "HR Ontology" in card["description"]
