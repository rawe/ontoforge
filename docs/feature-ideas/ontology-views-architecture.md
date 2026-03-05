# Ontology Views — Architectural Review

> Architectural analysis for implementing ontology views as described in the [Ontology Views PRD](ontology-views.md). This document describes the data model, code impact, and settled decisions.

## Terminology

| Term | Definition |
|---|---|
| **Schema** | The independent, global set of all entity types, relation types, and property definitions. The ground truth. Exists in Neo4j without an owner node. |
| **Ontology** | A named lens over the schema. Provides a key, name, and description for runtime access. Does not own types — it references or implicitly includes them. |
| **Unscoped ontology** | An ontology without `INCLUDES_TYPE` relationships. Exposes the full schema. Multiple unscoped ontologies are valid (different names/descriptions, same data). |
| **Scoped ontology** | An ontology with `INCLUDES_TYPE` relationships. Exposes only the referenced types and properties. |

## Resolved Decisions

The following decisions are settled:

- **Data model:** The schema exists independently — no owner node. Ontology nodes are named lenses over the schema. There is no root/view distinction; only unscoped vs. scoped ontologies.
- **Scoping mechanism:** `INCLUDES_TYPE` relationships from Ontology to EntityType/RelationType. No INCLUDES_TYPE = unscoped (exposes full schema). With INCLUDES_TYPE = scoped (exposes only referenced types). Property filtering via `properties` attribute on the relationship (`null` = all, `[...]` = listed only).
- **Runtime constraint:** The runtime API surface (endpoints, request/response contracts) does not change. Schema resolution is extended to handle both unscoped and scoped ontologies. The runtime always has access to the full schema for applying defaults on required properties omitted by a scope.
- **Modeling MCP structure:** Remove key from URL. Mount at `/mcp/model` with no key parameter. The `OntologyKeyMiddleware` must stop requiring a key for the modeling MCP mount (including the `X-Ontology-Key` header fallback), while the runtime MCP (`/mcp/runtime/{key}`) retains its current 3-tier key resolution (URL path, `X-Ontology-Key` header, env var). The shared middleware needs conditional behavior based on which mount it serves.
- **Migration:** Breaking change. No migration path from multi-ontology. Existing deployments must recreate their setup.
- **Cascading enforcement:** Strict. Schema changes that would break a scoped ontology are rejected. Error messages must name the affected ontology/ontologies and explain why the change conflicts (e.g., "Cannot remove entity type 'person': referenced by ontology 'hr_view'"). Scoped ontologies using `properties: null` (include-all) for a type are not affected by property changes on that type — only scoped ontologies with explicit property lists block removal of listed properties. Detailed, actionable error messages are critical for MCP consumers.
- **Runtime access:** All ontologies are uniformly addressable at runtime by key. The runtime does not distinguish between unscoped and scoped ontologies.

## Current Architecture Summary

All paths are relative to `backend/src/ontoforge_server/`.

### Modeling

| Component | Location | Role |
|---|---|---|
| Router | `modeling/router.py` | 26 REST endpoints, all scoped by `ontology_id` (UUID) path param |
| Service | `modeling/service.py` | Business logic, validation, referential integrity checks |
| Repository | `modeling/repository.py` | Cypher queries, cascading deletes |
| Schemas | `modeling/schemas.py` | Pydantic models for request/response |
| Export format | `core/schemas.py` | `ExportPayload` — key-based, self-contained JSON |

### Runtime

| Component | Location | Role |
|---|---|---|
| Router | `runtime/router.py` | 17 endpoints scoped by `ontology_key` (string) path param |
| Service | `runtime/service.py` | `_load_schema()` builds `SchemaCache` per request; validation, type coercion |
| Repository | `runtime/repository.py` | `get_full_schema()` loads schema by ontology key via 3 Cypher queries |
| SchemaCache | `runtime/service.py` | Dataclass: `ontology_id`, `ontology_key`, `entity_types`, `relation_types` |

### MCP

