# Entity identity as an ordered list of the type's own properties

Current behavior: [Declaring entity identity](../capabilities/entity-identity.md#declaring-an-identity)

## Context

An entity could be named only by a random id the server invents, and no property was
unique. A client loading data from another system could not find what it wrote before
without keeping its own map of ids, and every repeated load risked duplicates; people and
models had to carry opaque identifiers. Something the server enforces had to give an
entity a readable address.

## Decision

Allow an entity type to declare one identity as an ordered list of its own properties.
Derive a single readable address from their values, enforce its uniqueness within the
type, and keep the server-assigned id as the stable reference. Identity properties are
required when declared; a lens does not invent a partial identity or fallback address.

## Consequences

Clients can find an entity again without maintaining their own id map, and separate
clients cannot create two stored entities of the type holding the same identity at once.
An identity can be reused after deletion or a change of identity values. Changing an identity value
changes its address without changing stored references. The model supports composite
identities without client-specific concatenation, while deliberately avoiding several
competing unique addresses, parent-dependent addresses or a separate external-reference
store.

## Rejected

- **The client keeps a map from its own keys to ids.** Every client builds and loses the
  same map, and nothing stops two clients from creating the same entity twice.
- **The name property as identity.** Names are optional, often not unique, and change for
  reasons that have nothing to do with which entity is meant.
- **Ids derived from source values, with a writable `_id`.** The id would stop being the
  stable internal truth, and changing a source value would mean changing every reference.
- **A unique flag on any property.** It covers one property only, and a type could carry
  several competing unique properties with no single address.
- **An identity unique only below a parent.** Addressing would need the parent too, and
  moving an entity would change what its identity means.
- **Several external references per entity.** It serves many source systems at once at the
  cost of a second store and lookup that nothing yet needs.
- **One property that the client fills with a combined value.** Every client would compose
  and escape the value itself, and the parts could no longer be filtered or validated.
- **Partial identities per lens, with a fallback.** An entity would have a different
  address through each lens, and a hidden part could be guessed from what is shown.
- **Optional identity properties with an all-or-none rule.** Entities without an identity
  would sit beside those with one, and the schema would no longer say which is required.
