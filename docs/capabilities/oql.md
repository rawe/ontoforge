# OQL

The OntoForge Query Language: a read-only, pattern-matching graph language written
entirely in the schema's own vocabulary. It exists so that a caller can ask a question no
CRUD operation shapes — multi-hop traversals, joins across types, aggregates — without
being handed the database.

## What it is

**Normative anchor.** OQL's reference is the ISO GQL standard and its GPML pattern
sublanguage. It is not defined by, and does not track, any storage vendor's query
language. Where an implementation's own dialect and the standard disagree, the standard
wins. The rule and its reasoning are in [../decisions.md](../decisions.md#behaviour).

**Written in keys.** Node labels are entity type keys, relationship types are relation
type keys, and property names are property keys — exactly as declared in the schema, in
`lower_snake_case`. A physical name from the underlying store never appears in a query and
never appears in a result. A query about people is written with `person`, everywhere, for
every storage backend.

**Storage-independent.** Parsing, validation and the read-only guarantee happen above the
persistence port, against the lens. Compiling a validated query into whatever dialect the
active database speaks is the adapter's private business: invisible to callers, absent from
error messages, and not part of this contract. Two deployments on different backends
accept exactly the same queries and reject them with identical validation; where the
execution of an accepted query is known to diverge between adapters, the divergence is
enumerated in [../storage-adapters.md](../storage-adapters.md#where-the-adapters-diverge).

## The read-only guarantee

Enforced by rejecting whole categories of query before execution, not by relying on a
transaction mode. Four categories:

| Rejected | Why |
|---|---|
| Write clauses — create, delete, set, merge, remove, wherever they appear | Every mutation must pass the validating write path, which applies defaults, coerces types and honours the lens. A query that could write would be a second, unvalidated write path. |
| Procedure calls | Procedures are the database's own surface. Allowing them would expose the vendor through a language defined not to name one, and would put arbitrary capability — including writes — behind a read operation. |
| A node pattern that binds a variable but carries no label | Such a pattern matches every stored record, including internal ones the lens was never meant to expose. Requiring a label is what makes lens validation total. |
| Internal labels and internal relationship types | The names the system uses for its own records, including document passage storage. Rejected explicitly and with their own message, so that naming one is a clear error rather than a confusing "unknown type". |

## Supported surface

The language is a closed enumeration: what is named here is the whole surface. Any
construct or function the grammar parses but this enumeration does not name is rejected
at validation with a hint naming the supported alternative, identically for every
storage backend. The rule this enforces is in
[../decisions.md](../decisions.md#behaviour).

- **Clauses.** MATCH, OPTIONAL MATCH, WHERE, WITH, RETURN, ORDER BY with ASC and DESC,
  SKIP, LIMIT, and AS aliases. A query carries at most one WITH, so a pipeline is at
  most two stages. ORDER BY sort keys are properties, aliases and aggregates — not
  nodes, constants or parameters. SKIP and LIMIT each take a non-negative integer
  literal or a parameter placeholder.
- **Patterns.** Labeled and anonymous nodes; directed, reversed and undirected
  relationships — an undirected pattern matches in both directions; relationship
  variables and anonymous typed relationships; comma-separated pattern parts; inline
  property maps.
- **Predicates and expressions.** The comparisons `=`, `<>`, `<`, `<=`, `>`, `>=`;
  AND, OR and NOT, with parentheses — XOR is among the rejections; CONTAINS, which is
  case-sensitive, deliberately unlike the case-insensitive substring filter on the list
  operations; IN; IS NULL and IS NOT NULL; literals,
  including lists and maps; parameter placeholders; backticked identifiers; comments;
  system properties.
- **Functions.** The seven aggregates — `count(*)`, `count(x)`, `avg`, `collect`,
  `max`, `min`, `sum` — and no others.

Two boundaries are worth knowing rather than discovering:

- The label requirement binds node patterns that **introduce a variable**. A fully
  anonymous node pattern, and a relationship pattern with no type, are not flagged. They
  widen what a pattern traverses, but nothing can be projected from them without a
  variable, so they do not widen what is exposed. An inline property map, though,
  requires an owner with a known type: the map's keys are property accesses, validated
  against the owner's type within the lens exactly as any other property access.
- Parameter placeholders parse, but an ad-hoc query is executed with **no parameter values
  supplied**. Write literal values; parameterization is what saved queries are for
  ([saved-queries.md](saved-queries.md)).

## Validation against the lens

Every query is validated against the lens it arrived through, before it reaches the
database. Four checks, all keyed on the scoped schema:

- every node label must be an entity type the lens exposes;
- every relationship type must be a relation type the lens exposes;
- every property access on a variable whose type is known must name a property of that
  type **within the lens**;
- system properties are always permitted, on any variable, regardless of lens.

A type or property that exists in the global schema but not in this lens is rejected
identically to one that does not exist anywhere — same check, same wording, same
suggestions. The lens is a complete horizon, not a permission filter that leaks the
existence of what it hides.

Type inference is **pattern-local**: a variable's type is known only from a label or
relationship type written in the pattern that binds it. A variable bound to a
relationship pattern with no type has no declared type, and reading a property through
it is rejected — the query must name the type in the pattern that binds the variable.
Reading a property of a `WITH` alias that cannot be verified against the schema is an
error. System properties remain readable through any variable.

Violations are **collected, not raised one at a time**. A rejected query reports every
violation it found, as a list in the error details, consistent with the collect-all rule in
[../architecture.md](../architecture.md#request-lifecycle).

## Self-correction hints

Every rejection names what would have been valid. An unknown label lists the entity types
the lens exposes; an unknown relationship type lists its relation types; an unknown
property lists that type's properties plus the system properties; a missing label lists the
entity types.

This is contractual, not incidental verbosity. The primary caller composing OQL is a
language model turning a natural-language question into a query. A bare "unknown type"
forces a schema round trip and a retry; an error carrying the candidate list lets the very
next attempt be correct. Combined with collected errors, one rejection carries everything
needed to fix everything at once.

## Results

A result is an ordered list of column names — exactly as the query's projection names them,
including the `variable.property` form when a projection is not aliased — plus rows keyed
by those names. A column's value is an entity, a relation, a scalar, or a list or map of
those.

Entities and relations come back as flat objects: their properties plus their system
properties. Both are post-processed against the lens, and any property the lens does not
expose for that type is removed. A query therefore cannot surface a hidden property even by
projecting a whole node. Document properties are replaced by size stubs, though they remain
valid to reference inside the query itself — a predicate may test a document property even
though its value is never returned intact ([documents.md](documents.md)).

One boundary in that stubbing: a scalar projection is recognized as a document by its
column name having the `variable.property` form. An **aliased** projection of a document
property returns the full text.

### Relation endpoints are not returned

A relation returned by a query carries its identifier, its relation type key, its
timestamps and its properties — but **not the identifiers of the two entities it
connects.** Relation reads outside OQL do return them; query results do not.

A client that needs to draw a graph from query results must therefore reconstruct endpoints
itself, from the relation type's declared source and target and the entities in the same
row. The reconstruction the web client performs, including how it resolves ambiguity, is in
[../product-surface.md](../product-surface.md#client-side-contracts-the-api-does-not-imply).

### Ordering and paging

Expressed in the language — ordering by an expression, skipping, limiting — not as
parameters of the operation. There is no server-imposed default limit and no cap: an
unbounded query returns every matching row. Bounding a query is the caller's
responsibility.

Predicates follow three-valued logic: a comparison against a null or missing value is
unknown, not false, and only rows whose predicate holds are returned. In ordering,
nulls sort last ascending and first descending, on every backend. String comparison
in WHERE and string ordering in ORDER BY follow the database's default collation —
the same carve-out the list operations state.

## Through the interfaces

Complete operation and tool index: [../interfaces.md](../interfaces.md).

| Reached by | How |
|---|---|
| REST | One runtime query operation, taking the query text and returning columns and rows |
| MCP | `execute_query` on the runtime server, whose description tells a model to use type keys, that only reads are permitted, and that every node pattern needs a label |
| Web client | A query console: an editor with a schema sidebar for click-to-insert patterns, per-lens history, and results as either a table or a derived graph |

Two capabilities are built on this same validated path rather than beside it: saved
queries store parameterized OQL steps ([saved-queries.md](saved-queries.md)), and
natural-language querying generates OQL and submits it for the same validation
([ai-agents.md](ai-agents.md)). Neither can express anything an ad-hoc query cannot.
