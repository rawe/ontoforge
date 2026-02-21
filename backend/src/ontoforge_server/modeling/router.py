from fastapi import APIRouter, Depends, Query, Response
from neo4j import AsyncDriver

from ontoforge_server.core.database import get_driver
from ontoforge_server.modeling import service
from ontoforge_server.modeling.schemas import (
    EntityTypeCreate,
    EntityTypeResponse,
    EntityTypeUpdate,
    ExportPayload,
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


# --- Entity Types ---


@router.post(
    "/ontologies/{ontology_id}/entity-types",
    response_model=EntityTypeResponse,
    status_code=201,
)
async def create_entity_type(
    ontology_id: str,
    body: EntityTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_entity_type(ontology_id, body, driver)


@router.get(
    "/ontologies/{ontology_id}/entity-types",
    response_model=list[EntityTypeResponse],
)
async def list_entity_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_entity_types(ontology_id, driver)


@router.get(
    "/ontologies/{ontology_id}/entity-types/{entity_type_id}",
    response_model=EntityTypeResponse,
)
async def get_entity_type(
    ontology_id: str,
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.get_entity_type(ontology_id, entity_type_id, driver)


@router.put(
    "/ontologies/{ontology_id}/entity-types/{entity_type_id}",
    response_model=EntityTypeResponse,
)
async def update_entity_type(
    ontology_id: str,
    entity_type_id: str,
    body: EntityTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_entity_type(ontology_id, entity_type_id, body, driver)


@router.delete(
    "/ontologies/{ontology_id}/entity-types/{entity_type_id}",
    status_code=204,
)
async def delete_entity_type(
    ontology_id: str,
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_entity_type(ontology_id, entity_type_id, driver)
    return Response(status_code=204)


# --- Relation Types ---


@router.post(
    "/ontologies/{ontology_id}/relation-types",
    response_model=RelationTypeResponse,
    status_code=201,
)
async def create_relation_type(
    ontology_id: str,
    body: RelationTypeCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_relation_type(ontology_id, body, driver)


@router.get(
    "/ontologies/{ontology_id}/relation-types",
    response_model=list[RelationTypeResponse],
)
async def list_relation_types(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_relation_types(ontology_id, driver)


@router.get(
    "/ontologies/{ontology_id}/relation-types/{relation_type_id}",
    response_model=RelationTypeResponse,
)
async def get_relation_type(
    ontology_id: str,
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.get_relation_type(ontology_id, relation_type_id, driver)


@router.put(
    "/ontologies/{ontology_id}/relation-types/{relation_type_id}",
    response_model=RelationTypeResponse,
)
async def update_relation_type(
    ontology_id: str,
    relation_type_id: str,
    body: RelationTypeUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_relation_type(
        ontology_id, relation_type_id, body, driver
    )


@router.delete(
    "/ontologies/{ontology_id}/relation-types/{relation_type_id}",
    status_code=204,
)
async def delete_relation_type(
    ontology_id: str,
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_relation_type(ontology_id, relation_type_id, driver)
    return Response(status_code=204)


# --- Entity Type Properties ---


@router.post(
    "/ontologies/{ontology_id}/entity-types/{entity_type_id}/properties",
    response_model=PropertyDefinitionResponse,
    status_code=201,
)
async def create_entity_type_property(
    ontology_id: str,
    entity_type_id: str,
    body: PropertyDefinitionCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_property(
        ontology_id, entity_type_id, "EntityType", body, driver
    )


@router.get(
    "/ontologies/{ontology_id}/entity-types/{entity_type_id}/properties",
    response_model=list[PropertyDefinitionResponse],
)
async def list_entity_type_properties(
    ontology_id: str,
    entity_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_properties(
        ontology_id, entity_type_id, "EntityType", driver
    )


@router.put(
    "/ontologies/{ontology_id}/entity-types/{entity_type_id}/properties/{property_id}",
    response_model=PropertyDefinitionResponse,
)
async def update_entity_type_property(
    ontology_id: str,
    entity_type_id: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_property(
        ontology_id, entity_type_id, "EntityType", property_id, body, driver
    )


@router.delete(
    "/ontologies/{ontology_id}/entity-types/{entity_type_id}/properties/{property_id}",
    status_code=204,
)
async def delete_entity_type_property(
    ontology_id: str,
    entity_type_id: str,
    property_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_property(
        ontology_id, entity_type_id, "EntityType", property_id, driver
    )
    return Response(status_code=204)


# --- Relation Type Properties ---


@router.post(
    "/ontologies/{ontology_id}/relation-types/{relation_type_id}/properties",
    response_model=PropertyDefinitionResponse,
    status_code=201,
)
async def create_relation_type_property(
    ontology_id: str,
    relation_type_id: str,
    body: PropertyDefinitionCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_property(
        ontology_id, relation_type_id, "RelationType", body, driver
    )


@router.get(
    "/ontologies/{ontology_id}/relation-types/{relation_type_id}/properties",
    response_model=list[PropertyDefinitionResponse],
)
async def list_relation_type_properties(
    ontology_id: str,
    relation_type_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.list_properties(
        ontology_id, relation_type_id, "RelationType", driver
    )


@router.put(
    "/ontologies/{ontology_id}/relation-types/{relation_type_id}/properties/{property_id}",
    response_model=PropertyDefinitionResponse,
)
async def update_relation_type_property(
    ontology_id: str,
    relation_type_id: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.update_property(
        ontology_id, relation_type_id, "RelationType", property_id, body, driver
    )


@router.delete(
    "/ontologies/{ontology_id}/relation-types/{relation_type_id}/properties/{property_id}",
    status_code=204,
)
async def delete_relation_type_property(
    ontology_id: str,
    relation_type_id: str,
    property_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_property(
        ontology_id, relation_type_id, "RelationType", property_id, driver
    )
    return Response(status_code=204)


# --- Schema Validation ---


@router.post(
    "/ontologies/{ontology_id}/validate",
    response_model=ValidationResult,
)
async def validate_schema(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.validate_schema(ontology_id, driver)


# --- Export / Import ---


@router.get("/ontologies/{ontology_id}/export")
async def export_ontology(
    ontology_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    payload = await service.export_ontology(ontology_id, driver)
    return payload.model_dump(by_alias=True)


@router.post("/import", response_model=OntologyResponse, status_code=201)
async def import_ontology(
    payload: ExportPayload,
    overwrite: bool = Query(default=False),
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.import_ontology(payload, overwrite, driver)
