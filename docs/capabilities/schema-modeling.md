# Schema modeling

Designing one ontology's schema: entity types, relation types and property
definitions. Everything runtime permits is derived from it, so this is the only
place where the shape of the graph is decided.

Vocabulary: [../README.md](../README.md). Layering and invariants:
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
| Entity type | key, unique within the ontology | key | display name, description |
| Relation type | key, unique within the ontology | key, source entity type, target entity type | display name, description |
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
- No uniqueness, range, pattern or cross-property constraints. `required` is the
  only constraint a property definition can express.
- No cardinality on relation types. Any number of relations of a type may connect
  any pair of endpoint-compatible entities.
- No computed, derived or server-generated user properties.
- No renaming. A key, a data type and a relation type's endpoints are permanent;
  changing any of them means creating a new object.
- No cross-ontology references. A relation type's endpoints, like everything
  else, name types of its own ontology.

## Rules

### Keys and immutability

Type keys and property keys match `^[a-z][a-z0-9_]*$` — lower snake case, starting
with a letter — and are at most 64 characters.
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
explicit null is indistinguishable from omission. A property's default value is
the single exception — sending it explicitly as null clears it.

### Data types

Seven data types. Values are converted, never guessed; a value that cannot be
converted is a field error rather than a coerced approximation.

| Data type | Accepts | Rejects |
|---|---|---|
| `string` | any JSON scalar, stringified | a NUL character in the value |
| `integer` | a JSON integer, or a string parsing as one | booleans, any JSON float, unparsable strings, magnitudes beyond 2^53 − 1 |
| `float` | a JSON number, or a string parsing as one | booleans, unparsable strings, non-finite values |
| `boolean` | a JSON boolean, or the strings `true`/`false`, case-insensitive | numbers, any other string |
| `date` | an ISO calendar date string | non-strings, non-ISO strings |
| `datetime` | an ISO date-time string | non-strings, non-ISO strings |
| `document` | any JSON scalar, stringified | a NUL character in the value |

Two rules do not follow from the table:

**A boolean is not a number.** `true` is rejected for `integer` and `float` even
though many languages would accept it. This is checked before the numeric
conversion, so it holds for every input shape.

**`document` is not a wider `string`.** It is permitted on entity types only —
rejected on a relation type both on property creation and on import — and it
behaves differently on read, in search and under partial edits. What those
differences are, and why the type exists at all, is
[documents.md](documents.md).

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

### Reserved type keys

The active storage adapter declares two sets — reserved entity type keys and
reserved relation type keys — naming keys whose physical form would collide with
the adapter's own storage objects. A key in the applicable set is rejected on type
creation and on import, with a validation error that lists the reserved set and
names neither the vendor nor the physical name it would collide with. An adapter
with no such collisions declares empty sets. See
[../storage-adapters.md](../storage-adapters.md).

Keys already stored that a newly reserved set would now forbid are reported at
startup and never rewritten ([../architecture.md](../architecture.md)).

### Deletion

Deleting a type deletes its property definitions with it. Nothing else cascades by
default.

**An entity type cannot be deleted while any relation type names it as a source or
target.** This is checked first and is unconditional — the cascade flag does not
override it. Delete or redirect the referencing relation types first. The response
is a conflict, not a cascade prompt, because there is no consenting to it.

**Deletion does not delete instance data.** Entities of a deleted entity type
remain stored but become unreachable within their ontology: no lens exposes the
type, so every read, write and query naming it fails as not found. There is no
operation that reports or removes them — short of deleting the whole ontology.
This is the sharpest trap in the modeling surface.

Deleting an entity type also discards the search artefacts derived from it — its
vector index, and the stored passages and index of each of its document properties
([search.md](search.md), [documents.md](documents.md)). Deleting a document
property discards that property's passages and index alone.

### The cascade protocol

A schema change that would leave a scoped lens invalid is refused, names the
lenses it would break, and proceeds only if the caller repeats it with explicit
consent. Only lenses with explicit declarations can be broken, so an unscoped lens
never appears in any of this.

Exactly three changes can trigger it:

| Change | Triggers when |
|---|---|
| Delete an entity type | any lens includes that entity type |
| Delete a relation type | any lens includes that relation type |
| Create a required property with no default | any lens includes the owning type **with a property allowlist** that does not name the new key |

