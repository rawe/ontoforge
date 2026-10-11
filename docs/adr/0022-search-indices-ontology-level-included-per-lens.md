# Search indices are ontology-level and included per lens

Rule: [Search](../decisions.md#search)

## Context

Retrieval needs more than one indexed meaning per entity type: an entity found through
its own fields, through one relation with the entity at its other end, or through a
document. It also needs that content stored and shared. Two questions come with it and
are easily conflated: who defines and stores an index, and which lenses may query it. A
lens only subtracts from its ontology's schema and holds no types or data.

## Rejected

- **Flags on the schema** marking properties and relation types as semantic or keyword,
  giving one text per type. One text cannot serve a second index of the same type, a
  relation flag fixes its content for every use, and every flag change re-embeds the
  whole type with no way to stage a variant.
- **Lens-owned indices.** Identical indices in two lenses duplicate entries and embedding
  cost. Lens deletion has no consent step and would silently drop built indices. A lens
  would own stored content, and a scope edit would invalidate stored data.
- **Consumer-declared, content-addressed indices.** The build cost is implicit and
  unpredictable, there is nothing to point at for status, rebuild or deletion, and two
  declarations that differ by one field become two full copies.
- **Ontology-level indices visible to every lens.** A scoped lens would search indices
  over entity types it hides.
- **Availability derived from the lens** (searchable wherever the lens sees the root
  type, or everything the index reads). A lens could not withhold an index it can see.
  The strict variant would drop the default index from any scoped lens hiding one
  `string` property.
