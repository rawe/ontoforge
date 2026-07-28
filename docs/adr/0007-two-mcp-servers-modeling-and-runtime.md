# 0007. Two MCP servers, modeling and runtime

- **Status:** Accepted

## Context

The REST API keeps modeling and runtime apart, and the PRD requires that no client can
reach both modes through one connection. The MCP surface has to honour the same
separation.

## Decision

Two separate MCP mount points within the same process: one for modeling
(`/mcp/model/{key}`) and one for runtime (`/mcp/runtime/{key}`).

## Consequences

The MCP surface mirrors the REST API separation and satisfies the PRD requirement for no
cross-mode access. A client must open a second connection to reach the other mode.
