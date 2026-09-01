# 0018. Multi-ontology ships as a hard cut

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

The multi-ontology system changes the address of every REST route and MCP mount,
renames every lens-meaning interface name, re-scopes key uniqueness, and moves the
physical layout into per-ontology namespaces. Something had to be decided for every
artifact of the single-schema system: its database, its API paths, its MCP tool names,
and its 3.0 transfer payloads.

## Alternatives considered

- **Automatic data migration** — relocating an existing single-schema database into a
  first ontology at boot — rejected: an upgrade path built for deployments that did not
  exist yet, requiring a migration engine, a generated ontology identity, and a
  "default ontology" concept kept alive solely as a migration artifact.
- **Deprecated aliases** for the old REST paths, MCP mounts, and renamed `*_ontology`
  tool names — rejected: every alias is a second spelling of the vocabulary the
  terminology lock exists to kill, resolvable only against a single "default" ontology
  that the new model does not have; aliases would preserve exactly the ambiguity the
  rename removes.
- **A converter or version check for 3.0 transfer payloads** — rejected: the payload
  shape change (`ontologies[]` → `lenses[]`) makes an old document fail ordinary
  validation, which is a complete answer; a detector or converter would be
  compatibility machinery for a bridge deliberately closed.

## Outcome

The hard-cut rule in [../decisions.md](../decisions.md#scope): fresh database, old
paths removed without aliases, no default ontology, shipped as a major version bump.
