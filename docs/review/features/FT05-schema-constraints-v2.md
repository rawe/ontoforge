# FT05 — Schema Expressiveness v2 (Cardinality, Enums, Uniqueness)

> **Type: Feature concept** · **Effort: Large (incremental)** · **Priority: Medium-High — deepens the core promise**
> Picks up two PRD "Future Extensions" (cardinality constraints, property type system expansion).

## Why this is the most on-mission feature available

OntoForge's differentiator is "**no unstructured writes** — every write is schema-validated".
The current constraint vocabulary is thin: property existence, six data types, `required`,
endpoint type compatibility. Real ontologies need more, and every constraint the schema *can't*
express is a consistency rule that silently moves back into application code — exactly what the
product exists to prevent. This matters double for the AI-agent audience: constraints are how a
knowledge graph defends itself against enthusiastic LLM writers.

## Concept — three increments, each independently shippable

**V2a — Enum values** (smallest, highest everyday value)
- `allowedValues: [...]` on string PropertyDefinitions. Validated on write; exposed in schema
  introspection so MCP agents and the UI's `DynamicForm` can render/choose legal values.

**V2b — Relation cardinality**
- `sourceCardinality` / `targetCardinality` on RelationType: `one` | `many` (default `many`,
  fully backward compatible). `one` is enforced at relation creation (reject if an outgoing/
  incoming relation of this type already exists). Covers the dominant cases ("works_for exactly
  one company") without inventing a min/max grammar.

**V2c — Unique properties**
- `unique: true` on PropertyDefinition, enforced per entity type in the service layer (Neo4j
  Community lacks per-label uniqueness constraints on dynamic labels; a service-layer check +
  index is the honest implementation). This is also what FT02 (data scoping) needs for its
  dimension keys — build it here, use it there.

## Cross-cutting rules (same for all three)

- Validation errors use the existing collect-all-errors pipeline.
- Scoped-ontology semantics must be defined: constraints are **global schema facts** — a lens can
  hide a property, but never relax its constraints (consistent with how `required`+defaults work
  today).
- Export format additions → one coordinated `formatVersion` bump (with FT03's `embeddable` flag
  if both land in the same window; see FT06 for the versioning discipline).
- Existing-data conflicts on constraint *addition* (e.g. duplicate values already stored):
  recommend reporting via a validation endpoint rather than blocking the schema change — the
  same "reject or cascade" philosophy the scope system already uses.

## Dependencies

- After doc consolidation (F08) — the contract this extends must first be correctly documented.
- FT02 depends on V2c's uniqueness mechanics; FT06 benefits from constraints being versioned.

## Open questions for the user

- Priority order of the three increments (recommended: enums → cardinality → unique).
- `one`-cardinality semantics on existing data: enforce only for new writes, or offer a
  validation report of violations? (Recommended: report, don't block.)
