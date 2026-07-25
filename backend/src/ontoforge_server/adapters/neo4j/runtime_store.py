"""Neo4j implementation of the runtime store (instance persistence).

Implements the runtime side of the persistence port (see ``core/ports.py``).
Each method owns its session and delegates to the query functions in
``runtime_queries`` (looked up through the module so unit tests can patch
``ontoforge_server.adapters.neo4j.runtime_queries.<fn>``). Physical naming
(PascalCase labels, UPPER_SNAKE_CASE relationship types, index names) is
derived here from the ontology-level type keys the service passes in.
"""

from typing import Any

from neo4j import AsyncDriver

from ontoforge_server.adapters.neo4j import ddl, oql_compiler, runtime_queries
from ontoforge_server.adapters.neo4j.errors import open_session
from ontoforge_server.adapters.neo4j.filters import (
    build_filter_clauses,
    build_search_clause,
)
from ontoforge_server.core.oql import ValidatedQuery


class Neo4jRuntimeStore:
    def __init__(self, driver: AsyncDriver):
        self._driver = driver

    def _session(self):
        """Session whose driver failures surface as ``StoreError`` (rule 4)."""
        return open_session(self._driver)

    # ------------------------------------------------------------------
    # Schema reading (for the runtime schema cache)
    # ------------------------------------------------------------------

    async def get_full_schema(self, ontology_key: str) -> dict | None:
        async with self._session() as session:
            return await runtime_queries.get_full_schema(session, ontology_key)

    async def get_ai_agent_configs(self, ontology_key: str) -> list[dict]:
        async with self._session() as session:
            return await runtime_queries.get_ai_agent_configs(session, ontology_key)

    async def get_saved_queries(self, ontology_key: str) -> list[dict]:
        async with self._session() as session:
            return await runtime_queries.get_saved_queries(session, ontology_key)

    # ------------------------------------------------------------------
    # Vector-index metadata validation
    # ------------------------------------------------------------------

    def validate_vector_indexed_properties(
        self,
        entity_type_key: str,
        properties: dict[str, Any],
        filter_properties: list[str],
        entity_id: str | None = None,
    ) -> None:
        ddl.validate_vector_indexed_properties(
            entity_type_key, properties, filter_properties, entity_id=entity_id
        )

    # ------------------------------------------------------------------
    # Entity instances
    # ------------------------------------------------------------------

    async def create_entity(
        self,
        entity_type_key: str,
        entity_id: str,
        properties: dict,
        embedding: list[float] | None = None,
    ) -> dict:
        async with self._session() as session:
            return await runtime_queries.create_entity(
                session,
                entity_type_key,
                ddl._to_pascal_case(entity_type_key),
                entity_id,
                properties,
                embedding=embedding,
            )

    async def list_entities(
        self,
        entity_type_key: str,
        property_defs: dict[str, Any],
        filters: dict[str, str],
        search: str | None,
        search_property_keys: list[str],
        sort_field: str,
        order: str,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        where_clauses, params = build_filter_clauses(
            filters, property_defs, entity_type_key
        )
        if search and search_property_keys:
            clause, search_params = build_search_clause(search, search_property_keys)
            where_clauses.append(clause)
            params.update(search_params)
        async with self._session() as session:
            return await runtime_queries.list_entities(
                session,
                ddl._to_pascal_case(entity_type_key),
                entity_type_key,
                where_clauses,
                params,
                sort_field,
                order,
                limit,
                offset,
            )

    async def get_entity(self, entity_type_key: str, entity_id: str) -> dict | None:
        async with self._session() as session:
            return await runtime_queries.get_entity(
                session, ddl._to_pascal_case(entity_type_key), entity_id
            )

    async def get_entity_by_id(self, entity_id: str) -> dict | None:
        async with self._session() as session:
            return await runtime_queries.get_entity_by_id(session, entity_id)

    async def get_entities_by_ids(self, entity_ids: list[str]) -> dict[str, dict]:
        async with self._session() as session:
            return await runtime_queries.get_entities_by_ids(session, entity_ids)

    async def update_entity(
        self,
        entity_type_key: str,
        entity_id: str,
        set_properties: dict,
        remove_properties: list[str],
        embedding: list[float] | None = None,
        has_embedding_update: bool = False,
    ) -> dict | None:
        async with self._session() as session:
            return await runtime_queries.update_entity(
                session,
                ddl._to_pascal_case(entity_type_key),
                entity_id,
                set_properties,
                remove_properties,
                embedding=embedding,
                has_embedding_update=has_embedding_update,
            )

    async def delete_entity(self, entity_type_key: str, entity_id: str) -> bool:
        async with self._session() as session:
            return await runtime_queries.delete_entity(
                session, ddl._to_pascal_case(entity_type_key), entity_id
            )

    # ------------------------------------------------------------------
    # Document chunks
    # ------------------------------------------------------------------

    async def get_chunk_embeddings_for_entity_property(
        self, entity_id: str, property_key: str
    ) -> dict[str, list[float]]:
        async with self._session() as session:
            return await runtime_queries.get_chunk_embeddings_for_entity_property(
                session, entity_id, property_key
            )

    async def delete_chunks_for_entity_property(
        self, entity_id: str, property_key: str
    ) -> None:
        async with self._session() as session:
            await runtime_queries.delete_chunks_for_entity_property(
                session, entity_id, property_key
            )

    async def create_document_chunks(
        self,
        entity_id: str,
        entity_type_key: str,
        property_key: str,
        chunks: list[dict],
    ) -> None:
        async with self._session() as session:
            await runtime_queries.create_document_chunks(
                session,
                entity_id,
                ddl.document_virtual_label(entity_type_key, property_key),
                chunks,
            )

    async def search_document_chunks(
        self,
        entity_type_key: str,
        property_key: str,
        query_embedding: list[float],
        limit: int,
    ) -> list[dict]:
        async with self._session() as session:
            return await runtime_queries.search_document_chunks(
                session,
                ddl.document_virtual_label(entity_type_key, property_key),
                ddl.document_index_name(entity_type_key, property_key),
                query_embedding,
                limit,
            )

    # ------------------------------------------------------------------
    # Relation instances
    # ------------------------------------------------------------------

    async def create_relation(
        self,
        relation_type_key: str,
        relation_id: str,
        from_entity_id: str,
        to_entity_id: str,
        properties: dict,
    ) -> dict:
        async with self._session() as session:
            return await runtime_queries.create_relation(
                session,
                relation_type_key,
                relation_type_key.upper(),
                relation_id,
                from_entity_id,
                to_entity_id,
                properties,
            )

    async def list_relations(
        self,
        relation_type_key: str,
        property_defs: dict[str, Any],
        filters: dict[str, str],
        from_entity_id: str | None,
        to_entity_id: str | None,
        sort_field: str,
        order: str,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        where_clauses, params = build_filter_clauses(
            filters, property_defs, relation_type_key, node_alias="r"
        )
        if from_entity_id:
            where_clauses.append("from._id = $from_entity_id_filter")
            params["from_entity_id_filter"] = from_entity_id
        if to_entity_id:
            where_clauses.append("to._id = $to_entity_id_filter")
            params["to_entity_id_filter"] = to_entity_id
        async with self._session() as session:
            return await runtime_queries.list_relations(
                session,
                relation_type_key.upper(),
                relation_type_key,
                where_clauses,
                params,
                sort_field,
                order,
                limit,
                offset,
            )

    async def get_relation(
        self, relation_type_key: str, relation_id: str
    ) -> dict | None:
        async with self._session() as session:
            return await runtime_queries.get_relation(
                session, relation_type_key.upper(), relation_id
            )

    async def update_relation(
        self,
        relation_type_key: str,
        relation_id: str,
        set_properties: dict,
        remove_properties: list[str],
    ) -> dict | None:
        async with self._session() as session:
            return await runtime_queries.update_relation(
                session,
                relation_type_key.upper(),
                relation_id,
                set_properties,
                remove_properties,
            )

    async def delete_relation(self, relation_type_key: str, relation_id: str) -> bool:
        async with self._session() as session:
            return await runtime_queries.delete_relation(
                session, relation_type_key.upper(), relation_id
            )

    # ------------------------------------------------------------------
    # Graph traversal
    # ------------------------------------------------------------------

    async def get_neighbors(
        self,
        entity_id: str,
        direction: str,
        relation_type_key: str | None,
        limit: int,
    ) -> list[dict]:
        rel_type_filter = relation_type_key.upper() if relation_type_key else None
        async with self._session() as session:
            return await runtime_queries.get_neighbors(
                session, entity_id, direction, rel_type_filter, limit
            )

    # ------------------------------------------------------------------
    # Semantic search
    # ------------------------------------------------------------------

    async def semantic_search(
        self,
        entity_type_key: str,
        property_defs: dict[str, Any],
        query_embedding: list[float],
        limit: int,
        min_score: float | None,
        filters: dict[str, str] | None = None,
    ) -> list[dict]:
        where_clauses: list[str] = []
        filter_params: dict = {}
        if filters:
            where_clauses, filter_params = build_filter_clauses(
                filters, property_defs, entity_type_key, node_alias="n"
            )
        async with self._session() as session:
            return await runtime_queries.semantic_search(
                session,
                ddl._to_pascal_case(entity_type_key),
                entity_type_key,
                query_embedding,
                limit,
                min_score,
                where_clauses=where_clauses if where_clauses else None,
                filter_params=filter_params if filter_params else None,
            )

    async def semantic_search_all(
        self,
        query_embedding: list[float],
        limit: int,
        min_score: float | None,
    ) -> list[dict]:
        """Search the shared cross-type entity vector index."""
        async with self._session() as session:
            return await runtime_queries.semantic_search(
                session,
                "_Entity",
                "",
                query_embedding,
                limit,
                min_score,
                index_name=ddl.ENTITY_VECTOR_INDEX_NAME,
            )

    async def search_saved_queries(
        self,
        query_embedding: list[float],
        ontology_key: str,
        limit: int,
        min_score: float | None,
    ) -> list[dict]:
        async with self._session() as session:
            return await runtime_queries.search_saved_queries(
                session, query_embedding, ontology_key, limit, min_score
            )

    # ------------------------------------------------------------------
    # Compiled read queries (OQL execution)
    # ------------------------------------------------------------------

    async def execute_oql(
        self,
        validated: "ValidatedQuery",
        params: dict[str, Any] | None = None,
    ) -> tuple[list[str], list[dict]]:
        """Compile a validated OQL query to Cypher and execute it read-only."""
        cypher = oql_compiler.compile_query(validated)
        async with self._session() as session:
            return await runtime_queries.execute_cypher_read(
                session, cypher, params=params
            )
