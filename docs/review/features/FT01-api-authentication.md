# FT01 — Optional API Authentication

> **Type: Feature concept** · **Effort: Small** · **Priority: High — unblocks shared deployments**
> Builds directly on the existing draft in `docs/feature-ideas/_feature_drafts.md`.

## Why now

Finding F04 shows the modeling MCP is an unauthenticated, install-wide admin surface, and the
project visibly moves toward network-reachable deployments (published container images,
`examples/docker-compose/`, A2A endpoints with `PUBLIC_URL`). Auth is also the first "future
extension" named in the PRD. The existing draft is well-scoped and KISS-compliant — it should be
promoted from draft to implementation mostly as-is.

## Concept (confirming the draft, with three additions)

- `AUTH_TOKEN` env var; unset → current open behavior, set → bearer-token check on every request.
- One ASGI middleware in `main.py`, covering REST **and** both MCP mounts (same HTTP stack).
  No user model, no sessions — a shared secret.
- 401 with the standard error envelope (`error.code = "UNAUTHORIZED"`).

**Additions beyond the draft:**

1. **Exempt paths**: `GET /api/runtime/features` and A2A discovery (`/.well-known/agent.json`)
   should stay readable, or clients cannot even discover how to connect. Decide explicitly.
2. **Frontend handling**: the draft says "no frontend changes", but if auth is on, the UI is
   unusable without a token. Minimal viable answer: the nginx/docker deployment injects the
   token server-side (frontend container → backend), keeping the browser out of the secret; a
   token input in the UI is a later step. This deployment question needs a decision.
3. **Constant-time comparison** (`secrets.compare_digest`) and a startup log line stating whether
   auth is active.

## Explicit non-goals (YAGNI)

Multi-user accounts, roles/permissions, per-ontology tokens, OAuth. The design must not block
them (401 semantics and a middleware seam are enough forward compatibility).

## Dependencies

- None on other findings/features. Resolves the main part of **F04** (CORS configurability rides
  along in the same PR).
- Touchpoints: `main.py` (middleware), `config.py` (setting), README + `mcp-example*.json`
  (header examples), `_feature_drafts.md` (remove draft after shipping).

## Open questions for the user

- Exempt `/features` and A2A discovery from auth? (Recommended: yes.)
- Docker deployment: token injection via nginx proxy vs. UI token field? (Recommended: proxy.)
