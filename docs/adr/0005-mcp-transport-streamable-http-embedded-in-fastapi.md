# 0005. MCP transport: streamable HTTP, embedded in the existing FastAPI server

- **Status:** Accepted

## Context

OntoForge exposes its capabilities over MCP as well as REST. Where the MCP endpoints run,
and how they reach the domain logic, had to be settled. Three deployment shapes were
evaluated:

- **(A)** embedded in the existing FastAPI application,
- **(B)** a separate process wrapping the REST API,
- **(C)** a separate process with its own database connection.

## Decision

Shape A: MCP endpoints are mounted inside the existing `ontoforge-server` process, not in
a separate process. The MCP handlers call `modeling/service.py` and `runtime/service.py`
directly — the same way the REST routers do. The transport is streamable HTTP, stateless,
returning plain JSON responses rather than an SSE stream.

## Consequences

No extra processes to deploy or supervise. Existing infrastructure is reused directly: the
Neo4j connection, the schema cache, and the error handling. There is no REST-to-REST hop
between the MCP layer and the domain logic. Plain JSON responses were required because the
user's AI framework needs HTTP-based MCP servers.

## Alternatives considered

- **(B) A separate process wrapping the REST API** — rejected: it adds a process and a
  REST-to-REST hop.
- **(C) A separate process with its own database connection** — rejected: it adds a
  process and duplicates infrastructure that already exists in the server.
