# Entity identity

How OntoForge tells entities apart. Every entity has an **id**, assigned by the server and
never changed. An entity type may also declare an **identity**: the values of some of its
properties that name an entity the way people and other systems know it, such as a code
and a year. The id stays the reference; the identity is a second way to address an entity.

[Glossary](../glossary.md#data). The rationale for the identity model and commit-time
uniqueness is in [ADR 0032](../adr/0032-entity-identity-as-ordered-property-list.md) and
[ADR 0033](../adr/0033-identity-uniqueness-in-changesets-at-commit.md).
Not to be confused with [entity identity comparison](entity-identity-comparison.md), which
judges whether two snapshots describe the same real-world thing and writes nothing.

## Id and identity

| | Id (`_id`) | Identity (`_identity`) |
|---|---|---|
| Who sets it | The server, at create | Derived from the identity properties' values |
| Changes | Never | When an identity property's value changes |
| Present | On every entity and relation | On entities of a type that declares one |
| Unique | Within the ontology | Within the entity type |
| Stored as a reference | Yes: relation ends, anchors, staged objects | Never |

Everything stored points at ids, so a renamed identity breaks nothing. An identity is
resolved to an id wherever it is accepted, then the request runs as if it had named the id.

## Declaring an identity

An entity type's `identityProperties` is an ordered list of 1 to 5 distinct keys of its own
`string`, `integer` or `date` properties, or none. Setting, changing or clearing it is a
schema edit, checked in this order:

1. **The list.** Unknown keys, other data types, a repeated key, an empty list or more than
   five keys are refused with a validation error on `identityProperties`.
2. **The stored data.** Every entity of the type must have a value for each listed property,
   no `string` value may be empty, no two entities may share the resulting identity, and
   none may be longer than the limit. Otherwise the edit is refused with a conflict whose
   `details.violations` names each broken rule (`missing_value`, `duplicate`, `too_long`)
   with its count and its first five entities. Nothing is changed.
3. **The cascade.** An identity property must be required and have no default, and every
   lens that lists properties of the type must list it. Where that is not yet so, the edit
   needs the [cascade protocol](schema-modeling.md#the-cascade-protocol); with consent the
   properties become required, lose their defaults and join those lenses' lists.

On success every entity of the type gets its identity, and clearing it removes them. This is
the one schema edit that writes instance data. While a property belongs to the identity it
cannot become optional, take a default or be deleted; change the identity first.

Design [transfer](transfer.md) carries `identityProperties` on each entity type. Import
never cascades, so it refuses an identity whose properties break these rules.

## The text form

An identity is one string: the identity properties' stored values in the declared order,
joined with `~`. A `string` value writes `%` as `%25` and `~` as `%7E`, always (even with a
single property), so the join is never ambiguous. An `integer` is plain decimal and a
`date` is `YYYY-MM-DD`. An identity is at most 512 Unicode code points. Matching is exact:
no trimming and no case folding.

`_identity` is a system property: always readable, never writable. Entity lists sort and
filter on it like a `string` property, and [OQL](oql.md) reads it like the other system
properties.

## Writes

Every create and update computes the entity's identity from the values it will have.

- A create whose identity another entity of the type holds is refused with `409
  RESOURCE_CONFLICT`, `details.code` `IDENTITY_TAKEN`, the identity and the identity
  property keys. Two concurrent creates of one identity give exactly one entity and this
  conflict, never a storage error.
- There is no create-or-update on immediate writes. An update never creates; a client that
  loads data stages [puts](changesets.md#put), which resolve to a create or an update.
- An update that changes an identity property's value **renames** the identity, under the
  same check. The old identity is not kept: it no longer finds the entity.
- An update locks the entity before it reads the values its identity is built from, so two
  concurrent updates of different identity properties leave the identity in step with the
  values.
- An empty `string` value for an identity property is refused.

## Addressing by identity

An id and an identity are never mixed in one field or route. Every route that names an
entity by id has a twin that names it by identity, URL-encoded as one path segment:
`/entities/{entityTypeKey}/identity/{identity}` in place of
`/entities/{entityTypeKey}/{entityId}`, with the same suffixes (path, neighbours,
documents). Every body or query field that names an entity by id has a twin
(`fromEntityIdentity` beside `fromEntityId`, `parentIdentity` beside `parentId`), and the
MCP tools take `entity_identity`, `from_entity_identity`, `to_entity_identity` and
`parent_identity` beside the id arguments. A pair takes one of its two, never both;
where the entity is required, exactly one. An identity no entity has is not found.

The web client's entity URLs use ids only.

## Through a lens

A lens always shows a type's whole identity: identity properties are required without a
default, and a lens's property allowlist must list every such property
([inclusions](ontology-lenses.md#inclusions)). Import writes inclusions unchecked, so it
can still produce a lens that hides one. Through such a lens the type has no identity: `identityProperties` reads as null,
`_identity` is withheld from every read, and identity addresses are not found.

Search hit targets, hierarchy path steps and assistant entity cards carry the identity
where the lens shows it.

## In a changeset

[Changesets](changesets.md) resolve an identity once, at staging, in the changeset's view:
an entity created, renamed or deleted in the changeset counts as the changeset would leave
it, and an identity two entities would hold there is a conflict. The staged object then
holds the id, never the identity: each staged entity's identity is built when it is
needed, as the commit would build it then, from its staged values over the entity's
current stored ones under the current definition. A live write to a value the changeset
does not stage therefore moves the entity's identity in the changeset's view too, and
values it leaves unable to make one (too long, say) give the entity none there and are a
`replay` fault. The review shows the identity each staged entity gets, before and after.

Uniqueness is judged on the end state, so a changeset may swap two identities or delete an
entity and create another with its identity. Two entities the changeset would leave with
one identity are a `duplicate_identity` fault on submit, on the review and on check, and a
violation at commit. A staged create whose identity another write took after staging fails
the commit; nothing is persisted, and checking and committing again reports it.

[Storage of the identity](../storage-adapters.md) is the adapter's business.
