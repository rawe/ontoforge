# Ontology Views — Session Handover

> Use this document to start a new AI session for implementing ontology views. It references all relevant documents and summarizes the current state.

## Goal

Separate the schema (entity types, relation types, properties) from ontologies. The schema is the independent ground truth. Ontologies are named lenses over the schema — each provides a key, name, and description for runtime access. Scoped ontologies expose a subset of the schema via `INCLUDES_TYPE` relationships. Unscoped ontologies expose the full schema. This allows teams and LLMs to work on focused portions without the full schema's complexity.

## Documents

Read these in order:

1. **[Ontology Views PRD](ontology-views.md)** — Original feature requirements and motivation. Note: the PRD uses "root ontology" and "view" terminology which has since been revised (see Terminology below).

2. **[Ontology Views Architecture](ontology-views-architecture.md)** — Authoritative architectural document. Contains the revised data model, Neo4j representation, schema resolution, validation design, code impact analysis, and all settled decisions.

3. **[Multi-Ontology Entity Sharing](multi-ontology-entity-sharing.md)** — Existing feature idea that is subsumed by the new model. Provides context on instance data sharing behavior.

## Terminology

| Term | Definition |
|---|---|
| **Schema** | The independent, global set of all entity types, relation types, and property definitions. The ground truth. Exists in Neo4j without an owner node. |
| **Ontology** | A named lens over the schema. Provides a key, name, and description for runtime access. Does not own types. |
| **Unscoped ontology** | An ontology without `INCLUDES_TYPE` relationships. Exposes the full schema. Multiple unscoped ontologies are valid. |
| **Scoped ontology** | An ontology with `INCLUDES_TYPE` relationships. Exposes only the referenced types and properties. |

**Important:** The PRD uses older terminology ("root ontology", "view", "OntologyView" node). The architecture doc uses the revised terminology above. Always follow the architecture doc.

## Settled Decisions

| Decision | Resolution |
|---|---|
| Data model | **Schema is independent.** No owner node. Ontologies are lenses, not containers. No root/view distinction — only unscoped vs. scoped. |
| Scoping mechanism | **`INCLUDES_TYPE` relationships** from Ontology to EntityType/RelationType (single relationship type, target label distinguishes). `properties` attribute: `null` = all, `[...]` = listed only. API splits into `.../includes/entity-types` and `.../includes/relation-types` for clarity. `MERGE` semantics in Cypher to prevent duplicate edges. |
| Scoped schema filtering | **Entity type and relation type scoping are independent dimensions.** No INCLUDES_TYPE to a node type = all of that type included. See four-case matrix in architecture doc under "Scoped Schema Filtering". |
| Runtime schema loading | **Always load full schema.** Repository returns full schema plus `INCLUDES_TYPE` metadata. Service layer filters in Python to build scoped view. No filtering in Cypher. |
| Default values | **Applied from full schema.** Both required and optional properties with `defaultValue` are applied during entity/relation creation when omitted by a scoped ontology. Uses `defaultValue` as-is — no computed or ontology-specific defaults (future concern). A scoped ontology may omit a required property only if it has a `defaultValue`. |
| Runtime constraint | **API surface unchanged** (except data wipe removal). Schema resolution extended for unscoped/scoped. |
| Modeling MCP | **Remove key from URL.** Mount at `/mcp/model` without middleware. Global schema tools need no ontology key. Ontology management tools accept explicit `ontology_key` parameter. Runtime MCP unchanged. |
| Migration | **Breaking change.** No migration path. No backward compatibility. No traces of old format in the code. |
| Cascading enforcement | **Strict with optional cascade.** Delete blocked by default with detailed errors naming affected ontologies. `?cascade=true` query parameter on entity type, relation type, and property delete endpoints auto-removes `INCLUDES_TYPE` references before deleting. `properties: null` scoped ontologies are unaffected by property changes. |
| Export/import | **New format v2.0.** Global schema + all ontologies with scope declarations. Breaking change from per-ontology format. No backward compatibility. |
| Runtime access | **All ontologies uniform.** Runtime does not distinguish unscoped from scoped. |
| Data wipe | **Removed.** `DELETE /api/runtime/{key}/data` is removed — data does not belong to ontologies. |

