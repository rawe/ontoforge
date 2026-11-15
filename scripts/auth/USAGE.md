# Authentication checks and the command-line client

A command-line client that signs a person in to OntoForge (`cli.mjs`), a rerunnable
end-to-end check of authentication against a running server (`e2e.mjs`), and the helpers it
shares with the scale scenarios (`auth-*` in [scripts/scale/](../scale/USAGE.md)). No
browser in the checks: the Keycloak sign-in form and OntoForge's consent page are answered by
script. Node 22; the MCP SDK client is the server's installed SDK (`server/node_modules`, so
`npm install` in `server/` first). `cli.mjs` needs nothing installed.

## Prerequisites

```sh
./dev.sh keycloak                      # Keycloak on :8180, test users, env/*.local.env
./dev.sh env/auth.local.env            # server :8000 (PUBLIC_URL) + Vite :5173 (WEB_CLIENT_URL), authentication on
```

The checks read the test users' passwords, the client secrets and the Keycloak
administrator's password from `env/keycloak.local.env`, and the subjects from
`env/keycloak-subjects.local.env`. Nothing secret is printed: evidence is HTTP statuses,
user and assignment ids, claim names and values other than the token itself.

## The command-line client (`cli.mjs`)

The reference for an own tool acting for a person — a script, a command-line tool, a
desktop app. It signs in at OntoForge's authorization server with authorization code + PKCE
and a loopback redirect, opens the browser, and then calls OntoForge with the token.

```sh
node scripts/auth/cli.mjs                                   # REST: prints who is signed in and their roles
node scripts/auth/cli.mjs --mcp http://localhost:8000/mcp/ontologies/<key>/runtime/lenses/<lens>   # that mount's tools
node scripts/auth/cli.mjs --server https://ontoforge.example.com --client-id my-tool
```

| Option | Default | |
|---|---|---|
| `--server <url>` | `http://localhost:8000` | the server's `PUBLIC_URL` |
| `--client-id <id>` | `ontoforge-cli` | an `OAUTH_CLIENTS` entry of that server whose redirect URI is `http://127.0.0.1/callback` |
| `--mcp <mount url>` | — | ask for this MCP mount instead of the REST API and list its tools |

What it does, in the order of the file:

1. **Discovery.** The resource — `PUBLIC_URL/api`, or the mount's URL — names its
   authorization server in its protected-resource metadata
   (`/.well-known/oauth-protected-resource/<path>`); that server's metadata
   (`/.well-known/oauth-authorization-server`) names the endpoints.
2. **Loopback listener** on `127.0.0.1` and a free port; the redirect URI is
   `http://127.0.0.1:<port>/callback`. A loopback redirect URI matches the registered one on
   any port.
3. **Authorization request** in the browser: `client_id`, `redirect_uri`, the PKCE challenge
   (S256), `state`, and `resource`. **No scope**: the person's roles decide what the token may
   do. The person signs in at the identity provider and answers OntoForge's consent page.
4. **Token request** with the code, the PKCE verifier and the same `resource`. No secret: the
   client is public. The answer: an access token (one hour) and a refresh token.
5. **Calls** with `Authorization: Bearer <access token>`. The token opens exactly the one
   resource it was issued for: a REST token is refused on an MCP mount and the other way
   round.

`refresh()` exchanges the refresh token for a new pair. Refresh tokens rotate: the old one is
spent, and presenting it again revokes the whole authorization. Tokens live in memory only;
a tool that keeps them must store them as secrets.

A client that can publish a client metadata document (an https URL serving its client ID,
name and redirect URIs) uses that URL as its client ID and needs no `OAUTH_CLIENTS` entry —
this is how MCP clients such as Claude Code sign in.

## The end-to-end check (`e2e.mjs`)

```sh
node scripts/auth/lib.mjs --self-check     # Keycloak only: provider tokens and their claims
node scripts/auth/e2e.mjs                  # web client http://localhost:5173, server http://localhost:8000
node scripts/auth/e2e.mjs --base http://localhost:13000 --public-url http://localhost:18000   # the scale stack
node scripts/auth/e2e.mjs --idle-seconds 20                      # server booted with AUTH_SESSION_IDLE_SECONDS=20
```

| Option | Default | |
|---|---|---|
| `--base <url>` | `http://localhost:5173` | the web client's address (`WEB_CLIENT_URL`) of the server under test: browser sign-in, REST and the `Origin` of cookie POSTs |
| `--public-url <url>` | `http://localhost:8000` | the server's address (`PUBLIC_URL`): the authorization server, the resources tokens are issued for, MCP |
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
`e2e-<random>` per run with the concurrent check — its Keycloak account is deleted.

