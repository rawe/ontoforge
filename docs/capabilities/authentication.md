# Authentication

With authentication on, every caller signs in through an OpenID provider, and OntoForge
decides what each one may do from roles it assigned itself. With it off — the default —
every caller may do everything.

Vocabulary: [../README.md](../README.md#access). How a request is identified and judged:
[../architecture.md](../architecture.md#authentication-and-authorization). The switch and
its settings: the configuration table of the repository README.

## What it does

The provider says who a caller is; OntoForge says what it may do. A person or a service is
a **principal**, bound to one verified identity at the provider — its issuer and subject —
and never found by an email address or a name. What it may do are its **assignments**:
each one role, held on the platform, on one ontology or on one lens. A principal without
an assignment signs in and may do nothing.

Every server of one deployment runs with authentication on, or every one with it off.

## Signing in

Three ways in, one principal behind each:

- **The web client.** Sign-in sends the browser to the provider and back to the server,
  which starts a session and returns the person to the address they started from. The
  server is the provider's client and keeps the session; the browser holds only a cookie.
  A session ends after a configured time unused and at the latest 24 hours after sign-in;
  each sign-in starts a new one. Signing out ends it and leads to the provider's sign-out
  page. A request carrying the cookie that may change something must come from the
  deployment's own address.
- **REST with a bearer token.** An access token the provider issued for OntoForge's
  audience and scope, in an `Authorization: Bearer` header. An ID token, a token of
  another issuer, audience or scope, an expired one or one not signed by the provider's
  keys is refused. A
  request with a token is judged by the token alone, never by a cookie.
- **MCP over OAuth.** The MCP mounts take bearer tokens only. A client without one is told
  where to sign in, registers itself at the provider and signs its user in through the
  browser. Its token names OntoForge's audience only when the client asks for OntoForge's
  scope, which the mount advertises. A client connects through the deployment's public
  address, because the resource it signs in for is named after that address.

**First sign-in.** The first time an identity signs in — in the browser or with a token —
OntoForge creates its principal, with no role; concurrent first sign-ins create one. Later
sign-ins find it by its identity. A browser sign-in refreshes the name, email and username
shown, never the status or the roles. Nothing is linked by email: an identity at another
provider, or a subject the provider reissued, is another principal.

**The configured administrator.** The deployment's configuration names one identity at
the provider. Whenever it signs in, it is made active and Platform Administrator if it is
not. That is how the first administrator comes to exist, and how a platform whose
administrators are locked out is recovered.

**Disabled principals.** A disabled principal is refused on its next request, whichever
way it came in. Its browser sign-in starts no session and says the account is disabled;
signing in never enables it again. Disabling the account at the provider, or resetting
its password there, does not end an OntoForge session; disabling it in OntoForge does.

Every request reads the principal's status and roles anew, on whichever server serves it,
so a granted or revoked role and a changed status hold from the next request on.

## Roles

| Role | Held on | Allows |
|---|---|---|
| Platform Administrator | The platform | [User management](#user-management) in full. Sees every ontology and every lens listed, to assign roles, but reads no design and no data by itself |
| Ontology Creator | The platform | Creating ontologies; the creator becomes the administrator of each one it creates. Nothing in ontologies it did not create |
| Ontology Administrator | One ontology | Its whole design — every modeling route and the modeling MCP mount — its rulesets, renaming and deleting it, and granting Reader and Writer on its lenses. No data without a lens role, which it may grant itself |
| Reader | One lens | Everything that reads through the lens: schema, data, documents, search, queries, saved queries, assistants, its own threads and the lens's changesets; the lens's own design and the ontology's rulesets |
| Writer | One lens | What a Reader may, and every write the lens allows: data, documents, staging, submitting and committing changesets |

No role includes another. A principal holds at most one of Reader and Writer on a lens:
granting one replaces the other. A Writer stays within everything the lens and the
[ruleset](rulesets.md) of its URL limit: on a ruleset mount, the lower of the role and the
ruleset's write access applies. Agents stay read-only whatever the role.

## What a caller sees

An ontology a caller holds no role in, and a lens it holds no role on, answer not found,
exactly as a key that does not exist: a caller learns no key it may not use. Administrators
are the exception: a Platform Administrator knows every ontology and an Ontology
Administrator every lens of its ontology. A caller refused something it may know of is
forbidden: a Reader writing, a member of an ontology reading its design, an administrator
reading data through a lens it holds no role on.

The list of ontologies holds those the caller holds a role in, every one for a Platform
Administrator. The list of an ontology's lenses holds those the caller holds Reader or
Writer on, every one for an administrator. A Reader or Writer reads a lens's design as
its runtime serves it, without the inclusions it cannot serve; an administrator reads it
as designed. A runtime MCP mount lists a Reader only the tools a ruleset with write
access `none` lists ([rulesets.md](rulesets.md#write-access-through-the-interfaces)) and
refuses a write tool it calls anyway.

Without credentials, a caller reaches only sign-in, the deployment description
(`/api/server`), the probes, the API description and the MCP resource metadata;
everything else is refused as unauthenticated.

## Ontologies and lenses

Creating an ontology needs the Ontology Creator role, and its creator becomes its first
Ontology Administrator. That role is written first: if it cannot be, no ontology is
created, so none is ever left without an administrator. The modeling MCP mount's
`ensure_ontology` creates nothing: a missing ontology is created through REST or the web
client.

Deleting an ontology or a lens, through any interface, removes the assignments held on
it. One a failure leaves behind grants and reveals nothing: a role on a lens that no
longer exists counts for nothing, and an ontology or lens created again under the same
key is a new one, with no roles.

## Threads and changesets

An assistant thread belongs to the principal that started it as well as to its
assistant: to anyone else, even a Writer of the same lens, its id is unknown
([threads.md](threads.md)). Changesets stay shared within their lens: every Reader reads
and checks them, every Writer may stage into, submit and commit them
([changesets.md](changesets.md)).

## User management

Only with authentication on.

- A **Platform Administrator** finds every principal by name, email or username, sees all
  its roles, disables and enables it, admits services, and grants and revokes every role.
  Only a Platform Administrator grants Ontology Administrator and the platform roles.
- An **Ontology Administrator** finds principals as well, sees of each only the roles
  within the ontologies it administers, and grants and revokes Reader and Writer on those
  ontologies' lenses. It lists who holds which role in each of its ontologies.
- No one disables their own account. Neither the last active Platform Administrator nor
  the [configured administrator](#signing-in) can be disabled or stripped of the role:
  the configured one would only be restored at its next sign-in, so the configuration is
  changed first.
- A **service** — a client signing in with its own credentials, not a person's — is a
  principal like a person. It may be admitted under its subject before its first call, so
  it can be given roles ahead. Otherwise its first call creates a role-less principal,
  which admitting turns into the service as long as it holds no role.
- Every change of a status or a role, and every role removed with a deleted ontology or
  lens, is recorded with who made it.

Principals are never deleted. Accounts and passwords are managed at the provider.

## Authentication off

Every request is trusted and nothing is checked; neither the provider nor the access
database is needed. Sign-in, user management and the resource metadata do not exist —
their routes answer not found, never anonymously — and the web client shows no sign-in, no
user menu and no access pages. Assignments stored while authentication was on are kept for
when it is on again. Threads have no owner.

## Through the interfaces

| | REST | MCP | Web UI |
|---|---|---|---|
| Sign in and out, who is signed in | `/api/auth` | OAuth at the provider, discovered from the mount's challenge | the sign-in screen and the user menu |
| Whether authentication is on | `authentication` in `/api/server/info` and `/api/auth/me` | — | — |
| User management | `/api/users` and an ontology's `access` | — | the Users page and the Studio's Access page |

Routes, the challenge and the refusals: [../interfaces.md](../interfaces.md#sign-in).
Screens and the controls each role sees:
[../product-surface.md](../product-surface.md#signing-in).
