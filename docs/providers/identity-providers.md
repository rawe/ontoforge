# Identity provider setup

What to set up at an OpenID provider so that OntoForge can sign people in, and which values
then go into the server's [configuration](../../README.md#authentication).

## What every provider needs

Fix two addresses first; they decide the redirect URIs and may be on different domains.

| Address | Variable | Example |
|---|---|---|
| The web client | `WEB_CLIENT_URL` | `https://ontoforge.example.com` |
| The server: REST, MCP and its authorization server | `PUBLIC_URL` | `https://ontoforge-api.example.com` |

- **One confidential client** (a web application) for the authorization code flow, with a
  client secret and two redirect URIs: `WEB_CLIENT_URL/api/auth/callback` and
  `PUBLIC_URL/oauth/callback`. Sign-out returns to `WEB_CLIENT_URL/`.
- **The first administrator's subject** at the provider, for `AUTH_ADMIN_SUBJECT`.
- **Only when machines call OntoForge:** an audience for OntoForge, and one client per
  service that uses client credentials and whose access tokens carry that audience.

MCP clients and own tools need nothing at the provider: they sign in at OntoForge's
[authorization server](../capabilities/authentication.md#the-authorization-server).

## Keycloak, local development

```sh
./dev.sh keycloak              # Keycloak on :8180: realm, client, test users; writes env/auth.local.env
./dev.sh env/auth.local.env    # server on :8000, web client on :5173
node scripts/auth/cli.mjs      # sign in as a test user from the command line
```

The test users are `admin`, `reader`, `writer` and `newcomer`; their passwords are in
`env/keycloak.local.env`. What the first command sets up:
[scripts/keycloak/](../../scripts/keycloak/USAGE.md). Checking the whole setup:
[scripts/auth/](../../scripts/auth/USAGE.md).

In a Keycloak of your own, the client has client authentication and the standard flow on.
For machines, a client scope with an audience mapper is added to each service's client,
which has service accounts on.

| Variable | Value |
|---|---|
| `OIDC_ISSUER` | `https://<host>/realms/<realm>` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The client's ID and secret |
| `OIDC_AUDIENCE` | The audience the mapper adds |
| `AUTH_ADMIN_SUBJECT` | The administrator's user ID |

## Auth0

1. **Applications → Create Application → Regular Web Application.** Allowed Callback URLs:
   the two redirect URIs. Allowed Logout URLs: `WEB_CLIENT_URL/`. Credentials →
   Authentication Method: Client Secret (Basic).
2. **For machines only:** Applications → APIs → Create API; its identifier is the audience.
   Then one Machine to Machine application per service, authorized for that API.

| Variable | Value |
|---|---|
| `OIDC_ISSUER` | `https://<tenant domain>/`, with the trailing slash |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The web application's client ID and secret |
| `OIDC_AUDIENCE` | The API's identifier |
| `AUTH_ADMIN_SUBJECT` | The administrator's `user_id` (User Management → Users), such as `auth0\|…` |

A service's subject is `<its client ID>@clients`.

## Microsoft Entra ID

A tenant administrator sets this up, as Application Administrator or Cloud Application
Administrator.

- **An app registration** for one tenant, with the platform Web and the two redirect URIs,
  and a client secret.
- **Delegated Microsoft Graph permissions** `openid`, `profile` and `email`, with admin
  consent where the tenant requires it. The optional claim `email` in the ID token shows
  people's email addresses in OntoForge.
- **Who may sign in:** everyone in the tenant, or, with "Assignment required" on the
  enterprise application, the assigned users and groups.
- **For machines only:** a second app registration as the API. It exposes an Application ID
  URI, defines an app role for applications, and has `requestedAccessTokenVersion` 2 in its
  manifest, so that its tokens name the issuer below. Each service is an app registration
  of its own with a client secret, granted that app role with admin consent; it asks for
  the scope `<Application ID URI>/.default`.

| Variable | Value |
|---|---|
| `OIDC_ISSUER` | `https://login.microsoftonline.com/<tenant ID>/v2.0` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The app registration's application (client) ID and its secret's value |
| `OIDC_SUBJECT_CLAIM` | `oid`: Entra ID's `sub` differs from one application to the next |
| `AUTH_ADMIN_SUBJECT` | The administrator's object ID (Users) |
| `OIDC_AUDIENCE` | The API registration's application (client) ID |

A service's subject is the object ID of its enterprise application.
