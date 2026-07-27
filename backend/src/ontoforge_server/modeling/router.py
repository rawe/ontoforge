from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse

from ontoforge_server.core.ports import get_modeling_store, get_runtime_store
from ontoforge_server.core.embedding import get_embedding_provider
from ontoforge_server.core.exceptions import ValidationError
from ontoforge_server.modeling import service
from ontoforge_server.modeling.schemas import (
    AiAgentConfigResponse,
    AiAgentConfigUpsert,
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
    SavedQueryResponse,
    SavedQueryUpsert,
    ValidationResult,
)

router = APIRouter(tags=["modeling"])


# --- Ontologies ---


@router.post("/ontologies", response_model=OntologyResponse, status_code=201)
async def create_ontology(
    body: OntologyCreate,
    store=Depends(get_modeling_store),
):
    return await service.create_ontology(body, store)


@router.get("/ontologies", response_model=list[OntologyResponse])
async def list_ontologies(
    store=Depends(get_modeling_store),
):
    return await service.list_ontologies(store)


@router.get("/ontologies/{ontology_id}", response_model=OntologyResponse)
async def get_ontology(
    ontology_id: str,
    store=Depends(get_modeling_store),
):
    return await service.get_ontology(ontology_id, store)


@router.put("/ontologies/{ontology_id}", response_model=OntologyResponse)
async def update_ontology(
    ontology_id: str,
    body: OntologyUpdate,
    store=Depends(get_modeling_store),
):
    return await service.update_ontology(ontology_id, body, store)


@router.delete("/ontologies/{ontology_id}", status_code=204)
async def delete_ontology(
    ontology_id: str,
    store=Depends(get_modeling_store),
):
    await service.delete_ontology(ontology_id, store)
    return Response(status_code=204)


# --- Entity Types (Global) ---


@router.post("/entity-types", response_model=EntityTypeResponse, status_code=201)
async def create_entity_type(
    body: EntityTypeCreate,
    store=Depends(get_modeling_store),
):
    return await service.create_entity_type(body, store)


@router.get("/entity-types", response_model=list[EntityTypeResponse])
async def list_entity_types(
    store=Depends(get_modeling_store),
):
    return await service.list_entity_types(store)


@router.get("/entity-types/{entity_type_id}", response_model=EntityTypeResponse)
async def get_entity_type(
    entity_type_id: str,
    store=Depends(get_modeling_store),
):
    return await service.get_entity_type(entity_type_id, store)


@router.put("/entity-types/{entity_type_id}", response_model=EntityTypeResponse)
async def update_entity_type(
    entity_type_id: str,
    body: EntityTypeUpdate,
    store=Depends(get_modeling_store),
):
    return await service.update_entity_type(entity_type_id, body, store)


@router.delete("/entity-types/{entity_type_id}", status_code=204)
async def delete_entity_type(
    entity_type_id: str,
    cascade: bool = Query(default=False),
    store=Depends(get_modeling_store),
):
    await service.delete_entity_type(entity_type_id, cascade=cascade, store=store)
    return Response(status_code=204)


# --- Relation Types (Global) ---


@router.post("/relation-types", response_model=RelationTypeResponse, status_code=201)
async def create_relation_type(
    body: RelationTypeCreate,
    store=Depends(get_modeling_store),
):
    return await service.create_relation_type(body, store)


@router.get("/relation-types", response_model=list[RelationTypeResponse])
async def list_relation_types(
    store=Depends(get_modeling_store),
):
    return await service.list_relation_types(store)


@router.get("/relation-types/{relation_type_id}", response_model=RelationTypeResponse)
async def get_relation_type(
    relation_type_id: str,
    store=Depends(get_modeling_store),
):
    return await service.get_relation_type(relation_type_id, store)


@router.put("/relation-types/{relation_type_id}", response_model=RelationTypeResponse)
async def update_relation_type(
    relation_type_id: str,
    body: RelationTypeUpdate,
    store=Depends(get_modeling_store),
):
    return await service.update_relation_type(relation_type_id, body, store)


@router.delete("/relation-types/{relation_type_id}", status_code=204)
async def delete_relation_type(
    relation_type_id: str,
    cascade: bool = Query(default=False),
    store=Depends(get_modeling_store),
):
    await service.delete_relation_type(relation_type_id, cascade=cascade, store=store)
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
    store=Depends(get_modeling_store),
):
    return await service.create_property(
        entity_type_id, "EntityType", body, cascade=cascade, store=store
    )


