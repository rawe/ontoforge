# Storage adapters

Everything OntoForge persists about its ontologies crosses one boundary: the persistence
port. Above it, services speak schema vocabulary only — keys, property definitions,
structured filters, instance identifiers — through stores bound to one ontology and a
small registry port. Below it, exactly one adapter knows a database. The access database, which holds who may
do what when authentication is on, sits behind a port of its own and is not part of this
contract ([architecture.md](../architecture.md#components)).

This folder is the contract an adapter must satisfy. [Concepts](../concepts.md) explain the
mental model; the [glossary](../glossary.md) defines its terms. Where the port sits in the system:
[architecture.md](../architecture.md).

**One part binds; one describes.** The contract is normative: it binds every adapter.
The PostgreSQL file describes the adapter OntoForge ships — PostgreSQL, the only value
`DB_BACKEND` accepts — in named technology. It binds nothing: nothing in it may be relied
on by code above the port, and nothing in it constrains another adapter. The known
limitations in observable behavior are enumerated in one place, [below](#known-limitations).

| File | Part | Covers |
|---|---|---|
| [contract.md](contract.md) | Contract | Bound stores and the registry, what crosses the port, lifecycle, the ruleset, changeset and navigator stores, the design revision, transactions, obligations beyond storage, the validated query |
| [stores.md](stores.md) | Contract | The modeling and runtime stores: schema side and data side |
| [search-index-store.md](search-index-store.md) | Contract | The search-index store |
| [postgresql.md](postgresql.md) | PostgreSQL adapter | Isolation, physical mapping and naming, how each kind of data is stored, indexes, engine constraints |

PostgreSQL is the only shipped storage adapter. Features are built and tested against
one implementation, and the port carries the operations it needs rather than speculative
capabilities for other databases ([ADR 0025](../adr/0025-postgresql-only-storage.md)).

## Known limitations

Parsing and validation happen above the port, so which queries are accepted, and how an
invalid one is rejected, does not depend on the adapter. Beyond acceptance, the known
limitations of the PostgreSQL adapter's observable behaviour are enumerated here. One
deviation stands with the rule it attaches to in the contract rather than here: the datetime
text form on the two point reads.

- **Decoding through a shared type key.** An entity type and a relation type may share a
  key; if both declare the same property key at different data types, the traversal read
  can decode the value through the wrong definition, silently. A known limitation, accepted.
- **Width drift blocks writes, not just search.** While the saved-query description index
  of a stale width stands, every saved-query write that carries a description vector is
  rejected until the widths are reconciled.
- **Aggregates versus projection on temporal properties.** `min` and `max` over a date or
  datetime property return a decoded temporal value where a plain projection of the same
  property returns its stored text — the two forms disagree about the property's type.
- **Map literals and mixed lists in query results.** Conversion recurses through lists of
  one element type only; a map literal, or a list mixing element types, comes back in the
  adapter's own shape, its temporals as the stored text. The conformance suite pins that
  shape.
- **An empty leading `OPTIONAL MATCH`.** When it matches nothing, the query returns no
  row rather than one row of nulls.
- **A float literal with a bare trailing zero.** A literal such as `1.0` cannot be
  written — it parses as a property access and is rejected — so an equality across the
  integer/float divide written as `1 = 1.0` is inexpressible. `1.5` is unaffected.

## Implementing a new adapter

Provide, in this order:

1. **Connection lifecycle, physical isolation and physical naming.** Decide how an
   ontology's data is kept apart from its neighbours', and how a type key becomes a
   physical object, before writing a single query — every later decision depends on
   both. Choose a naming that no valid key can turn into a collision with your own
   storage objects.
2. **Error translation.** Build the single choke point through which all database access
   passes, before any operation exists to bypass it.
3. **The registry.** Create with atomic provisioning, list, read, rename, delete as one
   cascade. Nothing else works until an ontology can exist.
4. **Constraints and indexes.** Everything under the uniqueness obligation — the
   server-wide part at initialization, the per-ontology part at registry create.
5. **The schema side.** Lenses, types, properties, inclusions, full-schema retrieval,
   agents, saved queries, named searches and the navigator store. Nothing on the data side is useful
   until the schema can be read back.
6. **The data side.** Entities, relations, traversal, the hierarchy operations, the
   commit reads, the ruleset store, units of work and the changeset store.
7. **Filters, sorts and text search.** The predicate builder, shared by listing and by
   filtered vector search.
8. **Search** — the search-index store with its queue, wake-ups and retrievers — and the
   saved-query vector index, including width reconciliation.
9. **Query compilation.** Last, because it needs the naming transformation from step 1 and
   nothing else.

Three traps, each of which produces a system that passes casual testing and fails later:

**Collisions derive from *your* physical naming.** Nothing above the port knows your
storage objects, so nothing there rejects a key that would collide with one. Work out
whether any valid key's transformed form could, and choose a naming where none can —
otherwise a user can create a type that overwrites your schema.

**A vector index fixes its width when it is created.** Creating-if-absent will not widen
one, and the stale index reports itself as healthy. Reconcile widths on every create path,
report on startup, and repair only when the caller explicitly asked for a rebuild.

**The error contract is not optional.** A driver exception that escapes the port puts
vendor vocabulary into a client response and breaks the guarantee the whole boundary
exists to provide. Equally, do not over-catch: a domain exception raised inside a database
scope must keep its identity, and a bug must still look like a bug.
