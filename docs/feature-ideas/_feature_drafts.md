Here only drafts for features are listed.


## Optional API Authentication

- An optional auth token secures the backend (REST API and MCP).
- The token is defined via an environment variable (e.g. `AUTH_TOKEN`). When the variable is set, authentication is enforced on all requests. When unset, the backend runs without authentication (current behavior).
- REST API: the token is sent as a standard `Authorization: Bearer <token>` header.
- MCP: since MCP uses HTTP/SSE transport (embedded in FastAPI), the same `Authorization: Bearer <token>` header applies. MCP clients (e.g. Claude Desktop) pass it via their HTTP header configuration.
- Implementation: a single ASGI middleware checks for the env var on startup. If set, it intercepts every request, extracts the `Authorization` header, compares the bearer token against the env var value, and returns `401 Unauthorized` on mismatch. No database, no user model, no session — just a shared secret.
- The frontend is not affected. It already talks to the backend via REST; if auth is enabled, the frontend must include the header in its requests, but no frontend code changes are part of this feature.


## Partitioning

- Native partitioning segments entities of an ontology by a property value.
- A partition is defined by a partitioning entity type (e.g. `Project`) and a partitioning property (e.g. `project_key`). The property value on a specific entity becomes the partition value.
- The partitioning property gets a unique constraint on the partitioning entity type. Other entity types carry the same property name without a uniqueness constraint. Not all entity types need the property in the schema.
- Partitioning applies to runtime read and write operations. Reads filter to entities matching the partition value. Writes automatically apply the partition value to new entities.
- MCP: the partition value is passed as a declarative HTTP header per session, scoping all queries and mutations to that partition transparently.
- The partition must be modeled in the schema.


## OpenAI-Compatible Embedding

- Support the OpenAI embedding API format so the same embedding provider can serve both OntoForge and OpenAI-compatible clients.
