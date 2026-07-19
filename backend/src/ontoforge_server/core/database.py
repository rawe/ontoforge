import logging
from typing import Any

from neo4j import AsyncGraphDatabase, AsyncDriver

from ontoforge_server.config import settings
from ontoforge_server.core.exceptions import ValidationError

logger = logging.getLogger(__name__)

_driver: AsyncDriver | None = None
MAX_VECTOR_FILTER_VALUE_BYTES = 32766
ENTITY_VECTOR_INDEX_NAME = "entity_embedding"

_CONSTRAINTS = [
    "CREATE CONSTRAINT ontology_id_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE",
    "CREATE CONSTRAINT ontology_key_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.key IS UNIQUE",
    "CREATE CONSTRAINT ontology_name_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.name IS UNIQUE",
    "CREATE CONSTRAINT entity_type_id_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE",
    "CREATE CONSTRAINT entity_type_key_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.key IS UNIQUE",
    "CREATE CONSTRAINT relation_type_id_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE",
    "CREATE CONSTRAINT relation_type_key_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.key IS UNIQUE",
    "CREATE CONSTRAINT property_id_unique IF NOT EXISTS FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE",
    "CREATE CONSTRAINT entity_instance_id_unique IF NOT EXISTS FOR (n:_Entity) REQUIRE n._id IS UNIQUE",
    "CREATE INDEX entity_type_key_index IF NOT EXISTS FOR (n:_Entity) ON (n._entityTypeKey)",
    "CREATE CONSTRAINT agent_config_id_unique IF NOT EXISTS FOR (ac:AiAgentConfig) REQUIRE ac.agentConfigId IS UNIQUE",
    "CREATE CONSTRAINT saved_query_id_unique IF NOT EXISTS FOR (sq:SavedQuery) REQUIRE sq.savedQueryId IS UNIQUE",
]


def _to_pascal_case(key: str) -> str:
    """Convert a snake_case key to PascalCase."""
    return "".join(segment.capitalize() for segment in key.split("_"))


def document_virtual_label(entity_type_key: str, property_key: str) -> str:
    """Virtual chunk label for a document property. E.g. ('person', 'bio') -> 'PersonDocumentBio'."""
    return f"{_to_pascal_case(entity_type_key)}Document{_to_pascal_case(property_key)}"


def document_index_name(entity_type_key: str, property_key: str) -> str:
    """Vector index name for a document property's chunks."""
    return f"{entity_type_key}_document_{property_key}_embedding"


def validate_vector_indexed_properties(
    entity_type_key: str,
    properties: dict[str, Any],
    filter_properties: list[str],
    entity_id: str | None = None,
) -> None:
    """Reject string values too large for vector-index filter metadata."""
    for property_key in filter_properties:
        value = properties.get(property_key)
        if value is None or not isinstance(value, str):
            continue
        value_bytes = len(value.encode("utf-8"))
        if value_bytes <= MAX_VECTOR_FILTER_VALUE_BYTES:
            continue

        entity_ref = f" on entity '{entity_id}'" if entity_id else ""
        raise ValidationError(
            f"Property '{property_key}'{entity_ref} is too large for semantic indexing "
            f"on type '{entity_type_key}' ({value_bytes} bytes > "
            f"{MAX_VECTOR_FILTER_VALUE_BYTES} bytes)",
            details={
                "fields": {
                    property_key: (
                        "Value exceeds the indexed property size limit "
                        f"({value_bytes} bytes > {MAX_VECTOR_FILTER_VALUE_BYTES} bytes)"
                    )
                }
            },
        )


async def _validate_existing_vector_indexed_properties(
    driver: AsyncDriver,
    pascal_label: str,
    entity_type_key: str,
    filter_properties: list[str],
) -> None:
    if not filter_properties:
        return

    async with driver.session() as session:
        result = await session.run(
            f"MATCH (n:{pascal_label}) RETURN n._id AS entity_id, n {{.*}} AS properties"
        )
        async for record in result:
            validate_vector_indexed_properties(
                entity_type_key,
                record["properties"] or {},
                filter_properties,
                entity_id=record["entity_id"],
            )


