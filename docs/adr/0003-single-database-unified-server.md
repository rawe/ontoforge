# 0003. Single database, unified server

- **Status:** Accepted

## Context

Schema and instance data could be held in separate databases, and modeling and runtime
concerns could be served by separately deployed processes or by a process switched into
one mode or the other. OntoForge has to support multiple ontologies together with the
instance data they govern.

## Decision

One database instance holds all schema and instance data. The server always serves both
the modeling and the runtime routes from a single
process. No mode switching, and no separate deployments for different concerns.

## Consequences

Schema and instance data coexist in the same database; how they are kept apart is the
adapter's business (see 0008, and 0011 for the type keys an adapter may reserve). This is
the simplest architecture that supports multiple ontologies with their instance data.
