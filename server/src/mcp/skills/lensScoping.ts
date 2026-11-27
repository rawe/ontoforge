/** The built-in skill `lens-scoping`: its SKILL.md. */
export default `---
name: lens-scoping
description: Design an OntoForge lens - unscoped or scoped, which entity types, relation types and properties it exposes, and which search indices it searches - with the scoping rules that surprise modelers and the modeling tool calls in a safe order. Use when creating a lens for a team, an application or an agent, narrowing or widening an existing lens, or when a lens hides or shows something unexpectedly.
---

# Lens scoping

A lens is a named view over one ontology's schema. It decides what a caller can name,
see and write; it does not copy data. Every lens reads and writes the same entities.

## Unscoped or scoped

- **Unscoped**: the lens has no type inclusion. It shows the whole schema and keeps doing
  so as the schema grows: a type created later is visible at once, and a schema change
  never breaks it. Choose it for the modeler's own lens or a trusted full-access client.
- **Scoped**: the lens has at least one type inclusion (\`add_entity_type_to_lens\` or
  \`add_relation_type_to_lens\`). It shows only what it declares. Choose it for an audience
  that must not see or write everything, or to give a small model a small schema.

Search-index inclusions never make a lens scoped.

## The scoping matrix

Entity inclusions and relation inclusions are independent. Their combination decides
what the lens shows:

| Entity inclusions | Relation inclusions | Entity types shown | Relation types shown |
|---|---|---|---|
| none | none | all | all |
| some | none | the included ones | inferred: every relation type whose source and target are both shown |
| none | some | all | the included ones |
| some | some | the included ones | the included ones with both endpoints shown |

**Prefer entity inclusions alone.** Naming entity types yields a coherent subgraph: the
relation types between them follow on their own, including ones added later.

**The cliff edge.** Adding the first relation inclusion to a lens that relies on inferred
relation types hides every inferred one at once. Nothing warns. Include a relation type
explicitly only when you want to control the whole relation dimension, and then include
every relation type the lens needs.

## Property allowlists

\`properties\` on an inclusion:

| \`properties\` | Shows | As the schema changes |
|---|---|---|
| omitted | every property of the type | tracks the type: new properties appear |
| a list | exactly those keys | pinned: new properties stay hidden |

- Use an allowlist to hide sensitive or noisy properties. It must name every required
  property of the type that has no default, or creates through the lens could never
  succeed. Identity properties must be in it too, or the type has no identity through
  the lens.
- A lens with allowlists is what the cascade protocol defends: adding a required property
  without a default, or setting an identity, is refused while an allowlist for that type
  omits the key; \`cascade\` adds it.
- Only an inclusion carries an allowlist. With entity inclusions alone, inferred relation
  types always show all their properties.
- To change an allowlist, call \`add_entity_type_to_lens\` or \`add_relation_type_to_lens\`
  again: adding an inclusion replaces the previous one.

## Search through the lens

No lens searches a switched-off managed index. Otherwise an unscoped lens searches every
index; a scoped lens only the indices it includes, each only while it shows the index's
root entity type.

- A managed index that comes into existence later is included automatically in every
  scoped lens that shows its root type (a passage index only where its document property
  is shown). Indices that already exist are **not** included when you create a scoped
  lens or include a type afterwards: include them with \`add_search_index_to_lens\`, or
  search through that lens finds nothing by them.
- A scoped lens with entity inclusions must include the index's root entity type before
  the index. Including an index twice is refused.
- An index may read properties the lens hides. Their values still drive ranking, but the
  match snippet is withheld. If that is unwanted, give the lens its own custom index that
  reads only visible fields.

## A safe order of calls

1. \`get_schema\` for the types, properties and lenses; \`list_search_indices\` for the indices.
2. \`create_lens\` with \`key\`, \`name\` and a \`description\` stating the audience.
3. \`add_entity_type_to_lens\` for each entity type, with \`properties\` only where you hide
   something.
4. \`add_relation_type_to_lens\` only if you take control of the relation dimension. Add it
   after its source and target entity types: before any entity inclusion exists the
   endpoint check is skipped, and the lens can end up invalid.
5. \`add_search_index_to_lens\` for each index the lens should search, for example
   \`<entityTypeKey>~default\`.
6. \`validate_lens\`: errors make the lens invalid; warnings name included indices whose
   root type the lens hides and properties an index reads that the lens hides.

Retrievers, saved queries and search profiles belong to one lens and are checked against
what it shows: narrowing the lens can leave a stored one invalid, and nothing repairs it.
Save it again after such a change. \`delete_lens\` deletes them with the lens.
`;
