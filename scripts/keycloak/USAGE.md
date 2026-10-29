# Development identity provider

One Keycloak for both local stacks, started, provisioned and verified by one command.
Compose project `ontoforge-keycloak` (`docker/keycloak/compose.yml`), image
`quay.io/keycloak/keycloak:26.8.1`, bound to `127.0.0.1:8180`, data in the volume
`ontoforge-keycloak_data`.

```sh
./dev.sh keycloak          # start, wait (at most 180 s), reconcile, write configuration, verify
./dev.sh keycloak down     # stop; realm, users and secrets stay
./dev.sh keycloak reset    # remove the container and its volume; secrets stay
```

## What it reconciles

| Thing | Value |
|---|---|
| Issuer | `http://localhost:8180/realms/ontoforge`, the same for the browser, a server on the host and a server in a container (`KC_HOSTNAME`; containers reach it on the back channel, `OIDC_BACKCHANNEL_URL`) |
| Keycloak administrator | `ontoforge-admin` in `master`, permanent. Keycloak's temporary bootstrap administrator (`KC_BOOTSTRAP_ADMIN_*`) is used once to create it and then deleted. |
| Realm | `ontoforge` — created once, its settings reconciled; never deleted |
| Client scope `ontoforge-api` | Audience mapper (`aud: ontoforge-api`, access tokens only); a realm optional scope: a client gets it when it asks for it |
| Client `ontoforge-api` | The audience; no flows |
| Client `ontoforge-web` | Confidential; the OntoForge server signs browsers in with it (code + PKCE). Redirects `http://localhost:5173/api/auth/callback` and `http://localhost:13000/api/auth/callback` |
| Client `ontoforge-mcp` | Public, code + PKCE, loopback redirects; scripts use it to get a user's access token |
| Client `ontoforge-service` | Client credentials; the audience by default — a service principal once an OntoForge administrator admits it |
| Dynamic registration | Anonymous, as MCP clients register: loopback redirect URIs only, scope `ontoforge-api` allowed. Keycloak's own policies stay: such clients need the user's consent, and at most 200 exist (`./dev.sh keycloak reset` clears them) |
| Users of `ontoforge` | `admin`, `reader`, `writer`, `newcomer` — email `<name>@ontoforge.test`. `admin` is the OntoForge bootstrap administrator (`AUTH_ADMIN_SUBJECT`). Roles in OntoForge are assigned in OntoForge, never derived from Keycloak. |

A rerun changes only what differs: it never deletes the realm, never duplicates a client, scope
or user (the verification counts them) and never resets a password or the enabled flag of a
user. Startup realm import is not used: Keycloak skips an existing realm on import.

## Files it writes (all ignored by git, mode 600)

| File | Content |
|---|---|
| `env/keycloak.local.env` | Every generated secret: bootstrap and permanent administrator passwords, client secrets, the test users' passwords. Generated once and kept. |
| `env/auth.local.env` | `env/auth.env` + the web client secret + `AUTH_ADMIN_SUBJECT` — the one env file of `./dev.sh env/auth.local.env` |
| `env/scale-auth.local.env` | The same from `env/scale-auth.env`, for `./dev.sh scale up env/scale-auth.local.env` |
| `env/keycloak-subjects.local.env` | The users' and the service account's subjects, for scripted checks |

No secret is printed. To start over completely: `./dev.sh keycloak reset`, delete
`env/keycloak.local.env`, run `./dev.sh keycloak`.

## Failures

Each step names what failed and what to do: Keycloak not answering within 180 s (port 8180
taken, Docker short of memory — it needs about 1 GB), administrators from other secrets in the
volume (`reset`), an Admin API call refused (the call and Keycloak's answer). A disabled user or a
password reset in Keycloak does not end an OntoForge browser session; disabling the user in
OntoForge does, on the next request.
