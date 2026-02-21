from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from ontoforge_server.core.database import get_driver
from ontoforge_server.main import create_app


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
    application = create_app()
    application.dependency_overrides[get_driver] = lambda: mock_driver
    return application


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
