Here only drafts for features are listed.


## Optional API Authentication

- An optional auth token secures the backend (REST API and MCP).
- The token is defined via an environment variable (e.g. `AUTH_TOKEN`). When the variable is set, authentication is enforced on all requests. When unset, the backend runs without authentication (current behavior).
- REST API: the token is sent as a standard `Authorization: Bearer <token>` header.
- MCP: since MCP uses HTTP/SSE transport (embedded in FastAPI), the same `Authorization: Bearer <token>` header applies. MCP clients (e.g. Claude Desktop) pass it via their HTTP header configuration.
- Implementation: a single ASGI middleware checks for the env var on startup. If set, it intercepts every request, extracts the `Authorization` header, compares the bearer token against the env var value, and returns `401 Unauthorized` on mismatch. No database, no user model, no session — just a shared secret.
- The frontend is not affected. It already talks to the backend via REST; if auth is enabled, the frontend must include the header in its requests, but no frontend code changes are part of this feature.


## Data Scoping

See [data-scoping.md](data-scoping.md) for the full feature document.


## OpenAI-Compatible Embedding

- Support the OpenAI embedding API format so the same embedding provider can serve both OntoForge and OpenAI-compatible clients.
