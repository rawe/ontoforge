---
name: ontoforge-sync
description: "Export and import OntoForge schema and instance data. Use when the user wants to export or import their global schema (entity types, relation types, ontologies) and/or instance data (entities, relations) via JSON files."
---

# Goal

Export and import the complete OntoForge schema and instance data via the REST API. Schema and data are separate concerns handled by dedicated scripts, and must be imported in the correct order.

## Prerequisites

- **Node.js 18+** (uses built-in `fetch`, no external dependencies)
- **OntoForge server running** at the configured base URL

## Environment

All scripts resolve the server URL in this order:

1. `--base-url <URL>` flag
2. `ONTOFORGE_BASE_URL` environment variable
3. Default: `http://localhost:8000`

## Commands

All paths below are relative to this skill directory (`scripts/`).

### Export Schema

Export the complete global schema (entity types, relation types, ontologies with scopes, AI agents, saved queries) to a single JSON file.

```bash
node scripts/export-schema.mjs [-o <output>] [--base-url <url>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-o, --output` | `./ontoforge/schema.json` | Output file path |
| `--base-url` | see Environment | OntoForge server URL |

**API used**: `GET /api/model/export`

The output file is the standard OntoForge transfer format (v2.2) and can be committed to version control.

### Import Schema

Import a schema JSON file into the database. **Requires a fresh database** — the API rejects any type or ontology key that already exists.

```bash
node scripts/import-schema.mjs <file> [--base-url <url>]
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `<file>` | yes | Path to schema JSON file |
| `--base-url` | no | OntoForge server URL |

**API used**: `POST /api/model/import`

Prints the created ontology keys on success.

### Export Data

Export all instance data (entities and relations) to a JSON file.

```bash
node scripts/export-data.mjs [-o <output>] [--base-url <url>] [--ontology-key <key>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-o, --output` | `./ontoforge/data.json` | Output file path |
| `--base-url` | see Environment | OntoForge server URL |
| `--ontology-key` | auto-detected | Ontology key for runtime API access |

If `--ontology-key` is omitted, the script picks an unscoped ontology automatically. An **unscoped ontology** (one without INCLUDES_TYPE edges) grants access to all entity types and relation types — use one for a complete export. A scoped ontology will only export the subset it can see.

**API used**: `GET /api/model/export` (for type discovery), `GET /api/runtime/{key}/entities/{type}` and `/relations/{type}` (paginated, max 200 per page)

### Import Data

Import instance data from a JSON file, automatically remapping entity IDs.

```bash
node scripts/import-data.mjs <file> [--base-url <url>] [--ontology-key <key>]
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `<file>` | yes | Path to data JSON file |
| `--base-url` | no | OntoForge server URL |
| `--ontology-key` | no (auto-detected) | Ontology key for runtime API access |

The import creates all entities first (building a map from old IDs to new IDs), then creates all relations using the remapped IDs. Relations referencing unknown entities are skipped with a warning.

**API used**: `POST /api/runtime/{key}/entities/{type}`, `POST /api/runtime/{key}/relations/{type}`

### Rebuild Embeddings

Regenerate all embedding vectors for semantic search. Run this after data import, after changing the embedding model, or to repair missing indexes.

```bash
node scripts/rebuild-embeddings.mjs [--base-url <url>]
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--base-url` | no | OntoForge server URL |

**API used**: `POST /api/model/rebuild-embeddings`

Streams progress to stderr. On completion, prints a per-type summary. Returns a `422` error if the embedding provider is not configured on the server.

## Ordering Rules

1. **Schema before data.** The schema defines entity types and relation types. Data cannot be imported until the schema exists.
2. **Entities before relations.** The data import script handles this automatically.
3. **Rebuild embeddings after data import.** Semantic search requires embedding vectors. Run `rebuild-embeddings.mjs` after importing data.
4. **Fresh database for schema import.** The schema import API does not support overwrite. If the database already has types or ontologies with the same keys, the import will fail with a 409 Conflict. To re-import, reset the database first (e.g. `docker compose down -v && docker compose up -d`).

## Typical Workflows

### Bootstrap a new project from an existing schema

```bash
# 1. Start OntoForge
docker compose up -d

# 2. Wait for PostgreSQL to be ready (health check)

# 3. Import schema
node scripts/import-schema.mjs ./ontoforge/schema.json

# 4. Optionally import seed data
node scripts/import-data.mjs ./ontoforge/data.json

# 5. Rebuild embeddings for semantic search
node scripts/rebuild-embeddings.mjs
```

### Snapshot the current state for version control

```bash
# Export schema (always do this)
node scripts/export-schema.mjs -o ./ontoforge/schema.json

# Export data (if instance data should be versioned too)
node scripts/export-data.mjs -o ./ontoforge/data.json
```

## File Formats

### Schema file (v2.2)

Standard OntoForge transfer format produced by `GET /api/model/export`:

```json
{
  "formatVersion": "2.2",
  "entityTypes": [
    {
      "key": "person",
      "displayName": "Person",
      "properties": [
        { "key": "name", "displayName": "Name", "dataType": "string", "required": true }
      ]
    }
  ],
  "relationTypes": [
    {
      "key": "knows",
      "displayName": "Knows",
      "fromEntityTypeKey": "person",
      "toEntityTypeKey": "person",
      "properties": []
    }
  ],
  "ontologies": [
    {
      "key": "my_ontology",
      "name": "My Ontology",
      "includes": null,
      "aiAgents": [],
      "savedQueries": []
    }
  ]
}
```

An ontology with `"includes": null` is **unscoped** and sees all types. An ontology with includes lists specific type keys and optionally restricts visible properties.

### Data file (v1.0)

Instance data grouped by type key:

```json
{
  "formatVersion": "1.0",
  "exportedAt": "2025-01-01T00:00:00.000Z",
  "entities": {
    "person": [
      { "_id": "abc123", "_entityTypeKey": "person", "name": "Alice" }
    ]
  },
  "relations": {
    "knows": [
      { "_id": "rel456", "_relationTypeKey": "knows", "fromEntityId": "abc123", "toEntityId": "def789" }
    ]
  }
}
```

On import, `_id`, `_entityTypeKey`, `_relationTypeKey`, `_createdAt`, and `_updatedAt` are stripped. Entity IDs in relations are remapped to the newly created IDs.

## Related Skills

- **ontoforge-setup** — Bootstrap a project with Docker Compose, environment variables, and MCP configuration.
- **ontoforge-runtime-api** — Build against the OntoForge runtime REST API.
