# 0016. MCP binding: URL-only, no registry over MCP

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

With many isolated ontologies in one server, both MCP servers need a binding the
modeling server never had: which ontology (and, for runtime, which lens) a connected
client works in. The binding channel decides whether the isolation guarantee — a bound
AI client can never reach, list, or infer another ontology's existence — holds
structurally or has to be checked. Supersedes [0006](0006-mcp-ontology-scoping-hybrid-resolution.md),
whose hybrid URL/header/environment resolution predates multiple ontologies.

## Alternatives considered

- **A per-tool ontology parameter** (one server, tools take `ontology_key`) — rejected:
  any connected client could reach and enumerate every ontology, breaking total
  isolation outright, and a future ACL would have nothing to anchor on.
- **Keeping the header and environment fallback channels** (0006's hybrid) — rejected:
  three places to check for one fact, and REST had already rejected header addressing;
  with per-ontology lens keys the environment fallback also stopped being well-defined.
- **A registry/admin mount over MCP** (list, create, rename, delete ontologies) —
  rejected as YAGNI: no AI-driven ontology-management workflow exists, and it would be
  the one surface deliberately piercing isolation — the exact piece needing a retrofit
  once ontologies carry owners and ACLs.
- **On the `ensure_ontology` carve-out:** name or description arguments on the tool —
  rejected because an LLM cannot know the right display name, and with no-op semantics
  the argument would apply only at creation, the moment the client knows least; implicit
  auto-create when a mount URL names a missing ontology — rejected because a typo in a
  client config would silently spawn a junk ontology.

## Outcome

The MCP addressing rule in [../decisions.md](../decisions.md#interfaces): bound mounts
mirroring REST spelling, the URL as the only binding channel, no registry over MCP
except the argument-less `ensure_ontology`.
