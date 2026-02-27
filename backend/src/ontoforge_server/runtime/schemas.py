from pydantic import BaseModel, Field

from ontoforge_server.core.schemas import (
    ExportEntityType,
    ExportOntology,
    ExportRelationType,
)


class DataWipeResponse(BaseModel):
    ontology_key: str = Field(alias="ontologyKey")
    entities_deleted: int = Field(alias="entitiesDeleted")
    relations_deleted: int = Field(alias="relationsDeleted")

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


class SearchResultItem(BaseModel):
    entity: dict
    score: float


class SemanticSearchResponse(BaseModel):
    results: list[SearchResultItem]
    query: str
    total: int
