# Multi-Ontology Entity Sharing

> Feature proposal for making shared entity spaces across ontologies an explicit, well-supported concept in OntoForge.

## Context

OntoForge treats ontologies as **perspectives on a shared data space**, not as isolated data silos. When two ontologies define the same entity type key (e.g., `person`), their entity instances coexist in the same Neo4j node space under the same label. This is intentional and central to the product vision.

A `person` in a family tree ontology and a `person` in an employee directory ontology are the same underlying nodes. Each ontology defines its own properties and relations for that entity type — one might have `bio` and `family_role`, the other `department` and `hire_date`. The runtime API, scoped to a specific ontology, validates writes against that ontology's schema and filters responses to show only the properties and relations defined in that ontology.

This means:
- **Entities are shared by type key.** Two ontologies with `person` operate on the same pool of person nodes.
- **Properties are additive.** Each ontology contributes its own property definitions. A node may carry properties from multiple ontologies.
- **Relations are ontology-scoped.** Each ontology defines its own relation types. The runtime only exposes relations matching the active ontology's schema.
- **Search spans the shared space.** Semantic search for `person` entities returns all person nodes regardless of which ontology created them, ranked by relevance. This is correct — the ontology scoping happens at the property and relation level, not at the entity level.

This design enables powerful cross-domain use cases: model a person from a family perspective in one ontology and from a professional perspective in another, with both views operating on the same underlying entities.

## Current State

The sharing behavior works but is entirely **implicit**. There is no mechanism to:
- Discover that two ontologies share an entity type
- Understand which properties on a node come from which ontology
- Validate that shared entity types are modeled consistently across ontologies
- Prevent accidental type key collisions when sharing is not intended

This lack of explicitness creates modeling risks. A user might create a `person` entity type in a new ontology without realizing it connects to an existing pool of person nodes from another ontology. Conversely, a user who intends to share entities across ontologies has no tooling support for coordinating the schemas.

## Goals

1. **Make sharing transparent.** Users should be able to see when and how entity types are shared across ontologies, both during modeling and at runtime.
2. **Support intentional modeling.** Provide tooling that helps users model shared entity types consistently, catching mismatches and potential issues before they cause runtime problems.
3. **Prevent accidental collisions.** When a user creates an entity type key that already exists in another ontology, surface this clearly so they can make an informed choice — share intentionally or pick a different key.
4. **Document the mental model.** The multi-ontology sharing concept should be explained in architecture and user-facing documentation so the behavior is expected, not surprising.

## Proposed Capabilities

### Shared Type Discovery in Modeling

When creating or editing an entity type, the modeling UI and API should surface whether the same type key exists in other ontologies. This helps users understand the implications before committing to a key.

**UI**: When entering an entity type key during creation, show an inline notice if the key is already used by other ontologies — listing which ones and what properties they define. This is informational, not blocking.

**API**: A modeling endpoint (or extension to the existing entity type creation response) that returns cross-ontology usage information for a given type key.

### Schema Compatibility Check

When two ontologies share an entity type key, their property definitions may diverge in ways that cause confusion — for example, both defining a `status` property but with different data types (string vs boolean). A compatibility check would flag such conflicts.

This could be:
- A validation warning during schema validation (`GET /api/model/ontologies/{id}/validate`)
- A dedicated cross-ontology compatibility endpoint
- An advisory section in the modeling UI showing property overlaps and conflicts across ontologies that share entity types

### Property Provenance at Runtime

When viewing an entity instance, it may carry properties from multiple ontologies. The runtime currently filters to show only properties defined in the active ontology's schema. This is correct, but users may want to understand the full picture.

A possible extension: an optional query parameter or UI toggle that shows all properties on a node with annotations indicating which ontology defines each one. This would be read-only and informational.

### Documentation

The multi-ontology sharing model should be documented as a core architectural concept:
- **Architecture docs**: Explain the shared entity space model, how ontology scoping works at the property/relation level, and why entities are not isolated per ontology.
- **User-facing docs or UI help text**: Explain that creating an entity type with a key used by another ontology means operating on shared data, and what the implications are.
- **Modeling best practices**: Guidelines for when to share entity types intentionally and how to coordinate property schemas across ontologies.