The consent page is answered as a browser answers it: a form POST carrying the consent page's
`Origin` (`PUBLIC_URL`'s) and `Referer`. A real browser's run is still worth doing by hand
once: `node scripts/auth/cli.mjs` and Allow.

### What each step proves

| Step | Checks |
|---|---|
| server | `/api/server/info` reports `authentication: true` and `PUBLIC_URL` as `baseUrl`; `/api/auth/me` without credentials answers `user: null` (200) |
| browser sign-in (admin) | `/api/auth/login` → Keycloak form → `/api/auth/callback` → redirect to `returnTo`, session cookie; `/api/auth/me` names `admin`, Platform Administrator by `AUTH_ADMIN_SUBJECT` |
| first and repeat sign-in | `newcomer` signs in with no assignments and lists no ontology ("no access assigned"); on a fresh access database the first sign-in creates exactly one user (else SKIP: it existed); a second sign-in reuses the same id and creates no user |
| concurrent first sign-ins | a throwaway Keycloak user signs in 5 times; the 5 callbacks land at once; one user id, one local user |
| logout and CSRF | logout without `Origin` and with a foreign one → 403, the session survives; with `Origin` = WEB_CLIENT_URL → 200 and a `logoutUrl` at the issuer; afterwards `/api/auth/me` → `user: null`, a protected route → 401 |
| CSRF on another route | a cookie `POST /api/ontologies` with a foreign `Origin` → 403 |
| setup | the administrator (granting itself `ontology_creator` when needed) creates the ontology, two lenses and a type through its session; `reader` and `writer` sign in and get Reader / Writer on lens A |
| authorization server | its metadata at `PUBLIC_URL` (issuer, endpoints, PKCE S256, public clients only, client metadata documents, no registration endpoint); REST without a token → 401 naming `PUBLIC_URL/.well-known/oauth-protected-resource/api`, which names `PUBLIC_URL/api` and this authorization server |
| command-line client | `reader` and `writer` sign in through `cli.mjs` for `PUBLIC_URL/api` (Keycloak sign-in, consent, code + PKCE): opaque access and refresh tokens, `/api/auth/me` names them; the consent page names the client, the person, the redirect address and the REST API |
| REST with bearer tokens | with those tokens: reader reads lens A (200), writes (403), lens B (404); writer writes lens A (201), lens B (404); reader lists only its ontology and only lens A; 401 with `WWW-Authenticate: Bearer…` for no token, a person's provider token without audience `ontoforge-api`, garbage, a forged expired token, an ID token, a token of realm `master`, a service token with a broken signature, an OntoForge token with one character changed |
| refresh rotation | a new sign-in; refresh gives a new access and refresh token, the new access token works; the spent refresh token → `invalid_grant`, and that reuse revoked the authorization (the newest access token → 401, its refresh token → 400) |
| consent: Origin and Deny | the consent answer without `Origin` and with a foreign one → 403; Deny with the page's `Origin` → the client's redirect URI with `error=access_denied`, its `state`, no code |
| a client metadata document | online only (else SKIP): an authorization request with the client ID `https://claude.ai/oauth/claude-code-client-metadata` reaches the redirect to Keycloak — the server fetched and accepted the document |
| service principal | the client-credentials token (a provider JWT) before admission → 403/404; `POST /api/users` admits it (201, or 409 on a rerun) and `/api/auth/me` names it a `service`; after a Reader grant → 200 |
| MCP for a person | an unauthenticated `POST` to the runtime mount → 401 with `resource_metadata=`; that document names the mount and `PUBLIC_URL` as its authorization server; a real SDK client (`Client` + `StreamableHTTPClientTransport` + an `OAuthClientProvider` with the client ID `ontoforge-cli`) discovers, is authorized as `reader` for the mount (no scope sent), lists only read tools, calls `list_entities`, and is refused `create_entity`; the mount's token on REST, the REST token on the mount and the mount's token on lens B's mount → 401; `cli.mjs`'s token for the mount lists the same read tools |
| revocation | the reader's Reader grant is revoked; its next request with the same token → 403/404 |
| disabling | writer disabled → its next request with its live OntoForge token 403, its refresh token → `invalid_grant`, a new authorization ends on a 403 page, a new browser sign-in ends at `/?login=disabled` without a session; enabled again → it writes again with the same token |
| user management | list, search, one user with its assignments, an ontology's access list; a non-administrator listing users → 403 |
| session expiry | with `--idle-seconds N`: after N + 2 s idle, `/api/auth/me` → `user: null`, a protected route → 401 |
| cleanup | the ontology deleted; `ontology_creator` revoked when the run granted it |

## Helpers (`lib.mjs`)

`keycloakLogin(startUrl, username, password, jar)` follows redirects by hand, fills in
`form#kc-form-login`, and returns the first redirect that leaves Keycloak without following
it. `authorizeInBrowser(authorizationUrl, username, options)` is a browser through OntoForge's
authorization server: Keycloak sign-in, then the consent page answered (`decision: 'allow'`,
`'deny'`, or `null` to stop there and answer it with `submitConsent`); `via` sends the requests
to a chosen backend while the browser still believes it talks to `PUBLIC_URL`. It returns the
client's redirect with the answer, not followed. `ontoforgeTokens(username, resource)` runs
`cli.mjs` with it as the browser. `connectMcp` is the MCP SDK client described above.
`appLogin` / `startAppLogin` / `deliverCallback` do the web client's sign-in.
`providerTokens(username)` gets a person's tokens straight from Keycloak (the web client's
code flow, its code intercepted) for the checks that refuse them; `serviceToken()` uses
client credentials. `CookieJar` keeps cookies by host name, as a browser does: ports do not
separate cookies.