| Component | Location | Role |
|---|---|---|
| Middleware | `mcp/mount.py` | `OntologyKeyMiddleware` extracts key from URL path, sets `ContextVar` |
| Modeling tools | `mcp/modeling.py` | 15 tools, each calls `_get_ontology_key()` then `_resolve_ontology()` |
| Runtime tools | `mcp/runtime.py` | 14 tools, each calls `_get_ontology_key()` then service functions |
| Mount | `mcp/mount.py` | `mount_mcp()` mounts at `/mcp/model` and `/mcp/runtime` |

### Neo4j Data Model

**Schema (independent, no owner):**
```
(:EntityType {entityTypeId, key, name, description})
  -[:HAS_PROPERTY]->(:PropertyDefinition {propertyId, key, name, dataType, required, defaultValue})
(:RelationType {relationTypeId, key, name, description})
  -[:HAS_PROPERTY]->(:PropertyDefinition {propertyId, key, name, dataType, required, defaultValue})
  -[:RELATES_FROM]->(:EntityType)
  -[:RELATES_TO]->(:EntityType)
```

**Ontologies (named lenses over the schema):**
```
(:Ontology {ontologyId, key, name, description})
  -- no INCLUDES_TYPE relationships → unscoped (exposes full schema)
  -- with INCLUDES_TYPE relationships → scoped (exposes subset):
  -[:INCLUDES_TYPE {properties: [...] | null}]->(:EntityType)
  -[:INCLUDES_TYPE {properties: [...] | null}]->(:RelationType)
```

**Instance layer (unchanged):**
```
(:_Entity:PascalCase {_entityTypeKey, _id, ...user props})
(:_Entity)-[:UPPER_SNAKE_CASE {_relationTypeKey, _id, ...user props}]->(:_Entity)
```

**Instance data has no ontology scoping.** Instances are linked to types only by the string `_entityTypeKey` / `_relationTypeKey`. All instances of entity type key `"person"` share the same data pool regardless of which ontology exposes that entity type.

### Constraints

- `Ontology.ontologyId`, `Ontology.key` — globally unique
- `EntityType.entityTypeId`, `RelationType.relationTypeId`, `PropertyDefinition.propertyId` — globally unique
- `EntityType.key`, `RelationType.key` — globally unique (no longer scoped per ontology; types exist once)
- `_Entity._id` — globally unique

---

## Ontology as Lens Model

### Core Concept

The schema (all entity types, relation types, and property definitions) exists independently in Neo4j. No node owns it. An Ontology node is a **named lens** — it provides a key, name, and description for accessing the schema at runtime.

- **Unscoped ontology:** No `INCLUDES_TYPE` relationships. Exposes the entire schema. Multiple unscoped ontologies are valid — they can have different names and descriptions, guiding consumers differently while exposing the same data.
- **Scoped ontology:** Has `INCLUDES_TYPE` relationships pointing to specific EntityType and RelationType nodes. Exposes only the referenced types. Property visibility is controlled by the `properties` attribute on each `INCLUDES_TYPE` relationship.

There is no "root" or "view" distinction. The structural difference is purely whether `INCLUDES_TYPE` relationships exist.

### Scope Declarations via INCLUDES_TYPE

```
(:Ontology {key: "hr"})
  -[:INCLUDES_TYPE {properties: ["name", "email"]}]->(:EntityType {key: "person"})
  -[:INCLUDES_TYPE {properties: null}]->(:EntityType {key: "department"})
  -[:INCLUDES_TYPE {properties: null}]->(:RelationType {key: "works_in"})
```

- `properties: null` — all properties of that type are exposed.
- `properties: [...]` — only the listed properties are exposed.
- Types not referenced by `INCLUDES_TYPE` are excluded from this ontology.

**Duplicate prevention:** `INCLUDES_TYPE` relationships use `MERGE` (not `CREATE`) in Cypher to prevent duplicate edges between the same ontology and type. Neo4j does not support uniqueness constraints on relationships, so `MERGE` provides idempotent, database-level duplicate prevention.

