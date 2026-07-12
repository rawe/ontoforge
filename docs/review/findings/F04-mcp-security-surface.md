# F04 — Unauthenticated Global Modeling MCP Is a Blast-Radius Concern

> **Severity: High (security posture)** · **Effort: Small–Medium** · **Type: Code hardening + doc honesty**

## Finding

The docs (`mcp-architecture.md` §3 design principles, PRD §7.3) suggest per-ontology containment
("the ontology is fixed by the MCP connection URL", "each MCP instance operates on one ontology").
The implemented modeling MCP is the opposite by design — and that design is *correct* for the
lens model, but its consequences are neither documented nor mitigated:

- `/mcp/model` is mounted **without any middleware**: no ontology scoping, no authentication.
  Tools like `delete_ontology`, `delete_entity_type(cascade=true)`, and `import_schema` give any
  client that can reach the port install-wide, destructive write access to the entire schema.
- `main.py` configures CORS with `allow_origins=["*"]`.
- The runtime MCP's only broad tool (`execute_cypher_query`) is genuinely read-only and blocks
  schema labels — this containment is real and verified. The asymmetry (runtime carefully
  sandboxed, modeling wide open) is what makes the gap notable.

## Assessment

For a local dev tool this is acceptable; OntoForge however ships container images, an
`examples/docker-compose` deployment, and A2A endpoints with a `PUBLIC_URL` setting — i.e. it is
clearly heading toward network-reachable deployments. The security model has not moved with it.

## Proposed Correction

1. **Implement the existing "Optional API Authentication" draft** (see feature concept
   `FT01-api-authentication.md`) — a single bearer-token middleware covering REST *and* MCP is
   the smallest fix with the biggest effect, and it is already designed in
   `docs/feature-ideas/_feature_drafts.md`.
2. Make CORS configurable (`CORS_ORIGINS` env var, default `*` for dev) instead of hardcoded `*`.
3. Document the actual trust model in `mcp-architecture.md`: modeling MCP = install-wide admin
   surface; runtime MCP = read/write within one ontology lens, Cypher read-only. Remove the
   stale "no tool takes an ontology parameter" principle (part of F07).

## Dependencies

- Item 1 is feature FT01; items 2–3 are independent and small.
- Should precede any promotion of OntoForge for shared/hosted deployments.

## Acceptance

- With `AUTH_TOKEN` set, unauthenticated REST and MCP requests get 401; without it, behavior is
  unchanged.
- `mcp-architecture.md` describes the real containment model.
