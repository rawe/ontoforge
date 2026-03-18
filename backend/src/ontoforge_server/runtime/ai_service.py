"""AI-powered runtime endpoints using PydanticAI.

Each AI feature gets its own PydanticAI agent with a scoped tool subset.
Tools wrap the same service functions that the MCP tools use.
"""

from __future__ import annotations

import functools
import logging
from dataclasses import dataclass
from typing import Any

from neo4j import AsyncDriver
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext

from ontoforge_server.core.ai import get_ai_model
from ontoforge_server.core.exceptions import NotFoundError, ValidationError
from ontoforge_server.runtime import service
from ontoforge_server.runtime.schemas import RelationInstanceCreate

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool name constants
# ---------------------------------------------------------------------------

TOOL_GET_SCHEMA = "get_schema"
TOOL_LIST_ENTITIES = "list_entities"
TOOL_GET_ENTITY = "get_entity"
TOOL_LIST_RELATIONS = "list_relations"
TOOL_GET_NEIGHBORS = "get_neighbors"
TOOL_SEMANTIC_SEARCH = "semantic_search"
TOOL_EXECUTE_CYPHER = "execute_cypher_query"

# ---------------------------------------------------------------------------
# Tool allowlists — controls which tools each AI feature can use
# ---------------------------------------------------------------------------

QUERY_TOOLS = [TOOL_EXECUTE_CYPHER]
EXTRACT_TOOLS: list[str] = []  # schema context only
CHAT_TOOLS = [
    TOOL_GET_SCHEMA,
    TOOL_LIST_ENTITIES,
    TOOL_GET_ENTITY,
    TOOL_LIST_RELATIONS,
    TOOL_GET_NEIGHBORS,
    TOOL_SEMANTIC_SEARCH,
    TOOL_EXECUTE_CYPHER,
]


# ---------------------------------------------------------------------------
# Dependencies injected into agent runs
# ---------------------------------------------------------------------------


@dataclass
class AiDeps:
    ontology_key: str
    driver: AsyncDriver


# ---------------------------------------------------------------------------
# Schema description builder (for system prompts)
# ---------------------------------------------------------------------------


