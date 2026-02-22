from fastapi import APIRouter, Depends, Query, Request, Response
from neo4j import AsyncDriver

from ontoforge_server.core.database import get_driver
from ontoforge_server.core.schemas import ExportEntityType, ExportPayload, ExportRelationType
from ontoforge_server.runtime import service
from ontoforge_server.runtime.schemas import (
    NeighborhoodResponse,
    PaginatedResponse,
    ProvisionSummary,
    RelationInstanceCreate,
    SchemaResponse,
)

router = APIRouter(tags=["runtime"])


# --- Provision ---


@router.post("/provision", response_model=ProvisionSummary)
async def provision(
    body: ExportPayload,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.provision(body, driver)


# --- Schema Introspection ---


@router.get("/schema", response_model=SchemaResponse)
async def get_schema():
    return service.get_full_schema()


@router.get("/schema/entity-types", response_model=list[ExportEntityType])
async def list_entity_types():
    return service.list_entity_types()


@router.get("/schema/entity-types/{key}", response_model=ExportEntityType)
async def get_entity_type(key: str):
    return service.get_entity_type(key)


@router.get("/schema/relation-types", response_model=list[ExportRelationType])
async def list_relation_types():
    return service.list_relation_types()


@router.get("/schema/relation-types/{key}", response_model=ExportRelationType)
async def get_relation_type(key: str):
    return service.get_relation_type(key)


# --- Entity Instance CRUD ---


@router.post("/entities/{entity_type_key}", status_code=201)
async def create_entity(
    entity_type_key: str,
    request: Request,
    driver: AsyncDriver = Depends(get_driver),
):
    body = await request.json()
    return await service.create_entity(entity_type_key, body, driver)


@router.get("/entities/{entity_type_key}", response_model=PaginatedResponse)
async def list_entities(
    entity_type_key: str,
    request: Request,
    driver: AsyncDriver = Depends(get_driver),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(default="_createdAt"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    q: str | None = Query(default=None),
):
    # Parse filter.{key} params from the raw query string
    filters = service._parse_filters(dict(request.query_params))
    return await service.list_entities(
        entity_type_key, limit, offset, sort, order, q, filters, driver
    )


@router.get("/entities/{entity_type_key}/{entity_id}")
async def get_entity(
    entity_type_key: str,
    entity_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.get_entity(entity_type_key, entity_id, driver)


@router.patch("/entities/{entity_type_key}/{entity_id}")
async def update_entity(
    entity_type_key: str,
    entity_id: str,
    request: Request,
    driver: AsyncDriver = Depends(get_driver),
):
    body = await request.json()
    return await service.update_entity(entity_type_key, entity_id, body, driver)


@router.delete("/entities/{entity_type_key}/{entity_id}", status_code=204)
async def delete_entity(
    entity_type_key: str,
    entity_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_entity(entity_type_key, entity_id, driver)
    return Response(status_code=204)


# --- Graph Traversal ---


@router.get(
    "/entities/{entity_type_key}/{entity_id}/neighbors",
    response_model=NeighborhoodResponse,
)
async def get_neighbors(
    entity_type_key: str,
    entity_id: str,
    driver: AsyncDriver = Depends(get_driver),
    relation_type_key: str | None = Query(default=None, alias="relationTypeKey"),
    direction: str = Query(default="both", pattern="^(outgoing|incoming|both)$"),
    limit: int = Query(default=50, ge=1, le=200),
):
    return await service.get_neighbors(
        entity_type_key, entity_id, direction, relation_type_key, limit, driver
    )


# --- Relation Instance CRUD ---


@router.post("/relations/{relation_type_key}", status_code=201)
async def create_relation(
    relation_type_key: str,
    body: RelationInstanceCreate,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.create_relation(relation_type_key, body, driver)


@router.get("/relations/{relation_type_key}", response_model=PaginatedResponse)
async def list_relations(
    relation_type_key: str,
    request: Request,
    driver: AsyncDriver = Depends(get_driver),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(default="_createdAt"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    from_entity_id: str | None = Query(default=None, alias="fromEntityId"),
    to_entity_id: str | None = Query(default=None, alias="toEntityId"),
):
    filters = service._parse_filters(dict(request.query_params))
    return await service.list_relations(
        relation_type_key, limit, offset, sort, order,
        from_entity_id, to_entity_id, filters, driver,
    )


@router.get("/relations/{relation_type_key}/{relation_id}")
async def get_relation(
    relation_type_key: str,
    relation_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    return await service.get_relation(relation_type_key, relation_id, driver)


@router.patch("/relations/{relation_type_key}/{relation_id}")
async def update_relation(
    relation_type_key: str,
    relation_id: str,
    request: Request,
    driver: AsyncDriver = Depends(get_driver),
):
    body = await request.json()
    return await service.update_relation(relation_type_key, relation_id, body, driver)


@router.delete("/relations/{relation_type_key}/{relation_id}", status_code=204)
async def delete_relation(
    relation_type_key: str,
    relation_id: str,
    driver: AsyncDriver = Depends(get_driver),
):
    await service.delete_relation(relation_type_key, relation_id, driver)
    return Response(status_code=204)
