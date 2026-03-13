# Ontology Views

> **Status: Implemented**

> Architectural specification for ontology views — separating the schema from ontologies so that ontologies become named lenses over a shared, independent schema.

## 1. Overview

OntoForge currently ties entity types and relation types to individual ontologies via ownership relationships (`HAS_ENTITY_TYPE`, `HAS_RELATION_TYPE`). Ontology views replaces this with a model where the schema (all types and properties) exists independently, and ontologies are named lenses that expose the full schema or a filtered subset. This enables focused work on domain-specific portions without fragmenting the data model.

**This is a breaking change.** No migration path from the current multi-ontology model. Existing deployments must recreate their setup.

## 2. Terminology

| Term | Definition |
|---|---|
| **Schema** | The independent, global set of all entity types, relation types, and property definitions. The ground truth. Exists in Neo4j without an owner node. |
| **Ontology** | A named lens over the schema. Provides a key, name, and description for runtime access. Does not own types. |
| **Unscoped ontology** | An ontology without `INCLUDES_TYPE` relationships. Exposes the full schema. Multiple unscoped ontologies are valid. |
| **Scoped ontology** | An ontology with `INCLUDES_TYPE` relationships. Exposes only the referenced types and properties. |

There is no root/view hierarchy. The structural difference between ontologies is purely whether `INCLUDES_TYPE` relationships exist.

## 3. Neo4j Data Model

**Schema (independent, no owner):**

```
(:EntityType {entityTypeId, key, name, description})
  -[:HAS_PROPERTY]->(:PropertyDefinition {propertyId, key, name, dataType, required, defaultValue})
(:RelationType {relationTypeId, key, name, description})
  -[:HAS_PROPERTY]->(:PropertyDefinition {...})
  -[:RELATES_FROM]->(:EntityType)
  -[:RELATES_TO]->(:EntityType)
```

**Ontologies (named lenses):**

```
(:Ontology {ontologyId, key, name, description})
  -- no INCLUDES_TYPE → unscoped (full schema)
  -- with INCLUDES_TYPE → scoped (subset):
  -[:INCLUDES_TYPE {properties: [...] | null}]->(:EntityType)
  -[:INCLUDES_TYPE {properties: [...] | null}]->(:RelationType)
```

**Instance layer (unchanged):**

```
(:_Entity:PascalCase {_entityTypeKey, _id, ...user props})
(:_Entity)-[:UPPER_SNAKE_CASE {_relationTypeKey, _id, ...user props}]->(:_Entity)
```

**Constraints:**

- `Ontology.ontologyId`, `Ontology.key` — globally unique
- `EntityType.entityTypeId`, `EntityType.key` — globally unique (no longer per-ontology)
- `RelationType.relationTypeId`, `RelationType.key` — globally unique
- `PropertyDefinition.propertyId` — globally unique
- `_Entity._id` — globally unique

### INCLUDES_TYPE Relationship

```
(:Ontology {key: "hr"})
  -[:INCLUDES_TYPE {properties: ["name", "email"]}]->(:EntityType {key: "person"})
  -[:INCLUDES_TYPE {properties: null}]->(:EntityType {key: "department"})
  -[:INCLUDES_TYPE {properties: null}]->(:RelationType {key: "works_in"})
```

- `properties: null` — all properties of that type are exposed
- `properties: [...]` — only listed properties are exposed
- Types without an `INCLUDES_TYPE` edge from this ontology are excluded

**Duplicate prevention:** `MERGE` semantics in Cypher (not `CREATE`) to prevent duplicate edges.

## 4. Schema Resolution

### Full Schema Loading

The runtime **always loads the full schema** from Neo4j — all entity types, relation types, and properties. For scoped ontologies, the repository also returns the `INCLUDES_TYPE` metadata. The service layer filters in Python to build the scoped `SchemaCache`. No filtering happens in Cypher.

### Scoped Schema Filtering (Four-Case Matrix)

Entity type and relation type scoping are **independent dimensions**:

| Entity INCLUDES_TYPE | Relation INCLUDES_TYPE | Entity types exposed | Relation types exposed |
|---|---|---|---|
| None | None | All (fully unscoped) | All |
| Some | None | Only included | Auto-filtered: only those whose source AND target are both in the included entity type set |
| None | Some | All | Only included |
| Some | Some | Only included | Only included (validation ensures referential integrity) |

