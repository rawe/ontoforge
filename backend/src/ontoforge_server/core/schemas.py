from enum import Enum

from pydantic import BaseModel, Field


class DataType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"


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


class ExportOntology(BaseModel):
    key: str
    name: str
    description: str | None = None
    includes: ExportOntologyInclusions | None = None

    model_config = {"populate_by_name": True}


class ExportPayload(BaseModel):
    format_version: str = Field(default="2.0", alias="formatVersion")
    entity_types: list[ExportEntityType] = Field(default_factory=list, alias="entityTypes")
    relation_types: list[ExportRelationType] = Field(default_factory=list, alias="relationTypes")
    ontologies: list[ExportOntology] = Field(default_factory=list, alias="ontologies")

    model_config = {"populate_by_name": True}
