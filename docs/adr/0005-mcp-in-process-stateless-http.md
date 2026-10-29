# MCP runs in the server process over stateless JSON HTTP

Current behavior: [MCP interfaces](../interfaces/mcp.md)

## Context

OntoForge exposes its capabilities over MCP as well as REST. Where the MCP endpoints run,
how they reach the domain logic, and which transport they speak had to be settled.

## Decision

MCP runs inside the server process and calls the same services as REST directly. Its
transport is stateless HTTP with plain JSON responses, without a per-connection session
or event stream.

## Consequences

MCP shares the service, storage, schema-cache and error-handling contracts rather than
adding a separate deployed wrapper or a second database access path. A mount can serve
many clients without keeping connection state; clients must support the chosen JSON
HTTP transport.

## Rejected

- **A separate process wrapping the REST API.** It adds a process to deploy and a network
  hop, and makes MCP a second contract layered over the first.
- **A separate process with its own database connection.** It adds a process and
  duplicates the storage access, schema cache and error handling the server already has.
- **A session-based transport with an event stream.** The AI frameworks it serves need
  plain HTTP MCP servers that answer in JSON, and per-connection state would have to be
  kept for every client of a mount.