> **Cliff-edge behavior (Case 2 → Case 4):** When an ontology has entity type INCLUDES_TYPE but no relation type INCLUDES_TYPE (Case 2), relations are conveniently auto-filtered. Adding the **first** explicit relation type INCLUDES_TYPE transitions to Case 4, where **only** explicitly included relation types are exposed. All previously auto-filtered relations disappear. This is by design — adding explicit relation scoping means the user wants explicit control. Users and MCP consumers must understand that the first relation INCLUDES_TYPE changes the filtering mode.

### Runtime Property Filtering

**API responses include only properties visible in the scoped ontology's schema.** The runtime builds a `SchemaCache` from the scoped view and filters entity/relation responses to only the properties declared in that cache. Properties stored on the node but not in the scoped schema are invisible through that lens.

Internally, the service retains access to the full schema for:
- Applying `defaultValue` from the full schema on entity/relation creation when a property is omitted by the scope
- Validating referential integrity

**Writes** are also filtered — setting a property not in the scoped schema is rejected as "Unknown property."

### Defaults for Omitted Properties

When a scoped ontology omits a property that has a `defaultValue` in the full schema:

1. The consumer does not see the property in the schema
2. On entity/relation **creation**, the runtime applies the `defaultValue` from the full schema
3. The entity/relation is stored with the default; the consumer never sees it through this lens
4. On **updates** (PATCH), defaults are NOT re-applied — only creation triggers default application

This applies to both required and optional properties with defaults. No computed or ontology-specific defaults — the `defaultValue` from the schema is used as-is.

**Validation rule:** A scoped ontology may omit a required property **only if** that property has a `defaultValue` in the schema. Optional properties may always be omitted.

### Neighbor Traversal

The neighbor endpoint filters results against the scoped `SchemaCache`. Connections via relation types not in scope are excluded from the response. This prevents leaking relationships the scoped ontology does not acknowledge.

### Semantic Search

Search results are limited to entity types in the scoped schema. Note: embeddings are built from all string properties at creation/update time (using the full schema of the creating ontology). A scoped ontology's search may return results with high relevance driven by properties invisible to that scope. This is inherent to the shared data model and is documented, not prevented.

## 5. Instance Data

**Entities are not scoped by ontology.** An `_Entity` with `_entityTypeKey: "person"` is visible to any ontology that includes the `person` entity type. Ontologies are lenses over a shared data space, not isolated silos.

- Creating a person through ontology A and reading it through ontology B (both include `person`) returns the same instance
- Each ontology shows only its scoped properties; the underlying node data is unchanged
- Concurrent writes through different ontologies follow last-write-wins semantics on shared properties

### Data Wipe Removed

`DELETE /api/runtime/{key}/data` is removed. Data does not belong to ontologies — wiping through a lens would delete shared instances visible to other ontologies. The corresponding MCP `wipe_data` tool is also removed.

If batch deletion is needed in the future, it should be an explicit, schema-level operation with clear scope (e.g., delete all instances of a specific entity type).

## 6. Validation

### Schema Validation

Validates the global schema independently of ontologies:

- Entity type key global uniqueness
- Relation type key global uniqueness
- Property key uniqueness within each type
- Data type validity
- Relation type source/target entity type references exist

### Ontology Validation

Validates a scoped ontology's `INCLUDES_TYPE` declarations against the schema. Unscoped ontologies are always valid.

- All referenced entity/relation type keys exist in the schema
- For each included relation type: both source and target entity types are also included (exposed by the ontology — either explicitly or via "no entity scoping = all entity types")
- For each explicit property list: all listed property keys exist on the respective type
- Required property rule: every required property without a `defaultValue` must be in the property list (or `properties: null`)

### Full Validation

Validates the schema + all scoped ontologies in a single pass. Reports errors grouped by scope.

## 7. Cascading Enforcement

Schema changes that would break a scoped ontology are **rejected by default** with actionable errors naming the affected ontologies.

### Delete Operations

Delete endpoints for entity types, relation types, and properties accept `?cascade=true`:

- Without cascade: blocked with error listing affected ontologies
- With `cascade=true`: auto-removes `INCLUDES_TYPE` references, then deletes

### Add Operations

Adding a **required property without a default** to an entity type is blocked if any scoped ontology with an explicit property list for that type does not include the new property. The error lists affected ontologies. `?cascade=true` on the property creation endpoint auto-adds the new property key to all affected explicit property lists.

