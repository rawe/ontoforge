# Rules

Binding constraints on the design. Each states a rule and the reason it exists.

These are current state, not a history. When a rule changes, this file changes with it —
the record of *when* a rule was adopted and what was weighed against it lives in
[adr/](adr/).

Design principles that govern how these rules are chosen — and the requirement that a new
one be approved before it is adopted — are in the repository `CLAUDE.md`.

## System shape

**One server, always serving everything.**
Modeling routes, runtime routes and both MCP servers are served by every instance. There
is no mode switch and no runtime-only deployment. A schema change and the data it governs
must never be able to disagree about which server they reached.

**One database holds schema and instance data.**
Keeping them apart is the adapter's business, not the API's. Two stores would make every
schema change a distributed transaction to buy an isolation nothing needs.

**Three modules: modeling, runtime, core — and runtime never depends on modeling.**
Runtime obtains the schema through the persistence port, not by calling modeling. This is
what lets a lens be cached as a value rather than fetched as a service.

## Naming

**One word per concept, everywhere.**
"Modeling" and "runtime" name the same things in modules, routes and stores, with no
synonyms. This governs code and API surface. The web client is free to use its own
product names for its surfaces, and does.

**Keys, never identifiers, on the runtime and MCP surfaces.**
Everything an agent or a data client touches is addressed by human-readable key: types,
properties, ontologies, saved queries and agents. Internal identifiers are resolved behind
the interface. A language model should never have to carry an opaque identifier to name a
type.

The modeling REST surface is the exception: it addresses ontologies, types and properties
by internal identifier, and only agent configurations and saved queries by key. It is a
schema-design surface used by a client that has just listed the resource it is about to
address, so the identifier is always at hand.

**No vendor vocabulary anywhere a caller can see.**
Not in route names, field names, tool names or error messages. The query endpoint takes a
`query`; the query language is OQL; storage errors name no database. The storage backend
is exchangeable, so a public surface naming one would be a leak, not a convenience.

## Storage

**All storage access crosses the persistence port.**
Everything specific to a database — driver, connections, query text, physical naming,
index definitions, driver-native temporal types — lives inside one adapter. Services,
routers and MCP handlers speak ontology vocabulary only.

**Filters, sorts and searches cross the port as structured values.**
Never as query text or fragments. A fragment crossing the port would put query syntax in
the service layer and make the port unimplementable by a different kind of database.

**Driver exceptions never cross the port.**
Any storage failure surfaces as a single storage error carrying a generated id. The
original is logged against that id, because a driver message names the vendor and its
physical objects — and without the id a reported failure could not be traced back at all.

**Adapters declare the type keys they reserve; the service enforces them.**
A key whose physical form would collide with the adapter's own schema objects is rejected
on every write path, with an error naming neither the vendor nor the physical name.
Encoding those names above the port would tie database-agnostic code to one database;
enforcing them inside the adapter would deliver the error from the wrong layer and make
every future adapter reimplement it.

**A second adapter is not built until one is needed.**
One adapter is the reference implementation and the default deployment.

## Interfaces

**MCP runs inside the server process and calls services directly.**
Not a separate process, and not a wrapper over the REST API. A wrapper would add a
network hop and a second contract to keep in agreement with the first.

**Two MCP servers, one for modeling and one for runtime.**
Mirroring the REST split, so that no client can reach both through one connection.

**Runtime MCP binds to exactly one ontology, resolved when the connection opens.**
From the URL path, else a request header, else a configured fallback; with none of these,
the connection is refused. A language model should never have to choose a lens, or be
able to reach across two.

**Transport is stateless HTTP with plain JSON responses.**
No event stream. Statelessness is what allows the same mount to serve many clients
without per-connection state.

## Behaviour

**OQL is the query language, anchored to the ISO GQL standard.**
Its normative reference is ISO GQL and its GPML pattern sublanguage — not any vendor's
dialect. Parsing and validation are storage-independent; compiling to a native dialect is
the adapter's private business. Where the two disagree, the standard wins.

**Validation collects every error before answering.**
A rejected write names all offending fields at once, so a caller can correct in one round
trip rather than discovering faults one at a time.

**Writes validate against the lens; defaults come from the full schema.**
A property a lens hides cannot be written through it, but a required property with a
default still receives that default — otherwise a narrow lens could create data that is
invalid under a wider one.

**Destructive schema changes require explicit consent.**
A change that would invalidate a lens is refused, and names the lenses it would affect.
It proceeds only when the caller asks for it a second time, explicitly.

**Vector index width drift is reported at startup and repaired only on request.**
An index fixes its width when created, so a changed embedding model leaves indexes that
reject every new vector. Startup warns per mismatch and names the remedy. It does not
repair, because dropping an index destroys the vectors it holds — trading a loud failure
for a silently empty answer. The rebuild operation does repair, because there the drop is
immediately followed by regeneration at the new width.

## Scope

**Schema transfer carries schema only.**
Export and import move types, properties, lenses, agents and saved queries. Instance data
is not part of the format.

**No authentication, authorization or multi-tenancy.**
OntoForge assumes it is deployed behind something that provides them, or on a trusted
network. Building a permission model before a deployment requires one would be guessing
at its shape.
