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

**Key length cap.** Every key — entity type, relation type, ontology, property,
agent, saved query — is at most 64 characters (`MAX_KEY_LENGTH`), enforced at
validation alongside the key pattern. Keys are human-typed identifiers; the cap
keeps adapter-derived physical names legible and rejects absurd input at the
boundary rather than deep inside an adapter.

**No vendor or implementation-language vocabulary anywhere a caller can see.**
Not in route names, field names, tool names or error messages. The query endpoint takes a
`query`; the query language is OQL; storage errors name no database. A rejected value is
described by its JSON type, never by the name the server's own language gives that type.
The storage backend is exchangeable and so is the language, so a public surface naming
either would be a leak, not a convenience. Deliberation on the type-vocabulary half:
[adr/0014](adr/0014-received-values-named-by-their-json-type.md).

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

**Adapters are peers under one contract; one is the default deployment.**
The port contract and the conformance suite define behaviour — no adapter is the
reference implementation. Every shipped adapter is fully supported, each with its own
physical mapping described in [storage-adapters.md](storage-adapters.md). Which adapter
is the default, and what each specializes in, is deployment surface recorded there and
in the repository README, not here. A new adapter is still built only when a deployment
needs one.

**Oversized-string ceiling is adapter-specific.** The 32766-byte oversized-string
rejection is a Neo4j index limit, not a system rule; it applies only on the Neo4j
adapter, below the port. PostgreSQL accepts such values. No ceiling exists above
the port — deployments are adapter-bound for life, so no deployment ever sees
both behaviours.

**PostgreSQL instance mapping: two generic jsonb tables.** The PostgreSQL adapter
stores all instance data in two generic tables — `entity` and `relation`, with `uuid`
primary keys and properties as jsonb — never a table per type. A schema change stays
pure data; no DDL runs against a live database. The physical mapping is described in
[storage-adapters.md](storage-adapters.md); deliberation:
[adr/0015](adr/0015-generic-jsonb-instance-tables.md).

**Storage DDL enforces structure only.** Adapter DDL carries identity,
referential integrity, exactly-one-owner and uniqueness — nothing else. Business
rules (for example, document properties only on entity types, the data-type
enumeration) validate in the service; the database provides no backstop for them.

**Documentation above the port describes the behaviour of the default
deployment.** Adapter-specific deviations are documented with that adapter in
storage-adapters.md, never as hedges in the shared documents.

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

**OQL feature surface.** The surface is a closed enumeration in
`capabilities/oql.md` ("Supported surface"), enforced fail-closed at validation,
above the persistence port: any construct or function the grammar parses but the
enumeration does not name is rejected with a self-correction hint. Every backend
accepts exactly the same queries. Widening the surface is a deliberate, non-breaking
addition; narrowing it is a breaking change.

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

**Exactly one env file is read, and it is always named.**
`ENV_FILE` names it; without that it is `.env` in the working directory. Files never
layer: a second file cannot quietly supply what the first omits, and a named file that is
missing fails the boot rather than falling back to the built-in defaults. A variable
already set in the real environment still wins, because that is what a shell variable is
for. Development presets are committed under `env/` and passed to `./dev.sh`, so no
launcher script carries configuration values of its own — a value that decides how the
system runs must be readable in a file, not buried in a script that silently outranks one.

**Model thinking effort is one deployment setting, not a per-agent one.**
`AI_REASONING_EFFORT` fixes how hard the model thinks for every AI call the server makes,
and is validated at startup rather than per request — an unknown level is a boot failure,
not a failed inference. Effort is a property of the deployment's latency and cost budget,
not of any one lens or agent, and a level a given model ignores would otherwise look like
a broken agent configuration rather than a model limitation.

**Vector index width drift is reported at startup and repaired only on request.**
An index fixes its width when created, so a changed embedding model leaves indexes that
cannot accept vectors at the new width. Startup warns per mismatch and names the remedy.
It does not repair, because repair means dropping and rebuilding at the new width — a
destructive act no adapter may take unbidden. The rebuild operation does repair, because
there the caller has asked for exactly that.

## Scope

**Schema transfer carries schema only.**
Export and import move types, properties, lenses, agents and saved queries. Instance data
is not part of the format.

**No authentication, authorization or multi-tenancy.**
OntoForge assumes it is deployed behind something that provides them, or on a trusted
network. Building a permission model before a deployment requires one would be guessing
at its shape.
