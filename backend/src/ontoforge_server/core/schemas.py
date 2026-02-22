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


class ExportOntology(BaseModel):
    ontology_id: str = Field(alias="ontologyId")
    name: str
    description: str | None = None

    model_config = {"populate_by_name": True}


class ExportPayload(BaseModel):
    format_version: str = Field(default="1.0", alias="formatVersion")
    ontology: ExportOntology
    entity_types: list[ExportEntityType] = Field(alias="entityTypes")
    relation_types: list[ExportRelationType] = Field(alias="relationTypes")

    model_config = {"populate_by_name": True}
