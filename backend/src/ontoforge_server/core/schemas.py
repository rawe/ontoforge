from enum import Enum

from pydantic import AliasChoices, BaseModel, Field, field_validator


class DataType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"
    DOCUMENT = "document"


class ExportProperty(BaseModel):
    key: str
    display_name: str = Field(alias="displayName")
    description: str | None = None
    data_type: str = Field(alias="dataType")
    required: bool
    default_value: str | None = Field(default=None, alias="defaultValue")

    model_config = {"populate_by_name": True}


class ExportEntityType(BaseModel):
    key: str
    display_name: str = Field(alias="displayName")
    description: str | None = None
    properties: list[ExportProperty] = []

    model_config = {"populate_by_name": True}


class ExportRelationType(BaseModel):
    key: str
    display_name: str = Field(alias="displayName")
    description: str | None = None
    from_entity_type_key: str = Field(alias="fromEntityTypeKey")
    to_entity_type_key: str = Field(alias="toEntityTypeKey")
    properties: list[ExportProperty] = []

    model_config = {"populate_by_name": True}


class ExportOntologyInclusion(BaseModel):
    key: str
    properties: list[str] | None = None

    model_config = {"populate_by_name": True}


class ExportOntologyInclusions(BaseModel):
    entity_types: list[ExportOntologyInclusion] = Field(default_factory=list, alias="entityTypes")
    relation_types: list[ExportOntologyInclusion] = Field(default_factory=list, alias="relationTypes")

    model_config = {"populate_by_name": True}


class ExportAiAgent(BaseModel):
    key: str
    name: str
    description: str | None = None
    system_prompt: str | None = Field(default=None, alias="systemPrompt")
    tools: list[str] | None = None

    model_config = {"populate_by_name": True}


class ExportSavedQueryParameter(BaseModel):
    name: str
    description: str
    data_type: str = Field(alias="dataType")

    model_config = {"populate_by_name": True}


class ExportSavedQueryStep(BaseModel):
    """Saved-query step in the transfer format.

    ``oql`` steps carry the query text in ``oql``; ``semantic_search`` steps
    carry their search text in ``query``. Step type ``cypher`` / field
    ``cypher`` are accepted on import from format 2.x and normalized.
    """

    name: str
    type: str
    oql: str | None = Field(
        default=None, validation_alias=AliasChoices("oql", "cypher"),
    )
    entity_type_key: str | None = Field(default=None, alias="entityTypeKey")
    query: str | None = None
    limit: int | None = None
    min_score: float | None = Field(default=None, alias="minScore")
    bindings: dict[str, str] | None = None

    model_config = {"populate_by_name": True}

    @field_validator("type", mode="before")
    @classmethod
    def _legacy_step_type(cls, v: object) -> object:
        return "oql" if v == "cypher" else v


class ExportSavedQuery(BaseModel):
    key: str
    name: str
    description: str
    steps: list[ExportSavedQueryStep]
    parameters: list[ExportSavedQueryParameter] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class ExportOntology(BaseModel):
    key: str
    name: str
    description: str | None = None
    includes: ExportOntologyInclusions | None = None
    ai_agents: list[ExportAiAgent] = Field(default_factory=list, alias="aiAgents")
    saved_queries: list[ExportSavedQuery] = Field(default_factory=list, alias="savedQueries")

    model_config = {"populate_by_name": True}


class ExportPayload(BaseModel):
    format_version: str = Field(default="3.0", alias="formatVersion")
    entity_types: list[ExportEntityType] = Field(default_factory=list, alias="entityTypes")
    relation_types: list[ExportRelationType] = Field(default_factory=list, alias="relationTypes")
    ontologies: list[ExportOntology] = Field(default_factory=list, alias="ontologies")

    model_config = {"populate_by_name": True}
