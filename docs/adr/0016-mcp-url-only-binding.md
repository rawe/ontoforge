# MCP binding by URL only, no registry over MCP

Current behavior: [MCP mount binding](../interfaces/mcp.md#how-a-mount-is-bound)

## Context

With many isolated ontologies in one server, both MCP servers need a binding: which
ontology, and for runtime which lens and, optionally, which ruleset, a connected client
works in. The binding channel decides whether isolation holds by structure or has to be
checked.

## Decision

Bind each MCP mount by its URL alone: an ontology for modeling, and an ontology, lens
and optional ruleset for runtime. No tool parameter, header or environment fallback
changes that binding. MCP exposes no registry; with authentication off, the modeling
mount can explicitly ensure only its own ontology with an argument-less operation.
A mount never implicitly
creates an ontology or ruleset named by its URL.

## Consequences

Tools on one mount cannot switch or enumerate other ontologies. Clients configure a
mount for the context they intend, and configuration mistakes fail rather than silently
creating an ontology or an unrestricted ruleset. Registry management remains a separate
surface.

## Rejected

- **A per-tool ontology parameter.** Any connected client could reach and enumerate every
  ontology, which breaks isolation outright, and authorization would have no fixed
  mount scope to bind to.
- **Header or environment fallback channels beside the URL.** That is three places to
  check for one fact; REST does not use header addressing either; and with per-ontology
  lens keys an environment default is not well defined.
- **A registry mount over MCP** (list, create, rename, delete ontologies). YAGNI: no
  AI-driven ontology management exists, and it would be the one surface built to pierce
  isolation.
- **Arguments on `ensure_ontology`** (name, description). A model cannot know the right
  display name, and with no-op semantics the argument would apply only at creation, when
  the client knows least.
- **Implicit creation when a mount URL names a missing ontology.** A typo in a client
  config would silently create a junk ontology.
- **Implicit creation when a mount URL names a missing ruleset.** A typo in a client
  config would silently create a ruleset that limits nothing, and the client would write
  as through the plain lens.
