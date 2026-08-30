# 0006. MCP ontology scoping: hybrid resolution

- **Status:** Superseded by [0016](0016-mcp-url-only-binding.md)

> This record predates the multi-ontology system and uses "ontology" in the old sense
> (today's lens). The hybrid resolution it describes — URL, then header, then
> environment fallback — was replaced by URL-only binding.

## Context

Every MCP connection operates against exactly one ontology, and that ontology has to be
determined when the connection opens. The URL path carries it today, but orchestration
frameworks vary in what they can configure: some pass configuration through HTTP headers,
and single-ontology deployments would rather configure it once for the whole server.

## Decision

The ontology key can be provided via three mechanisms, in priority order:

1. the URL path (`/mcp/model/{ontologyKey}`),
2. the `X-Ontology-Key` HTTP header,
3. the `DEFAULT_MCP_ONTOLOGY_KEY` environment variable.

The URL path remains the primary and highest-priority mechanism, preserving backward
compatibility. If no key is found from any source, the server returns 400.

## Consequences

The header fallback supports orchestration frameworks that pass configuration via HTTP
headers; the environment variable fallback supports single-ontology deployments where
every MCP connection uses the same ontology. The LLM never sees multi-ontology complexity
— all tools operate on the single ontology resolved at connection time. The MCP layer
resolves the key to the ontology UUID internally; all type references use human-readable
keys, never UUIDs.
