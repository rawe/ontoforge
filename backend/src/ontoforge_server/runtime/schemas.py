from typing import Any

from pydantic import BaseModel, Field

from ontoforge_server.core.schemas import (
    ExportEntityType,
    ExportOntology,
    ExportRelationType,
)


class SchemaResponse(BaseModel):
    ontology: ExportOntology
    entity_types: list[ExportEntityType] = Field(alias="entityTypes")
    relation_types: list[ExportRelationType] = Field(alias="relationTypes")

    model_config = {"populate_by_name": True}


class PaginatedResponse(BaseModel):
    items: list[dict]
    total: int
    limit: int
    offset: int


class RelationInstanceCreate(BaseModel):
    from_entity_id: str = Field(alias="fromEntityId")
    to_entity_id: str = Field(alias="toEntityId")

    model_config = {"populate_by_name": True, "extra": "allow"}


class NeighborEntry(BaseModel):
    relation: dict
    entity: dict


class NeighborhoodResponse(BaseModel):
    entity: dict
    neighbors: list[NeighborEntry]


class SearchResultItem(BaseModel):
    entity: dict
    score: float


class SemanticSearchResponse(BaseModel):
    results: list[SearchResultItem]
    query: str
    total: int


class RelationSemanticMatch(BaseModel):
    id: str = Field(alias="_id")
    relation_type_key: str = Field(alias="_relationTypeKey")
    source_id: str
    target_id: str
    fact: str | None = Field(default=None, alias="_fact")
    score: float
    matched_via: list[str]

    model_config = {"populate_by_name": True}


class EntitySemanticMatch(BaseModel):
    id: str = Field(alias="_id")
    entity_type_key: str = Field(alias="_entityTypeKey")
    display_name: str | None = Field(default=None, alias="displayName")
    properties: dict = Field(default_factory=dict)
    score: float
    matched_via: list[str] = Field(default_factory=lambda: ["vector"])

    model_config = {"populate_by_name": True}


class CypherQueryRequest(BaseModel):
    cypher: str = Field(..., min_length=1)


class CypherQueryResponse(BaseModel):
    columns: list[str]
    results: list[dict]


class SavedQueryRunRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


class FeaturesResponse(BaseModel):
    semantic_search: bool = Field(alias="semanticSearch")
    ai: bool = False

    model_config = {"populate_by_name": True}


# --- AI Endpoints ---


class AiQueryRequest(BaseModel):
    question: str = Field(..., min_length=1)


class AiQueryResponse(BaseModel):
    answer: str
    cypher: str | None = None
    results: dict | None = None


class AiExtractRequest(BaseModel):
    text: str = Field(..., min_length=1)
    entity_types: list[str] | None = Field(default=None, alias="entityTypes")
    create: bool = False

    model_config = {"populate_by_name": True}


class AiExtractResponse(BaseModel):
    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    created: bool


class AiChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class AiChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: list[AiChatMessage] | None = None
    include_tool_calls: bool = Field(default=False, alias="includeToolCalls")

    model_config = {"populate_by_name": True}


class AiChatResponse(BaseModel):
    reply: str
    tool_calls: list[dict[str, Any]] | None = Field(
        default=None, alias="toolCalls",
    )

    model_config = {"populate_by_name": True}


# --- Agent Discovery ---


class AgentInfo(BaseModel):
    key: str
    name: str
    description: str | None = None
