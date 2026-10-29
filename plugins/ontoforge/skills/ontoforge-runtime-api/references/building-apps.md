# Building Applications on OntoForge

How an application talks to an OntoForge server through the runtime API. The endpoint
contract itself is [runtime-api.md](runtime-api.md); this file covers what surrounds the
calls. [ontoforge-client.mjs](../templates/ontoforge-client.mjs) implements every pattern
below and is the starting point to copy.

## Connecting

An application needs four values, all configuration, none hard-coded:

| Value | Default variable | Notes |
|---|---|---|
| Base URL | `ONTOFORGE_BASE_URL` | The address the API is served at; default `http://localhost:8000`, the local server |
| Ontology key | `ONTOFORGE_ONTOLOGY` | No default on the server |
| Lens key | `ONTOFORGE_LENS` | No default on the server |
| Token | `ONTOFORGE_API_TOKEN` | Only when authentication is enabled |

These are the plugin's [connection](../../../CONNECTION.md) variables. Server and token
are independent: a local or a remote server, either with or without authentication
enabled. When it is enabled, every request — REST and MCP alike — needs
`Authorization: Bearer <token>`, and is answered `401` without a matching one. The same
application therefore runs in all four cases without a code change.

Use the variable names above unless the application already has a configuration
mechanism — a settings module, a secret manager, a framework's config files — in which
case read the four values from there. Either way:

- The token is read at run time from configuration and passed to the client. It never
  appears in source, tests, fixtures, logs, error messages or the conversation.
- Ship a `.env.example` (or the mechanism's equivalent) listing the four names with the
  token left empty, and make sure the real file is gitignored.
- Send the token only to the base URL. Refuse redirects while it is set
  (`redirect: 'manual'` on `fetch`), so it is never forwarded to another host.
- Over plain `http` to anything but `localhost`, the token travels in clear text; use
  `https` for a remote server.

### Browser applications

With authentication enabled, keep the token out of the browser: a token shipped to the
browser is readable by every user, and the CORS preflight (`OPTIONS`, which carries no
`Authorization`) is answered `401`, so the real request is never sent. Put a small
backend in front: the browser calls the application's own server, which holds the token
in its configuration and forwards to OntoForge. Without authentication, OntoForge allows
any origin, and a browser can call it directly.

## Typing an application from the schema

The server's `/openapi.json` describes paths and query parameters, but entity and
relation bodies there are generic objects: their shape is the ontology's schema, which
the OpenAPI document does not know. Type the application from `GET /schema` instead —
it answers `{ lens, entityTypes, relationTypes }` already filtered to the lens. Per
property, `key`, `dataType` and `required` give the field:

| `dataType` | TypeScript | JSON on the wire |
|---|---|---|
| `string` | `string` | string |
| `integer` | `number` | integer (strings parsing as one are accepted on write) |
| `float` | `number` | number |
| `boolean` | `boolean` | boolean |
| `date` | `string` | ISO calendar date |
| `datetime` | `string` | ISO date-time |
| `document` | `string` on write, `{ document: true, length: number }` on read | read the content with the documents route |

Every entity read also carries `_id`, `_entityTypeKey`, `_createdAt` and `_updatedAt`,
plus a read-only `_identity` string when its type declares an identity (see
[runtime-api.md](runtime-api.md#entity-identity)); a relation carries `_id`, `_relationTypeKey`, `fromEntityId` and `toEntityId`.
Generate the types once from the live schema and regenerate when the schema changes;
the lens a scoped application uses decides which types and properties exist for it.

## Patterns

**Paging.** Lists answer `{ items, total, limit, offset }` with `limit` at most 200.
Loop on `offset` until `offset + items.length >= total` (`allEntities` in the template).

**Writing many objects.** Immediate writes are one object per request, and a failure
midway leaves what was already written. For many objects, start a changeset
(`POST …/changesets`), stage up to 1,000 calls per `POST …/changesets/{changesetId}/writes`
— entities before the relations that name them — and commit it
(`POST …/changesets/{changesetId}/commit`), which persists all of it or nothing. A
`put_entity` updates the entity whose identity its values build, or creates it, so a
rerun does not duplicate. A changeset holds 10,000 objects by default: commit and start
another when the server answers that it is full.

**Reading after writing.** CRUD reads see a write at once. Search does not: index
entries are built in the background, so a new or changed entity reaches `GET /search`
and `POST /search` a moment later. Do not assert on search results right after a write.

**Long text.** `document` properties come back as a stub on every entity read. Fetch the
content with `GET .../documents/{propertyKey}`, by character range for large texts, and
edit it in place with `PATCH .../documents/{propertyKey}` rather than rewriting the
entity.

**Chat.** A chat answers NDJSON, one event per line. Keep the `threadId` from the first
`thread` event and send it with the next message; the server holds the conversation.
Render `delta` text as it arrives, and treat `final` or `error` as the end — a stream
that ends without one is an incomplete turn. `409` with `details.code` `THREAD_BUSY`
means the previous message on that thread is still running; `404` with
`THREAD_NOT_FOUND` means the thread expired, so start a new one. Ignore event types the
application does not know.

**Optional features.** Read `GET /api/server/features` once at start-up and hide what
the deployment lacks — semantic search, AI assistants, saved-query discovery, entity
identity comparison. A call to an absent feature answers `422` with `details.code`
`FEATURE_DISABLED`; branch on that rather than reporting a bad request.

**Errors.** OntoForge errors use one envelope, `{ error: { code, message, details } }`,
with six top-level codes; `details.fields` names each rejected field or filter, so one
rejection is enough to correct the next attempt. A `401` for a missing or wrong token has no envelope.
`STORAGE_ERROR` carries only an `errorId` to quote to whoever runs the server.

## Checking the connection

There is no health endpoint. `GET /api/server/info` is the cheapest real request: it
answers the server version, proves the token when authentication is enabled, and touches no
ontology. Follow it with `GET .../schema` to prove the ontology and lens keys.
