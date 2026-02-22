from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ontoforge_server.config import settings
from ontoforge_server.core.database import close_driver, init_driver
from ontoforge_server.core.exceptions import (
    ConflictError,
    NotFoundError,
    ValidationError,
)
from ontoforge_server.modeling.router import router as modeling_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_driver()
    yield
    await close_driver()


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
        return _error_response(422, "VALIDATION_ERROR", str(exc))

    if settings.SERVER_MODE == "model":
        app.include_router(modeling_router, prefix="/api/model")
    else:
        runtime_router = APIRouter(tags=["runtime"])
        app.include_router(runtime_router, prefix="/api/runtime")

    return app


app = create_app()
