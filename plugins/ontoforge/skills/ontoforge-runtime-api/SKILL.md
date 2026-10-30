---
name: ontoforge-runtime-api
description: "Use when the user builds an application, service, integration, script or frontend on top of an OntoForge server, or needs curl calls, API clients, request payloads, query parameters or endpoint selection for the runtime REST API under /api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}. Covers local and remote servers, with Bearer token authentication when it is enabled. Does not cover schema design on the modeling API or managing ontologies."
---

# Goal

Help the user build correct applications and calls against the OntoForge **runtime REST
API**: instance data, search, queries and assistants of one ontology, read and written
through one lens.

Do not use this skill for schema design, which lives on the modeling surface under
`/api/ontologies/{ontologyKey}/model/...`, or for creating, renaming or deleting
ontologies, which is the registry at `/api/ontologies`.

## References

- [runtime-api.md](references/runtime-api.md) — the endpoint contract: paths, filter and
  projection syntax, streams, the error envelope, and what runtime does not offer. Read it
  first for any call.
- [building-apps.md](references/building-apps.md) — connecting, configuration and the
  token, typing an application from the schema, paging, chat streams, error handling,
  browser apps. Read it before writing application code.
- [templates/ontoforge-client.mjs](templates/ontoforge-client.mjs) — a dependency-free
  client module to copy into an application and adapt.

## Ontology and lens

Every runtime call names two keys, and confusing them is the most common mistake against
this surface:

- **Ontology** — the isolated unit that owns a schema, its lenses and all of its instance
  data. Nothing spans two ontologies.
- **Lens** — a named view over one ontology's schema. Runtime reads and writes instance
  data through a lens, which may expose the whole schema or only part of it.

The base path is `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`. There is no
default ontology and no default lens. When the user does not name them, look them up with
the two read-only calls `GET /api/ontologies` and
`GET /api/ontologies/{ontologyKey}/model/lenses` and ask which to use; these lookups are
the only registry and modeling calls this skill makes.

## Connecting

The server may be local — the Docker Compose setup at `http://localhost:8000` — or remote,
at a base URL the user is given; either may have authentication enabled, and then every
request needs `Authorization: Bearer <token>`. Which server and which token is the
plugin's [connection contract](../../CONNECTION.md), including how the token is handled
without ever being read or printed. Follow it for every call you make yourself.

What you build follows the same contract, so it runs against a local and a remote server
without a code change:

- Generated code reads `ONTOFORGE_BASE_URL` (default `http://localhost:8000`) and, when
  set, `ONTOFORGE_API_TOKEN` from the application's configuration at run time — or the
  application's own configuration mechanism, when it has one. Never a literal.
- Ship a `.env.example` (or the equivalent) with an empty token placeholder, make sure the
  real file is gitignored, and tell the user where to put the value.
- In a `curl` example, reference the variables, never values:
  `"$ONTOFORGE_BASE_URL/..."` and `-H "Authorization: Bearer $ONTOFORGE_API_TOKEN"`.
- To run what you built against a server with authentication enabled, rely on the token
  already being set in the environment you run in. If it is not, ask the user to set it
  before starting the assistant — do not work around its absence.

A `401` means the token is missing or wrong. It carries no OntoForge error envelope.

## Workflow

1. Resolve the server — local or remote — the ontology key and the lens key, and whether
   authentication is enabled.
2. Read the live deployment: `GET /api/server/info` (version) and
   `GET /api/server/features` (search strategies, AI, decisions). Build nothing on search,
   saved-query discovery, AI or decisions that the probe says is absent.
3. Read the lens's schema — `GET /schema` — before generating writes, queries or types.
   It is already filtered to the lens, so what it omits is not reachable through it.
4. Map the request to the narrowest endpoint family in `references/runtime-api.md`. The
   server's `/openapi.json` (and `/docs`) gives the path and query-parameter shape of the
   running version; entity bodies there are generic because they follow the schema.
5. Preserve documented filter syntax exactly: `filter.{key}` and `filter.{key}__{op}`;
   on entity lists and search `{key}` may also be a query path, or under `__exists` /
   `__missing` a bare relation type, whose rules are in the reference. Repeat `fields`
   rather than comma-separating it.
6. Set `Content-Type: application/json` on JSON `POST` and `PATCH` requests.
7. For application code, follow `references/building-apps.md`.

## Choosing a surface

| The application needs | Use |
|---|---|
| Its own UI or service over the data | Runtime REST, through a client like the template |
| An LLM tool-user (Claude Code, an agent framework) to read and write the data | The runtime MCP server at `/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`, with the same Bearer header when authentication is enabled; `ontoforge-setup` writes its configuration |
| Natural-language answers over the data without its own model | The assistant chat routes under `/ai/assistants/...` |

## Boundaries

- Runtime only: schema introspection, entity CRUD, document reads and partial writes,
  relation CRUD, neighbors, search (entity search, passage search and the search
  catalog), OQL query, saved query listing/search/run, entity identity comparison,
  the assistant endpoints (list, chat on server-held threads, thread read, retrieve), and
  the deployment reads `GET /api/server/info` and `GET /api/server/features`.
- Not modeling: creating or changing entity types, relation types, properties or lenses;
  defining saved queries; configuring assistants (agents, retrievers and navigators);
  defining search indices; schema export and import; rebuilding search data. Listing
  lenses is the one modeling read this skill makes.
- Not the registry: creating, renaming or deleting ontologies. Listing them is the one
  registry read this skill makes.
- Absent everywhere: there is no data-wipe endpoint, no immediate bulk write (many
  writes are staged in a changeset, see the references), no instance-data export and no
  health endpoint. Do not generate calls for them.

## Output Style

When answering:
- name the exact endpoint first
- include the ontology key and lens key in the path
- include required path parameters
- include relevant query parameters
- include the JSON body when applicable
- include the Bearer header as a variable reference when authentication is enabled
- then produce the requested artifact: `curl`, client code, fetch wrapper, SDK helper,
  typed interface or application