@router.get(
    "/entity-types/{entity_type_id}/properties",
    response_model=list[PropertyDefinitionResponse],
)
async def list_entity_type_properties(
    entity_type_id: str,
    store=Depends(get_modeling_store),
):
    return await service.list_properties(entity_type_id, "EntityType", store)


@router.put(
    "/entity-types/{entity_type_id}/properties/{property_id}",
    response_model=PropertyDefinitionResponse,
)
async def update_entity_type_property(
    entity_type_id: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    store=Depends(get_modeling_store),
):
    return await service.update_property(
        entity_type_id, "EntityType", property_id, body, store
    )


@router.delete(
    "/entity-types/{entity_type_id}/properties/{property_id}",
    status_code=204,
)
async def delete_entity_type_property(
    entity_type_id: str,
    property_id: str,
    cascade: bool = Query(default=False),
    store=Depends(get_modeling_store),
):
    await service.delete_property(
        entity_type_id, "EntityType", property_id, cascade=cascade, store=store
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
    store=Depends(get_modeling_store),
):
    return await service.create_property(
        relation_type_id, "RelationType", body, cascade=cascade, store=store
    )


@router.get(
    "/relation-types/{relation_type_id}/properties",
    response_model=list[PropertyDefinitionResponse],
)
async def list_relation_type_properties(
    relation_type_id: str,
    store=Depends(get_modeling_store),
):
    return await service.list_properties(relation_type_id, "RelationType", store)


@router.put(
    "/relation-types/{relation_type_id}/properties/{property_id}",
    response_model=PropertyDefinitionResponse,
)
async def update_relation_type_property(
    relation_type_id: str,
    property_id: str,
    body: PropertyDefinitionUpdate,
    store=Depends(get_modeling_store),
):
    return await service.update_property(
        relation_type_id, "RelationType", property_id, body, store
    )


@router.delete(
    "/relation-types/{relation_type_id}/properties/{property_id}",
    status_code=204,
)
async def delete_relation_type_property(
    relation_type_id: str,
    property_id: str,
    cascade: bool = Query(default=False),
    store=Depends(get_modeling_store),
):
    await service.delete_property(
        relation_type_id, "RelationType", property_id, cascade=cascade, store=store
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
    store=Depends(get_modeling_store),
):
    return await service.add_includes_entity_type(ontology_id, body, store)


@router.get(
    "/ontologies/{ontology_id}/includes/entity-types",
    response_model=list[IncludeTypeResponse],
)
async def list_includes_entity_types(
    ontology_id: str,
    store=Depends(get_modeling_store),
):
    return await service.list_includes_entity_types(ontology_id, store)


@router.put(
    "/ontologies/{ontology_id}/includes/entity-types/{type_id}",
    response_model=IncludeTypeResponse,
)
async def update_includes_entity_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    store=Depends(get_modeling_store),
):
    return await service.update_includes_entity_type(ontology_id, type_id, body, store)


@router.delete(
    "/ontologies/{ontology_id}/includes/entity-types/{type_id}",
    status_code=204,
)
async def remove_includes_entity_type(
    ontology_id: str,
    type_id: str,
    store=Depends(get_modeling_store),
):
    await service.remove_includes_entity_type(ontology_id, type_id, store)
    return Response(status_code=204)


@router.post(
    "/ontologies/{ontology_id}/includes/relation-types",
    response_model=IncludeTypeResponse,
    status_code=201,
)
async def add_includes_relation_type(
    ontology_id: str,
    body: IncludeTypeRequest,
    store=Depends(get_modeling_store),
):
    return await service.add_includes_relation_type(ontology_id, body, store)


@router.get(
    "/ontologies/{ontology_id}/includes/relation-types",
    response_model=list[IncludeTypeResponse],
)
async def list_includes_relation_types(
    ontology_id: str,
    store=Depends(get_modeling_store),
):
    return await service.list_includes_relation_types(ontology_id, store)