### `properties: null` Exception

Scoped ontologies using `properties: null` for a type are **not affected** by property additions or removals on that type — they dynamically reflect whatever properties exist.

> **Stability note:** This creates two stability classes for scoped ontologies:
> - `properties: null` = **unstable** contract (schema changes to that type are reflected automatically)
> - `properties: [...]` = **stable** contract (changes are blocked unless cascaded)
>
> Consumers should be aware that `properties: null` ontologies may gain or lose properties when the schema changes.

## 8. Modeling API

### Schema Management (Global)

Entity types, relation types, and properties are global — no ontology scope in the URL.

```
POST   /api/model/entity-types
GET    /api/model/entity-types
GET    /api/model/entity-types/{id}
PUT    /api/model/entity-types/{id}
DELETE /api/model/entity-types/{id}[?cascade=true]

POST   /api/model/entity-types/{id}/properties
GET    /api/model/entity-types/{id}/properties
PUT    /api/model/entity-types/{id}/properties/{prop_id}
DELETE /api/model/entity-types/{id}/properties/{prop_id}[?cascade=true]

POST   /api/model/relation-types
GET    /api/model/relation-types
GET    /api/model/relation-types/{id}
PUT    /api/model/relation-types/{id}
DELETE /api/model/relation-types/{id}[?cascade=true]

POST   /api/model/relation-types/{id}/properties
GET    /api/model/relation-types/{id}/properties
PUT    /api/model/relation-types/{id}/properties/{prop_id}
DELETE /api/model/relation-types/{id}/properties/{prop_id}[?cascade=true]

POST   /api/model/schema/validate
```

### Ontology Management

```
POST   /api/model/ontologies
GET    /api/model/ontologies
GET    /api/model/ontologies/{id}
PUT    /api/model/ontologies/{id}
DELETE /api/model/ontologies/{id}
```

### Scope Management

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

### Export / Import

```
GET    /api/model/export
POST   /api/model/import
```

**Format v2.0** — breaking change from per-ontology format. No backward compatibility.

```json
{
  "formatVersion": "2.0",
  "entityTypes": [
    {
      "key": "person",
      "displayName": "Person",
      "description": "...",
      "properties": [
        { "key": "name", "displayName": "Name", "dataType": "string", "required": true, "defaultValue": null }
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

Top-level `entityTypes` and `relationTypes` are the full schema. Unscoped ontologies have no `includes` field. Scoped ontologies list their inclusions with `properties` filters.

## 9. Runtime API

**The runtime API surface is unchanged** except for the removal of the data wipe endpoint. Schema resolution is extended to handle scoped ontologies, but all other endpoints, request/response contracts, and behavior remain the same.

Requesting an entity type or relation type not in the scoped schema returns 404 — the type is invisible through this lens.

## 10. MCP

### Modeling MCP

Mounts at `/mcp/model` with no key parameter. The `OntologyKeyMiddleware` is removed from the modeling mount.

**Global schema tools** (no ontology key parameter): CRUD for types and properties, get/validate schema, export/import.

**Ontology management tools** (explicit `ontology_key` parameter): CRUD for ontologies, scope management, validate ontology.

### Runtime MCP

**Unchanged** except: `wipe_data` tool removed (same as REST).

Key resolution retains 3-tier: URL path → `X-Ontology-Key` header → env var.

## 11. Interaction with Data Scoping

The [data scoping](data-scoping.md) feature (if implemented) operates at the **data level** — filtering instances by scope dimension values. Ontology views operates at the **schema level** — filtering types and properties. The two compose naturally: schema scoping narrows what types are visible, data scoping narrows which instances within those types are returned.

**Known interactions:**

- **Scope dimension entity type excluded from scoped ontology:** Data scoping still works because it filters by the `{entity_type}_key` property value, not by the dimension entity type's presence in the schema. However, the consumer cannot discover valid scope values through an ontology that excludes the dimension type.
- **Scope dimension property filtered out:** If a scoped ontology's explicit property list omits the `{entity_type}_key` property (e.g., `project_key`), data scoping must inject the scope value via the full schema, bypassing scoped validation — similar to how defaults are applied.
- **Precedence:** When both a schema default and a scope value apply to the same property, the scope value takes precedence.