## Neo4j Data Model (Target)

```
Schema (independent):
(:EntityType {entityTypeId, key, name, description})
  -[:HAS_PROPERTY]->(:PropertyDefinition {propertyId, key, name, dataType, required, defaultValue})
(:RelationType {relationTypeId, key, name, description})
  -[:HAS_PROPERTY]->(:PropertyDefinition {...})
  -[:RELATES_FROM]->(:EntityType)
  -[:RELATES_TO]->(:EntityType)

Ontologies (named lenses):
(:Ontology {ontologyId, key, name, description})
  -- no INCLUDES_TYPE → unscoped (full schema)
  -- with INCLUDES_TYPE → scoped (subset):
  -[:INCLUDES_TYPE {properties: [...] | null}]->(:EntityType)
  -[:INCLUDES_TYPE {properties: [...] | null}]->(:RelationType)

Instance layer (unchanged):
(:_Entity:PascalCase {_entityTypeKey, _id, ...user props})
(:_Entity)-[:UPPER_SNAKE_CASE {_relationTypeKey, _id, ...user props}]->(:_Entity)
```

## Current Code Structure

All backend code is in `backend/src/ontoforge_server/`:

- `modeling/` — Router (26 endpoints), service, repository, schemas. Currently scoped by `ontology_id` (UUID). Types owned by ontologies via `HAS_ENTITY_TYPE` / `HAS_RELATION_TYPE`.
- `runtime/` — Router (17 endpoints), service with `SchemaCache`, repository. Scoped by `ontology_key` (string). Loads schema per request via `_load_schema()`.
- `mcp/` — Middleware in `mount.py` extracts key from URL path via `ContextVar` with `X-Ontology-Key` header and env var fallbacks. Shared between modeling (`/mcp/model/{key}`) and runtime (`/mcp/runtime/{key}`).
- `core/` — Database setup (`database.py`), shared schemas (`schemas.py` with `ExportPayload`).

## Implementation Scope

1. **Neo4j data model** — Remove `HAS_ENTITY_TYPE` / `HAS_RELATION_TYPE`. Entity types and relation types become global. Add `INCLUDES_TYPE` relationship support with `MERGE` semantics. Add global uniqueness constraints on `EntityType.key` and `RelationType.key`.
2. **Modeling API** — Restructure into three groups: schema management (global, no ontology scope), ontology CRUD, and scope management (`/ontologies/{id}/includes/entity-types`, `/ontologies/{id}/includes/relation-types`). Delete endpoints get `?cascade=true` parameter. Full endpoint listing in the architecture doc.
3. **Modeling MCP** — Mount at `/mcp/model` without middleware. Remove `_get_ontology_key()` and ContextVar from modeling tools. Global schema tools need no ontology key. Ontology management tools accept explicit `ontology_key` parameter. Runtime MCP unchanged.
4. **Runtime schema loading** — `get_full_schema()` always loads full schema plus `INCLUDES_TYPE` metadata. Service filters in Python (four-case model for entity/relation type scoping). Apply `defaultValue` from full schema for properties omitted by scope.
5. **Export/Import** — New format v2.0 with global schema + ontology declarations. Breaking change, no backward compatibility, no old format traces.
6. **Frontend** — Schema management UI (global) + ontology management UI (with scope).
7. **Data wipe** — Remove `DELETE /api/runtime/{key}/data` endpoint and its MCP tool.

## Validation

Two separate levels:

1. **Schema validation** — Global consistency of entity types, relation types, properties. Independent of ontologies.
2. **Ontology validation** — Per scoped ontology: INCLUDES_TYPE declarations consistent with schema (referential integrity, required properties with defaults). Unscoped ontologies are always valid.

## Constraints

- Runtime API surface (endpoints, request/response contracts) must not change
- Runtime MCP tools and behavior must not change
- Scoped ontologies must be internally consistent (referential integrity, required properties)
- Schema changes must be validated against all scoped ontologies (strict enforcement)
- No new requirements may be introduced without user approval
