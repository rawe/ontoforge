"""Tests for OntologyKeyMiddleware resolution order.

Verifies: URL path > X-Ontology-Key header > DEFAULT_MCP_ONTOLOGY_KEY env var > 400.

Tests the middleware in isolation by wrapping a simple echo handler — no need
for the full FastAPI app or real MCP session managers.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Mount

from ontoforge_server.mcp.mount import OntologyKeyMiddleware, current_ontology_key


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


async def _echo_key(scope, receive, send):
    """Simple ASGI app that echoes back the resolved ontology key."""
    key = current_ontology_key.get("__unset__")
    response = PlainTextResponse(key, status_code=200)
    await response(scope, receive, send)


@pytest.fixture
def app():
    """Minimal Starlette app with the middleware mounted at /mcp/model."""
    return Starlette(
        routes=[
            Mount("/mcp/model", app=OntologyKeyMiddleware(_echo_key)),
            Mount("/mcp/runtime", app=OntologyKeyMiddleware(_echo_key)),
        ]
    )


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestUrlPathResolution:
    """URL path key is extracted (existing behavior, regression test)."""

    async def test_modeling_url_key(self, client: AsyncClient):
        resp = await client.get("/mcp/model/my_ontology/mcp")
        assert resp.status_code == 200
        assert resp.text == "my_ontology"

    async def test_runtime_url_key(self, client: AsyncClient):
        resp = await client.get("/mcp/runtime/my_ontology/mcp")
        assert resp.status_code == 200
        assert resp.text == "my_ontology"


class TestHeaderResolution:
    """X-Ontology-Key header is used when no key in URL path."""

    async def test_modeling_header_key(self, client: AsyncClient):
        resp = await client.get(
            "/mcp/model/",
            headers={"X-Ontology-Key": "header_onto"},
        )
        assert resp.status_code == 200
        assert resp.text == "header_onto"

    async def test_runtime_header_key(self, client: AsyncClient):
        resp = await client.get(
            "/mcp/runtime/",
            headers={"X-Ontology-Key": "header_onto"},
        )
        assert resp.status_code == 200
        assert resp.text == "header_onto"


class TestEnvVarResolution:
    """DEFAULT_MCP_ONTOLOGY_KEY env var used when no URL key or header."""

    async def test_modeling_env_key(self, client: AsyncClient, monkeypatch):
        monkeypatch.setenv("DEFAULT_MCP_ONTOLOGY_KEY", "env_onto")
        resp = await client.get("/mcp/model/")
        assert resp.status_code == 200
        assert resp.text == "env_onto"

    async def test_runtime_env_key(self, client: AsyncClient, monkeypatch):
        monkeypatch.setenv("DEFAULT_MCP_ONTOLOGY_KEY", "env_onto")
        resp = await client.get("/mcp/runtime/")
        assert resp.status_code == 200
        assert resp.text == "env_onto"


class TestPrecedence:
    """Higher-priority sources override lower ones."""

    async def test_url_beats_header(self, client: AsyncClient):
        resp = await client.get(
            "/mcp/model/url_key/mcp",
            headers={"X-Ontology-Key": "header_key"},
        )
        assert resp.status_code == 200
        assert resp.text == "url_key"

    async def test_header_beats_env(self, client: AsyncClient, monkeypatch):
        monkeypatch.setenv("DEFAULT_MCP_ONTOLOGY_KEY", "env_key")
        resp = await client.get(
            "/mcp/model/",
            headers={"X-Ontology-Key": "header_key"},
        )
        assert resp.status_code == 200
        assert resp.text == "header_key"


class TestNoKey:
    """400 when no key is available from any source."""

    async def test_modeling_no_key(self, client: AsyncClient, monkeypatch):
        monkeypatch.delenv("DEFAULT_MCP_ONTOLOGY_KEY", raising=False)
        resp = await client.get("/mcp/model/")
        assert resp.status_code == 400
        assert "Ontology key required" in resp.text

    async def test_runtime_no_key(self, client: AsyncClient, monkeypatch):
        monkeypatch.delenv("DEFAULT_MCP_ONTOLOGY_KEY", raising=False)
        resp = await client.get("/mcp/runtime/")
        assert resp.status_code == 400
        assert "Ontology key required" in resp.text
