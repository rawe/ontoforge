# Neo4j Adapter

This document describes the internals of the Neo4j persistence adapter (`adapters/neo4j/`) — how the logical data model from `architecture.md` §4 is physically stored in Neo4j. Everything here is adapter-internal: nothing in this document is part of the API contract, and none of these names or conventions may leak through the persistence port (`core/ports.py`). Clients and services see only ontology vocabulary — type keys, property keys, instance UUIDs.

## 1. Module Layout

The adapter package `adapters/neo4j/` implements the persistence port on Neo4j:

- `driver.py` — driver lifecycle (init/close) and schema constraint creation. Nothing outside `adapters/neo4j` may import the driver.
- `ddl.py` — naming conventions (PascalCase/UPPER_SNAKE_CASE helpers, `document_virtual_label`, `document_index_name`), vector-index DDL, and index-metadata limits (`MAX_VECTOR_FILTER_VALUE_BYTES`).
- `modeling_store.py` — `Neo4jModelingStore`, the schema persistence implementation.
- `runtime_store.py` — `Neo4jRuntimeStore`, the instance persistence implementation.
- `modeling_queries.py` / `runtime_queries.py` — the Cypher query modules backing the two stores.
- `errors.py` — the adapter's only door to the database (`open_session`), translating driver failures into `StoreError`.

The stores own their sessions; multi-statement methods currently run per-statement auto-commit, and managed transactions are not yet used. Driver temporal types (`neo4j.time.Date`/`DateTime`) are converted to plain Python `date`/`datetime` at the port boundary, in both directions. Driver exceptions are mapped to the domain exceptions in `core/exceptions.py` and never cross the port: every session in the package is opened through `errors.open_session`, which translates any driver failure into `StoreError`, logging the original — vendor name, driver code and message — against the error id the client receives in its place.

## 2. Label and Relationship Naming

All Neo4j labels use PascalCase. Relationships use UPPER_SNAKE_CASE.

**Schema nodes:**

| Neo4j Element | Name |
|---------------|------|
| Node label | `Ontology` |
| Node label | `EntityType` |
| Node label | `RelationType` |
| Node label | `PropertyDefinition` |
| Node label | `AiAgentConfig` |
| Node label | `SavedQuery` |
| Relationship | `INCLUDES_TYPE` (Ontology → EntityType/RelationType, optional scoping) |
| Relationship | `HAS_PROPERTY` (EntityType/RelationType → PropertyDefinition) |
| Relationship | `RELATES_FROM` (RelationType → EntityType) |
| Relationship | `RELATES_TO` (RelationType → EntityType) |
| Relationship | `HAS_AI_AGENT` (Ontology → AiAgentConfig) |
| Relationship | `HAS_SAVED_QUERY` (Ontology → SavedQuery) |

**Instance nodes:**

| Neo4j Element | Name | Rule |
|---------------|------|------|
| Marker label | `_Entity` | Present on every entity instance node |
| Type label | e.g. `Person`, `ResearchPaper` | Entity type key converted to PascalCase |
| Relationship type | e.g. `WORKS_FOR`, `AUTHORED_BY` | Relation type key converted to UPPER_SNAKE_CASE |
| Marker label | `_Chunk` | Present on every document chunk node (see §3) |
| Virtual chunk label | e.g. `PersonDocumentBio` | Pascal(entity type key) + `Document` + Pascal(property key) |
| Relationship type | `_HAS_CHUNK` | Entity instance → its document chunk nodes |

The underscore-prefixed `_Entity` label separates instance nodes from schema nodes. Entity type keys are converted from `snake_case` to `PascalCase` (split on underscores, capitalize segments). Relation type keys are converted to `UPPER_SNAKE_CASE`.

This name conversion is the source of the reserved-name rule in `architecture.md` §4, and this adapter derives its reserved sets directly from the schema names listed above: an entity type key whose PascalCase form is a schema node label (`ontology`, `entity_type`, `relation_type`, `property_definition`, `ai_agent_config`, `saved_query`) and a relation type key whose UPPER_SNAKE_CASE form is a schema relationship type (`includes_type`, `has_property`, `relates_from`, `relates_to`, `has_ai_agent`, `has_saved_query`) are rejected by the modeling service. The internal names `_Entity`, `_Chunk`, and `_HAS_CHUNK` need no reserved key — the type key pattern forbids a leading underscore, so no key converts to them — and are rejected by the OQL validator.

## 3. Physical Instance Representation

**Entity instances** are Neo4j nodes carrying two labels: the `_Entity` marker label and the PascalCase form of the entity type key (entity type key `person` becomes label `Person`). System and user properties are stored as direct node properties:

```
(:_Entity:Person {
  _id: "b7e3f1a2-...",
  _entityTypeKey: "person",
  _createdAt: datetime("2026-02-22T10:00:00Z"),
  _updatedAt: datetime("2026-02-22T10:00:00Z"),
  name: "Alice",
  age: 30
})
```

Properties use native Neo4j types, not a serialized JSON blob — this enables Neo4j's native filtering, ordering, and indexing:

| Schema dataType | Neo4j Storage Type |
|----------------|--------------------|
| `string` | String |
| `integer` | Integer (64-bit) |
| `float` | Float (64-bit) |
| `boolean` | Boolean |
| `date` | Date |
| `datetime` | DateTime |
| `document` | String |

**Relation instances** are native Neo4j relationships between two entity instance nodes, typed with the UPPER_SNAKE_CASE form of the relation type key (`works_for` becomes `WORKS_FOR`); system and user properties are stored directly on the relationship. Native relationships are used instead of intermediate nodes because they leverage Neo4j's core strengths: natural graph traversal patterns, optimized relationship storage engine, and compatibility with graph algorithms and visualization tools.