### Schema Resolution at Runtime

The runtime **always loads the full schema** (all entity types, relation types, and properties) from the repository. For scoped ontologies, the repository also returns the `INCLUDES_TYPE` metadata (which types are included, which properties are filtered). The service layer then filters in Python to build the scoped view.

**Repository behavior:**

1. `MATCH (o:Ontology {key: $key})` — find the ontology. If not found, raise `NotFoundError`.
2. Load the full schema: all entity types, relation types, and their properties.
3. Load the `INCLUDES_TYPE` metadata for this ontology (if any): which types are included and their `properties` attribute.
4. Return both the full schema and the `INCLUDES_TYPE` metadata.

**Service behavior:**

1. If no `INCLUDES_TYPE` metadata (unscoped): build `SchemaCache` from the full schema. Same as today.
2. If `INCLUDES_TYPE` metadata exists (scoped): filter the full schema according to the scoping rules (see "Scoped Schema Filtering" below) to build the `SchemaCache`.
3. For scoped ontologies: retain access to the full schema's property definitions for applying defaults during entity/relation creation (see "Defaults for Omitted Properties").

The result is the same `SchemaCache` structure. The runtime router and MCP are unaware of whether the ontology is unscoped or scoped.

### Scoped Schema Filtering

Entity type and relation type scoping are **independent dimensions**. The presence or absence of `INCLUDES_TYPE` edges to each node type determines the behavior:

