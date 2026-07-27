"""Persistence port: store accessors and adapter lifecycle.

Services, routers, and MCP handlers obtain their store through this module
and speak ontology vocabulary only (type keys, property keys, instance
UUIDs, structured filters). Everything database-specific — connections,
transactions, query text, physical naming, index DDL, driver types — is
owned by the adapter selected via ``settings.DB_BACKEND``.

Port contract (every adapter must satisfy it):

1. Methods accept and return plain Python/JSON-safe types; temporal values
   cross the boundary as ``datetime.date``/``datetime.datetime`` or ISO
   strings, never as driver types. The sole exception is the validated-query
   object from ``core.oql``, which crosses the port opaque and is compiled
   by the adapter.
2. Each method owns its connection. Multi-statement methods currently run
   per-statement auto-commit; managed transactions are not yet used.
3. Filtering, search, and sorting inputs are structured values, never query
   fragments.
4. Driver exceptions never cross the port; adapters raise the domain
   exceptions from ``core.exceptions``. Expected conditions are pre-checked
   by the services or expressed as ``None`` returns; anything left — lost
   connections, timeouts, index state, constraint violations the code did
   not anticipate — is raised as ``StoreError``, whose message carries no
   storage detail. The adapter logs what it withheld against the error's
   ``error_id``, which is what reaches the client (decision 012).
5. Adapters declare the type keys they cannot store — keys whose physical
   form would collide with the adapter's own storage objects — through
   ``reserved_entity_type_keys()`` and ``reserved_relation_type_keys()`` on
   the modeling store. They return plain type keys, never physical names,
   so the modeling service can reject a colliding key without knowing why
   it collides. An adapter with no such collisions returns empty sets.

The reference implementation and the authoritative method list is the Neo4j
adapter: ``adapters.neo4j.modeling_store.Neo4jModelingStore`` and
``adapters.neo4j.runtime_store.Neo4jRuntimeStore``. A future adapter
implements the same method surface and is registered in ``init_stores``.

The port is intentionally structural rather than an explicit ``Protocol``:
with a single adapter, formal signatures would be speculative (decision 008,
YAGNI). A second adapter is the trigger to introduce them.
"""

from typing import Any

from ontoforge_server.config import settings

_modeling_store: Any | None = None
_runtime_store: Any | None = None


async def init_stores() -> None:
    """Initialize the configured persistence adapter and its stores."""
    global _modeling_store, _runtime_store
    if settings.DB_BACKEND == "neo4j":
        from ontoforge_server.adapters import neo4j as adapter

        _modeling_store, _runtime_store = await adapter.create_stores()
    else:
        raise ValueError(
            f"Unknown DB_BACKEND '{settings.DB_BACKEND}' (supported: neo4j)"
        )


async def close_stores() -> None:
    global _modeling_store, _runtime_store
    if settings.DB_BACKEND == "neo4j":
        from ontoforge_server.adapters import neo4j as adapter

        await adapter.close_stores()
    _modeling_store = None
    _runtime_store = None


async def ensure_semantic_indexes(dimensions: int) -> None:
    """Ensure the adapter's semantic-search indexes exist (startup hook)."""
    if settings.DB_BACKEND == "neo4j":
        from ontoforge_server.adapters import neo4j as adapter

        await adapter.ensure_semantic_indexes(dimensions)
    else:
        raise ValueError(
            f"Unknown DB_BACKEND '{settings.DB_BACKEND}' (supported: neo4j)"
        )


async def wipe_database() -> None:
    """Delete all stored data via the active adapter. Test support only."""
    if settings.DB_BACKEND == "neo4j":
        from ontoforge_server.adapters import neo4j as adapter

        await adapter.wipe()
    else:
        raise ValueError(
            f"Unknown DB_BACKEND '{settings.DB_BACKEND}' (supported: neo4j)"
        )


def get_modeling_store() -> Any:
    assert _modeling_store is not None, "Stores not initialized"
    return _modeling_store


def get_runtime_store() -> Any:
    assert _runtime_store is not None, "Stores not initialized"
    return _runtime_store