**Document chunk nodes** carry the `_Chunk` marker label plus a virtual label per (entity type, document property): Pascal(entity type key) + `Document` + Pascal(property key) — e.g. entity type `person` with document property `bio` produces `PersonDocumentBio` (`document_virtual_label` in `ddl.py`). The owning entity links to its chunks via `_HAS_CHUNK` relationships, and the entity delete query removes chunk nodes explicitly alongside `DETACH DELETE`. The chunk payload (coordinates, text, vector, owner references) is part of the logical model — see `architecture.md` §4.2.

## 4. Constraints and Indexes

The adapter creates all constraints and indexes on startup (`driver.py`):

```cypher
CREATE CONSTRAINT ontology_id_unique FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE;
CREATE CONSTRAINT ontology_key_unique FOR (o:Ontology) REQUIRE o.key IS UNIQUE;
CREATE CONSTRAINT ontology_name_unique FOR (o:Ontology) REQUIRE o.name IS UNIQUE;
CREATE CONSTRAINT entity_type_id_unique FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE;
CREATE CONSTRAINT entity_type_key_unique FOR (et:EntityType) REQUIRE et.key IS UNIQUE;
CREATE CONSTRAINT relation_type_id_unique FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE;
CREATE CONSTRAINT relation_type_key_unique FOR (rt:RelationType) REQUIRE rt.key IS UNIQUE;
CREATE CONSTRAINT property_id_unique FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE;
CREATE CONSTRAINT agent_config_id_unique FOR (ac:AiAgentConfig) REQUIRE ac.agentConfigId IS UNIQUE;
CREATE CONSTRAINT saved_query_id_unique FOR (sq:SavedQuery) REQUIRE sq.savedQueryId IS UNIQUE;
CREATE CONSTRAINT entity_instance_id_unique FOR (n:_Entity) REQUIRE n._id IS UNIQUE;
CREATE INDEX entity_type_key_index FOR (n:_Entity) ON (n._entityTypeKey);
```

The global uniqueness of entity type and relation type keys promised by the modeling API is enforced by these Neo4j constraints.

## 5. Vector Indexes and In-Index Filtering

When an embedding provider is configured, the adapter ensures vector indexes on startup (`ddl.py`):

| Index | Name | On |
|-------|------|----|
| Per entity type | `{entity_type_key}_embedding` | The type's PascalCase label |
| Cross-type entity search | `entity_embedding` (`ENTITY_VECTOR_INDEX_NAME`) | `_Entity` |
| Saved-query descriptions | `saved_query_embedding` | `SavedQuery` |
| Per document property | `{entity_type_key}_document_{property_key}_embedding` (`document_index_name`) | The virtual chunk label |

Document chunk indexes are also created immediately when a document property is added via the modeling API, and dropped when the property or its entity type is deleted.

**Dimension drift:** a vector index fixes its width at creation and `CREATE ... IF NOT EXISTS` does not touch an existing one, so a changed embedding model leaves indexes that reject every vector the new model produces. Such an index is `ONLINE`, so the failed-index check (`_drop_failed_index_if_exists`) does not catch it, and writes still succeed — the affected vectors are simply not indexed, and the first semantic search fails. `_reconcile_index_dimensions` closes this: before each `CREATE`, it reads the existing index's configured width and compares it against the embedding provider's. On startup a mismatch is only reported, never repaired (decision 013); `rebuild-embeddings` passes `recreate_on_mismatch` and the index is dropped and recreated at the model's width, repopulated by the rebuild that follows. The warnings describe indexes by entity type, document property, or search scope — never by index name, which is this adapter's own business.

**In-index filtering:** semantic search applies property filters inside the vector-index query — candidates are over-fetched from the index and filtered before the final limit. Because indexed string property values participate in this filter metadata, they are subject to Neo4j's indexed-property size limit: `MAX_VECTOR_FILTER_VALUE_BYTES` (32766 bytes) in `ddl.py`. Writes whose indexed string values exceed this limit are rejected with a validation error before persistence ("indexed property size limit" — the message deliberately names no vendor). Document property values are exempt: they are never part of the entity embedding or its filter metadata. The saved-query `_ontologyKey` property exists for the same mechanism — the semantic index over saved queries can only filter on node properties, not relationships, so the owning ontology key is denormalized onto the node.

## 6. Query Compilation and Dynamic-Query Safety

**OQL compilation:** the query endpoint's OQL (see `api-contracts/runtime-api.md` §7) is parsed and validated in ontology vocabulary; at execution time the adapter rewrites entity type keys to PascalCase labels and relation type keys to UPPER_SNAKE_CASE relationship types before running the resulting Cypher. The translation is invisible to clients — queries are written and results are returned entirely in schema type keys.

**Dynamic-query safety:** entity type keys become Neo4j labels and relation type keys become relationship types in adapter-generated Cypher. These values are never raw user input — they come from the schema cache, which was built from the ontology stored in the database. Only property *values* are passed as query parameters. This makes dynamic query construction safe from injection. Filtering, search, and sorting arrive at the store as structured values (never query fragments) and are compiled to `WHERE`/`ORDER BY` clauses inside the adapter.

## 7. Community Edition Trade-offs

Neo4j Community Edition does not support relationship property indexes. Relation instance lookup by `_id` scans relationships of the given type. This is acceptable at expected data volumes; if it becomes a bottleneck, a secondary lookup mechanism can be added later.
