from pydantic import BaseModel, Field

from ontoforge_server.core.schemas import (
    ExportEntityType,
    ExportOntology,
    ExportRelationType,
)


class ProvisionSummary(BaseModel):
    ontology_id: str = Field(alias="ontologyId")
    name: str
    entity_type_count: int = Field(alias="entityTypeCount")
    relation_type_count: int = Field(alias="relationTypeCount")

    model_config = {"populate_by_name": True}


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
