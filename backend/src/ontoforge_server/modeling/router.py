from fastapi import APIRouter, Depends, Query, Response
from neo4j import AsyncDriver

from ontoforge_server.core.database import get_driver
from ontoforge_server.modeling import service
from ontoforge_server.modeling.schemas import (
    EntityTypeCreate,
    EntityTypeResponse,
    EntityTypeUpdate,
    ExportPayload,
    IncludeTypeRequest,
    IncludeTypeResponse,
    IncludeTypeUpdate,
    OntologyCreate,
    OntologyResponse,
    OntologyUpdate,
    PropertyDefinitionCreate,
    PropertyDefinitionResponse,
    PropertyDefinitionUpdate,
    RelationTypeCreate,
    RelationTypeResponse,
    RelationTypeUpdate,
    ValidationResult,
)

router = APIRouter(tags=["modeling"])


# --- Ontologies ---


@router.post("/ontologies", response_model=OntologyResponse, status_code=201)
async def create_ontology(
    body: OntologyCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_ontology(body, driver)


@router.get("/ontologies", response_model=list[OntologyResponse])
async def list_ontologies(
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_ontologies(driver)


@router.get("/ontologies/{ontology_id}", response_model=OntologyResponse)
async def get_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.get_ontology(ontology_id, driver)


@router.put("/ontologies/{ontology_id}", response_model=OntologyResponse)
async def update_ontology(
    ontology_id: str,
    body: OntologyUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_ontology(ontology_id, body, driver)


@router.delete("/ontologies/{ontology_id}", status_code=204)
async def delete_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_ontology(ontology_id, driver)
    return Response(status_code=204)


# --- Entity Types (Global) ---


@router.post("/entity-types", response_model=EntityTypeResponse, status_code=201)
async def create_entity_type(
    body: EntityTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_entity_type(body, driver)


@router.get("/entity-types", response_model=list[EntityTypeResponse])
async def list_entity_types(
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_entity_types(driver)


@router.get("/entity-types/{entity_type_id}", response_model=EntityTypeResponse)
async def get_entity_type(
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.get_entity_type(entity_type_id, driver)


@router.put("/entity-types/{entity_type_id}", response_model=EntityTypeResponse)
async def update_entity_type(
    entity_type_id: str,
    body: EntityTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_entity_type(entity_type_id, body, driver)


@router.delete("/entity-types/{entity_type_id}", status_code=204)
async def delete_entity_type(
    entity_type_id: str,
    cascade: bool = Query(default=False),
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_entity_type(entity_type_id, cascade=cascade, driver=driver)
    return Response(status_code=204)


# --- Relation Types (Global) ---


@router.post("/relation-types", response_model=RelationTypeResponse, status_code=201)
async def create_relation_type(
    body: RelationTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_relation_type(body, driver)


@router.get("/relation-types", response_model=list[RelationTypeResponse])
async def list_relation_types(
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_relation_types(driver)


@router.get("/relation-types/{relation_type_id}", response_model=RelationTypeResponse)
async def get_relation_type(
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.get_relation_type(relation_type_id, driver)


@router.put("/relation-types/{relation_type_id}", response_model=RelationTypeResponse)
async def update_relation_type(
    relation_type_id: str,
    body: RelationTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_relation_type(relation_type_id, body, driver)


@router.delete("/relation-types/{relation_type_id}", status_code=204)
async def delete_relation_type(
    relation_type_id: str,
    cascade: bool = Query(default=False),
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_relation_type(relation_type_id, cascade=cascade, driver=driver)
    return Response(status_code=204)


# --- Entity Type Properties ---


@router.post(
    "/entity-types/{entity_type_id}/properties",
    response_model=PropertyDefinitionResponse,
    status_code=201,
)
async def create_entity_type_property(
    entity_type_id: str,
    body: PropertyDefinitionCreate,
    cascade: bool = Query(default=False),
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_property(
        entity_type_id, "EntityType", body, cascade=cascade, driver=driver
    )


@router.get(
    "/entity-types/{entity_type_id}/properties",
    response_model=list[PropertyDefinitionResponse],
)
async def list_entity_type_properties(
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_properties(entity_type_id, "EntityType", driver)


@router.put(
    "/entity-types/{entity_type_id}/properties/{property_id}",
    response_model=PropertyDefinitionResponse,
)
async def update_entity_type_property(
    entity_type_id: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_property(
        entity_type_id, "EntityType", property_id, body, driver
    )


@router.delete(
    "/entity-types/{entity_type_id}/properties/{property_id}",
    status_code=204,
)
async def delete_entity_type_property(
    entity_type_id: str,
    property_id: str,
    cascade: bool = Query(default=False),
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_property(
        entity_type_id, "EntityType", property_id, cascade=cascade, driver=driver
    )
    return Response(status_code=204)


# --- Relation Type Properties ---


@router.post(
    "/relation-types/{relation_type_id}/properties",
    response_model=PropertyDefinitionResponse,
    status_code=201,
)
async def create_relation_type_property(
    relation_type_id: str,
    body: PropertyDefinitionCreate,
    cascade: bool = Query(default=False),
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_property(
        relation_type_id, "RelationType", body, cascade=cascade, driver=driver
    )


@router.get(
    "/relation-types/{relation_type_id}/properties",
    response_model=list[PropertyDefinitionResponse],
)
async def list_relation_type_properties(
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_properties(relation_type_id, "RelationType", driver)


@router.put(
    "/relation-types/{relation_type_id}/properties/{property_id}",
    response_model=PropertyDefinitionResponse,
)
async def update_relation_type_property(
    relation_type_id: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_property(
        relation_type_id, "RelationType", property_id, body, driver
    )


@router.delete(
    "/relation-types/{relation_type_id}/properties/{property_id}",
    status_code=204,
)
async def delete_relation_type_property(
    relation_type_id: str,
    property_id: str,
    cascade: bool = Query(default=False),
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_property(
        relation_type_id, "RelationType", property_id, cascade=cascade, driver=driver
    )
    return Response(status_code=204)


# --- Scope Management ---


@router.post(
    "/ontologies/{ontology_id}/includes/entity-types",
    response_model=IncludeTypeResponse,
    status_code=201,
)
async def add_includes_entity_type(
    ontology_id: str,
    body: IncludeTypeRequest,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.add_includes_entity_type(ontology_id, body, driver)


@router.get(
    "/ontologies/{ontology_id}/includes/entity-types",
    response_model=list[IncludeTypeResponse],
)
async def list_includes_entity_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_includes_entity_types(ontology_id, driver)


@router.put(
    "/ontologies/{ontology_id}/includes/entity-types/{type_id}",
    response_model=IncludeTypeResponse,
)
async def update_includes_entity_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_includes_entity_type(ontology_id, type_id, body, driver)


@router.delete(
    "/ontologies/{ontology_id}/includes/entity-types/{type_id}",
    status_code=204,
)
async def remove_includes_entity_type(
    ontology_id: str,
    type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.remove_includes_entity_type(ontology_id, type_id, driver)
    return Response(status_code=204)


@router.post(
    "/ontologies/{ontology_id}/includes/relation-types",
    response_model=IncludeTypeResponse,
    status_code=201,
)
async def add_includes_relation_type(
    ontology_id: str,
    body: IncludeTypeRequest,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.add_includes_relation_type(ontology_id, body, driver)


@router.get(
    "/ontologies/{ontology_id}/includes/relation-types",
    response_model=list[IncludeTypeResponse],
)
async def list_includes_relation_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_includes_relation_types(ontology_id, driver)


@router.put(
    "/ontologies/{ontology_id}/includes/relation-types/{type_id}",
    response_model=IncludeTypeResponse,
)
async def update_includes_relation_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_includes_relation_type(ontology_id, type_id, body, driver)


@router.delete(
    "/ontologies/{ontology_id}/includes/relation-types/{type_id}",
    status_code=204,
)
async def remove_includes_relation_type(
    ontology_id: str,
    type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.remove_includes_relation_type(ontology_id, type_id, driver)
    return Response(status_code=204)


# --- Ontology Validation ---


@router.post(
    "/ontologies/{ontology_id}/validate",
    response_model=ValidationResult,
)
async def validate_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.validate_ontology(ontology_id, driver)


# --- Schema Validation ---


@router.post(
    "/schema/validate",
    response_model=ValidationResult,
)
async def validate_schema(
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.validate_all(driver)


# --- Export / Import ---


@router.get("/export")
async def export_schema(
    driver: AsyncDriver = Depends(get_driver),
):
    payload = await service.export_schema(driver)
    return payload.model_dump(by_alias=True)


@router.post("/import", status_code=201)
async def import_schema(
    payload: ExportPayload,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.import_schema(payload, driver)
