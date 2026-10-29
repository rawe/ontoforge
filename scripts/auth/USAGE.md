# Authentication checks

A rerunnable end-to-end check of authentication against a running server, and the helpers
it shares with the scale scenarios (`auth-*` in [scripts/scale/](../scale/USAGE.md)). No
browser: the Keycloak sign-in form is filled in by script. Node 22; the MCP client is the
server's installed SDK (`server/node_modules`, so `npm install` in `server/` first).

## Prerequisites

```sh
./dev.sh keycloak                      # Keycloak on :8180, test users, env/*.local.env
./dev.sh env/auth.local.env            # server :8000 (PUBLIC_URL) + Vite :5173 (WEB_CLIENT_URL), authentication on
```

The checks read the test users' passwords, the service client's secret and the Keycloak
administrator's password from `env/keycloak.local.env`, and the subjects from
`env/keycloak-subjects.local.env`. Nothing secret is printed: evidence is HTTP statuses,
user and assignment ids, claim names and values other than the token itself.

## Commands

```sh
node scripts/auth/lib.mjs --self-check     # Keycloak only: tokens and their claims, DCR + consent
node scripts/auth/e2e.mjs                  # web client http://localhost:5173, server http://localhost:8000
node scripts/auth/e2e.mjs --base http://localhost:13000 --public-url http://localhost:18000   # the scale stack
node scripts/auth/e2e.mjs --idle-seconds 20                      # server booted with AUTH_SESSION_IDLE_SECONDS=20
```

| Option | Default | |
|---|---|---|
| `--base <url>` | `http://localhost:5173` | the web client's address (`WEB_CLIENT_URL`) of the server under test: browser sign-in, REST and the `Origin` of cookie POSTs |
| `--public-url <url>` | `http://localhost:8000` | the server's address (`PUBLIC_URL`): MCP connects here, resources are named after it, `/api/server/info` reports it |
| `--idle-seconds N` | — | runs the expiry check: waits N + 2 s, then the session must be gone |
| `--no-fresh-user` | — | skips the concurrent first sign-ins (no throwaway Keycloak user) |

Output: one line per check, `PASS`, `FAIL` or `SKIP` with its evidence, grouped by step, and
a count. Exit 1 when a check failed, 2 when no server answers or it runs without
authentication. A step whose prerequisite failed reports one `SKIP` naming it; the others
still run.

The run creates the ontology `e2e_auth_<random>` (lenses `lens_a`, `lens_b`, entity type
`item`) and deletes it at the end; the administrator's `ontology_creator` role is revoked
again when the run granted it. Persisting: the local users of `reader`, `writer`, `newcomer`
and the service principal (an e2e user cannot be deleted), and one disabled user
`e2e-<random>` per run with the concurrent check — its Keycloak account is deleted. Each MCP
client registered at Keycloak is deleted again.

## What each step proves

| Step | Checks |
|---|---|
| server | `/api/server/info` reports `authentication: true` and `PUBLIC_URL` as `baseUrl`; `/api/auth/me` without credentials answers `user: null` (200) |
| browser sign-in (admin) | `/api/auth/login` → Keycloak form → `/api/auth/callback` → redirect to `returnTo`, session cookie; `/api/auth/me` names `admin`, Platform Administrator by `AUTH_ADMIN_SUBJECT` |
| first and repeat sign-in | `newcomer` signs in with no assignments and lists no ontology ("no access assigned"); on a fresh access database the first sign-in creates exactly one user (else SKIP: it existed); a second sign-in reuses the same id |
| concurrent first sign-ins | a throwaway Keycloak user signs in 5 times; the 5 callbacks land at once; one user id, one local user |
| logout and CSRF | logout without `Origin` and with a foreign one → 403, the session survives; with `Origin` = WEB_CLIENT_URL → 200 and a `logoutUrl` at the issuer; afterwards `/api/auth/me` → `user: null`, a protected route → 401 |
| CSRF on another route | a cookie `POST /api/ontologies` with a foreign `Origin` → 403 |
| setup | the administrator (granting itself `ontology_creator` when needed) creates the ontology, two lenses and a type through its session; `reader` and `writer` sign in and get Reader / Writer on lens A |
| REST with bearer tokens | reader reads lens A (200), writes (403), lens B (404); writer writes lens A (201), lens B (404); reader lists only its ontology and only lens A; 401 with `WWW-Authenticate: Bearer…` for no token, a token without audience `ontoforge-api`, garbage, a forged expired token, an ID token, a token of realm `master`, a token with a broken signature |
| service principal | the client-credentials token before admission → 403/404; `POST /api/users` admits it (201, or 409 on a rerun) and `/api/auth/me` names it a `service`; after a Reader grant → 200 |
| MCP OAuth | at `PUBLIC_URL`: an unauthenticated `POST` to the runtime mount → 401 with `resource_metadata=`; that document names the issuer and the mount; a real SDK client (`Client` + `StreamableHTTPClientTransport` + an `OAuthClientProvider`) discovers, registers at Keycloak, is authorized as `reader` (consent accepted, loopback redirect), lists only read tools, calls `list_entities`, and is refused `create_entity` |
| revocation | the reader's Reader grant is revoked; its next request with the same token → 403/404 |
| disabling | writer disabled → its next request 403, a new browser sign-in ends at `/?login=disabled` without a session; enabled again → it writes again |
| user management | list, search, one user with its assignments, an ontology's access list; a non-administrator listing users → 403 |
| session expiry | with `--idle-seconds N`: after N + 2 s idle, `/api/auth/me` → `user: null`, a protected route → 401 |
| cleanup | the ontology deleted; `ontology_creator` revoked when the run granted it |

## Helpers (`lib.mjs`)

`keycloakLogin(startUrl, username, password, jar)` follows redirects by hand, fills in
`form#kc-form-login`, accepts a consent screen, and returns the first redirect that leaves
Keycloak — the app's callback URL — without following it, so a caller can deliver it to the
backend it chooses (`deliverCallback`). `appLogin` / `startAppLogin` do the whole browser
sign-in against OntoForge. `userToken(username)` and `idToken(username)` use the public client
`ontoforge-mcp` (code + PKCE, loopback redirect, scope `openid ontoforge-api`) with the form
driven by script — no password grant. `serviceToken()` uses client credentials. `connectMcp`
is the MCP client described above. `CookieJar` keeps cookies by host name, as a browser does:
ports do not separate cookies.
