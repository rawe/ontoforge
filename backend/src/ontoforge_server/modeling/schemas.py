from datetime import datetime

from pydantic import BaseModel, Field

from ontoforge_server.core.schemas import (
    DataType,
    ExportEntityType,
    ExportOntology,
    ExportPayload,
    ExportProperty,
    ExportRelationType,
)

# Re-export core schemas so existing imports from this module keep working
__all__ = [
    "DataType",
    "ExportEntityType",
    "ExportOntology",
    "ExportPayload",
    "ExportProperty",
    "ExportRelationType",
]

KEY_PATTERN = r"^[a-z][a-z0-9_]*$"


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
    source_entity_type_id: str = Field(alias="sourceEntityTypeId")
    target_entity_type_id: str = Field(alias="targetEntityTypeId")

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
    source_entity_type_id: str = Field(alias="sourceEntityTypeId")
    target_entity_type_id: str = Field(alias="targetEntityTypeId")
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
