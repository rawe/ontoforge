from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from ontoforge_server.core.database import get_driver


@asynccontextmanager
async def _noop_lifespan(app):
    yield


@pytest.fixture
def mock_driver():
    driver = AsyncMock()
    mock_session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield mock_session

    driver.session = _session
    return driver


@pytest.fixture
def app(mock_driver):
    with patch("ontoforge_server.main.lifespan", _noop_lifespan):
        from ontoforge_server.main import create_app

        application = create_app()
    application.dependency_overrides[get_driver] = lambda: mock_driver
    return application


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
