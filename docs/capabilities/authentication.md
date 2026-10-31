# Authentication

When authentication is enabled, callers authenticate through an OpenID Connect provider.
OntoForge determines their permissions from roles assigned within OntoForge.
Authentication is disabled by default; in that mode, requests are trusted and role
checks are skipped.

[Access terminology](../glossary.md#access).
[Authentication and authorization architecture](../architecture.md#authentication-and-authorization).
[Authentication configuration](../../README.md#authentication).

## What it does

The provider authenticates callers; OntoForge determines their permissions. A
**principal** represents a person or service and is identified by a verified
issuer–subject pair, never by an email address or name. An **assignment** grants a
principal one role on the platform, on a specific ontology, or on a specific lens. A
principal without any assignments can sign in but has no access to ontologies or lenses.

All servers in a deployment must use the same authentication mode.

## Signing in

Three authentication methods resolve callers to principals:

- **The web client.** Sign-in redirects the browser to the provider and then back to the
  server. The server starts a session and redirects the browser to the original page.
  The server acts as the provider's client and stores the session; the browser stores
  only a session cookie. Sessions expire after the configured period of inactivity or
  24 hours after sign-in, whichever comes first. Each sign-in starts a new session.
  Signing out ends the session and redirects the browser to the provider's sign-out
  page, if available. State-changing requests authenticated by the session cookie must
  originate from the web client's address. Browser sign-in exists only when the deployment
  names that address; without it, callers use bearer tokens.
- **REST with a bearer token.** Send an access token issued by the provider for
  OntoForge's audience and required scope in the `Authorization` header using the
  `Bearer` scheme. OntoForge rejects ID tokens, tokens with an invalid issuer or
  audience, tokens missing the required scope, expired tokens, and tokens without a
  valid signature from the provider. When a request includes a bearer token,
  authentication uses that token alone and ignores any session cookie. This is how every
  other client calls OntoForge, including a frontend with a server side of its own that
  signs its users in at the provider and sends their tokens.
- **MCP over OAuth.** The MCP mounts take bearer tokens only. A client without one is told
  where to sign in, registers itself at the provider and signs its user in through the
  browser. Its token names OntoForge's audience only when the client asks for OntoForge's
  scope, which the mount advertises. Clients must connect through the server's public
  address because that address forms part of the OAuth resource identifier.

**First sign-in.** When a previously unknown sign-in identity first signs in, through the
browser or with a bearer token, OntoForge creates a principal without any roles, except
for the configured administrator described below. Concurrent first sign-ins for the
same sign-in identity create only one principal. Later sign-ins resolve the principal by its
issuer–subject pair. Browser sign-in updates the displayed name, email, and username.
Status and roles remain unchanged, except for the configured administrator described
below. Sign-in identities are never linked by email: a different issuer or subject value
identifies a different principal.

**The configured administrator.** The deployment configuration identifies one account
at the provider. On sign-in, OntoForge ensures that this principal is active and has the
Platform Administrator role. This creates the initial administrator and provides a
recovery path if the other administrators are locked out.

**Disabled principals.** Requests to protected resources are rejected when the principal
is disabled, whether authentication uses a bearer token or a session cookie. Browser
sign-in does not create a session and reports that the account is disabled. Signing in
does not reactivate the principal, except for the configured administrator described
above. Disabling an account or resetting its password at the provider does not
invalidate an existing OntoForge session. Disabling the principal in OntoForge prevents
further access to protected resources.

Each authenticated request to a protected resource loads the principal's current status
and role assignments, regardless of which server handles it. Changes take effect on the
next such request.

## Roles

| Role | Scope | Permissions |
|---|---|---|
| Platform Administrator | The platform | Grants full access to [user management](#user-management). Allows the principal to list every ontology and lens to assign roles, but does not itself grant access to designs or data. |
| Ontology Creator | The platform | Allows the principal to create ontologies. The creator is assigned the Ontology Administrator role on each new ontology. This role alone grants no access to other ontologies. |
| Ontology Administrator | One ontology | Grants full access to the ontology's design through all modeling routes and the modeling MCP mount, and to each lens's schema and search catalog on its runtime routes. Allows the principal to manage the ontology's rulesets, rename or delete the ontology, and grant Reader, Proposer or Writer roles on its lenses. Access to data requires a lens role, which the principal may assign to itself. |
| Reader | One lens | Allows read operations through the lens, including access to schema, data, documents, search, queries, saved queries, named searches, assistants, the principal's own threads, and changesets. Also grants read access to the lens's design and the ontology's rulesets. |
| Proposer | One lens | Grants all Reader permissions and allows proposing changes through changesets: starting them, staging writes into them, and checking, submitting, unsubmitting, and discarding them. Does not allow direct writes to data or documents, or committing a changeset; a Writer commits it. |
| Writer | One lens | Grants all Proposer permissions and allows all write operations permitted by the lens, including direct writes to data and documents and committing changesets. |

Role assignments are independent: holding one role does not automatically assign
another. On the same lens, a Proposer nevertheless has all Reader permissions, and a
Writer all Proposer permissions. A principal holds at most one of Reader, Proposer and
Writer on a lens; granting one replaces the one held before.

Each lens role allows exactly what one level of a ruleset's
[write access](rulesets.md#write-access-levels) allows: Reader `none`, Proposer
`propose`, Writer `full`. Its permissions remain subject to the lens's restrictions and,
on a ruleset mount, the [ruleset](rulesets.md) selected by the URL. The lower of the
role's and the ruleset's level applies. Agents remain read-only regardless of the
caller's role.

## What a caller sees

Requests for ontologies or lenses that the caller is not allowed to discover return
Not Found, just like requests for nonexistent resources. This avoids revealing their
keys. Platform Administrators can discover every ontology and lens; Ontology
Administrators can discover every lens in the ontologies they administer. If the caller
can discover a resource but lacks permission for the requested operation, the request
returns Forbidden. Examples include a Reader attempting a write, a Proposer attempting a
direct write or a commit, an ontology member
without the Ontology Administrator role reading the ontology's design, or an
administrator accessing data through a lens without a lens role.

The ontology list contains ontologies in which the caller holds an Ontology
Administrator role or a role on a lens; Platform Administrators see all ontologies. An
ontology's lens list contains lenses on which the caller holds a lens role; Platform
Administrators and that ontology's administrators see all its lenses. Holders of a lens
role see the runtime view of a lens's design, with unsupported inclusions omitted.
Ontology Administrators see the full design. A runtime MCP mount lists only the tools
its caller's role allows, as a ruleset of the role's level would
([Ruleset interfaces](rulesets.md#write-access-through-the-interfaces)): for a Reader
the reads, for a Proposer also the changeset tools but `commit_changeset`, with
`changeset_id` required on every write tool. A call the role does not allow is refused
as Forbidden, naming the role and, for a Proposer, the way round: stage the write into
a changeset, or submit the changeset for a Writer to commit.

Unauthenticated callers can access the authentication endpoints, the deployment
description (`/api/server`), health probes, the API documentation, and MCP resource
metadata. Protected endpoints reject requests without valid credentials.

## Ontologies and lenses

Creating an ontology requires the Ontology Creator role. The creator is assigned the
Ontology Administrator role on the new ontology. This assignment is stored before the
ontology is created; if storing it fails, creation is aborted. This prevents creation of
an ontology without an administrator. The modeling MCP tool `ensure_ontology` does not
create missing ontologies; use REST or the web client to create them.

Deleting an ontology or lens through any interface also removes its role assignments.
If a failure leaves an assignment behind, that assignment grants neither access to nor
visibility of the deleted resource. A role on a deleted lens has no effect. Recreating an
ontology or lens under the same key creates a new resource that does not inherit the
deleted resource's assignments.

## Threads and changesets

An assistant thread is associated with both its assistant and the principal that
started it. Other principals, including Writers on the same lens, cannot access it and
receive Not Found ([Threads](threads.md)). Changesets are shared within their lens:
Readers can read them; Proposers can also start them, stage changes, run checks, and
submit them; Writers can also commit them, a Proposer's included. All of it is subject to
the lens's and the selected ruleset's restrictions ([Changesets](changesets.md)).

## User management

User management is available only when authentication is enabled.

- A **Platform Administrator** can search for principals by name, email, or username;
  view all their role assignments; enable or disable them; register services using **Admit service**; and grant
  or revoke any role. Only Platform Administrators can grant the Ontology Administrator
  role or platform-level roles.
- An **Ontology Administrator** can also search for principals, but can view only their
  role assignments within the ontologies the administrator manages. The administrator
  can grant and revoke Reader, Proposer and Writer roles on those ontologies' lenses and
  list role assignments within each managed ontology.
- Principals cannot disable their own accounts. The last active Platform Administrator
  cannot be disabled or have that role revoked. The [configured administrator](#signing-in)
  is also protected: change the configured administrator's sign-in identity before disabling that
  principal or revoking its Platform Administrator role. Otherwise, sign-in would restore
  its active status and role.
- A **service** is a client that authenticates with its own credentials rather than a
  person's credentials. Like a person, it is represented by a principal. A Platform
  Administrator can use **Admit service** to register the service by its subject before
  its first request and assign roles in advance. Otherwise, its first request creates a principal without
  roles. The administrator can later convert that principal to a service principal,
  provided it still has no role assignments.
- Changes to principal status and role assignments are audited, including assignments
  removed when an ontology or lens is deleted. For changes made by a principal, the audit
  record identifies that principal.

Principals are never deleted. Accounts and passwords are managed at the provider.

## Authentication off

Requests are trusted without authentication or role checks; neither the provider nor
the access database is required. Lens and ruleset restrictions still apply. Sign-in,
user-management, and OAuth resource-metadata routes return Not Found rather than allowing
anonymous access. The `/api/auth/me` endpoint remains available and reports that
authentication is disabled. The web client hides sign-in, the user menu, and
access-management pages. Existing role assignments are retained for when authentication
is enabled again. Threads have no principal owner.

## Through the interfaces

| | REST | MCP | Web UI |
|---|---|---|---|
| Sign in and out, who is signed in | `/api/auth` | OAuth at the provider, discovered from the mount's challenge | the sign-in screen and the user menu |
| Whether authentication is on | `authentication` in `/api/server/info` and `/api/auth/me` | — | — |
| User management | `/api/users` and an ontology's `access` | — | the Users page and the Studio's Access page |

[Authentication endpoints](../interfaces/server.md#sign-in).
[Role-specific UI controls](../product-surface/README.md#signing-in).