async def _drop_failed_index_if_exists(driver: AsyncDriver, index_name: str) -> None:
    async with driver.session() as session:
        result = await session.run(
            "SHOW INDEXES YIELD name, state WHERE name = $name RETURN state",
            name=index_name,
        )
        record = await result.single()
        if record and record["state"] == "FAILED":
            await session.run(f"DROP INDEX {index_name} IF EXISTS")
            logger.warning("Dropped failed vector index before recreate: %s", index_name)


async def _ensure_constraints(driver: AsyncDriver) -> None:
    async with driver.session() as session:
        for constraint in _CONSTRAINTS:
            await session.run(constraint)


async def ensure_vector_indexes(driver: AsyncDriver, dimensions: int) -> None:
    """Create vector indexes for all existing entity types (IF NOT EXISTS).

    New indexes include a WITH clause listing all current properties for
    in-index filtering (Neo4j 2026+ SEARCH clause). Existing indexes are
    left untouched.
    """
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (et:EntityType)
            OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
            WHERE p.dataType <> 'document'
            RETURN et.key AS key, collect(p.key) AS property_keys
            """
        )
        entity_types = [
            {"key": record["key"], "property_keys": record["property_keys"]}
            async for record in result
        ]

    for et in entity_types:
        await create_vector_index(
            driver, et["key"], dimensions, filter_properties=et["property_keys"]
        )

    # Chunk vector indexes for document properties (one per virtual type)
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (et:EntityType)-[:HAS_PROPERTY]->(p:PropertyDefinition {dataType: 'document'})
            RETURN et.key AS entity_type_key, p.key AS property_key
            """
        )
        document_properties = [
            (record["entity_type_key"], record["property_key"])
            async for record in result
        ]

    for entity_type_key, property_key in document_properties:
        await create_document_vector_index(
            driver, entity_type_key, property_key, dimensions
        )

    # Cross-type entity vector index (semantic search across all types)
    await ensure_entity_vector_index(driver, dimensions)

    # Saved query vector index (for semantic search over descriptions)
    await ensure_saved_query_vector_index(driver, dimensions)


async def ensure_entity_vector_index(driver: AsyncDriver, dimensions: int) -> None:
    """Create the cross-type vector index on the shared _Entity label (IF NOT EXISTS).

    Indexes _embedding across all entity instances so semantic search can run
    over every entity type in a single query. Type/scope filtering happens in
    the service layer, so no in-index filter properties are needed.
    """
    await _drop_failed_index_if_exists(driver, ENTITY_VECTOR_INDEX_NAME)
    query = (
        f"CREATE VECTOR INDEX {ENTITY_VECTOR_INDEX_NAME} IF NOT EXISTS "
        "FOR (n:_Entity) ON (n._embedding) "
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: 'cosine'}}}}"
    )
    async with driver.session() as session:
        await session.run(query)
    logger.info("Vector index ensured: %s", ENTITY_VECTOR_INDEX_NAME)


async def ensure_saved_query_vector_index(
    driver: AsyncDriver, dimensions: int
) -> None:
    """Create the vector index for SavedQuery descriptions (IF NOT EXISTS).

    Uses _ontologyKey as an in-index filter property so that semantic search
    can be scoped to a single ontology in one query.
    """
    query = (
        "CREATE VECTOR INDEX saved_query_embedding IF NOT EXISTS "
        "FOR (sq:SavedQuery) ON (sq._embedding) "
        "WITH [sq._ontologyKey] "
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: 'cosine'}}}}"
    )
    async with driver.session() as session:
        await session.run(query)
    logger.info("Vector index ensured: saved_query_embedding")


