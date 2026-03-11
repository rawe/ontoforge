# Data Scoping

> Narrow runtime visibility to subsets of data by declaring scope dimensions in the schema and setting scope values at request time.

## Problem

All runtime queries return the full dataset of an ontology. There is no built-in way to restrict visibility to a logical subset — e.g. "only entities belonging to project PROJ-001" or "only entities for customer CUST-42". Clients must filter manually, which is error-prone and not enforceable.

## Concept

Data scoping introduces **scope dimensions** — entity types whose `key` values define logical boundaries. At runtime, a client sets one or more scope values, and all reads and writes are automatically constrained to matching entities.

Scoping is declarative: the schema defines which dimensions exist, and the runtime enforces them transparently.

## Key Convention

Scoping builds on the existing reference key convention:

| Pattern | Meaning | Example |
|---|---|---|
| `key` | Entity's own identity | `"PROJ-001"` on a Project entity |
| `{entity_type}_key` | Reference to another entity's `key` | `project_key: "PROJ-001"` on a Requirement |

- A **scope dimension** is an entity type marked as scope-eligible in the schema (e.g. `Project`, `Customer`).
- Entities that participate in a scope dimension carry the reference key `{entity_type}_key` (e.g. `project_key`, `customer_key`).
- The scope dimension entity itself is identified by its own `key` — never repurposed as a foreign reference.
- Not all entity types must participate. Only those carrying the `{entity_type}_key` property are scoped.

## Semantics

### Schema

- One or more entity types can be marked as scope dimensions.
- Each scope dimension derives its reference key automatically: entity type `Project` → `project_key`, entity type `Customer` → `customer_key`.
- The scope dimension entity type's `key` has a uniqueness constraint. The derived `{entity_type}_key` on other entity types is not unique (many entities share one scope value).

### Runtime — Reads

- When a scope value is set for a dimension, all queries on participating entity types add a filter: `{entity_type}_key = <scope_value>`.
- Multiple dimensions can be active simultaneously (intersection). E.g. `project_key = "PROJ-001"` AND `customer_key = "CUST-42"`.
- Unset dimensions apply no filter on that axis.
- The scope dimension entity itself is not filtered — it is the anchor, not a scoped member.

### Runtime — Writes

- When creating an entity that participates in an active scope dimension, the `{entity_type}_key` is set automatically to the active scope value.
- If the entity type participates in a scope dimension but no scope value is active for that dimension, the write proceeds without setting the reference key (unscoped).

## API Surface

### REST API

Scope values are passed as HTTP headers per request:

- `X-Scope-Project-Key: PROJ-001`
- `X-Scope-Customer-Key: CUST-42`

Header naming follows the pattern `X-Scope-{Entity-Type}-Key`. Multiple headers can be combined.

### MCP

Same HTTP headers apply (MCP uses HTTP/SSE transport). MCP clients pass them via their header configuration, scoping the entire session.

## Example

Schema declares `Project` as a scope dimension. Entity types `Requirement` and `Specification` carry `project_key`.

| Request | Behavior |
|---|---|
| `GET /api/runtime/my_onto/entities/Requirement` | Returns all requirements (no scope) |
| Same request with `X-Scope-Project-Key: PROJ-001` | Returns only requirements where `project_key = "PROJ-001"` |
| `POST /api/runtime/my_onto/entities/Requirement` with `X-Scope-Project-Key: PROJ-001` | Creates requirement with `project_key` automatically set to `"PROJ-001"` |
| MCP `list_entities(entity_type_key="Requirement")` with header `X-Scope-Project-Key: PROJ-001` | Same filtering, applied transparently |

## Scope

- Backend only (REST API + MCP). No frontend changes.
- Schema modeling: mechanism to mark entity types as scope dimensions.
- Runtime enforcement: middleware or service-layer filtering/injection.
- No changes to the data model — scoping uses existing properties and the reference key convention.