def _describe_schema(schema: service.SchemaCache) -> str:
    """Build a concise text description of the scoped schema for the LLM."""
    lines = [f"Ontology: {schema.ontology_name} (key: {schema.ontology_key})"]
    if schema.ontology_description:
        lines.append(f"Description: {schema.ontology_description}")

    lines.append("\nSystem properties (available on all entities and relations):")
    lines.append("  - _id: string (unique identifier)")
    lines.append("  - _createdAt: datetime")
    lines.append("  - _updatedAt: datetime")

    lines.append("\nEntity types:")
    for et in schema.entity_types.values():
        desc = f"  - {et.key}"
        if et.description:
            desc += f": {et.description}"
        lines.append(desc)
        for p in et.properties.values():
            req = " (required)" if p.required else ""
            lines.append(f"    - {p.key}: {p.data_type}{req}")
            if p.description:
                lines.append(f"      {p.description}")

    lines.append("\nRelation types:")
    for rt in schema.relation_types.values():
        desc = f"  - {rt.key}: {rt.from_entity_type_key} -> {rt.to_entity_type_key}"
        if rt.description:
            desc += f" ({rt.description})"
        lines.append(desc)
        for p in rt.properties.values():
            req = " (required)" if p.required else ""
            lines.append(f"    - {p.key}: {p.data_type}{req}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool definitions — registered selectively per agent
# ---------------------------------------------------------------------------


ALL_TOOLS: dict[str, Any] = {}


def _register_tool(name: str):
    """Decorator to register a tool function in the global tool registry.

    Wraps each tool to catch service-layer errors and return them as
    messages so the LLM can self-correct instead of crashing the endpoint.
    """
    def decorator(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            try:
                return await fn(*args, **kwargs)
            except (NotFoundError, ValidationError) as exc:
                return {"error": str(exc)}

        ALL_TOOLS[name] = wrapper
        return wrapper
    return decorator


@_register_tool(TOOL_GET_SCHEMA)
async def tool_get_schema(ctx: RunContext[AiDeps]) -> str:
    """Get the full ontology schema including entity types, relation types,
    and their property definitions with data types and required flags.
    Call this if you need to verify available types or properties."""
    loaded = await service._load_schema(ctx.deps.ontology_key, ctx.deps.driver)
    return _describe_schema(loaded.scoped)


@_register_tool(TOOL_LIST_ENTITIES)
async def tool_list_entities(
    ctx: RunContext[AiDeps],
    entity_type_key: str,
    search: str | None = None,
    filters: dict[str, str] | None = None,
    limit: int = 20,
) -> dict:
    """List entities of a type with optional filtering and search.
    Use 'search' to match a term across ALL string properties at once.
    Use 'filters' to filter on specific properties: exact match
    ("name": "Alice"), greater than ("age__gt": "25"), greater or equal
    ("__gte"), less than ("__lt"), less or equal ("__lte"), contains
    ("name__contains": "ali"). All filter values must be strings."""
    result = await service.list_entities(
        ctx.deps.ontology_key, entity_type_key,
        min(limit, 50), 0, "_createdAt", "asc",
        search, filters or {}, ctx.deps.driver,
    )
    return result.model_dump()


@_register_tool(TOOL_GET_ENTITY)
async def tool_get_entity(
    ctx: RunContext[AiDeps],
    entity_type_key: str,
    entity_id: str,
) -> dict:
    """Retrieve a specific entity by its _id. Returns all properties."""
    return await service.get_entity(
        ctx.deps.ontology_key, entity_type_key, entity_id, ctx.deps.driver,
    )


@_register_tool(TOOL_LIST_RELATIONS)
async def tool_list_relations(
    ctx: RunContext[AiDeps],
    relation_type_key: str,
    limit: int = 20,
) -> dict:
    """List relations of a type. Each result includes _id, source and target
    entity IDs, and relation properties."""
    result = await service.list_relations(
        ctx.deps.ontology_key, relation_type_key,
        min(limit, 50), 0, "_createdAt", "asc",
        None, None, {}, ctx.deps.driver,
    )
    return result.model_dump()


@_register_tool(TOOL_GET_NEIGHBORS)
async def tool_get_neighbors(
    ctx: RunContext[AiDeps],
    entity_type_key: str,
    entity_id: str,
    direction: str = "both",
    limit: int = 20,
) -> dict:
    """Explore an entity's connections. Returns the entity plus all connected
    entities with their connecting relations. Use this to answer "what is X
    connected to?" questions. Direction: "outgoing", "incoming", or "both"."""
    result = await service.get_neighbors(
        ctx.deps.ontology_key, entity_type_key, entity_id,
        direction, None, min(limit, 50), ctx.deps.driver,
    )
    return result.model_dump()


@_register_tool(TOOL_SEMANTIC_SEARCH)
async def tool_semantic_search(
    ctx: RunContext[AiDeps],
    query: str,
    entity_type_key: str,
    limit: int = 10,
) -> dict:
    """Search entities by semantic similarity to a natural language query.
    Returns entities ranked by relevance with similarity scores.
    Best for finding entities when you don't know exact property values."""
    return await service.semantic_search(
        ctx.deps.ontology_key, query, entity_type_key,
        min(limit, 20), None, ctx.deps.driver,
    )


@_register_tool(TOOL_EXECUTE_CYPHER)
async def tool_execute_cypher_query(
    ctx: RunContext[AiDeps],
    cypher: str,
) -> dict:
    """Execute a read-only Cypher query against the knowledge graph.
    Use entity type keys (snake_case) as node labels and relation type keys
    as relationship types. ALL node patterns MUST have a label. Only
    MATCH/RETURN — no writes, no CALL. Use CONTAINS for substring matching
    (not regex). If the query fails, read the error — it lists available
    types and properties.
    Examples:
      MATCH (p:person {name: 'Alice'}) RETURN p
      MATCH (p:person)-[r:works_for]->(c:company) RETURN p.name, c.name
      MATCH (p:person) WHERE p.age > 30 RETURN p.name, p.age LIMIT 10"""
    return await service.execute_cypher_query(
        ctx.deps.ontology_key, cypher, ctx.deps.driver,
    )


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------


def _create_agent(
    system_prompt: str,
    tool_names: list[str],
    result_type: type | None = None,
) -> Agent:
    """Create a PydanticAI agent with the given tools and system prompt."""
    model = get_ai_model()
    if model is None:
        raise ValidationError("AI feature is disabled (AI_PROVIDER not configured)")

    tools = [ALL_TOOLS[name] for name in tool_names if name in ALL_TOOLS]

    kwargs: dict[str, Any] = {
        "model": model,
        "system_prompt": system_prompt,
        "tools": tools,
        "deps_type": AiDeps,
    }
    if result_type is not None:
        kwargs["output_type"] = result_type

    return Agent(**kwargs)


# ---------------------------------------------------------------------------
# Feature: NL → Cypher Query
# ---------------------------------------------------------------------------

_QUERY_SYSTEM_PROMPT = """You are a Cypher query assistant for a Neo4j knowledge graph.
You translate natural language questions into Cypher queries.

RULES:
- Use entity type keys (snake_case) as node labels: e.g., person, company
- Use relation type keys (snake_case) as relationship types: e.g., works_for
- ALL node patterns MUST have a label — never use bare (n) patterns
- Only generate read queries (MATCH/RETURN) — no writes
- Use the execute_cypher_query tool to run your query
- After getting results, provide a clear natural language answer

{schema}
"""


async def ai_query(
    ontology_key: str,
    question: str,
    driver: AsyncDriver,
) -> dict:
    """Translate a natural language question to Cypher, execute it, and summarize."""
    loaded = await service._load_schema(ontology_key, driver)
    schema_desc = _describe_schema(loaded.scoped)

    agent = _create_agent(
        system_prompt=_QUERY_SYSTEM_PROMPT.format(schema=schema_desc),
        tool_names=QUERY_TOOLS,
    )
    deps = AiDeps(ontology_key=ontology_key, driver=driver)
    result = await agent.run(question, deps=deps)

    # Extract the Cypher query and results from tool call messages
    cypher_used = None
    cypher_results = None
    for msg in result.new_messages():
        for part in getattr(msg, "parts", []):
            tool_name = getattr(part, "tool_name", None)
            if tool_name and TOOL_EXECUTE_CYPHER in tool_name:
                # ToolCallPart: args is JSON string, use args_as_dict()
                args_fn = getattr(part, "args_as_dict", None)
                if args_fn:
                    args_dict = args_fn()
                    cypher_used = args_dict.get("cypher")
                # ToolReturnPart: content is the result dict
                content = getattr(part, "content", None)
                if isinstance(content, dict):
                    cypher_results = content

    return {
        "answer": result.output,
        "cypher": cypher_used,
        "results": cypher_results,
    }


# ---------------------------------------------------------------------------
# Feature: Entity Extraction
# ---------------------------------------------------------------------------


class ExtractedEntity(BaseModel):
    entity_type_key: str = Field(alias="entityTypeKey")
    properties: dict[str, Any]
    model_config = {"populate_by_name": True}


class ExtractedRelationEndpoint(BaseModel):
    entity_type_key: str = Field(alias="entityTypeKey")
    match: dict[str, Any]
    model_config = {"populate_by_name": True}


class ExtractedRelation(BaseModel):
    relation_type_key: str = Field(alias="relationTypeKey")
    source: ExtractedRelationEndpoint
    target: ExtractedRelationEndpoint
    properties: dict[str, Any] = Field(default_factory=dict)
    model_config = {"populate_by_name": True}


class ExtractionResult(BaseModel):
    entities: list[ExtractedEntity]
    relations: list[ExtractedRelation]


_EXTRACT_SYSTEM_PROMPT = """You are an entity extraction assistant for a knowledge graph.
Given unstructured text, extract entities and relations that match the ontology schema.

RULES:
- Only extract entities whose types exist in the schema below
- Only extract relations whose types exist in the schema below
- Map properties to the correct data types defined in the schema
- For relations, provide 'match' fields that uniquely identify the source and target entities
- If a property cannot be determined from the text, omit it (unless required)
- Be precise — only extract what the text clearly states

{schema}
"""


async def ai_extract(
    ontology_key: str,
    text: str,
    driver: AsyncDriver,
    entity_types: list[str] | None = None,
    create: bool = False,
) -> dict:
    """Extract entities and relations from text using the ontology schema."""
    loaded = await service._load_schema(ontology_key, driver)
    schema_desc = _describe_schema(loaded.scoped)

    prompt_extra = ""
    if entity_types:
        prompt_extra = f"\nFocus on these entity types: {', '.join(entity_types)}"

    agent = _create_agent(
        system_prompt=_EXTRACT_SYSTEM_PROMPT.format(schema=schema_desc) + prompt_extra,
        tool_names=EXTRACT_TOOLS,
        result_type=ExtractionResult,
    )
    deps = AiDeps(ontology_key=ontology_key, driver=driver)
    result = await agent.run(
        f"Extract entities and relations from this text:\n\n{text}",
        deps=deps,
    )
    extraction: ExtractionResult = result.output

    response: dict[str, Any] = {
        "entities": [e.model_dump(by_alias=True) for e in extraction.entities],
        "relations": [r.model_dump(by_alias=True) for r in extraction.relations],
        "created": False,
    }

    if create:
        created_entities: dict[str, dict] = {}
        for entity in extraction.entities:
            created = await service.create_entity(
                ontology_key, entity.entity_type_key, entity.properties, driver,
            )
            match_key = f"{entity.entity_type_key}:{_match_key(entity.properties)}"
            created_entities[match_key] = created

        for relation in extraction.relations:
            source_key = f"{relation.source.entity_type_key}:{_match_key(relation.source.match)}"
            target_key = f"{relation.target.entity_type_key}:{_match_key(relation.target.match)}"
            source = created_entities.get(source_key)
            target = created_entities.get(target_key)
            if source and target:
                body = RelationInstanceCreate(
                    fromEntityId=source["_id"],
                    toEntityId=target["_id"],
                    **relation.properties,
                )
                await service.create_relation(
                    ontology_key, relation.relation_type_key, body, driver,
                )
        response["created"] = True

    return response


def _match_key(props: dict) -> str:
    """Create a stable key from match properties for entity lookup."""
    return "|".join(f"{k}={v}" for k, v in sorted(props.items()))


# ---------------------------------------------------------------------------
# Feature: Schema-Aware Chat
# ---------------------------------------------------------------------------

_CHAT_SYSTEM_PROMPT = """You are a knowledge graph assistant. You answer questions by \
querying data with the available tools. You can only read data, not create or modify it.

SCHEMA:
{schema}

STRATEGY — use the exact keys from the schema as tool arguments (e.g. entity_type_key="person"):
1. For questions about connections or relationships, use execute_cypher_query with a
   relationship pattern. Example: "What does Lena do?" →
   MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name CONTAINS 'Lena' RETURN p.name, c.name
2. For counting, filtering, or combining conditions, use execute_cypher_query.
3. For fuzzy or "find something like..." questions, use semantic_search.
4. For exploring an entity's connections when you have its _id, use get_neighbors.
5. For browsing entities of a type, use list_entities.

Never make up answers — only use data from tool results. If the data doesn't contain \
the answer, say so. Be concise.
"""


async def ai_chat(
    ontology_key: str,
    message: str,
    driver: AsyncDriver,
    history: list[dict] | None = None,
    include_tool_calls: bool = False,
) -> dict:
    """Chat with the knowledge graph using AI and tools."""
    loaded = await service._load_schema(ontology_key, driver)
    schema_desc = _describe_schema(loaded.scoped)

    # Filter chat tools to only include semantic_search if embedding is enabled
    from ontoforge_server.core.embedding import get_embedding_provider

    available_tools = [
        t for t in CHAT_TOOLS
        if t != TOOL_SEMANTIC_SEARCH or get_embedding_provider() is not None
    ]

    agent = _create_agent(
        system_prompt=_CHAT_SYSTEM_PROMPT.format(schema=schema_desc),
        tool_names=available_tools,
    )
    deps = AiDeps(ontology_key=ontology_key, driver=driver)

    # Build message history for multi-turn
    message_history = None
    if history:
        from pydantic_ai.messages import (
            ModelRequest,
            ModelResponse,
            TextPart,
            UserPromptPart,
        )
        message_history = []
        for entry in history:
            if entry["role"] == "user":
                message_history.append(
                    ModelRequest(parts=[UserPromptPart(content=entry["content"])])
                )
            elif entry["role"] == "assistant":
                message_history.append(
                    ModelResponse(parts=[TextPart(content=entry["content"])])
                )

    result = await agent.run(
        message,
        deps=deps,
        message_history=message_history,
    )

    response: dict[str, Any] = {"reply": result.output}

    if include_tool_calls:
        tool_calls = []
        for msg in result.new_messages():
            for part in getattr(msg, "parts", []):
                tool_name = getattr(part, "tool_name", None)
                args_fn = getattr(part, "args_as_dict", None)
                if tool_name and args_fn:
                    tool_calls.append({
                        "tool": tool_name.removeprefix("tool_"),
                        "args": args_fn(),
                    })
        response["tool_calls"] = tool_calls

    return response
