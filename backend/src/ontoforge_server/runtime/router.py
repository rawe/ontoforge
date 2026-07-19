from fastapi import APIRouter, Depends, Query, Request, Response

from ontoforge_server.config import settings
from ontoforge_server.core.ports import get_runtime_store
from ontoforge_server.core.schemas import ExportEntityType, ExportRelationType
from ontoforge_server.runtime import service
from ontoforge_server.runtime.schemas import (
    QueryRequest,
    QueryResponse,
    DocumentContentResponse,
    DocumentEditRequest,
    DocumentEditResponse,
    FeaturesResponse,
    NeighborhoodResponse,
    PaginatedResponse,
    RelationInstanceCreate,
    SavedQueryRunRequest,
    SchemaResponse,
    SemanticSearchResponse,
)

router = APIRouter(tags=["runtime"])
global_router = APIRouter(tags=["runtime"])


@global_router.get("/features", response_model=FeaturesResponse)
async def get_features():
    return FeaturesResponse(
        semanticSearch=bool(settings.EMBEDDING_PROVIDER),
        ai=bool(settings.AI_PROVIDER),
    )


# --- Schema Introspection ---


@router.get("/schema", response_model=SchemaResponse)
async def get_schema(ontology_key: str, store=Depends(get_runtime_store)):
    return await service.get_full_schema(ontology_key, store)


@router.get("/schema/entity-types", response_model=list[ExportEntityType])
async def list_entity_types(ontology_key: str, store=Depends(get_runtime_store)):
    return await service.list_entity_types(ontology_key, store)


@router.get("/schema/entity-types/{key}", response_model=ExportEntityType)
async def get_entity_type(ontology_key: str, key: str, store=Depends(get_runtime_store)):
    return await service.get_entity_type(ontology_key, key, store)


@router.get("/schema/relation-types", response_model=list[ExportRelationType])
async def list_relation_types(ontology_key: str, store=Depends(get_runtime_store)):
    return await service.list_relation_types(ontology_key, store)


@router.get("/schema/relation-types/{key}", response_model=ExportRelationType)
async def get_relation_type(ontology_key: str, key: str, store=Depends(get_runtime_store)):
    return await service.get_relation_type(ontology_key, key, store)


# --- Semantic Search ---


@router.get("/search/semantic", response_model=SemanticSearchResponse)
async def semantic_search(
    ontology_key: str,
    request: Request,
    q: str = Query(..., min_length=1),
    type: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=100),
    min_score: float | None = Query(default=None, ge=0.0, le=1.0),
    fields: list[str] | None = Query(default=None),
    search_in: str = Query(default="all", alias="searchIn", pattern="^(entities|documents|all)$"),
    snippets: bool = Query(default=True),
    store=Depends(get_runtime_store),
):
    filters = service._parse_filters(dict(request.query_params))
    return await service.semantic_search(
        ontology_key, q, type, limit, min_score, store, filters=filters,
        fields=fields, search_in=search_in, snippets=snippets,
    )


# --- Entity Instance CRUD ---


@router.post("/entities/{entity_type_key}", status_code=201)
async def create_entity(
    ontology_key: str,
    entity_type_key: str,
    request: Request,
    store=Depends(get_runtime_store),
):
    body = await request.json()
    return await service.create_entity(ontology_key, entity_type_key, body, store)


@router.get("/entities/{entity_type_key}", response_model=PaginatedResponse)
async def list_entities(
    ontology_key: str,
    entity_type_key: str,
    request: Request,
    store=Depends(get_runtime_store),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(default="_createdAt"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    q: str | None = Query(default=None),
    fields: list[str] | None = Query(default=None),
):
    filters = service._parse_filters(dict(request.query_params))
    return await service.list_entities(
        ontology_key, entity_type_key, limit, offset, sort, order, q, filters, store,
        fields=fields,
    )


@router.get("/entities/{entity_type_key}/{entity_id}")
async def get_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    fields: list[str] | None = Query(default=None),
    store=Depends(get_runtime_store),
):
    return await service.get_entity(
        ontology_key, entity_type_key, entity_id, store, fields=fields
    )


@router.patch("/entities/{entity_type_key}/{entity_id}")
async def update_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    request: Request,
    store=Depends(get_runtime_store),
):
    body = await request.json()
    return await service.update_entity(ontology_key, entity_type_key, entity_id, body, store)


@router.delete("/entities/{entity_type_key}/{entity_id}", status_code=204)
async def delete_entity(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    store=Depends(get_runtime_store),
):
    await service.delete_entity(ontology_key, entity_type_key, entity_id, store)
    return Response(status_code=204)


# --- Document Properties ---


@router.get(
    "/entities/{entity_type_key}/{entity_id}/documents/{property_key}",
    response_model=DocumentContentResponse,
)
async def get_document(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    offset: int = Query(default=0, ge=0),
    limit: int | None = Query(default=None, ge=1),
    store=Depends(get_runtime_store),
):
    return await service.get_document(
        ontology_key, entity_type_key, entity_id, property_key, offset, limit, store
    )