The third case is the subtle one and applies to entity types and relation types
alike. A required property with no default must be supplied on every create. A
lens whose allowlist omits it cannot supply it, so every create through that lens
would fail from the moment the property exists. A lens that includes the type
without an allowlist tracks the type's properties automatically and is therefore
never affected — the same property added under the same circumstances breaks one
lens and not the other, purely because of how they declared their inclusion.

The refusal is the `CASCADE_REQUIRED` error described in
[../architecture.md](../architecture.md). Its `details.affectedLenses` is the
sorted list of the **keys** of every lens the change would break — enough to
inspect each one and decide, without a second lookup.

Repeating the request with cascade requested makes the change consented rather
than forced, and the repair is mechanical:

| Change | What cascade does before the change |
|---|---|
| Delete an entity type | removes that type's inclusion from every lens that has one |
| Delete a relation type | removes that type's inclusion from every lens that has one |
| Create a required property with no default | appends the new key to every allowlist for that type |
| Delete a property | removes the key from every allowlist for that type |

Two asymmetries are easy to get wrong when reimplementing:

**Deleting a property never triggers the protocol.** It is not in the trigger
table. Without cascade, the property is deleted and every allowlist naming it is
left holding a key that no longer resolves — harmless at runtime, where an
unresolvable key in an allowlist simply matches nothing, but reported by lens
validation. Cascade on a property deletion is therefore a cleanup, not a consent.

**Changing an existing property is never checked.** Making an optional property
required, or clearing a required property's default, produces exactly the state
the third trigger exists to prevent, and nothing stops it. Lens validation will
report the resulting lenses as invalid; nothing else will.

### Schema validation

Two read-only operations. Both always answer successfully — they report, they
never raise — returning a boolean verdict and a flat list of errors, each with a
dotted path locating the offending object and a message.

**Validating one lens** checks that lens's declarations against the schema. An
unscoped lens is valid by definition. The rules are in
[ontology-lenses.md](ontology-lenses.md).

**Validating the schema** checks the ontology's schema and then every one of its
lenses, returning one combined error list. The schema half reports:

- a duplicate entity type key, or a duplicate relation type key
- a duplicate property key within one type
- a property whose data type is not one of the seven
- a relation type whose source or target entity type key does not exist

Those are the same conditions the create paths already prevent, and the pass earns
its place because import does not: it writes properties without checking the data
type against the enumeration, so an invalid data type can reach storage that no
interactive path would have accepted ([transfer.md](transfer.md)).

Neither operation inspects instance data. Entities stranded by a deleted type are
invisible to both.

## Through the interfaces

Full index: [../interfaces.md](../interfaces.md). Every entrance below addresses
one ontology — REST in the path, MCP through the mount's binding.

The same service enforces every rule above regardless of entrance, including the
cascade protocol. One detail does not survive the crossing: the structured list of
affected lens keys reaches a REST caller in the error body, while an MCP caller
receives only the refusal message and must ask which lenses include the type.

| Operation group | REST | Modeling MCP | Web UI |
|---|---|---|---|
| Entity and relation types | create, list, read, update, delete | create, update, delete | schema studio |
| Properties | create, list, update, delete, per owning type | one add/update/delete trio taking a `type_kind` discriminator | schema studio |
| Whole-schema read | assembled from the type operations, or the export payload | one `get_schema` tool | schema studio |
| Validation | per-lens and whole-schema | per-lens and whole-schema | schema studio |
| Cascade consent | a query flag on the three cascading operations | a boolean argument on the same three | prompted on the affected action |

Two differences between the entrances are contractual, not cosmetic:

**Addressing differs.** The modeling MCP tools take keys throughout; the modeling
REST routes take internal identifiers for types and properties. Exactly which
path segment is which is tabulated in
[../interfaces.md](../interfaces.md#what-a-path-segment-identifies), and it is the
commonest mistake made against this surface.

**MCP folds the two property owners into one tool set.** Where REST has parallel
routes under entity types and relation types, MCP has a single set of property
tools discriminated by an argument. The rules applied are identical, including the
rejection of `document` on a relation type.

The web UI reaches all of this over REST and holds no privileged path; what it
offers is described in [../product-surface.md](../product-surface.md).
