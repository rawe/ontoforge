---
name: ontoforge-okf
description: "Sync Markdown documents with YAML frontmatter (Google's Open Knowledge Format, OKF) with OntoForge entities. Use when the user wants to push a Markdown/OKF file into OntoForge as an entity, or pull an entity back to a Markdown file — frontmatter maps to properties, the body maps to the document property."
---

# Goal

Move single concept documents between an OKF bundle (a directory of Markdown files with YAML frontmatter) and OntoForge entities — without the document content ever passing through the LLM context. The agent edits files with its normal file tools and runs one command to sync; interactive queries and in-place edits stay on the OntoForge MCP tools.

**Mapping** (one file = one entity):

| OKF concept document | OntoForge entity |
|----------------------|------------------|
| File path without `.md` (the concept ID) | `conceptId` property (the natural key) |
| Frontmatter `type` | Entity type key (via optional `typeMap`) |
| Other frontmatter keys (`title`, `tags`, …) | Scalar properties of the same name |
| Markdown body | The entity type's `document` property |
| `index.md`, `log.md` | Reserved by OKF — rejected as concepts |

## Prerequisites

- **Node.js 18+** (built-in `fetch`, no external dependencies)
- **OntoForge server running** at the configured base URL
- **Entity types prepared for OKF** (see Schema Requirements below)

## Environment

All scripts resolve the server URL in this order:

1. `--base-url <URL>` flag
2. `ONTOFORGE_BASE_URL` environment variable
3. Default: `http://localhost:8000`

## Bundle Root and Config

The concept ID is the file path **relative to the bundle root**, so root resolution matters. Scripts resolve it as: `--root` flag > directory containing `okf.config.json` (found by walking up from the pushed file, or from the current directory for pulls) > current directory.

An optional `okf.config.json` at the bundle root holds the mapping config:

```json
{
  "ontology": "main",
  "conceptIdProperty": "conceptId",
  "documentProperty": null,
  "typeMap": { "table": "db_table" },
  "listProperties": ["tags"],
  "listDelimiter": ", "
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `ontology` | — | Ontology key for runtime API access (or pass `--ontology`) |
| `conceptIdProperty` | `conceptId` | String property holding the concept ID (natural key) |
| `documentProperty` | auto-detect | Which document property holds the body; only needed when a type has several |
| `typeMap` | `{}` | Frontmatter `type` value → entity type key (identity when absent) |
| `listProperties` | `["tags"]` | String properties serialized as YAML lists (joined/split with `listDelimiter`) |
| `listDelimiter` | `", "` | Delimiter used to store list values in a string property |

## Commands

All paths below are relative to this skill directory (`scripts/`).

### Push (file → entity)

```bash
node scripts/okf-push.mjs <file.md> [<file.md> ...] [--ontology <key>] [--root <dir>] [--config <path>] [--type <entityTypeKey>] [--skip-unknown] [--base-url <url>]
```

Parses the file, resolves the entity type from frontmatter `type` (or `--type` override), looks the entity up by concept ID, then creates it (`POST`) or updates it (`PATCH`). Idempotent — pushing the same file twice yields one entity.

- Frontmatter keys without a matching property definition fail the push with a list of the missing keys; `--skip-unknown` downgrades this to a warning and drops them.
- On update, the file is treated as the **full representation**: declared properties absent from the frontmatter are cleared. Removing a required property's key from the frontmatter therefore fails server-side.
- Multiple files are pushed in one invocation (shell globs work); failures are reported per file and the exit code is non-zero if any failed.

**API used**: `GET /schema/entity-types/{key}`, `GET /entities/{type}?filter.<conceptIdProperty>=…`, `POST /entities/{type}`, `PATCH /entities/{type}/{id}` (all under `/api/runtime/{ontology}`)

### Pull (entity → file)

```bash
node scripts/okf-pull.mjs <conceptId|file.md> [--type <entityTypeKey>] [--ontology <key>] [--root <dir>] [-o <file>] [--base-url <url>]
node scripts/okf-pull.mjs --id <entityId> --type <entityTypeKey> [...]
```

Finds the entity by concept ID (searching the given `--type`, or every entity type that has both a concept-ID and a document property), fetches it with a fields projection so the document value arrives raw instead of as a stub, and writes `<root>/<conceptId>.md`. Frontmatter keys are emitted in OKF's reserved order (`type`, `title`, `description`, `resource`, `tags`, `timestamp`) followed by extension keys alphabetically — output is deterministic, so repeated pulls produce clean git diffs.

- If the same concept ID exists on several entity types, the pull aborts and lists the candidates — disambiguate with `--type`.
- `--id` pulls a specific entity directly; the file path is derived from its concept-ID property.
- `-o` overrides the output path.

**API used**: `GET /schema/entity-types`, `GET /entities/{type}?filter.…&fields=_id`, `GET /entities/{type}/{id}?fields=…`

## Schema Requirements

Each entity type used for OKF concepts needs, in the modeling schema:

1. A **string property for the concept ID** (default name `conceptId`), ideally required — it is the natural key for idempotent pushes.
2. Exactly one **`document` property** for the Markdown body (or several plus `documentProperty` in the config).
3. **One scalar property per frontmatter key** you want to store: `title`, `description`, `resource` as `string`; `tags` as `string` (stored delimited, rendered as a YAML list); `timestamp` as `datetime`; extension keys as needed.

## Frontmatter Support

The parser covers the flat YAML subset OKF uses: plain/quoted scalars, numbers, booleans, `null`, inline lists (`[a, b]`), and block lists. Nested mappings and block scalars (`|`, `>`) are rejected with a clear error. Values are coerced against the property's declared data type; YAML lists are only accepted for string properties (joined with `listDelimiter`).

## Limitations

- One document property per concept: additional document properties on the same type have no OKF representation and are skipped on pull, left untouched on push.
- Markdown links between concepts are preserved inside the body but are **not** materialized as OntoForge relations.
- Whole-bundle import/export, `index.md` generation, and schema bootstrap are Layer 3 of that same proposal, not part of this skill yet.

## Testing

```bash
node --test scripts/codec.test.mjs
```

Covers frontmatter parsing, payload mapping, serialization order/quoting, and byte-identical round-trips.

## Related Skills

- **ontoforge-sync** — Whole-database schema and instance-data export/import as JSON.
- **ontoforge-setup** — Bootstrap a project with Docker Compose and MCP configuration.
- **ontoforge-runtime-api** — Build against the OntoForge runtime REST API.