@router.patch(
    "/entities/{entity_type_key}/{entity_id}/documents/{property_key}",
    response_model=DocumentEditResponse,
)
async def edit_document(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    property_key: str,
    body: DocumentEditRequest,
    store=Depends(get_runtime_store),
):
    return await service.edit_document(
        ontology_key, entity_type_key, entity_id, property_key, body, store
    )


# --- Graph Traversal ---


@router.get(
    "/entities/{entity_type_key}/{entity_id}/neighbors",
    response_model=NeighborhoodResponse,
)
async def get_neighbors(
    ontology_key: str,
    entity_type_key: str,
    entity_id: str,
    store=Depends(get_runtime_store),
    relation_type_key: str | None = Query(default=None, alias="relationTypeKey"),
    direction: str = Query(default="both", pattern="^(outgoing|incoming|both)$"),
    limit: int = Query(default=50, ge=1, le=200),
    fields: list[str] | None = Query(default=None),
    relation_fields: list[str] | None = Query(default=None, alias="relationFields"),
):
    return await service.get_neighbors(
        ontology_key, entity_type_key, entity_id, direction, relation_type_key, limit, store,
        fields=fields, relation_fields=relation_fields,
    )


# --- Relation Instance CRUD ---


@router.post("/relations/{relation_type_key}", status_code=201)
async def create_relation(
    ontology_key: str,
    relation_type_key: str,
    body: RelationInstanceCreate,
    store=Depends(get_runtime_store),
):
    return await service.create_relation(ontology_key, relation_type_key, body, store)


@router.get("/relations/{relation_type_key}", response_model=PaginatedResponse)
async def list_relations(
    ontology_key: str,
    relation_type_key: str,
    request: Request,
    store=Depends(get_runtime_store),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(default="_createdAt"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    from_entity_id: str | None = Query(default=None, alias="fromEntityId"),
    to_entity_id: str | None = Query(default=None, alias="toEntityId"),
):
    filters = service._parse_filters(dict(request.query_params))
    return await service.list_relations(
        ontology_key, relation_type_key, limit, offset, sort, order,
        from_entity_id, to_entity_id, filters, store,
    )


@router.get("/relations/{relation_type_key}/{relation_id}")
async def get_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    store=Depends(get_runtime_store),
):
    return await service.get_relation(ontology_key, relation_type_key, relation_id, store)


@router.patch("/relations/{relation_type_key}/{relation_id}")
async def update_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    request: Request,
    store=Depends(get_runtime_store),
):
    body = await request.json()
    return await service.update_relation(ontology_key, relation_type_key, relation_id, body, store)


@router.delete("/relations/{relation_type_key}/{relation_id}", status_code=204)
async def delete_relation(
    ontology_key: str,
    relation_type_key: str,
    relation_id: str,
    store=Depends(get_runtime_store),
):
    await service.delete_relation(ontology_key, relation_type_key, relation_id, store)
    return Response(status_code=204)


# --- OQL Query ---


@router.post("/query", response_model=QueryResponse)
async def run_query(
    ontology_key: str,
    body: QueryRequest,
    store=Depends(get_runtime_store),
):
    """Execute a read-only OQL query scoped to the ontology."""
    return await service.execute_query(ontology_key, body.query, store)


# --- Saved Queries ---


@router.get("/saved-queries")
async def list_saved_queries(
    ontology_key: str,
    store=Depends(get_runtime_store),
):
    loaded = await service._load_schema(ontology_key, store)
    return [
        {
            "key": sq.key,
            "name": sq.name,
            "description": sq.description,
            "steps": [
                {
                    "name": s.name,
                    "type": s.type,
                    **({"oql": s.oql} if s.oql else {}),
                    **({"entityTypeKey": s.entity_type_key} if s.entity_type_key else {}),
                    **({"query": s.query} if s.query else {}),
                    **({"limit": s.limit} if s.limit is not None else {}),
                    **({"minScore": s.min_score} if s.min_score is not None else {}),
                    **({"bindings": s.bindings} if s.bindings else {}),
                }
                for s in sq.steps
            ],
            "parameters": [
                {"name": p.name, "description": p.description, "dataType": p.data_type}
                for p in sq.parameters
            ],
        }
        for sq in loaded.saved_queries.values()
    ]


@router.get("/saved-queries/search")
async def search_saved_queries(
    ontology_key: str,
    q: str = Query(..., min_length=1),
    limit: int = Query(default=3, ge=1, le=20),
    min_score: float | None = Query(default=0.7, ge=0.0, le=1.0),
    store=Depends(get_runtime_store),
):
    return await service.search_saved_queries(
        ontology_key, q, limit, min_score, store
    )


@router.post("/saved-queries/{query_key}/run")
async def run_saved_query(
    ontology_key: str,
    query_key: str,
    body: SavedQueryRunRequest,
    store=Depends(get_runtime_store),
):
    return await service.execute_saved_query(ontology_key, query_key, body.params, store)
