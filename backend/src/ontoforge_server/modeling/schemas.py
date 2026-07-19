from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from ontoforge_server.core.schemas import (
    DataType,
    ExportAiAgent,
    ExportEntityType,
    ExportOntology,
    ExportOntologyInclusion,
    ExportOntologyInclusions,
    ExportPayload,
    ExportProperty,
    ExportRelationType,
    ExportSavedQuery,
    ExportSavedQueryParameter,
    ExportSavedQueryStep,
)

# Re-export core schemas so existing imports from this module keep working
__all__ = [
    "DataType",
    "ExportAiAgent",
    "ExportSavedQuery",
    "ExportSavedQueryParameter",
    "ExportSavedQueryStep",
    "ExportEntityType",
    "ExportOntology",
    "ExportOntologyInclusion",
    "ExportOntologyInclusions",
    "ExportPayload",
    "ExportProperty",
    "ExportRelationType",
]

KEY_PATTERN = r"^[a-z][a-z0-9_]*$"
AGENT_KEY_PATTERN = r"^[a-z][a-z0-9_-]*$"


# --- Ontology ---


class OntologyCreate(BaseModel):
    key: str = Field(pattern=KEY_PATTERN)
    name: str
    description: str | None = None


class OntologyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class OntologyResponse(BaseModel):
    ontology_id: str = Field(alias="ontologyId")
    key: str
    name: str
    description: str | None = None
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


# --- Entity Type ---


class EntityTypeCreate(BaseModel):
    key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(alias="displayName")
    description: str | None = None

    model_config = {"populate_by_name": True}


class EntityTypeUpdate(BaseModel):
    display_name: str | None = Field(default=None, alias="displayName")
    description: str | None = None

    model_config = {"populate_by_name": True}


class EntityTypeResponse(BaseModel):
    entity_type_id: str = Field(alias="entityTypeId")
    key: str
    display_name: str = Field(alias="displayName")
    description: str | None = None
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


# --- Relation Type ---


class RelationTypeCreate(BaseModel):
    key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(alias="displayName")
    description: str | None = None
    source_entity_type_key: str = Field(alias="sourceEntityTypeKey")
    target_entity_type_key: str = Field(alias="targetEntityTypeKey")

    model_config = {"populate_by_name": True}


class RelationTypeUpdate(BaseModel):
    display_name: str | None = Field(default=None, alias="displayName")
    description: str | None = None

    model_config = {"populate_by_name": True}


class RelationTypeResponse(BaseModel):
    relation_type_id: str = Field(alias="relationTypeId")
    key: str
    display_name: str = Field(alias="displayName")
    description: str | None = None
    source_entity_type_key: str = Field(alias="sourceEntityTypeKey")
    target_entity_type_key: str = Field(alias="targetEntityTypeKey")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


# --- Property Definition ---


class PropertyDefinitionCreate(BaseModel):
    key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(alias="displayName")
    description: str | None = None
    data_type: DataType = Field(alias="dataType")
    required: bool = False
    default_value: str | None = Field(default=None, alias="defaultValue")

    model_config = {"populate_by_name": True}


class PropertyDefinitionUpdate(BaseModel):
    display_name: str | None = Field(default=None, alias="displayName")
    description: str | None = None
    required: bool | None = None
    default_value: str | None = Field(default=None, alias="defaultValue")

    model_config = {"populate_by_name": True}


class PropertyDefinitionResponse(BaseModel):
    property_id: str = Field(alias="propertyId")
    key: str
    display_name: str = Field(alias="displayName")
    description: str | None = None
    data_type: str = Field(alias="dataType")
    required: bool
    default_value: str | None = Field(default=None, alias="defaultValue")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


# --- Scope Management ---


class IncludeTypeRequest(BaseModel):
    key: str
    properties: list[str] | None = None


class IncludeTypeUpdate(BaseModel):
    properties: list[str] | None = None


class IncludeTypeResponse(BaseModel):
    key: str
    properties: list[str] | None = None


# --- Validation ---


class SchemaValidationError(BaseModel):
    path: str
    message: str


class ValidationResult(BaseModel):
    valid: bool
    errors: list[SchemaValidationError] = []


# --- Error ---


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


# --- AI Agent Config ---


class AiAgentConfigUpsert(BaseModel):
    name: str
    description: str | None = None
    system_prompt: str | None = Field(default=None, alias="systemPrompt")
    tools: list[str] | None = None

    model_config = {"populate_by_name": True}


class AiAgentConfigResponse(BaseModel):
    key: str
    name: str
    description: str | None = None
    system_prompt: str | None = Field(default=None, alias="systemPrompt")
    tools: list[str] | None = None
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


# --- Saved Query Config ---


class StepType(str, Enum):
    CYPHER = "cypher"
    SEMANTIC_SEARCH = "semantic_search"


class StepSchema(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z_]\w*$")
    type: StepType
    cypher: str | None = None
    entity_type_key: str | None = Field(default=None, alias="entityTypeKey")
    query: str | None = None
    limit: int | None = Field(default=None, ge=1, le=100)
    min_score: float | None = Field(default=None, ge=0.0, le=1.0, alias="minScore")
    bindings: dict[str, str] | None = None

    model_config = {"populate_by_name": True}


class ParamDataType(str, Enum):
    """Data types allowed for saved query parameters (scalars + entity_ref)."""

    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"
    ENTITY_REF = "entity_ref"


class SavedQueryParameterSchema(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z_]\w*$")
    description: str
    data_type: ParamDataType = Field(alias="dataType")
    default: str | int | float | bool | None = None
    entity_type_key: str | None = Field(default=None, alias="entityTypeKey")

    model_config = {"populate_by_name": True}


class SavedQueryUpsert(BaseModel):
    name: str
    description: str
    example_questions: list[str] = Field(default_factory=list, alias="exampleQuestions")
    steps: list[StepSchema] = Field(min_length=1)
    parameters: list[SavedQueryParameterSchema] = Field(default_factory=list)
    max_rows: int | None = Field(default=None, ge=1, le=10000, alias="maxRows")

    model_config = {"populate_by_name": True}


class SavedQueryResponse(BaseModel):
    key: str
    name: str
    description: str
    example_questions: list[str] = Field(default_factory=list, alias="exampleQuestions")
    steps: list[StepSchema]
    parameters: list[SavedQueryParameterSchema]
    max_rows: int | None = Field(default=None, alias="maxRows")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class SavedQueryHealthEntry(BaseModel):
    key: str
    name: str
    valid: bool
    errors: list[str] = Field(default_factory=list)


class SavedQueryHealthResponse(BaseModel):
    queries: list[SavedQueryHealthEntry]
    valid: bool  # true when every saved query validates


# --- Rebuild Embeddings ---


class RebuildEmbeddingsTypeResult(BaseModel):
    entity_type_key: str = Field(alias="entityTypeKey")
    processed: int
    failed: int

    model_config = {"populate_by_name": True}


class RebuildEmbeddingsResult(BaseModel):
    entity_types: list[RebuildEmbeddingsTypeResult] = Field(alias="entityTypes")
    saved_queries_processed: int = Field(alias="savedQueriesProcessed")
    saved_queries_failed: int = Field(alias="savedQueriesFailed")
    total_processed: int = Field(alias="totalProcessed")
    total_failed: int = Field(alias="totalFailed")

    model_config = {"populate_by_name": True}
