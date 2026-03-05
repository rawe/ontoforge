# Ontology Views

> Feature proposal for introducing ontology views — consistent subsets of a single root ontology that allow focused work on domain-specific portions of the model.

## Glossary

This feature introduces a hierarchy in the modeling domain. Precise terminology prevents confusion.

| Term | Context | Definition |
|---|---|---|
| **Ontology** | Modeling | The single, complete model hosted by an OntoForge server. Contains all entity types, relation types, and property definitions. This is the authoritative source of truth. |
| **View** | Modeling | A named, consistent subset of the ontology. Declares which entity types, relation types, and properties are exposed. Has its own key, name, and description. |
| **ontology** (lowercase) | Runtime | Anything addressable at runtime by key — either the ontology itself or a view. The runtime API does not distinguish between them. From a runtime consumer's perspective, a view *is* an ontology. |

**The naming rule:** In modeling, always use "Ontology" (the root) or "View" (a subset) — never use "ontology" generically. In runtime, the distinction does not exist; everything is an ontology addressed by key.

## Motivation

The full ontology can become too large and complex to work with directly. Teams, applications, or LLMs often need to operate on a focused, domain-specific portion of the model. Today this requires creating separate ontologies, which fragments the data model and makes cross-domain relationships impossible.

Views solve this by providing focused subsets while keeping a single, shared ontology as the source of truth. The ontology is primarily for modeling and integration; views enable practical day-to-day work.

## Concept

An OntoForge server hosts exactly **one ontology**. This ontology contains every entity type, relation type, and property definition.

A **view** is a declarative filter over the ontology. It selects:
- Which entity types are included
- Which relation types are included
- Which properties of included entity types are exposed
- Which properties of included relation types are exposed

Views do not copy or duplicate schema elements. They reference the same entity types, relation types, and property definitions that exist in the ontology. If an entity type appears in multiple views, it is the same entity type — not a duplicate.

Each view has its own **key**, **name**, and **description**. At runtime, a view is accessed by its key through the same API pattern as the ontology itself. The runtime does not need to know whether a key resolves to the ontology or a view.

## Invariants

These properties must always hold:

1. **Single ontology.** An OntoForge server has exactly one ontology. All entity types and relation types belong to it.
2. **Views are subsets.** A view cannot define new entity types, relation types, or properties. It can only select from what the ontology defines.
3. **Runtime is unchanged.** The runtime API, runtime service, and runtime data model do not change. A view resolves to a schema the same way the ontology does. No new runtime endpoints, no behavioral changes.
4. **No-views fallback.** If no views exist, working with the ontology behaves exactly as today. The view concept only affects behavior once views are introduced.
5. **Views are internally consistent.** A view must never expose a broken or infeasible schema (see Consistency Constraints below).
6. **The ontology is always valid.** Changes to the ontology must not break existing views. Validation enforces this.

## View Scope

A view declaration specifies what is exposed. Everything not selected is hidden from that view's consumers.

### Entity types
A view selects a subset of entity types by key. Only selected entity types appear in the view's schema and are queryable through the view's runtime endpoint.

### Relation types
A view selects a subset of relation types by key. A relation type can only be included if both its source and target entity types are also included in the view (see Consistency Constraints).

### Properties of entity types
For each included entity type, a view may further restrict which properties are exposed. If no property filter is specified for an entity type, all properties are exposed.

### Properties of relation types
Same as entity type properties — a view may restrict which properties of a relation type are exposed.

## Consistency Constraints

A view must represent a valid, usable schema. The following constraints are enforced when a view is created or modified:

### Referential integrity of relations
If a view includes a relation type, it must also include both the source and target entity types of that relation. A relation type without its endpoints is meaningless.

### Required properties
If an entity type has a required property, a view that includes that entity type must either:
- **Include the required property**, or
- **Provide a default value** that satisfies the requirement, so that data created through the view remains valid against the full ontology.

The same applies to required properties on relation types.

### No dangling references
A view's schema must be self-contained. Every type or property referenced within the view must be resolvable within the view.

## Transparency

Any filtering performed by a view must be fully transparent to users working with that view.

- The view's description should convey its purpose and scope.
- Modeling UI and API responses for a view should indicate which elements are included and that the view is a subset of the ontology.
- Users must never be surprised by "missing" entity types or properties — it should be clear that they are working within a view, not the full ontology.

## Impact on Modeling

### What changes

- **Ontology management** becomes singular. Instead of CRUD for multiple ontologies, there is one ontology to manage (create/read/update; delete is a server-level operation).
- **View management** is new. CRUD for views, including their filter declarations. Creating a view is a selection step: choose entity types, relation types, and optionally restrict properties.
- **Validation** must expand. Validating the ontology must also verify that all existing views remain consistent. Changes to the ontology that would break a view must be rejected or flagged.
- **Schema graph visualization** needs to support both the full ontology and individual view scopes.

