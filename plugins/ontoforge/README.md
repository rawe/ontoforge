# OntoForge Plugin

A plugin for AI coding assistants (Claude Code and OpenAI Codex) that provides OntoForge skills for ontology schema management, project setup and building applications on the runtime API — against a local or a remote server, with or without authentication enabled.

## Ontologies and lenses

One OntoForge server holds many **ontologies** — isolated units, each with its own schema, lenses, saved queries, agents and instance data. Nothing spans two. A **lens** is a named view over one ontology's schema; instance data is read and written through one.

Every skill here works against one ontology at a time, and every skill that touches instance data also names a lens. Neither has a default, so both are explicit inputs — a flag or an environment variable for `ontoforge-sync`, `okf.config.json` for `ontoforge-okf`, and the mount URL for the MCP servers `ontoforge-setup` configures.

## Connection

Every skill works against a **local** OntoForge — the one `ontoforge-setup` runs with Docker Compose at `http://localhost:8000` — or a **remote** one at a base URL you are given. Separately, the server may have authentication enabled, and then needs a Bearer token. Two variables cover all four combinations:

| | No authentication | Authentication enabled |
|---|---|---|
| Local | nothing to set | `ONTOFORGE_API_TOKEN` |
| Remote | `ONTOFORGE_BASE_URL` | `ONTOFORGE_BASE_URL` and `ONTOFORGE_API_TOKEN` |

Scripts also accept both from a connection profile named by `ONTOFORGE_ENV_FILE`, and print the server they use first. The MCP configuration and the applications built with `ontoforge-runtime-api` read the same variables. The assistant never reads, prints or writes the token's value. The full contract — resolution order, profiles, token handling — is [CONNECTION.md](CONNECTION.md).

## Skills

### ontoforge-sync

Export and import one ontology's design and instance data via the REST API.

- **Design export/import**: save and restore one ontology's schema, lenses, assistants and saved queries as JSON, in the server's own transfer format
- **Data export/import**: save and restore instance data (entities, relations) with automatic ID remapping — this is the only instance-data export there is, since the transfer format carries the design alone
- **Search-data rebuild**: regenerate one ontology's keyword text, document passages and semantic vectors, with streamed progress
- Resolves the ontology key from `--ontology` or `ONTOFORGE_ONTOLOGY`, and stops with a clear message when neither is set
- Uses Node.js 18+ with built-in `fetch` — no external dependencies

### ontoforge-okf

Sync Markdown documents with YAML frontmatter (Google's [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)) with OntoForge entities — one file, one entity.

- **Push**: `okf-push.mjs <file.md>` turns a concept document into an entity — frontmatter keys become scalar properties, the Markdown body becomes the `document` property, the file path becomes the concept ID (natural key). Idempotent: re-pushing updates instead of duplicating.
- **Pull**: `okf-pull.mjs <conceptId>` writes an entity back to `<conceptId>.md` with deterministic frontmatter ordering for clean git diffs.
- Document content moves filesystem ↔ API directly, never through an LLM context — use it alongside the MCP tools, not instead of them.
- `okf.config.json` at the bundle root carries the per-bundle state: the ontology key, the lens key, the type mapping and the list-property handling. Only the server URL stays per-developer, in `ONTOFORGE_BASE_URL`.

See [SKILL.md](skills/ontoforge-okf/SKILL.md) for the full usage reference, schema requirements, and the supported YAML subset.

### ontoforge-document

Upload a file's contents verbatim into a `document` property of an existing entity, and download it back byte for byte — one file, one property, one entity.

- **Upload**: `ontoforge-doc.mjs upload <file> --type <key> (--id <uuid> | --where <field>=<value>)` replaces the property's content with the file's, as a plain `PATCH` on that one field.
- **Download**: the same call with `download` writes the property back to a file, reading through `GET .../documents/<field>` because ordinary entity reads return a document stub, not the text.
- Reads the schema rather than guessing: an unknown type or property yields the list of valid keys, and the `document` property is auto-selected when the type has exactly one.
- It never creates entities and touches no property but the named one: the target entity must already exist. Nothing is parsed out of the file — no frontmatter, no schema mapping, no config file.

### ontoforge-setup

Set up a project to work with OntoForge in one of two modes: **local** — run OntoForge with Docker Compose — or **remote** — connect to an existing server at a base URL. Both end in the same MCP configuration.

When invoked, the skill interactively gathers requirements and generates:

1. **`docker-compose.yml`** (local mode) — PostgreSQL (the database used by OntoForge's default storage adapter), OntoForge server, and OntoForge UI, with optional Ollama for local embeddings.
2. **`.env`** (local mode, optional) — the server's environment variables for secrets and local overrides.
3. **`.mcp.json`** (both modes) — Claude Code MCP configuration pointing to the OntoForge modeling and runtime servers, local by default, any server when `ONTOFORGE_BASE_URL` is set.

The skill uses bundled templates as starting points and adapts them based on user input. It never invents environment variables — only the ones recognized by OntoForge are used.

### ontoforge-runtime-api

Help an agent build applications, `curl` calls, clients and integrations against the OntoForge runtime REST API under `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`. It bundles the endpoint contract (filter and projection syntax, streams, the error envelope, what the surface does not offer), an app-building guide (configuration and the token, typing from the lens schema, paging, chat streams, browser apps) and a dependency-free client module to copy into an application. Beyond runtime it makes only the two lookups that find the keys: listing ontologies and listing an ontology's lenses.

## Installation

### Claude Code

From a repository that has the OntoForge marketplace configured:

```bash
claude plugin install ontoforge
```

### OpenAI Codex

Load the plugin directory directly:

```
plugins/ontoforge/
```

## Templates

The setup skill ships two templates under `skills/ontoforge-setup/templates/`:

| File | Contents |
| --- | --- |
| `docker-compose.yml` | Full OntoForge stack (PostgreSQL + server + UI) with commented embedding and Ollama config |
| `mcp.json` | MCP server entries for modeling and runtime; base URL and Bearer token from the environment, local server without a token by default |

The runtime skill ships `skills/ontoforge-runtime-api/templates/ontoforge-client.mjs`, a starting point for application code.

## Tests

```bash
node --test plugins/ontoforge/skills/ontoforge-sync/scripts/connection.test.mjs
node --test plugins/ontoforge/skills/ontoforge-okf/scripts/codec.test.mjs
```

`connection.mjs` is copied into every skill that has scripts, so each skill stays self-contained; the connection test fails when the copies differ.

## Environment Variables

The setup skill only uses variables that OntoForge actually reads. See the full reference in the [SKILL.md](skills/ontoforge-setup/SKILL.md#ontoforge-server-environment-variables).

## Embedding Providers

OntoForge supports two embedding providers for semantic search:

- **Ollama** (`EMBEDDING_PROVIDER=ollama`) — local, no API key needed.
- **OpenAI-compatible** (`EMBEDDING_PROVIDER=openai`) — works with OpenAI, Azure OpenAI, vLLM, LM Studio. Requires `EMBEDDING_API_KEY`.

Both default to model `bge-m3` at 1024 dimensions; `EMBEDDING_DIMENSIONS` must match the model you configure.

Omit `EMBEDDING_PROVIDER` entirely to disable semantic search.