async def create_vector_index(
    driver: AsyncDriver,
    entity_type_key: str,
    dimensions: int,
    filter_properties: list[str] | None = None,
) -> None:
    """Create a vector index for the given entity type label.

    When *filter_properties* is provided, the index is created with a WITH
    clause so that those properties are stored alongside vectors for in-index
    filtering (Neo4j 2026+ SEARCH clause).
    """
    pascal_label = _to_pascal_case(entity_type_key)
    index_name = f"{entity_type_key}_embedding"
    selected_properties = [p for p in (filter_properties or []) if p]
    await _validate_existing_vector_indexed_properties(
        driver, pascal_label, entity_type_key, selected_properties
    )
    await _drop_failed_index_if_exists(driver, index_name)
    with_clause = ""
    if selected_properties:
        props = ", ".join(f"n.{p}" for p in selected_properties)
        with_clause = f"WITH [{props}] "
    query = (
        f"CREATE VECTOR INDEX {index_name} IF NOT EXISTS "
        f"FOR (n:{pascal_label}) ON (n._embedding) "
        f"{with_clause}"
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: 'cosine'}}}}"
    )
    async with driver.session() as session:
        await session.run(query)
    logger.info("Vector index ensured: %s", index_name)


async def create_document_vector_index(
    driver: AsyncDriver,
    entity_type_key: str,
    property_key: str,
    dimensions: int,
) -> None:
    """Create the vector index for a document property's chunk nodes."""
    index_name = document_index_name(entity_type_key, property_key)
    virtual_label = document_virtual_label(entity_type_key, property_key)
    await _drop_failed_index_if_exists(driver, index_name)
    query = (
        f"CREATE VECTOR INDEX {index_name} IF NOT EXISTS "
        f"FOR (c:{virtual_label}) ON (c._embedding) "
        f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: 'cosine'}}}}"
    )
    async with driver.session() as session:
        await session.run(query)
    logger.info("Vector index ensured: %s", index_name)


async def drop_document_vector_index(
    driver: AsyncDriver, entity_type_key: str, property_key: str
) -> None:
    """Drop the vector index for a document property's chunk nodes."""
    index_name = document_index_name(entity_type_key, property_key)
    async with driver.session() as session:
        await session.run(f"DROP INDEX {index_name} IF EXISTS")
    logger.info("Vector index dropped: %s", index_name)


async def drop_vector_index(driver: AsyncDriver, entity_type_key: str) -> None:
    """Drop the vector index for the given entity type."""
    index_name = f"{entity_type_key}_embedding"
    async with driver.session() as session:
        await session.run(f"DROP INDEX {index_name} IF EXISTS")
    logger.info("Vector index dropped: %s", index_name)


async def rebuild_vector_index(
    driver: AsyncDriver, entity_type_key: str, dimensions: int
) -> None:
    """Drop and recreate the vector index with current properties.

    Called when properties are added or removed from an entity type so that
    the in-index filter properties stay in sync with the schema.
    """
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (et:EntityType {key: $key})
            OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
            WHERE p.dataType <> 'document'
            RETURN collect(p.key) AS property_keys
            """,
            key=entity_type_key,
        )
        record = await result.single()
        property_keys = record["property_keys"] if record else []

    await _validate_existing_vector_indexed_properties(
        driver, _to_pascal_case(entity_type_key), entity_type_key, property_keys
    )
    await drop_vector_index(driver, entity_type_key)
    await create_vector_index(
        driver, entity_type_key, dimensions, filter_properties=property_keys
    )


async def init_driver() -> AsyncDriver:
    global _driver
    _driver = AsyncGraphDatabase.driver(
        settings.DB_URI,
        auth=(settings.DB_USER, settings.DB_PASSWORD),
    )
    await _driver.verify_connectivity()
    await _ensure_constraints(_driver)
    return _driver


async def get_driver() -> AsyncDriver:
    assert _driver is not None, "Neo4j driver not initialized"
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None
