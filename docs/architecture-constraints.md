# Architectural constraints

These are the essential boundaries contributors must preserve when changing OntoForge.
They are the authoritative statements of the constraints; the linked documents explain
their mechanisms and application. Read the relevant capability and interface sections
as well before changing a feature. This page is not a catalogue of every feature rule.

## Schema-driven behavior

**Model and use an ontology through generic, schema-driven operations; do not add
per-schema code or generated APIs.** Types, properties and relations are design data,
so changing an ontology does not require an application deployment.
See [the central idea](README.md#the-central-idea).

## Ontology isolation

**An ontology-scoped operation belongs to exactly one ontology; its design and instance
data never span ontologies.** Bind stores to an ontology rather than relying on a filter
every query must remember. Registry operations manage ontologies as units and do not
inspect their data. This makes isolation structural.
See [ontology isolation](architecture.md#ontology-isolation).

## Lenses are boundaries, not containers

**Lens-scoped runtime data access uses one lens over its ontology's shared instance data.** A lens selects what
schema a caller can name, see and write; it does not own a separate copy of entities.
Operations must respect its visibility and scoping rules rather than bypassing them
through another surface. This keeps the same design meaningful across clients.
See [lenses](capabilities/ontology-lenses.md) and
[lens scoping](architecture.md#lens-scoping).

## Service and storage boundaries

**Enforce domain rules in services shared by REST and MCP, not in an individual
interface. Keep ontology storage behind the persistence port and database-specific
details in its adapter.** Otherwise a second entrance could bypass a rule or become
coupled to the storage engine. The web client uses REST and has no privileged path.
Access storage and shared state have their own narrow ports beside the ontology
persistence port; they do not bypass it to reach ontology data.
See [layers](architecture.md#layers), [components](architecture.md#components) and
[the persistence contract](storage-adapters.md#bound-stores-and-the-registry).

## Schema and write consistency

**A data write must commit against the design revision it was validated against.**
Design changes and data writes coordinate so that stale schema cannot admit a write the
current design forbids. Runtime reads schema as a value through the port and never
depends on the modeling service, allowing schema caching without a second schema owner.
Schema and instance data share one ontology database; their physical separation inside
it is the adapter's concern.
See [design revisions](architecture.md#design-revision) and
[bounded contexts](architecture.md#bounded-contexts).

## Authorization belongs to OntoForge

**When authentication is enabled, verified provider identity does not grant access:
OntoForge's assignments do.** One authorization service protects REST, MCP and assistant
tool access. A principal's identity is bound to its verified issuer and subject, not an
email address or provider role. Missing assignments grant nothing; platform or ontology
administration does not implicitly grant lens data access. The permissions within each
lens role follow the documented ladder. Access records are durable in a separate access database.

**Enabled authentication must fail closed, never silently become trusted access.**
Missing or unusable required authentication dependencies prevent startup; a failed
protected-request check refuses the request. Authentication explicitly disabled is a
different deployment mode: callers are trusted. This distinction prevents an apparently
healthy server from accidentally exposing protected ontologies.
See [authentication and authorization](architecture.md#authentication-and-authorization)
and [roles](capabilities/authentication.md#roles).

## One deployment contract across server instances

**Every server instance serves registry, modeling, runtime and both MCP surfaces, with
no partial mode.** Instances share the ontology database and, when authentication is
enabled, the access database and identity provider. Configuration must not make one
instance open what another protects.

**State that must be shared uses the deployment's shared store; configured shared
storage never falls back to per-process memory.** Memory serves a single process only.
Durable state belongs in its database; recoverable, expiring state such as threads and
browser sessions belongs in shared state. A fallback would silently split what servers
see. See [components](architecture.md#components) and
[shared state](architecture.md#shared-state).

## Maintaining this document

Add a constraint only when it protects an important architectural boundary or guarantee
that contributors need before designing changes. State the obligation, its reason and
where to understand it further. Feature defaults, parameter limits, procedures and local
implementation choices belong in their owning documents. Changing a constraint is an
architectural choice; apply [recording architectural decisions](workflows/recording-decisions.md)
to determine whether its rationale warrants an ADR.
