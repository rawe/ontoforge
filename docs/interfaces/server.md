# Server-wide routes

The registry, the server route, sign-in, the authorization server, user management,
exposure, probes and metrics. Shared conventions — addressing, errors, who may call — are
in the [interfaces index](README.md).

## Registry

Prefix `/api/ontologies`. Ontologies as whole units — the only surface that manages
them. An ontology is created bare: empty schema, no lenses, no data, and no lens is
auto-created.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ontologies` | Create an ontology — a key plus an optional display name |
| GET | `/api/ontologies` | List every ontology |
| GET | `/api/ontologies/{ontologyKey}` | Read one ontology |
| PATCH | `/api/ontologies/{ontologyKey}` | Rename — the display name only; the key is immutable |
| DELETE | `/api/ontologies/{ontologyKey}` | Hard cascade delete of the ontology and everything it contains |

Keys follow the schema [key](../glossary.md#schema-and-design) rule at up to 59 characters and are unique
server-wide, as are display names. Delete is a plain request with no API-level guard —
the web client adds its own confirmation, callers of the API get none.

## Server

Prefix `/api/server`. Read-only reads describing the deployment.
Ontology-scoped operations never live here, and server-wide data operations do not
exist.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/server/info` | Report where clients reach this server and which version it runs |
| GET | `/api/server/features` | Report which optional capabilities this deployment offers |

Both routes concern neither the ontologies nor their content — they describe the
deployment.

`info` answers:

| Field | Type | Reports |
|---|---|---|
| `baseUrl` | string or null | The address clients reach this server at, without a trailing slash; REST and MCP paths are appended to it. Taken from the server's configured public address; `null` when none is configured |
| `version` | string | The server's release version |
| `authentication` | boolean | Authentication is on: callers sign in, and roles decide what they may do |

`features` answers as follows; clients call it before offering optional capabilities.

| Field | Type | Reports |
|---|---|---|
| `semanticSearch` | boolean | This server has an embedding provider installed, so semantic ranking can run |
| `rankedSearch` | boolean | Ranked search can run: the store ranks by keyword, or an embedding provider is installed |
| `ai` | boolean | A language-model provider is configured; gates the `/ai` routes |
| `decisions` | boolean | A Decision provider is configured; gates the `/decisions` routes |

## Sign-in

