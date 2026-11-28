/** The built-in skill `schema-changes`: its SKILL.md. */
export default `---
name: schema-changes
description: Change an existing OntoForge schema safely - what can and cannot change, how to work around an immutable key, data type or endpoint, what deleting leaves behind, and how cascade consent works for lenses and custom search indices. Use when renaming, retyping, restructuring or deleting entity types, relation types or properties in an ontology that already has lenses, indices or data.
---

# Schema changes

Schema edits change the design, not the instance data. The one exception: setting,
changing or clearing an entity type's identity rebuilds every entity's identity.

## What never changes

Set once, never updated: a type's or property's \`key\`, a property's \`data_type\`, the type
a property belongs to, and a relation type's source and target entity types. The update
tools have no argument for them.

To change one anyway, build the new shape beside the old:

1. Create the new type, property or relation type (\`create_entity_type\`,
   \`add_property\`, \`create_relation_type\`).
2. Move the values with the runtime tools of a lens that shows both shapes. The modeling
   tools never write instance data.
3. Include the new shape in the scoped lenses and custom search indices that used the old
   one, then delete the old one.

What can change in place: display names and descriptions, \`required\` and
\`default_value\`, an entity type's name property and identity, a relation type's \`parent\`
end and \`one_per_pair\`. A description can be replaced but not cleared.

## Deleting leaves data behind

\`delete_entity_type\` and \`delete_relation_type\` delete the definition, not the entities
or relations stored under it. Those stay stored, hidden from every lens, until a type is
created again under the same key; meanwhile no tool can list or remove them, short of
deleting the ontology. Delete or move the data first, through a lens, while the type
still exists.

Order of deletes:

- An entity type that a relation type names as source or target cannot be deleted, with
  or without \`cascade\`. Delete those relation types first.
- An entity type's name property cannot be deleted: choose another one with
  \`update_entity_type\` \`name_property\` first.
- A property in an identity cannot be deleted, made optional or given a default: change or
  clear the identity first (\`identity_properties\` null).

## Cascade consent

A change that would break a lens or a custom search index is refused, saying what it
would break. Repeating it with \`cascade\` true consents, and the server repairs them:

| Change | Refused when | \`cascade\` does |
|---|---|---|
| \`delete_entity_type\` | a lens includes it, or a custom index is rooted on it | drops the inclusions, deletes those indices |
| \`delete_relation_type\` | a lens includes it, or a custom index has a group on it | drops the inclusions and the groups |
| \`add_property\`, required, no default | a lens allowlist for the type omits it | adds the key to those allowlists |
| \`delete_property\` | a custom index reads it | removes it from allowlists and indices |
| \`delete_search_index\` | a lens includes it | drops the inclusions |
| identity set (\`create_entity_type\`, \`update_entity_type\`) | a listed property is optional or has a default, or an allowlist omits it | makes them required without default, adds them to allowlists |

Read the refusal before consenting: an index left with no field and no group is deleted
with its lens inclusions. Managed indices never block a change.

## Changes nothing checks

- Making an existing property required, or removing a required property's default, with
  \`update_property\` is never refused, even when a lens allowlist omits it. That lens then
  validates as invalid, and creates through it succeed without the value. Run
  \`validate_schema\` afterwards and fix the allowlists with \`add_entity_type_to_lens\` or
  \`add_relation_type_to_lens\`.
- Deleting a property that only lens allowlists name is not refused: the allowlists keep
  a key that matches nothing. \`cascade\` cleans them up.
- Retrievers, saved queries and search profiles are not repaired by any cascade. A
  change can leave them invalid; \`list_retrievers\` shows each retriever's validation.

## Rules that check stored data

Setting an identity, a \`parent\` end or \`one_per_pair\` is checked against the data already
stored. A violation refuses the change, naming what breaks; repair the data first, no
consent overrides it. Clearing a relation rule is never refused, but a parent relation is
always one per pair: clear \`parent\` before \`one_per_pair\`.

Finish every restructuring with \`validate_schema\`.
`;
