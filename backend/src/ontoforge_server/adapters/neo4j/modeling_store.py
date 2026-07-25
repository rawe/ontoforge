"""Neo4j implementation of the modeling store (schema persistence).

Implements the modeling side of the persistence port (see ``core/ports.py``).
Each method owns its session and delegates to the query functions in
``modeling_queries`` (looked up through the module so unit tests can patch
``ontoforge_server.adapters.neo4j.modeling_queries.<fn>``). Vector-index DDL
methods delegate to ``ddl`` with the adapter's driver.
"""

from neo4j import AsyncDriver

from ontoforge_server.adapters.neo4j import ddl, modeling_queries


class Neo4jModelingStore:
    def __init__(self, driver: AsyncDriver):
        self._driver = driver

    # ------------------------------------------------------------------
    # Reserved keys
    # ------------------------------------------------------------------

    def reserved_entity_type_keys(self) -> frozenset[str]:
        """Entity type keys this adapter cannot store (see ``ddl``)."""
        return ddl.reserved_entity_type_keys()

    def reserved_relation_type_keys(self) -> frozenset[str]:
        """Relation type keys this adapter cannot store (see ``ddl``)."""
        return ddl.reserved_relation_type_keys()

    async def find_reserved_type_keys_in_use(self) -> list[dict]:
        """Stored types with a now-reserved key, as ``{"kind", "key"}`` rows."""
        async with self._driver.session() as session:
            return await modeling_queries.find_reserved_type_keys_in_use(
                session,
                sorted(ddl.reserved_entity_type_keys()),
                sorted(ddl.reserved_relation_type_keys()),
            )

    # ------------------------------------------------------------------
    # Ontology
    # ------------------------------------------------------------------

    async def create_ontology(
        self,
        ontology_id: str,
        key: str,
        name: str,
        description: str | None,
    ) -> dict:
        async with self._driver.session() as session:
            return await modeling_queries.create_ontology(
                session, ontology_id, key, name, description
            )

    async def list_ontologies(self) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_ontologies(session)

    async def get_ontology(self, ontology_id: str) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_ontology(session, ontology_id)

    async def get_ontology_by_name(self, name: str) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_ontology_by_name(session, name)

    async def get_ontology_by_key(self, key: str) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_ontology_by_key(session, key)

    async def update_ontology(
        self,
        ontology_id: str,
        name: str | None,
        description: str | None,
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.update_ontology(
                session, ontology_id, name, description
            )

    async def delete_ontology(self, ontology_id: str) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.delete_ontology(session, ontology_id)

    # ------------------------------------------------------------------
    # Entity types
    # ------------------------------------------------------------------

    async def create_entity_type(
        self,
        entity_type_id: str,
        key: str,
        display_name: str,
        description: str | None,
    ) -> dict:
        async with self._driver.session() as session:
            return await modeling_queries.create_entity_type(
                session, entity_type_id, key, display_name, description
            )

    async def list_entity_types(self) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_entity_types(session)

    async def get_entity_type(self, entity_type_id: str) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_entity_type(session, entity_type_id)

    async def get_entity_type_by_key(self, key: str) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_entity_type_by_key(session, key)

    async def update_entity_type(
        self,
        entity_type_id: str,
        display_name: str | None,
        description: str | None,
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.update_entity_type(
                session, entity_type_id, display_name, description
            )

    async def delete_entity_type(self, entity_type_id: str) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.delete_entity_type(session, entity_type_id)

    async def is_entity_type_referenced(self, entity_type_id: str) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.is_entity_type_referenced(
                session, entity_type_id
            )

    # ------------------------------------------------------------------
    # Relation types
    # ------------------------------------------------------------------

    async def create_relation_type(
        self,
        relation_type_id: str,
        key: str,
        display_name: str,
        description: str | None,
        source_entity_type_key: str,
        target_entity_type_key: str,
    ) -> dict:
        async with self._driver.session() as session:
            return await modeling_queries.create_relation_type(
                session,
                relation_type_id,
                key,
                display_name,
                description,
                source_entity_type_key,
                target_entity_type_key,
            )

    async def list_relation_types(self) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_relation_types(session)

    async def get_relation_type(self, relation_type_id: str) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_relation_type(session, relation_type_id)

    async def get_relation_type_by_key(self, key: str) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_relation_type_by_key(session, key)

    async def update_relation_type(
        self,
        relation_type_id: str,
        display_name: str | None,
        description: str | None,
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.update_relation_type(
                session, relation_type_id, display_name, description
            )

    async def delete_relation_type(self, relation_type_id: str) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.delete_relation_type(
                session, relation_type_id
            )

    # ------------------------------------------------------------------
    # Property definitions
    # ------------------------------------------------------------------

    async def create_property(
        self,
        owner_id: str,
        owner_label: str,
        property_id: str,
        key: str,
        display_name: str,
        description: str | None,
        data_type: str,
        required: bool,
        default_value: str | None,
    ) -> dict:
        async with self._driver.session() as session:
            return await modeling_queries.create_property(
                session,
                owner_id,
                owner_label,
                property_id,
                key,
                display_name,
                description,
                data_type,
                required,
                default_value,
            )

    async def list_properties(self, owner_id: str, owner_label: str) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_properties(
                session, owner_id, owner_label
            )

    async def get_property(
        self, owner_id: str, owner_label: str, property_id: str
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_property(
                session, owner_id, owner_label, property_id
            )

    async def get_property_by_key(
        self, owner_id: str, owner_label: str, key: str
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_property_by_key(
                session, owner_id, owner_label, key
            )

    async def update_property(
        self,
        owner_id: str,
        owner_label: str,
        property_id: str,
        display_name: str | None,
        description: str | None,
        required: bool | None,
        default_value: str | None,
        clear_default: bool = False,
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.update_property(
                session,
                owner_id,
                owner_label,
                property_id,
                display_name,
                description,
                required,
                default_value,
                clear_default=clear_default,
            )

    async def delete_property(
        self, owner_id: str, owner_label: str, property_id: str
    ) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.delete_property(
                session, owner_id, owner_label, property_id
            )

    # ------------------------------------------------------------------
    # Scope management (INCLUDES_TYPE)
    # ------------------------------------------------------------------

    async def add_includes_type(
        self,
        ontology_id: str,
        type_label: str,
        type_key: str,
        properties: list[str] | None,
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.add_includes_type(
                session, ontology_id, type_label, type_key, properties
            )

    async def list_includes_types(
        self, ontology_id: str, type_label: str
    ) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_includes_types(
                session, ontology_id, type_label
            )

    async def get_includes_type(
        self, ontology_id: str, type_label: str, type_id: str
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_includes_type(
                session, ontology_id, type_label, type_id
            )

    async def update_includes_type(
        self,
        ontology_id: str,
        type_label: str,
        type_id: str,
        properties: list[str] | None,
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.update_includes_type(
                session, ontology_id, type_label, type_id, properties
            )

    async def remove_includes_type(
        self, ontology_id: str, type_label: str, type_id: str
    ) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.remove_includes_type(
                session, ontology_id, type_label, type_id
            )

    async def remove_all_includes_for_type(
        self, type_label: str, type_id: str
    ) -> int:
        async with self._driver.session() as session:
            return await modeling_queries.remove_all_includes_for_type(
                session, type_label, type_id
            )

    async def find_ontologies_including_type(
        self, type_label: str, type_id: str
    ) -> list[str]:
        async with self._driver.session() as session:
            return await modeling_queries.find_ontologies_including_type(
                session, type_label, type_id
            )

    async def find_ontologies_with_explicit_property(
        self, type_label: str, type_id: str, property_key: str
    ) -> list[str]:
        async with self._driver.session() as session:
            return await modeling_queries.find_ontologies_with_explicit_property(
                session, type_label, type_id, property_key
            )

    async def add_property_to_includes_lists(
        self, type_label: str, type_id: str, property_key: str
    ) -> int:
        async with self._driver.session() as session:
            return await modeling_queries.add_property_to_includes_lists(
                session, type_label, type_id, property_key
            )

    async def remove_property_from_includes_lists(
        self, type_label: str, type_id: str, property_key: str
    ) -> int:
        async with self._driver.session() as session:
            return await modeling_queries.remove_property_from_includes_lists(
                session, type_label, type_id, property_key
            )

    # ------------------------------------------------------------------
    # Full schema (validation and export)
    # ------------------------------------------------------------------

    async def get_full_schema(self) -> dict:
        async with self._driver.session() as session:
            return await modeling_queries.get_full_schema(session)

    # ------------------------------------------------------------------
    # AI agent configs
    # ------------------------------------------------------------------

    async def list_ai_agents(self, ontology_id: str) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_ai_agents(session, ontology_id)

    async def get_ai_agent_by_key(
        self, ontology_id: str, agent_key: str
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_ai_agent_by_key(
                session, ontology_id, agent_key
            )

    async def upsert_ai_agent(
        self,
        ontology_id: str,
        agent_config_id: str,
        key: str,
        name: str,
        description: str | None,
        system_prompt: str | None,
        tools: list[str] | None,
    ) -> tuple[dict, bool]:
        async with self._driver.session() as session:
            return await modeling_queries.upsert_ai_agent(
                session,
                ontology_id,
                agent_config_id,
                key,
                name,
                description,
                system_prompt,
                tools,
            )

    async def delete_ai_agent(self, ontology_id: str, agent_key: str) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.delete_ai_agent(
                session, ontology_id, agent_key
            )

    async def list_ai_agents_for_export(self, ontology_id: str) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_ai_agents_for_export(
                session, ontology_id
            )

    # ------------------------------------------------------------------
    # Saved query configs
    # ------------------------------------------------------------------

    async def list_saved_queries(self, ontology_id: str) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_saved_queries(session, ontology_id)

    async def get_saved_query_by_key(
        self, ontology_id: str, query_key: str
    ) -> dict | None:
        async with self._driver.session() as session:
            return await modeling_queries.get_saved_query_by_key(
                session, ontology_id, query_key
            )

    async def upsert_saved_query(
        self,
        ontology_id: str,
        saved_query_id: str,
        key: str,
        name: str,
        description: str,
        steps_json: str,
        parameters_json: str,
        ontology_key: str | None = None,
        embedding: list[float] | None = None,
    ) -> tuple[dict, bool]:
        async with self._driver.session() as session:
            return await modeling_queries.upsert_saved_query(
                session,
                ontology_id,
                saved_query_id,
                key,
                name,
                description,
                steps_json,
                parameters_json,
                ontology_key=ontology_key,
                embedding=embedding,
            )

    async def delete_saved_query(self, ontology_id: str, query_key: str) -> bool:
        async with self._driver.session() as session:
            return await modeling_queries.delete_saved_query(
                session, ontology_id, query_key
            )

    async def list_saved_queries_for_export(self, ontology_id: str) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_saved_queries_for_export(
                session, ontology_id
            )

    # ------------------------------------------------------------------
    # Embedding rebuild
    # ------------------------------------------------------------------

    async def get_entity_types_with_properties(self) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.get_entity_types_with_properties(session)

    async def set_entity_embedding(
        self, entity_id: str, embedding: list[float]
    ) -> None:
        async with self._driver.session() as session:
            await modeling_queries.set_entity_embedding(session, entity_id, embedding)

    async def list_saved_query_refs(self) -> list[dict]:
        async with self._driver.session() as session:
            return await modeling_queries.list_saved_query_refs(session)

    async def set_saved_query_embedding(
        self, saved_query_id: str, embedding: list[float]
    ) -> None:
        async with self._driver.session() as session:
            await modeling_queries.set_saved_query_embedding(
                session, saved_query_id, embedding
            )

    # ------------------------------------------------------------------
    # Document property cascade
    # ------------------------------------------------------------------

    async def delete_chunks_for_virtual_type(
        self, entity_type_key: str, property_key: str
    ) -> None:
        async with self._driver.session() as session:
            await modeling_queries.delete_chunks_for_virtual_type(
                session, entity_type_key, property_key
            )

    # ------------------------------------------------------------------
    # Vector-index DDL
    # ------------------------------------------------------------------

    async def create_vector_index(
        self,
        entity_type_key: str,
        dimensions: int,
        filter_properties: list[str] | None = None,
    ) -> None:
        await ddl.create_vector_index(
            self._driver,
            entity_type_key,
            dimensions,
            filter_properties=filter_properties,
        )

    async def drop_vector_index(self, entity_type_key: str) -> None:
        await ddl.drop_vector_index(self._driver, entity_type_key)

    async def rebuild_vector_index(
        self, entity_type_key: str, dimensions: int
    ) -> None:
        await ddl.rebuild_vector_index(self._driver, entity_type_key, dimensions)

    async def create_document_vector_index(
        self, entity_type_key: str, property_key: str, dimensions: int
    ) -> None:
        await ddl.create_document_vector_index(
            self._driver, entity_type_key, property_key, dimensions
        )

    async def drop_document_vector_index(
        self, entity_type_key: str, property_key: str
    ) -> None:
        await ddl.drop_document_vector_index(
            self._driver, entity_type_key, property_key
        )

    async def ensure_saved_query_vector_index(self, dimensions: int) -> None:
        await ddl.ensure_saved_query_vector_index(self._driver, dimensions)

    async def ensure_vector_indexes(self, dimensions: int) -> None:
        await ddl.ensure_vector_indexes(self._driver, dimensions)