@router.put(
    "/ontologies/{ontology_id}/includes/relation-types/{type_id}",
    response_model=IncludeTypeResponse,
)
async def update_includes_relation_type(
    ontology_id: str,
    type_id: str,
    body: IncludeTypeUpdate,
    store=Depends(get_modeling_store),
):
    return await service.update_includes_relation_type(ontology_id, type_id, body, store)


@router.delete(
    "/ontologies/{ontology_id}/includes/relation-types/{type_id}",
    status_code=204,
)
async def remove_includes_relation_type(
    ontology_id: str,
    type_id: str,
    store=Depends(get_modeling_store),
):
    await service.remove_includes_relation_type(ontology_id, type_id, store)
    return Response(status_code=204)


# --- Ontology Validation ---


@router.post(
    "/ontologies/{ontology_id}/validate",
    response_model=ValidationResult,
)
async def validate_ontology(
    ontology_id: str,
    store=Depends(get_modeling_store),
):
    return await service.validate_ontology(ontology_id, store)


# --- Schema Validation ---


@router.post(
    "/schema/validate",
    response_model=ValidationResult,
)
async def validate_schema(
    store=Depends(get_modeling_store),
):
    return await service.validate_all(store)


# --- Export / Import ---


@router.get("/export")
async def export_schema(
    store=Depends(get_modeling_store),
):
    payload = await service.export_schema(store)
    return payload.model_dump(by_alias=True)


@router.post("/import", status_code=201)
async def import_schema(
    payload: ExportPayload,
    store=Depends(get_modeling_store),
):
    return await service.import_schema(payload, store)


# --- AI Agent Config ---


@router.get(
    "/ontologies/{ontology_key}/ai-agents",
    response_model=list[AiAgentConfigResponse],
)
async def list_ai_agents(
    ontology_key: str,
    store=Depends(get_modeling_store),
):
    return await service.list_ai_agents(ontology_key, store)


@router.put(
    "/ontologies/{ontology_key}/ai-agents/{agent_key}",
    response_model=AiAgentConfigResponse,
)
async def upsert_ai_agent(
    ontology_key: str,
    agent_key: str,
    body: AiAgentConfigUpsert,
    response: Response,
    store=Depends(get_modeling_store),
):
    result, created = await service.upsert_ai_agent(ontology_key, agent_key, body, store)
    response.status_code = 201 if created else 200
    return result


@router.delete(
    "/ontologies/{ontology_key}/ai-agents/{agent_key}",
    status_code=204,
)
async def delete_ai_agent(
    ontology_key: str,
    agent_key: str,
    store=Depends(get_modeling_store),
):
    await service.delete_ai_agent(ontology_key, agent_key, store)
    return Response(status_code=204)


# --- Saved Query Config ---


@router.get(
    "/ontologies/{ontology_key}/saved-queries",
    response_model=list[SavedQueryResponse],
)
async def list_saved_queries(
    ontology_key: str,
    store=Depends(get_modeling_store),
):
    return await service.list_saved_queries(ontology_key, store)


@router.put(
    "/ontologies/{ontology_key}/saved-queries/{query_key}",
    response_model=SavedQueryResponse,
)
async def upsert_saved_query(
    ontology_key: str,
    query_key: str,
    body: SavedQueryUpsert,
    response: Response,
    store=Depends(get_modeling_store),
    runtime_store=Depends(get_runtime_store),
):
    result, created = await service.upsert_saved_query(
        ontology_key, query_key, body, store, runtime_store
    )
    response.status_code = 201 if created else 200
    return result


@router.delete(
    "/ontologies/{ontology_key}/saved-queries/{query_key}",
    status_code=204,
)
async def delete_saved_query(
    ontology_key: str,
    query_key: str,
    store=Depends(get_modeling_store),
):
    await service.delete_saved_query(ontology_key, query_key, store)
    return Response(status_code=204)


# --- Rebuild Embeddings ---


@router.post("/rebuild-embeddings")
async def rebuild_embeddings(
    store=Depends(get_modeling_store),
    runtime_store=Depends(get_runtime_store),
):
    provider = get_embedding_provider()
    if not provider:
        raise ValidationError(
            "Embedding provider is not configured. "
            "Set EMBEDDING_PROVIDER to enable semantic search."
        )
    return StreamingResponse(
        service.rebuild_embeddings(store, runtime_store),
        media_type="application/x-ndjson",
    )
