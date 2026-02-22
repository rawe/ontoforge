import contextvars

from starlette._utils import get_route_path
from starlette.types import ASGIApp, Receive, Scope, Send

current_ontology_key: contextvars.ContextVar[str] = contextvars.ContextVar(
    "ontology_key"
)


class OntologyKeyMiddleware:
    """ASGI middleware that extracts /{ontologyKey} from the path prefix,
    stores it in a ContextVar, and forwards the remainder to the wrapped app.

    Starlette's Mount does NOT rewrite ``scope["path"]``; it sets
    ``scope["root_path"]`` instead.  We therefore compute the relative path
    via ``get_route_path`` before splitting out the ontology key.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            relative_path = get_route_path(scope)
            parts = relative_path.strip("/").split("/", 1)
            if parts and parts[0]:
                ontology_key = parts[0]
                # Advance root_path so downstream sees only "/"
                scope = dict(scope)
                scope["root_path"] = scope.get("root_path", "") + "/" + ontology_key
                token = current_ontology_key.set(ontology_key)
                try:
                    await self.app(scope, receive, send)
                finally:
                    current_ontology_key.reset(token)
                return
        await self.app(scope, receive, send)


def mount_mcp(app) -> None:
    """Mount MCP endpoints on the FastAPI app.

    Instead of using ``modeling_mcp.streamable_http_app()`` (which creates a
    full Starlette app with its own lifespan that would conflict with our main
    lifespan), we mount the raw ASGI handler directly.  The session manager
    lifecycle is managed by the main FastAPI lifespan in ``main.py``.
    """
    from ontoforge_server.mcp.modeling import modeling_mcp

    # Ensure the session manager is created (lazy init inside FastMCP)
    if modeling_mcp._session_manager is None:
        from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

        modeling_mcp._session_manager = StreamableHTTPSessionManager(
            app=modeling_mcp._mcp_server,
            event_store=modeling_mcp._event_store,
            json_response=modeling_mcp.settings.json_response,
            stateless=modeling_mcp.settings.stateless_http,
        )

    # The raw ASGI callable that delegates to session_manager.handle_request
    async def mcp_asgi_app(scope: Scope, receive: Receive, send: Send) -> None:
        await modeling_mcp.session_manager.handle_request(scope, receive, send)

    app.mount("/mcp/model", OntologyKeyMiddleware(mcp_asgi_app))
