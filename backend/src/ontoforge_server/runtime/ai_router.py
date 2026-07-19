from fastapi import APIRouter, Depends, Request

from ontoforge_server.config import settings
from ontoforge_server.core.ai import DEFAULT_AGENT_CONFIG
from ontoforge_server.core.ports import get_runtime_store
from ontoforge_server.runtime import ai_service, service
from ontoforge_server.runtime.schemas import (
    AiChatRequest,
    AiChatResponse,
    AiExtractRequest,
    AiExtractResponse,
    AiQueryRequest,
    AiQueryResponse,
    AgentInfo,
)

router = APIRouter(tags=["ai"])


# --- Moved from runtime/router.py ---


@router.post("/{ontology_key}/ai/query", response_model=AiQueryResponse)
async def ai_query(
    ontology_key: str,
    body: AiQueryRequest,
    store=Depends(get_runtime_store),
):
    return await ai_service.ai_query(ontology_key, body.question, store)


@router.post("/{ontology_key}/ai/extract", response_model=AiExtractResponse)
async def ai_extract(
    ontology_key: str,
    body: AiExtractRequest,
    store=Depends(get_runtime_store),
):
    return await ai_service.ai_extract(
        ontology_key, body.text, store,
        entity_types=body.entity_types, create=body.create,
    )


@router.post("/{ontology_key}/ai/chat", response_model=AiChatResponse)
async def ai_chat(
    ontology_key: str,
    body: AiChatRequest,
    store=Depends(get_runtime_store),
):
    history = [h.model_dump() for h in body.history] if body.history else None
    return await ai_service.ai_chat(
        ontology_key, body.message, store,
        history=history, include_tool_calls=body.include_tool_calls,
    )


# --- New Agent Endpoints ---


@router.get("/{ontology_key}/ai/agents", response_model=list[AgentInfo])
async def list_agents(
    ontology_key: str,
    store=Depends(get_runtime_store),
):
    return await ai_service.list_runtime_agents(ontology_key, store)


@router.post("/{ontology_key}/ai/agents/{agent_key}/chat", response_model=AiChatResponse)
async def agent_chat(
    ontology_key: str,
    agent_key: str,
    body: AiChatRequest,
    store=Depends(get_runtime_store),
):
    history = [h.model_dump() for h in body.history] if body.history else None
    return await ai_service.ai_agent_chat(
        ontology_key, agent_key, body.message, store,
        history=history, include_tool_calls=body.include_tool_calls,
    )


# --- A2A / Agent Card Endpoints ---


def _get_base_url(request: Request) -> str:
    """Resolve base URL from PUBLIC_URL config or request Host header."""
    if settings.PUBLIC_URL:
        return settings.PUBLIC_URL.rstrip("/")
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("host", request.url.netloc)
    return f"{scheme}://{host}"


@router.get("/{ontology_key}/ai/.well-known/agent.json")
async def default_agent_card(
    ontology_key: str,
    request: Request,
    store=Depends(get_runtime_store),
):
    loaded = await service._load_schema(ontology_key, store)
    base_url = _get_base_url(request)
    return ai_service.build_agent_card(DEFAULT_AGENT_CONFIG, loaded.scoped, base_url)


@router.post("/{ontology_key}/ai/a2a")
async def default_a2a_task(
    ontology_key: str,
    request: Request,
    store=Depends(get_runtime_store),
):
    request_body = await request.json()
    return await ai_service.handle_a2a_task(
        DEFAULT_AGENT_CONFIG, ontology_key, request_body, store
    )


@router.get("/{ontology_key}/ai/agents/{agent_key}/.well-known/agent.json")
async def agent_card(
    ontology_key: str,
    agent_key: str,
    request: Request,
    store=Depends(get_runtime_store),
):
    from ontoforge_server.core.exceptions import NotFoundError

    loaded = await service._load_schema(ontology_key, store)
    config = loaded.agent_configs.get(agent_key)
    if not config:
        raise NotFoundError(f"AI agent '{agent_key}' not found")
    base_url = _get_base_url(request)
    return ai_service.build_agent_card(config, loaded.scoped, base_url)


@router.post("/{ontology_key}/ai/agents/{agent_key}/a2a")
async def agent_a2a_task(
    ontology_key: str,
    agent_key: str,
    request: Request,
    store=Depends(get_runtime_store),
):
    from ontoforge_server.core.exceptions import NotFoundError

    loaded = await service._load_schema(ontology_key, store)
    config = loaded.agent_configs.get(agent_key)
    if not config:
        raise NotFoundError(f"AI agent '{agent_key}' not found")
    request_body = await request.json()
    return await ai_service.handle_a2a_task(
        config, ontology_key, request_body, store
    )
