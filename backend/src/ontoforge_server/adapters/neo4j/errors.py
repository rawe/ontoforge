"""Driver-error translation at the persistence-port boundary.

Port contract rule 4 (``core/ports.py``) requires that driver exceptions never
cross the port. Every database access in this adapter goes through
``open_session``, which turns any driver failure into ``StoreError`` — the
domain exception for a storage failure no domain exception describes.

Expected conditions are not handled here: they are pre-checked by the services
or expressed as ``None`` returns from the query modules. What reaches this
translation is the unexpected — connection loss, timeouts, index state
problems, constraint violations the code did not anticipate.

The driver's own message never reaches the caller: it names the vendor and
leaks physical naming, both of which decision 010 keeps out of the public
surface. It is logged instead, against the ``error_id`` the client receives,
so a reported failure can be traced back to its server-side stack.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from neo4j import AsyncDriver, AsyncSession
from neo4j.exceptions import DriverError, Neo4jError

from ontoforge_server.core.exceptions import StoreError

logger = logging.getLogger(__name__)


def to_store_error(exc: Exception) -> StoreError:
    """Log a driver failure and return the ``StoreError`` that replaces it."""
    error = StoreError()
    logger.error(
        "Storage failure %s: %s: %s",
        error.error_id,
        type(exc).__name__,
        exc,
        exc_info=exc,
    )
    return error


@asynccontextmanager
async def open_session(driver: AsyncDriver) -> AsyncIterator[AsyncSession]:
    """Open a driver session whose failures surface as ``StoreError``.

    Catches only driver exceptions, so domain exceptions raised inside the
    block (and ordinary bugs) keep propagating unchanged.
    """
    try:
        async with driver.session() as session:
            yield session
    except (Neo4jError, DriverError) as exc:
        raise to_store_error(exc) from exc
