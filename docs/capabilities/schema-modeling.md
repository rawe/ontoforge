# Schema modeling

Designing one ontology's schema: entity types, relation types and property
definitions. Everything runtime permits is derived from it, so this is the only
place where the shape of the graph is decided.

Vocabulary: [glossary](../glossary.md). Layering and invariants:
[../architecture.md](../architecture.md).

## What it does

An ontology has exactly one schema, and every modeling operation addresses one
ontology. Types are not owned by a lens, a project or a namespace below the
ontology — within its ontology, a type key names the same type everywhere, for
every caller. A lens can hide a type ([ontology-lenses.md](ontology-lenses.md)),
but it cannot own, shadow or redefine one. Beyond the ontology, nothing is shared:
two ontologies can each define `person`, and the two types have nothing to do
with each other.

Creating a type is immediately effective. Its CRUD surface, query surface, search
surface and MCP tools exist from the moment it is created, with no deployment step
and no generated code.

| Object | Identity | Fixed at creation | Editable afterwards |
|---|---|---|---|
| Entity type | key, unique within the ontology | key | display name, description, name property |
| Relation type | key, unique within the ontology | key, source entity type, target entity type | display name, description, [relation rules](#relation-rules) |
| Property definition | key, unique within its owning type | key, data type, owning type | display name, description, required flag, default |

Every type carries a mandatory display name and an optional description. Both are
labelling only: no behaviour depends on them, and nothing addresses a type by
display name.

**Deliberately not offered.** Their absence is a design position, and each is
something a reader would otherwise assume:

- No inheritance, subtyping or abstract types. Types are flat.
- An entity has exactly one type. There is no multi-typing and no retyping.
- No collection, enumeration, reference or nested-object data types. Every
  property holds one scalar; a "many" is modelled as a relation.
- No uniqueness, range, pattern or cross-property constraints on a property.
  `required` is the only constraint a property definition can express; the one
  uniqueness is an entity type's [identity](#the-identity).
- No cardinality on relation types beyond the [relation rules](#relation-rules): any
  number of relations of a type may connect any pair of endpoint-compatible entities,
  except that across all parent relations an entity has at most one parent and no
  hierarchy closes a cycle, and a one-per-pair relation type links one source to one
  target at most once.
- No computed, derived or server-generated user properties.
- No renaming. A key, a data type and a relation type's endpoints are permanent;
  changing any of them means creating a new object.
- No cross-ontology references. A relation type's endpoints, like everything
  else, name types of its own ontology.

## Rules

Schema edits change the design, not instance data. The only exception is rebuilding an
entity's derived identity when its type's identity changes: identities come from values a
caller wrote, not from a value callers can write directly. Otherwise cleaning instance
data during a schema edit would turn that edit into a write over all of it.

### Keys and immutability

Type keys and property keys follow the schema [key](../glossary.md#schema-and-design) rule — lower snake
case, starting with a letter — and are at most 64 characters.
The leading-letter requirement is load-bearing: system properties
are distinguished by a leading underscore, so no user key can ever collide with
one.

Entity type keys and relation type keys are unique within their ontology — and
share no namespace, so the same key may name one of each. Property keys are unique
within their owning type only.

Nothing that a stored value or a stored reference depends on can change: a key, a
property's data type, the type a property belongs to, and a relation type's source
and target entity types are all set once. An update that would change one of them
is not expressible — those fields are simply absent from the update surface rather
than rejected.

Updates are sparse: a field omitted from an update body is left unchanged. One
consequence is that a description cannot be cleared, only replaced, because an
explicit null is indistinguishable from omission. A property's default value and a
relation type's parent end are the two exceptions — sending either explicitly as null
clears it. A relation type's `onePerPair` is a boolean, so `false` turns it off.

### The name property

Every entity type has exactly one **name property**: one of its own `string`
properties, whose value names the type's entities wherever an entity is shown as a
label. The type holds the property's key. It is never absent — an entity type does
not exist without one.

- **Created with the type.** Creating an entity type also creates its name property:
  a non-required `string` property keyed `name` with display name "Name", unless the
  request names another key — then that key, with the key as its display name.
- **Reassignable.** An update may name any other `string` property of the same type;
  naming a property the type does not have, or one of another data type, is a field
  error. Data types never change, so the name property cannot be retyped.
- **Never removed.** Deleting the property that is the name property is refused with a
  conflict — choose another name property first. Nothing cascades: the server never
  picks a replacement.

The name property is an ordinary property otherwise: it may be optional, so an entity
may have no name. Relation types have none.

A lens that hides the name property shows its type without one
([ontology-lenses.md](ontology-lenses.md)).

### The identity

An entity type may declare an **identity**: `identityProperties`, an ordered list of 1 to
5 of its own `string`, `integer` or `date` properties whose values, joined, are unique
within the type. Setting it checks the type's stored entities and may need the
[cascade protocol](#the-cascade-protocol); the identity properties are then required,
without a default, and locked: they cannot become optional, take a default or be
deleted while they belong to the identity. Setting, changing or clearing it rebuilds
every entity's derived identity — the one schema edit that writes instance data. The whole model is in
[entity-identity.md](entity-identity.md).

### Relation rules

A **relation rule** is an optional constraint a relation type declares on its relations.
There are two, a closed set: the **parent end** ([below](#parent-relations)) and **one
per pair** ([below](#one-per-pair)). Both are set, changed and cleared on create and on
update, and every read of a relation type returns both. A rule set or turned on is
checked against the relations already stored under the key, in one transaction with the
write: when they break it, the write is refused with a conflict whose
`details.violations` names each broken rule with its count and its first five entities,
ordered by type and id, and nothing of the request is written. No consent overrides the
refusal — the data must be repaired first. Clearing a rule is never refused. A relation
type that does not exist yet can still have stored relations, because deleting a
relation type keeps its instances ([below](#deletion)). Both rules bind every write of a
relation, immediate or [staged](changesets.md#commit-validation), in the service.

### Parent relations

A relation type may name one of its ends as the **parent end**: `parent` is `source` or
`target`, or null for an ordinary relation type. The flag sits beside the endpoints, so a
self-relation such as `manages` (person → person) is unambiguous: with `source`, the
manager is the parent. A `has_project` from customer to project reads `source`; an
`owned_by` or `located_in` that points up reads `target`.

The relations of every parent relation together form the ontology's hierarchy, under two
**parent rules**:

- **At most one parent per entity**, across all parent relations, not per relation type.
- **No cycles.** A self-loop is a cycle.

Entities without a parent are hierarchy roots, and are allowed. A parent relation is
otherwise an ordinary relation type: it has properties, it is listed, read and traversed
like any other, and a lens includes or hides it the same way. How the rules bind instance
writes — relation creates, the create with a parent relation, leaf-only deletes — is in
[instance-data.md](instance-data.md#hierarchies); how they bind a ruleset's anchor, in
[rulesets.md](rulesets.md#anchor).

**Setting it, flipping it, or creating a relation type with it** checks the relations
already stored under every parent relation, with the new reading in place of the old, as
a [relation rule](#relation-rules) is checked: the violations are `two_parents` and
`cycle` ([../interfaces/](../interfaces/README.md#errors)). Clearing it, or deleting a
parent relation, is never refused; an update repeating the stored parent end is not a
change and checks nothing.

A parent relation is always one per pair: a child has one parent, so no pair can hold
two of its relations. Setting a parent end turns [one per pair](#one-per-pair) on, it
cannot be turned off while the parent end is set — a field error on `onePerPair` — and
clearing the parent end leaves it on.

These checks are the schema edits that read instance data. They read to refuse and never
write.

### One per pair

`onePerPair` true allows at most one relation of the type from one source entity to one
target entity; false, the default, allows any number. The pair is ordered: on a
self-relation such as `knows` (person → person), A to B and B to A are two pairs.

Turning it on is refused while the stored relations of the type link a pair more than
once: the violation `duplicate_pair` counts those pairs and names the source entity of
the first five. A relation create of a pair the type already links is refused
([instance-data.md](instance-data.md#relations)).

Parallel relations of one type make sense where a relation carries what tells them
apart, such as two employment periods with their own start and end; such a type leaves
one per pair off, or becomes an entity type of its own. A plain link, such as membership
or location, turns it on, so loading the same data twice cannot link a pair twice.

### Data types

Seven data types. Values are converted, never guessed; a value that cannot be
converted is a field error rather than a coerced approximation.

| Data type | Accepts | Rejects |
|---|---|---|
| `string` | any JSON scalar, stringified | objects and arrays, a NUL character in the value |
| `integer` | a JSON integer, or a string parsing as one | booleans, any JSON float, unparsable strings, magnitudes beyond 2^53 − 1 |
| `float` | a JSON number, or a string parsing as one | booleans, unparsable strings, non-finite values |
| `boolean` | a JSON boolean, or the strings `true`/`false`, case-insensitive | numbers, any other string |
| `date` | an ISO calendar date string | non-strings, non-ISO strings |
| `datetime` | an ISO date-time string | non-strings, non-ISO strings |
| `document` | any JSON scalar, stringified | objects and arrays, a NUL character in the value |

Two rules do not follow from the table:

**A boolean is not a number.** `true` is rejected for `integer` and `float` even
though many languages would accept it. This is checked before the numeric
conversion, so it holds for every input shape.

**`document` is not a wider `string`.** It is permitted on entity types only —
rejected on a relation type both on property creation and on import — and it
behaves differently on read, in search and under partial edits. What those
differences are, and why the type exists at all, is
[documents.md](documents.md).

A field error names the expected data type and the received value's JSON type. Where the
JSON type says nothing useful — a number for `integer`, or a string that does not parse —
it quotes the rejected value instead.

Where the coercion sits in the write path is described in
[instance-data.md](instance-data.md).

### Required and default

`required` and `default` combine into three meaningful states.

| Property | On create, when omitted or null | On partial update |
|---|---|---|
| Optional, no default | absent | null removes it |
| Optional or required, with default | the default is applied | never re-applied |
| Required, no default | rejected: the property is missing | null is rejected |

Defaults are always stored as strings and coerced to the declared data type at the
moment they are applied, which is creation only — an update never re-applies a
default, so changing a default does not touch existing data.

A default that cannot be coerced fails in two different ways, depending on where
in the write it gets applied. Where validation itself applies it — a required
property the lens exposes, or one the caller sent explicitly as null — the failure
is a field error and the write is rejected. Everywhere else the default is applied
after validation has already passed, and a coercion failure there is swallowed:
the property is skipped and the instance is created without it. That covers every
optional property, and every property the lens hides. Nothing validates a default
against its data type at the time the property is defined, so a bad default is not
detected until something tries to use it.

The "required, no default" state is the one that constrains lenses, because such a
property can never be supplied through a lens that hides it. That constraint is
what the cascade protocol enforces.

### Deletion

Deleting a type deletes its property definitions with it. Nothing else cascades by
default. An entity type's name property is the one property that cannot be deleted on its
own ([above](#the-name-property)).

**An entity type cannot be deleted while any relation type names it as a source or
target.** This is checked first and is unconditional — the cascade flag does not
override it. Delete or redirect the referencing relation types first. The response
is a conflict, not a cascade prompt, because there is no consenting to it.

**Deletion does not delete instance data.** Entities of a deleted entity type
remain stored but become unreachable within their ontology: no lens exposes the
type, so every read, write and query naming it fails as not found. There is no
operation that reports or removes them — short of deleting the whole ontology.
This is the sharpest trap in the modeling surface.

Deleting an entity type also discards the search artefacts derived from it — every
search index rooted on it, with its entries ([search-indices.md](search-indices.md),
[documents.md](documents.md)). Deleting a document property discards that property's
passage index alone. Managed indices follow such a deletion silently; a custom index that
reads what is deleted brings the deletion under the cascade protocol below.

### The cascade protocol

A schema change that would leave a scoped lens invalid, or a
[custom search index](search-indices.md#custom-indices) reading what no longer exists,
is refused, names the lenses and indices it would affect, and proceeds only if the
caller repeats it with explicit consent. Only lenses with explicit declarations can be
broken, so an unscoped lens never appears in any of this; managed search indices follow
the schema by themselves and never appear either.

Six changes can trigger it:

| Change | Triggers when |
|---|---|
| Delete an entity type | any lens includes that entity type, or any custom index is rooted on it |
| Delete a relation type | any lens includes that relation type, or any custom index has a relation group on it |
| Create a required property with no default | any lens includes the owning type **with a property allowlist** that does not name the new key |
| Delete a property | any custom index reads it — as an own, header, relation or target field |
| Delete a custom search index | any lens includes it |
| Set an entity type's [identity](#the-identity) | a listed property is optional or has a default, or any lens's allowlist for the type omits one |

A custom index may also name an entity type as a group's target, but that type is an
endpoint of the group's relation type, and an entity type that a relation type names
cannot be deleted at all ([above](#deletion)).

The third case is the subtle one and applies to entity types and relation types
alike. A required property with no default must be supplied on every create. A
lens whose allowlist omits it cannot supply it, so every create through that lens
would fail from the moment the property exists. A lens that includes the type
without an allowlist tracks the type's properties automatically and is therefore
never affected — the same property added under the same circumstances breaks one
lens and not the other, purely because of how they declared their inclusion.

The refusal is the `CASCADE_REQUIRED` error described in
[../architecture.md](../architecture.md). Its `details.affectedLenses` is the
sorted list of the **keys** of every lens the change would break or change, and
`details.affectedIndices` the sorted keys of every custom index it would change or
delete — either may be empty — enough to inspect each one and decide, without a second
lookup. A property deletion triggered by an index names, as lenses, those whose
allowlist names the property and those that include an index the cascade deletes.

Repeating the request with cascade requested makes the change consented rather
than forced, and the repair is mechanical:

| Change | What cascade does before the change |
|---|---|
| Delete an entity type | removes that type's inclusion from every lens that has one; deletes every custom index rooted on it |
| Delete a relation type | removes that type's inclusion from every lens that has one; removes every custom index's groups on it |
| Create a required property with no default | appends the new key to every allowlist for that type |
| Delete a property | removes the key from every allowlist for that type, and from every custom index's own, header, relation and target fields |
| Delete a custom search index | removes its inclusion from every lens that has one |
| Set an entity type's identity | makes the listed properties required, removes their defaults, and appends them to every allowlist for that type |

The identity is the one trigger that needs consent with no lens or index affected: an
optional or defaulted property becoming an identity property changes the schema itself.

What is left of a custom index stays consistent: a target type left with no field and a
relation group left with no relation or target field are removed, and an index left with
no field and no group is deleted, together with its lens inclusions. A template
placeholder naming a removed field stays and has no value
([search-indices.md](search-indices.md#templates)). The changed indices build new
generations in the background.

Two asymmetries are easy to get wrong when reimplementing:

**Lens allowlists never make a property deletion trigger the protocol.** Only a custom
index reading the property does. Without one, and without cascade, the property is
deleted and every allowlist naming it is left holding a key that no longer resolves —
harmless at runtime, where an unresolvable key in an allowlist simply matches nothing,
but reported by lens validation. For lenses, cascade on a property deletion is therefore
a cleanup, not a consent.

**Changing an existing property is never checked.** Making an optional property
required, or clearing a required property's default, produces exactly the state
the third trigger exists to prevent, and nothing stops it. (An identity property is
already required without a default, and locked.) Lens validation will
report the resulting lenses as invalid; nothing else will.

### Schema validation

Two read-only operations. Both always answer successfully — they report, they
never raise — returning a boolean verdict, a flat list of errors and a flat list of
warnings, each with a dotted path locating the offending object and a message.
Warnings never affect the verdict.

**Validating one lens** checks that lens's declarations against the schema and warns
about what limits the search indices it includes. An unscoped lens is valid by
definition and has no warnings. The rules are in
[ontology-lenses.md](ontology-lenses.md), the warnings in
[ontology-lenses.md](ontology-lenses.md#validation-warnings).

**Validating the schema** checks the ontology's schema and then every one of its
lenses, returning one combined error list and one combined warning list. The schema half reports:

- a duplicate entity type key, or a duplicate relation type key
- a duplicate property key within one type
- a property whose data type is not one of the seven
- a relation type whose source or target entity type key does not exist

Those are the same conditions the create paths already prevent, and the pass earns
its place because import does not: it writes properties without checking the data
type against the enumeration, so an invalid data type can reach storage that no
interactive path would have accepted ([transfer.md](transfer.md)).

Neither operation inspects instance data. Entities stranded by a deleted type are
invisible to both, and so are relations that break the relation rules; only a
[rules change](#relation-rules) reports those.

## Through the interfaces

Full index: [../interfaces/](../interfaces/README.md). Every entrance below addresses
one ontology — REST in the path, MCP through the mount's binding.

The same service enforces every rule above regardless of entrance, including the
cascade protocol. One detail does not survive the crossing: the structured lists of
affected lens and index keys reach a REST caller in the error body, while an MCP caller
receives only the refusal message — which names the affected custom indices, but not the
lenses — and must ask which lenses include the type. A refused relation rules write likewise
reaches MCP as its message, with the count per rule but without the listed entities.

| Operation group | REST | Modeling MCP | Web UI |
|---|---|---|---|
| Entity and relation types | create, list, read, update, delete | create, update, delete | schema studio |
| Properties | create, list, update, delete, per owning type | one add/update/delete trio taking a `type_kind` discriminator | schema studio |
| Whole-schema read | assembled from the type operations, or the export payload | one `get_schema` tool | schema studio |
| Validation | per-lens and whole-schema | per-lens and whole-schema | schema studio |
| Cascade consent | a query flag on the cascading operations | a boolean argument on the same operations | prompted on the affected action |

Two differences between the entrances are contractual, not cosmetic:

**Addressing differs.** The modeling MCP tools take keys throughout; the modeling
REST routes take internal identifiers for types and properties. Exactly which
path segment is which is tabulated in
[../interfaces/](../interfaces/README.md#what-a-path-segment-identifies), and it is the
commonest mistake made against this surface.

**MCP folds the two property owners into one tool set.** Where REST has parallel
routes under entity types and relation types, MCP has a single set of property
tools discriminated by an argument. The rules applied are identical, including the
rejection of `document` on a relation type.

The web UI reaches all of this over REST and holds no privileged path; what it
offers is described in [../product-surface/](../product-surface/README.md).
