"""TRANSITION SHIM — deleted at the end of the port extraction.

The former contents of this module moved into the Neo4j adapter
(``adapters/neo4j/driver.py`` and ``adapters/neo4j/ddl.py``). This shim
keeps old import paths alive while services are being converted to the
persistence port (``core/ports.py``). New code must not import from here.
"""

from ontoforge_server.adapters.neo4j.ddl import (  # noqa: F401
    ENTITY_VECTOR_INDEX_NAME,
    MAX_VECTOR_FILTER_VALUE_BYTES,
    _to_pascal_case,
    create_document_vector_index,
    create_vector_index,
    document_index_name,
    document_virtual_label,
    drop_document_vector_index,
    drop_vector_index,
    ensure_entity_vector_index,
    ensure_saved_query_vector_index,
    ensure_vector_indexes,
    rebuild_vector_index,
    validate_vector_indexed_properties,
)
from ontoforge_server.adapters.neo4j.driver import (  # noqa: F401
    close_driver,
    get_driver,
    init_driver,
)
