# MCP runs in the server process over stateless JSON HTTP

Rule: [Interfaces](../decisions.md#interfaces)

## Context

OntoForge exposes its capabilities over MCP as well as REST. Where the MCP endpoints run,
how they reach the domain logic, and which transport they speak had to be settled.

## Rejected

- **A separate process wrapping the REST API.** It adds a process to deploy and a network
  hop, and makes MCP a second contract layered over the first.
- **A separate process with its own database connection.** It adds a process and
  duplicates the storage access, schema cache and error handling the server already has.
- **A session-based transport with an event stream.** The AI frameworks it serves need
  plain HTTP MCP servers that answer in JSON, and per-connection state would have to be
  kept for every client of a mount.