| Entity type INCLUDES_TYPE | Relation type INCLUDES_TYPE | Entity types exposed | Relation types exposed |
|---|---|---|---|
| None | None | All (fully unscoped) | All |
| Some | None | Only included | Auto-filtered: only those whose source and target are both in the included entity type set |
| None | Some | All | Only included |
| Some | Some | Only included | Only included (ontology validation ensures each included relation's source and target entity types are also included) |

This filtering happens in the service layer (Python), not in Cypher queries. The repository always returns the full schema plus `INCLUDES_TYPE` metadata.

### Defaults for Omitted Properties

The runtime always has access to the full schema — not just the scoped subset. When a scoped ontology omits a property that has a `defaultValue` in the schema (whether required or optional):

1. The consumer does not see the property (it is not in the ontology's visible schema).
2. On entity/relation creation, the runtime applies the `defaultValue` from the full schema.
3. The entity/relation is stored with the property set to its default.

This applies to both required and optional properties with defaults. The current implementation uses `defaultValue` as-is from the schema — no computed or ontology-specific defaults.

**Validation rule:** A scoped ontology may omit a required property **only if** that property has a `defaultValue` in the schema. Otherwise the ontology's scope declaration is invalid. This is enforced at ontology creation/update time. Optional properties may always be omitted regardless of whether they have a default.

---

## Validation

Validation operates at two separate levels.

### Schema Validation

Validates the schema itself — the global set of entity types, relation types, and property definitions. This is independent of any ontology.

**Checks:**
- Entity type key uniqueness
- Relation type key uniqueness
- Property key uniqueness within each type
- Data type validity for all property definitions
- Relation type source/target entity type references exist

### Ontology Validation

Validates a single scoped ontology's `INCLUDES_TYPE` declarations against the schema. Only applies to scoped ontologies (unscoped ontologies are always valid by definition).

**Checks:**
- All referenced entity type keys exist in the schema
- All referenced relation type keys exist in the schema
- For each included relation type: both source and target entity types are also included
- For each explicit property list: all listed property keys exist on the respective type in the schema
- Required property rule: for each included entity type, every required property without a `defaultValue` must be included in the property list (or the ontology uses `properties: null` for that type)
- Same checks for relation type properties

**Returns:** `ValidationResult` with errors scoped to the ontology (e.g., `message: "required property 'name' on entity type 'person' omitted without default"`).

### Full Validation

Validates the schema and all scoped ontologies in a single pass. Runs schema validation first, then ontology validation for each scoped ontology. Reports errors grouped by scope: schema-level errors vs per-ontology errors.

---

## Code Impact Analysis

### Modeling Module (`modeling/`)

| File | Change | Notes |
|---|---|---|
| `router.py` | Restructure: schema management endpoints (global, no ontology scope) + ontology CRUD (with INCLUDES_TYPE management). Remove old `HAS_ENTITY_TYPE` / `HAS_RELATION_TYPE` scoping. | Major restructure |
| `service.py` | Schema validation (independent of ontologies) + ontology validation (INCLUDES_TYPE checks). Strict cascading enforcement on schema changes. | Major restructure |
| `repository.py` | Remove `HAS_ENTITY_TYPE` / `HAS_RELATION_TYPE` Cypher. Add `INCLUDES_TYPE` relationship management. Entity/relation types become global (no ontology owner). | Major restructure |
| `schemas.py` | New Pydantic models for ontology CRUD with filter declarations. Schema management models decoupled from ontology. | Significant changes |

### Runtime Module (`runtime/`)

| File | Change | Notes |
|---|---|---|
| `repository.py` | `get_full_schema()` always loads the full schema plus `INCLUDES_TYPE` metadata. Returns both. No filtering in Cypher. | Moderate, contained |
| `service.py` | `_load_schema()` filters in Python for scoped ontologies. Applies `defaultValue` from full schema for properties omitted by scope during entity/relation creation. | Moderate |
| `router.py` | Remove data wipe endpoint. No other changes. | API surface unchanged for all other endpoints |

### MCP Module (`mcp/`)

| File | Change | Notes |
|---|---|---|
| `mount.py` | Middleware split: modeling MCP no longer needs key resolution (including `X-Ontology-Key` header); runtime MCP unchanged. | Moderate |
| `modeling.py` | Restructure: tools operate on global schema + ontology management. All 15 tools change pattern (no ontology key resolution). | Major restructure |
| `runtime.py` | No changes | Ontology keys resolve transparently via schema loading |

### Core (`core/`)

| File | Change | Notes |
|---|---|---|
| `database.py` | Remove `HAS_ENTITY_TYPE` / `HAS_RELATION_TYPE` constraints. Ensure `EntityType.key` and `RelationType.key` are globally unique. Add `INCLUDES_TYPE` relationship support. | Moderate |
| `schemas.py` | Export format: ontologies with filter declarations, schema types as global. | Moderate |

### Frontend (`frontend/`)

| Area | Change | Notes |
|---|---|---|
| Schema management | Global schema editing (entity types, relation types, properties) — no longer scoped per ontology | Major restructure |
| Ontology management | CRUD for ontologies with optional INCLUDES_TYPE scope declarations | Significant changes |
| Schema graph view | Support ontology-scoped visualization (unscoped vs. scoped) | Moderate |

---

## Instance Data Implications

**Entity instances are not scoped by ontology.** An `_Entity` node with `_entityTypeKey: "person"` is visible to any ontology that includes the `person` entity type. This is intentional — ontologies are lenses over a shared data space, not isolated silos.

Consequences:
- Creating a person instance through ontology A and reading it through ontology B (if both include `person`) returns the same instance
- Ontology B may show fewer properties in its schema, but the instance data on the node is unchanged — the runtime returns all properties stored on the node, while the schema communicates which properties are "known" to that ontology

### Data Wipe Removed

The current `DELETE /api/runtime/{key}/data` endpoint is removed. Its original purpose — wiping all data "belonging to" an ontology — no longer applies because data does not belong to any ontology. Wiping through a lens would delete shared instances visible to other ontologies, which is misleading and dangerous. If batch deletion is needed in the future, it should be designed as an explicit, schema-level operation with clear scope (e.g., delete all instances of a specific entity type).

---

## Modeling API Structure

The modeling API separates schema management (global) from ontology management. Schema operations apply to the global set of types. Ontology operations manage named lenses. Scope management handles `INCLUDES_TYPE` declarations on scoped ontologies.

### Schema Management

Entity types, relation types, and properties are global — no ontology scope in the URL.

```
POST   /api/model/entity-types
GET    /api/model/entity-types
GET    /api/model/entity-types/{id}
PUT    /api/model/entity-types/{id}
DELETE /api/model/entity-types/{id}

POST   /api/model/entity-types/{id}/properties
GET    /api/model/entity-types/{id}/properties
PUT    /api/model/entity-types/{id}/properties/{prop_id}
DELETE /api/model/entity-types/{id}/properties/{prop_id}

POST   /api/model/relation-types
GET    /api/model/relation-types
GET    /api/model/relation-types/{id}
PUT    /api/model/relation-types/{id}
DELETE /api/model/relation-types/{id}

POST   /api/model/relation-types/{id}/properties
GET    /api/model/relation-types/{id}/properties
PUT    /api/model/relation-types/{id}/properties/{prop_id}
DELETE /api/model/relation-types/{id}/properties/{prop_id}

POST   /api/model/schema/validate
```

Delete operations on entity types, relation types, and properties enforce strict cascading: if a scoped ontology references the type or explicitly lists the property, the delete is rejected with a detailed error naming the affected ontologies.

**Cascade parameter:** The following delete endpoints accept an optional `?cascade=true` query parameter:

- `DELETE /api/model/entity-types/{id}?cascade=true`
- `DELETE /api/model/relation-types/{id}?cascade=true`
- `DELETE /api/model/entity-types/{id}/properties/{prop_id}?cascade=true`
- `DELETE /api/model/relation-types/{id}/properties/{prop_id}?cascade=true`

Without `cascade` (default): deletion is blocked if any scoped ontology references the type or explicitly lists the property. The error response names the affected ontologies. With `cascade=true`: the system first removes all `INCLUDES_TYPE` references (edges for type deletion, property keys from explicit property lists for property deletion), then performs the delete.

### Ontology Management

CRUD for ontology nodes (key, name, description).

```
POST   /api/model/ontologies
GET    /api/model/ontologies
GET    /api/model/ontologies/{id}
PUT    /api/model/ontologies/{id}
DELETE /api/model/ontologies/{id}
```

### Scope Management

Manages `INCLUDES_TYPE` relationships on scoped ontologies. The API splits entity type and relation type includes into separate endpoint groups for clarity. In Neo4j, both use the same `INCLUDES_TYPE` relationship type — the target node's label (`EntityType` or `RelationType`) distinguishes them.

```
POST   /api/model/ontologies/{id}/includes/entity-types
GET    /api/model/ontologies/{id}/includes/entity-types
PUT    /api/model/ontologies/{id}/includes/entity-types/{type_id}
DELETE /api/model/ontologies/{id}/includes/entity-types/{type_id}

POST   /api/model/ontologies/{id}/includes/relation-types
GET    /api/model/ontologies/{id}/includes/relation-types
PUT    /api/model/ontologies/{id}/includes/relation-types/{type_id}
DELETE /api/model/ontologies/{id}/includes/relation-types/{type_id}

POST   /api/model/ontologies/{id}/validate
```

- `POST .../includes/entity-types` adds an `INCLUDES_TYPE` relationship to an entity type (with optional `properties` filter).
- `POST .../includes/relation-types` adds an `INCLUDES_TYPE` relationship to a relation type (with optional `properties` filter).
- `PUT .../includes/.../{ type_id}` updates the `properties` filter on an existing `INCLUDES_TYPE`.
- `DELETE .../includes/.../{ type_id}` removes the `INCLUDES_TYPE` relationship.
- `POST .../validate` validates this ontology's scope declarations against the schema.

**Automatic relation filtering:** Entity type and relation type scoping are independent dimensions — see the four-case model in "Scoped Schema Filtering" under "Schema Resolution at Runtime". When a scoped ontology includes only some entity types but has no `INCLUDES_TYPE` to any relation types, relation types are automatically filtered to only those whose source and target entity types are both in the included set. This happens at schema resolution time in the service layer, not as stored `INCLUDES_TYPE` relationships.

### Export / Import

```
GET    /api/model/export
POST   /api/model/import
```

Export produces the full schema plus all ontology declarations (including scope). Import replaces the current state. This is a breaking change from the previous per-ontology format — no backward compatibility, no import support for the old format, no traces of the old format in the code.

**Export format (v2.0):**

```json
{
  "formatVersion": "2.0",
  "entityTypes": [
    {
      "key": "person",
      "displayName": "Person",
      "description": "...",
      "properties": [
        { "key": "name", "displayName": "Name", "dataType": "string", "required": true, "defaultValue": null },
        { "key": "status", "displayName": "Status", "dataType": "string", "required": true, "defaultValue": "active" }
      ]
    }
  ],
  "relationTypes": [
    {
      "key": "works_at",
      "displayName": "Works At",
      "description": "...",
      "fromEntityTypeKey": "person",
      "toEntityTypeKey": "company",
      "properties": []
    }
  ],
  "ontologies": [
    {
      "key": "hr",
      "name": "HR View",
      "description": "...",
      "includes": {
        "entityTypes": [
          { "key": "person", "properties": ["name"] },
          { "key": "department", "properties": null }
        ],
        "relationTypes": [
          { "key": "works_in", "properties": null }
        ]
      }
    },
    {
      "key": "full",
      "name": "Full Schema",
      "description": "Unscoped access to everything"
    }
  ]
}
```

- `entityTypes` and `relationTypes` at the top level are the full schema (ground truth).
- `ontologies` lists all ontologies. Unscoped ontologies have no `includes` field. Scoped ontologies have `includes` with `entityTypes` and/or `relationTypes` arrays carrying the `properties` filter (`null` = all, `[...]` = listed only).

## Modeling MCP Structure

The modeling MCP mounts at `/mcp/model` with no key parameter. The `OntologyKeyMiddleware` is removed from the modeling mount — the ASGI app is mounted directly. The runtime MCP (`/mcp/runtime/{key}`) retains the middleware and its current 3-tier key resolution (URL path → `X-Ontology-Key` header → env var) unchanged.

### Modeling MCP Tool Categories

Tools split into two categories:

**Global schema tools** (no ontology key parameter):
- CRUD for entity types, relation types, properties
- get schema, validate schema
- export, import

**Ontology management tools** (explicit `ontology_key: str` parameter):
- CRUD for ontologies
- scope management (add/list/update/remove `INCLUDES_TYPE`)
- validate ontology

The `_get_ontology_key()` helper and `current_ontology_key` ContextVar import are removed from `mcp/modeling.py`. Ontology management tools accept `ontology_key` as an explicit tool parameter. The `_resolve_ontology()` helper is retained but callers pass the key in directly.

## Cascading Enforcement

Schema changes that would break a scoped ontology are **rejected by default**. The error response must include:

- Which ontology/ontologies are affected
- Why the change conflicts (e.g., "Cannot remove entity type 'person': referenced by ontology 'hr_view' via INCLUDES_TYPE")
- The specific part of the ontology's filter that creates the conflict

**`properties: null` exception:** Scoped ontologies that use `properties: null` (include-all) for a type are not affected by property additions or removals on that type — they dynamically reflect whatever properties exist. Only scoped ontologies with explicit property lists (`properties: [...]`) block removal of listed properties.

**Cascade override:** Delete endpoints for entity types, relation types, and properties accept an optional `?cascade=true` query parameter. Without it, deletion is blocked with a detailed error. With `cascade=true`, the system automatically removes all `INCLUDES_TYPE` references to the deleted item (edges for type deletion, property keys from explicit property lists for property deletion), then performs the delete. See "Schema Management" under "Modeling API Structure" for the full list of endpoints with this parameter.

Actionable, detailed error messages are critical — especially for MCP consumers where LLMs need clear feedback to adjust their actions.