Prefix `/api/auth`. The browser's sign-in, with the server as the provider's client.
Semantics: [capabilities/authentication.md](../capabilities/authentication.md#signing-in).
`me` exists with authentication off too; the others only with it on and a web client
address configured.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/me` | Whether authentication is on, and who is signed in with their roles |
| GET | `/api/auth/login` | Start a browser sign-in: redirects to the provider; `returnTo`, a path on the web client's address, is where the browser lands afterwards |
| GET | `/api/auth/callback` | Where the provider sends the browser back: starts the session and redirects to `returnTo` |
| POST | `/api/auth/logout` | End the session; answers `logoutUrl`, the provider's sign-out page, for the browser to open |

`me` never answers `401`: `authentication` alone when it is off; with it on, `user` — null
when no one is signed in — and `assignments`, each with its role and the keys of its
ontology and lens. An assignment whose ontology or lens no longer exists is left out. A
failed sign-in lands on `/?login=failed`, that of a disabled principal on
`/?login=disabled`, both without a session.

## Authorization server

With authentication on only, at the server's public address; off, every path here answers
not found. Semantics:
[capabilities/authentication.md](../capabilities/authentication.md#the-authorization-server).
A reference client is `scripts/auth/cli.mjs` ([scripts/auth/](../../scripts/auth/USAGE.md)).

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource/api` | Protected-resource metadata (RFC 9728) of the REST API: `resource` is the public address followed by `/api`, `authorization_servers` the public address |
| GET | `/.well-known/oauth-protected-resource/<mount path>` | The same for one MCP mount, its URL as `resource`; the bare `/.well-known/oauth-protected-resource` describes the server |
| GET | `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414): the issuer, the public address, and its endpoints |
| GET | `/oauth/authorize` | Authorization request: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` with `code_challenge_method=S256`, `state`, and exactly one `resource`; any `scope` is ignored |
| POST | `/oauth/token` | Token request: `grant_type=authorization_code` with the code, the PKCE verifier and the same `resource`, or `grant_type=refresh_token`; no client secret. Answers `access_token`, `refresh_token` and `expires_in` |
| GET | `/oauth/jwks` | The authorization server's public key set |
| GET | `/oauth/callback` | Where the provider sends the browser back during an authorization |
| GET, POST | `/oauth/interaction/{uid}` | The consent page, and its Allow or Deny, accepted only with the public address's `Origin` |

A `401` on a REST route under `/api` or on an MCP mount carries
`WWW-Authenticate: Bearer resource_metadata="…"`, naming the metadata document of the REST
API or of that mount. MCP takes no cookie.

## User management

Prefix `/api/users`, plus one route per ontology. Exists only with authentication on;
off, every route here answers not found. Semantics and who may do what:
[capabilities/authentication.md](../capabilities/authentication.md#user-management).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users` | Find principals by name, email or username; `search`, `limit` (at most 200, default 50), `offset`; answers `items` and `total` |
| POST | `/api/users` | Admit a service under its subject at the provider, before its first call |
| GET | `/api/users/{userId}` | Read one principal with the assignments the caller may see |
| PATCH | `/api/users/{userId}` | Disable or enable a principal |
| POST | `/api/users/{userId}/assignments` | Grant a role: platform roles without keys, Ontology Administrator with `ontologyKey`, Reader, Proposer and Writer with `ontologyKey` and `lensKey`; idempotent |
| DELETE | `/api/users/{userId}/assignments/{assignmentId}` | Revoke one assignment |
| GET | `/api/ontologies/{ontologyKey}/access` | Every assignment within one ontology, each with its principal |

Removing the role of the last active Platform Administrator or of the configured
administrator, disabling either of them, or disabling oneself answers
`RESOURCE_CONFLICT`. Admitting an identity bound to a principal that holds no role turns
that principal into the service; one bound to a principal with a role answers
`RESOURCE_CONFLICT`.

## Exposure

One port serves everything. What a deployment exposes follows one rule: **what clients call
is public, what the platform calls stays internal.** The ingress or reverse proxy in front
of the server enforces it; the server itself serves every path under that route's access
rules. Probes and metrics share the client port rather than a listener of their own:
one port with one exposure rule keeps deployment simpler.

| Path | Exposed | Called by |
|---|---|---|
| `/api/*` | public | REST clients and the web client |
| `/mcp/*` | public | MCP clients |
| `/.well-known/*`, `/oauth/*` | public | Clients finding where to sign in, and the authorization server they sign in at (authentication on) |
| `/openapi.json` | public | Clients reading the contract or generating code from it |
| `/docs/*` | optional | People browsing the same description |
| `/livez`, `/readyz` | internal | The orchestrator, on each server directly |
| `/metrics` | internal | The monitoring system, on each server directly |

Probes and metrics describe one server process, so they are called on each server, never
through a load balancer that would pick one at random.

## Probes

Two routes outside `/api` for an orchestrator; they check no dependency, are not part of
the OpenAPI description and do not use the error envelope.

| Method | Path | Answers |
|---|---|---|
| GET | `/livez` | `200` while the process answers requests |
| GET | `/readyz` | `200` until the server starts shutting down, then `503` |

They are two because they trigger different actions: a failing liveness probe restarts the
server, a failing readiness probe only stops new traffic to it. While shutting down, a
server is ready no longer but still live, so it finishes its running requests and chat
streams instead of being restarted in the middle of them
([architecture.md](../architecture.md#shutdown)). Neither answers before startup is done
([architecture.md](../architecture.md#startup)).

## Metrics

| Method | Path | Answers |
|---|---|---|
| GET | `/metrics` | Every metric of this server process in Prometheus text format |

Like the probes it needs no credential, is not part of the OpenAPI description and does not
use the error envelope.

| Metric | Type | Labels |
|---|---|---|
| `ontoforge_http_requests_total` | counter | `method`, `route`, `status` |
| `ontoforge_http_request_duration_seconds` | histogram | `method`, `route`, `status` |
| `ontoforge_db_pool_connections` | gauge | `pool` (`ontology`, `access`), `state` (`total`, `idle`, `waiting`) |
| `ontoforge_search_queue_items` | gauge | `state` (`pending`, `failed`) |
| `ontoforge_search_items_total` | counter | `outcome` (`completed`, `failed`, `released`) |
| `ontoforge_search_entries_total` | counter | `representation` (`keyword`, `semantic`) |
| `ontoforge_provider_request_duration_seconds` | histogram | `provider` (`embedding`, `ai`), `outcome` (`ok`, `error`) |
| `ontoforge_ai_tokens_total` | counter | `kind` (`input`, `output`, `cache_read`, `cache_write`) |
| `process_*`, `nodejs_*` | as the client library defines them | none |

`route` is the route template (`/api/ontologies/:ontologyKey`), or `unmatched` for a request
no route answers; `status` is the status code, or `aborted` when the client left before any
response was sent. No label carries an ontology, a lens, a principal or a raw path. The
number of series therefore depends on the code alone, and metrics do not disclose what
an ontology holds. A streamed response or model call is timed to its end. Tokens are counted
as the language-model provider reports them: `input` is the whole prompt, `cache_read` and
`cache_write` the parts of it read from and written to the provider's cache.

The search counters count this server's worker; the queue is shared, so every server reports
the same queue, as of its last pass over every ontology. A `failed` item there waits for a
rebuild; one counted `failed` by the worker may still be retried.
