import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ontoforge_server.core.ai import init_ai_model
from ontoforge_server.core.embedding import (
    close_embedding_provider,
    get_embedding_provider,
    init_embedding_provider,
)
from ontoforge_server.core.ports import (
    close_stores,
    ensure_semantic_indexes,
    get_modeling_store,
    init_stores,
)
from ontoforge_server.core.exceptions import (
    CascadeRequiredError,
    ConflictError,
    NotFoundError,
    StoreError,
    ValidationError,
)
from ontoforge_server.mcp.modeling import modeling_mcp
from ontoforge_server.mcp.mount import mount_mcp
from ontoforge_server.mcp.runtime import runtime_mcp
from ontoforge_server.modeling.router import router as modeling_router
from ontoforge_server.runtime.ai_router import router as ai_router
from ontoforge_server.runtime.router import global_router as runtime_global_router
from ontoforge_server.runtime.router import router as runtime_router


logger = logging.getLogger(__name__)


async def _warn_about_reserved_type_keys_in_use() -> None:
    """Name any stored type whose key is now reserved.

    Such types can only predate the reserved-key check. They are left in
    place — renaming a type key is destructive and is the operator's call —
    but without this warning their only symptom is an unexplained 500 from
    the modeling API once instance data exists under them.
    """
    collisions = await get_modeling_store().find_reserved_type_keys_in_use()
    for collision in collisions:
        logger.warning(
            "Stored %s '%s' uses a reserved key. It predates the reserved-key "
            "check and can corrupt schema reads once instance data exists "
            "under it. Export its data, delete the type, and recreate it "
            "under a different key.",
            collision["kind"],
            collision["key"],
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_stores()
    await _warn_about_reserved_type_keys_in_use()
    await init_embedding_provider()
    init_ai_model()
    provider = get_embedding_provider()
    if provider:
        await ensure_semantic_indexes(provider.dimensions)
    async with modeling_mcp.session_manager.run():
        async with runtime_mcp.session_manager.run():
            yield
    await close_embedding_provider()
    await close_stores()


def _error_response(status: int, code: str, message: str, details: dict | None = None) -> JSONResponse:
    body: dict = {"error": {"code": code, "message": str(message)}}
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


def create_app() -> FastAPI:
    app = FastAPI(title="OntoForge", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(NotFoundError)
    async def not_found_handler(request: Request, exc: NotFoundError):
        return _error_response(404, "RESOURCE_NOT_FOUND", str(exc))

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, exc: ConflictError):
        return _error_response(409, "RESOURCE_CONFLICT", str(exc))

    @app.exception_handler(ValidationError)
    async def validation_handler(request: Request, exc: ValidationError):
        return _error_response(422, "VALIDATION_ERROR", str(exc), getattr(exc, "details", None))

    @app.exception_handler(CascadeRequiredError)
    async def cascade_required_handler(request: Request, exc: CascadeRequiredError):
        return _error_response(
            409,
            "CASCADE_REQUIRED",
            str(exc),
            {"affectedOntologies": exc.affected_ontologies},
        )

    @app.exception_handler(StoreError)
    async def store_error_handler(request: Request, exc: StoreError):
        # The adapter has already logged the originating failure against this
        # id; the response carries the id and nothing else about the storage.
        return _error_response(
            500, "STORAGE_ERROR", str(exc), {"errorId": exc.error_id}
        )

    @app.exception_handler(json.JSONDecodeError)
    async def json_error_handler(request: Request, exc: json.JSONDecodeError):
        return _error_response(400, "INVALID_JSON", "Request body is not valid JSON")

    app.include_router(modeling_router, prefix="/api/model")
    app.include_router(runtime_global_router, prefix="/api/runtime")
    app.include_router(runtime_router, prefix="/api/runtime/{ontology_key}")
    app.include_router(ai_router, prefix="/api/runtime")
    mount_mcp(app)

    return app


app = create_app()