### What does not change

- **Entity type and relation type management** — these are still created, updated, and deleted on the ontology. Views do not own types.
- **Property management** — properties are defined on entity types and relation types in the ontology. Views only select which ones are visible.

## Impact on Runtime

**None.** The runtime API, service layer, data model, and SchemaCache remain unchanged. A view resolves to a schema (a set of entity types, relation types, and property definitions) exactly as the ontology does. From the runtime's perspective, it is loading a schema by key — the fact that the key might point to a view is irrelevant.

This is possible because each view has its own key, name, and description. The schema loaded for a view is a filtered version of the ontology's schema, but the runtime receives it in the same format and processes it identically.

## Impact on MCP

The modeling and runtime MCP servers are affected differently.

### Runtime MCP — unchanged

The runtime MCP is scoped to a key (`/mcp/runtime/{key}`). It exposes the schema and data operations for that key. Whether the key resolves to the ontology or a view is irrelevant — the runtime MCP receives a schema and works with it. No changes needed.

### Modeling MCP — significant change

The modeling MCP currently scopes to a specific ontology (`/mcp/model/{ontologyKey}`). With a single ontology, this per-ontology scoping no longer makes sense. The modeling MCP must:

- Operate on **the ontology** directly (manage entity types, relation types, properties).
- Manage **views** (create, update, delete view declarations).
- Expose the full ontology schema and individual view schemas for inspection.

This means the modeling MCP URL structure changes — there is no ontology key to select because there is only one ontology. The MCP mount point could simplify to `/mcp/model` (no key parameter).

### Schema endpoints — two perspectives

Today two schema views exist: the modeling schema (full structure with metadata) and the runtime schema (focused on what a runtime consumer needs). With views, these perspectives become more distinct:

- **Modeling schema**: Always the full ontology. Used for editing, validation, and view management. The modeling MCP works with this.
- **Runtime schema** (per key): The effective schema for a given key — either the full ontology or a view's filtered subset. The runtime MCP and REST API work with this.

This separation is already present today; views make it more explicit.

## Impact on Existing Multi-Ontology Behavior

This feature replaces the current multi-ontology model with a single-ontology-plus-views model. This is a fundamental architectural shift.

### Migration

Existing deployments with multiple ontologies need a migration path:
- The ontologies are merged into one ontology containing all entity types and relation types.
- Each former ontology becomes a view that selects the same entity types and relation types it previously contained.
- Runtime keys remain unchanged, so existing integrations continue to work.

### Entity sharing (existing feature idea)

The multi-ontology entity sharing concept (documented in `multi-ontology-entity-sharing.md`) is largely subsumed by views. Entities were already shared when multiple ontologies used the same entity type key. With a single ontology and views, sharing is explicit and by design — all views reference the same entity types in the same ontology.

## Validation

### When creating or modifying a view
The system validates that the view's filter declaration produces a consistent schema (referential integrity, required properties, no dangling references).

### When modifying the ontology
Changes to the ontology must be checked against all existing views:

| Ontology change | Potential view impact |
|---|---|
| Add entity type | No impact (no view includes it yet) |
| Remove entity type | Views including this type break — reject or require view update first |
| Add optional property | No impact (views that don't filter properties get it automatically; views that filter can ignore it) |
| Add required property | Views including this entity type must be updated to include the property or provide a default |
| Remove property | Views exposing this property must be updated |
| Make optional property required | Views including the entity type but not the property must be updated |
| Add relation type | No impact |
| Remove relation type | Views including this relation type break |
| Change relation type endpoints | Views including this relation type must be re-validated |

This validation can be enforced per-operation (reject changes that break views) or deferred to the existing validation endpoint (validate ontology + all views together). The approach is an architectural decision to be made during design.

## Open Questions

1. **Migration strategy.** How are existing multi-ontology deployments migrated? Automatic merge, manual process, or tooling-assisted?
2. **Property filtering granularity.** Can views restrict properties to read-only (exposed but not writable), or is it strictly include/exclude?
3. **Default values for required properties.** Where are defaults defined — on the view declaration, on the property definition in the ontology, or both?
4. **View composition.** Can a view be defined in terms of another view, or only in terms of the ontology?
5. **Ontology-level runtime access.** Should the ontology itself always be accessible at runtime (exposing everything), or can it be restricted to modeling-only once views exist?
6. **Cascading enforcement model.** Should ontology changes that break views be rejected immediately (strict), or should the system allow temporary inconsistency with a validation warning (lenient)?
7. **Import/export.** How does JSON export/import handle views? Export the ontology with view declarations embedded, or separate exports per view?
