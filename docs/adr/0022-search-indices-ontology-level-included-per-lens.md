# 0022. Search indices are ontology-level and included per lens

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Ranked search read one hard-wired text and vector per entity, composed from every
`string` property of its type, plus document passages. Retrieval needed more than one
indexed meaning per entity type — an entity found through its own fields, through one
relation with the entity at its other end, through a document — and a persisted,
shared form of what retrievers had been embedding in memory. Two questions came with it,
easy to conflate: who defines and stores an index, and which lenses may query it. A lens
only subtracts from its ontology's schema; it holds no types and no data. A scoped lens
already ranked on text composed from the full schema, including values it hides, and
that was documented and accepted.

## Alternatives considered

- **Flags on the schema** — mark properties and relation types as semantic or keyword,
  and derive exactly one text per entity type. Rejected: one text per type cannot serve a
  second index of the same type with other content, relation flags on the relation type
  fix its content for every use, and every flag change re-embeds the whole type with no
  way to stage a variant.
- **Lens-owned indices** — each lens defines its own, validated against its scope.
  Rejected: identical indices in two lenses duplicate entries and embedding cost; lens
  deletion has no consent step and would silently drop built indices; a lens would own
  stored content, against "lenses only subtract"; and a lens scope edit would invalidate
  stored data where today it writes nothing.
- **Consumer-declared, content-addressed indices** — no index object; each consumer
  declares what it wants embedded and identical declarations share storage. Rejected: an
  implicit, unpredictable build cost on saving a consumer, nothing to point at for status,
  rebuild or deletion, and two declarations differing by one field become two full copies.
- **Ontology-level indices visible to every lens.** Rejected: a scoped lens would search
  indices over entity types it hides.
- **Ontology-level indices with availability derived from the lens** — an index is
  searchable wherever the lens sees its root type, optionally everything it reads.
  Rejected: a lens cannot withhold an index it could technically see, and the strict
  variant would remove the default index from any scoped lens hiding a single `string`
  property — a regression.
- **Ontology-level indices included per lens** — chosen. Definitions are modeling
  objects stored once; a scoped lens includes indices as one more inclusion kind, and the
  existing inclusion mechanism is the reference lifecycle. The objection that had sunk an
  ontology-level retriever referenced by lenses — a new key space and reference lifecycle
  — does not apply, because inclusions already are that mechanism. Its cost, one more
  thing to include in a scoped lens, is met by including managed indices automatically.
  Paired with managed default indices, which reproduce the former search with no
  configuration.

## Outcome

The search-index placement and managed-index rules in
[decisions.md](../decisions.md#behaviour).
