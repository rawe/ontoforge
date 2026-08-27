---
name: ontoforge-okf
description: "Sync Markdown documents with YAML frontmatter (Google's Open Knowledge Format, OKF) with OntoForge entities. Use when the user wants to push a Markdown/OKF file into OntoForge as an entity, or pull an entity back to a Markdown file — frontmatter maps to properties, the body maps to the document property."
---

# Goal

Move OKF concept documents between a bundle on disk and OntoForge entities without the document content ever passing through the LLM context. The agent edits files with its normal file tools and runs one command to sync; interactive queries and in-place edits stay on the OntoForge MCP tools.

## Mapping

One file, one entity.

| OKF concept document | OntoForge entity |
|----------------------|------------------|
| File path without `.md`, relative to the bundle root — the **concept ID** | The concept-ID property (default `concept_id`) |
| Frontmatter `type` | Entity type key, resolved through the `typeMap` in `okf.config.json` |
| Other frontmatter keys | Scalar properties of the same name |
| Markdown body | The entity type's `document` property |
| `index.md`, `log.md` | Reserved by OKF — rejected as concepts |

The concept ID alone identifies a document. Push and pull resolve it the same way, so the same file always reaches the same entity, and the same entity always returns to the same file.

## Prerequisites

- **Node.js 18+** — built-in `fetch`, no dependencies
- **`ONTOFORGE_BASE_URL`** naming a running OntoForge server. It is per-developer, so it stays out of the bundle
- **`okf.config.json` at the bundle root**, naming the ontology and mapping every `type` value to an entity type
- **Entity types** carrying a concept-ID property and a document property

**Missing `okf.config.json`, or an ontology with no entity types for this bundle? → [references/setup.md](references/setup.md)**

## Commands

Both commands take a file path and locate the bundle from it: the nearest `okf.config.json` at or above the file's directory marks the bundle root, and the concept ID is the file path relative to that root. The working directory plays no part, so the same file always yields the same concept ID.

Invoke the scripts by their path inside this skill directory.

### Push (file → entity)

```bash
node scripts/okf-push.mjs <file.md> [<file.md> ...] [--skip-unknown]
```

Parses each file, resolves the entity type from frontmatter `type`, looks the concept ID up across every mapped entity type, then creates (`POST`) or updates (`PATCH`). Pushing the same file twice yields one entity.

- Frontmatter keys with no matching property fail the push, naming the missing keys. `--skip-unknown` downgrades this to a warning and drops those keys.
- On update the file is the **full representation**: declared properties absent from the frontmatter are cleared. Removing a required property's key therefore fails server-side.
- A concept ID already stored under a different entity type is a conflict. An entity cannot change type — delete the stored entity, then push again.
- Several files go in one invocation (shell globs work). Failures are reported per file and the exit code is non-zero if any failed.

**API used**: `GET /schema/entity-types`, `GET /entities/{type}?filter.<concept-ID property>=…`, `POST /entities/{type}`, `PATCH /entities/{type}/{id}` (all under `/api/runtime/{ontology}`)

### Pull (entity → file)

```bash
node scripts/okf-pull.mjs <file.md>
```

Derives the concept ID from the path, finds the entity across every mapped entity type, fetches it with a fields projection so the document value arrives raw instead of as a stub, and writes the file. The file need not exist yet. Frontmatter keys are written alphabetically, so repeated pulls of the same concept are byte-identical and produce clean git diffs.

A concept ID that exists more than once aborts the pull and lists the entities, because the concept ID is meant to be unique.

**API used**: `GET /schema/entity-types`, `GET /entities/{type}?filter.…&fields=_id`, `GET /entities/{type}/{id}?fields=…`

## Frontmatter Support

The parser covers the flat YAML that OKF concepts use: plain and quoted scalars, numbers, booleans, `null`, inline lists (`[a, b]`) and block lists of scalars. Values are coerced against the property's declared data type; YAML lists map onto string properties, joined into one string with the configured delimiter.

Nested mappings — `generated: { by: …, at: … }`, `sources:` with indented entries — raise an error naming the offending line. Block scalars (`|`, `>`) do the same.

## Limitations

- One document property per concept. Further document properties on the same type are skipped on pull and left untouched on push.
- Markdown links between concepts stay inside the body. They become no OntoForge relations.
- Renaming or moving a file changes its concept ID, so the next push creates a second entity and leaves the first in place.
- Whole-bundle import and export, `index.md` generation and schema bootstrap are not part of this skill.

## Testing

```bash
node --test scripts/codec.test.mjs
```

Covers config validation, frontmatter parsing, payload mapping, serialization order and byte-identical round-trips.

## Related Skills

- **ontoforge-sync** — whole-database schema and instance-data export/import as JSON.
- **ontoforge-setup** — bootstrap a project with Docker Compose and MCP configuration.
- **ontoforge-runtime-api** — build against the OntoForge runtime REST API.
