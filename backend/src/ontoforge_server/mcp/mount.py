import contextvars
import os

from starlette._utils import get_route_path
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ontoforge_server.mcp.constants import (
    DEFAULT_MCP_ONTOLOGY_KEY_ENV,
    ONTOLOGY_KEY_HEADER,
)

current_ontology_key: contextvars.ContextVar[str] = contextvars.ContextVar(
    "ontology_key"
)


class OntologyKeyMiddleware:
    """ASGI middleware that resolves the ontology key from three sources
    (in priority order) and stores it in a ContextVar:

    1. **URL path** — ``/{ontologyKey}/...`` extracted from the request path
    2. **HTTP header** — ``X-Ontology-Key``
    3. **Environment variable** — ``DEFAULT_MCP_ONTOLOGY_KEY``

    If none provide a key, returns 400.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        # --- 1. Try URL path ---
        relative_path = get_route_path(scope)
        parts = relative_path.strip("/").split("/", 1)
        url_key = parts[0] if parts and parts[0] else None

        if url_key:
            scope = dict(scope)
            scope["root_path"] = scope.get("root_path", "") + "/" + url_key
            token = current_ontology_key.set(url_key)
            try:
                await self.app(scope, receive, send)
            finally:
                current_ontology_key.reset(token)
            return

        # --- 2. Try X-Ontology-Key header ---
        header_key = _get_header(scope, ONTOLOGY_KEY_HEADER)
        if header_key:
            token = current_ontology_key.set(header_key)
            try:
                await self.app(scope, receive, send)
            finally:
                current_ontology_key.reset(token)
            return

        # --- 3. Try DEFAULT_MCP_ONTOLOGY_KEY env var ---
        env_key = os.environ.get(DEFAULT_MCP_ONTOLOGY_KEY_ENV)
        if env_key:
            token = current_ontology_key.set(env_key)
            try:
                await self.app(scope, receive, send)
            finally:
                current_ontology_key.reset(token)
            return

        # --- 4. No key found ---
        response = PlainTextResponse("Ontology key required", status_code=400)
        await response(scope, receive, send)


def _get_header(scope: Scope, name: str) -> str | None:
    name_lower = name.lower().encode("latin-1")
    for header_name, header_value in scope.get("headers", []):
        if header_name == name_lower:
            return header_value.decode("latin-1")
    return None


def _ensure_session_manager(mcp_instance) -> None:
    if mcp_instance._session_manager is None:
        from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

        mcp_instance._session_manager = StreamableHTTPSessionManager(
            app=mcp_instance._mcp_server,
            event_store=mcp_instance._event_store,
            json_response=mcp_instance.settings.json_response,
            stateless=mcp_instance.settings.stateless_http,
        )


def mount_mcp(app) -> None:
    """Mount MCP endpoints on the FastAPI app.

    Modeling MCP is mounted directly (no middleware — tools use explicit ontology_key parameter).
    Runtime MCP uses OntologyKeyMiddleware for key resolution.
    """
    from ontoforge_server.mcp.modeling import modeling_mcp
    from ontoforge_server.mcp.runtime import runtime_mcp

    # --- Modeling MCP (no middleware) ---
    _ensure_session_manager(modeling_mcp)

    async def modeling_asgi_app(scope: Scope, receive: Receive, send: Send) -> None:
        await modeling_mcp.session_manager.handle_request(scope, receive, send)

    app.mount("/mcp/model", modeling_asgi_app)

    # --- Runtime MCP (with middleware) ---
    _ensure_session_manager(runtime_mcp)

    async def runtime_asgi_app(scope: Scope, receive: Receive, send: Send) -> None:
        await runtime_mcp.session_manager.handle_request(scope, receive, send)

    app.mount("/mcp/runtime", OntologyKeyMiddleware(runtime_asgi_app))
