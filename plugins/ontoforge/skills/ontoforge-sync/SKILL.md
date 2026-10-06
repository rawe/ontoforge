---
name: ontoforge-sync
description: "Export and import one OntoForge ontology's design and instance data. Use when the user wants to snapshot or restore an ontology — its schema, lenses, agents and saved queries, and/or its entities and relations — as JSON files."
---

# Goal

Export and import one ontology via the REST API. Every script addresses exactly one
ontology, named by its key. Design and instance data are separate concerns handled by
dedicated scripts, and must be imported in that order.

## Prerequisites

- **Node.js 18+** (uses built-in `fetch`, no external dependencies)
- **OntoForge server running** at the configured base URL
- **An ontology to work against.** Nothing is auto-created and there is no default
  ontology — the key is a required input for every script.

## Environment

All scripts resolve the server URL in this order:

1. `--base-url <URL>` flag
2. `ONTOFORGE_BASE_URL` environment variable
3. Default: `http://localhost:8000`

and the ontology key in this order:

1. `--ontology <key>` flag
2. `ONTOFORGE_ONTOLOGY` environment variable

There is no default ontology. A script with no key resolved stops before calling the
server and names both inputs. List the server's ontologies with
`GET /api/ontologies`; create one with `POST /api/ontologies`.

## Ontologies and lenses

An **ontology** is the isolated unit: one schema, its lenses, its agents, its saved
queries and all of its instance data. Nothing spans two ontologies.

A **lens** is a named view over one ontology's schema. Instance data is only reachable
through a lens, so the two data scripts take a lens key as well. An **unscoped** lens
sees the whole schema and is the one to use for a complete export; a **scoped** lens
exposes only the types and properties it names, and exports only that subset.

Design operations — schema export and import, search-data rebuild — cover the whole
ontology and need no lens.

## Commands

All paths below are relative to this skill directory (`scripts/`).

### Export Schema

Export one ontology's design — entity types, relation types, properties, the keyword
language set, custom search indices, lenses with their inclusions, AI agents, retrievers
and saved queries — to a single JSON file.

```bash
node scripts/export-schema.mjs [-o <output>] [--ontology <key>] [--base-url <url>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-o, --output` | `./ontoforge/schema.json` | Output file path |
| `--ontology` | see Environment | Ontology key |
| `--base-url` | see Environment | OntoForge server URL |

**API used**: `GET /api/ontologies/{ontologyKey}/model/export`

The output file is the OntoForge transfer format (v6.0) and can be committed to version
control. It carries the design only — no entities, no relations, no document content,
and not the ontology's own key or display name. It is not a backup.

### Import Schema

Import a design JSON file into **one existing ontology**.

```bash
node scripts/import-schema.mjs <file> [--ontology <key>] [--base-url <url>]
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `<file>` | yes | Path to a transfer-format JSON file |
| `--ontology` | see Environment | Ontology key |
| `--base-url` | no | OntoForge server URL |

**API used**: `POST /api/ontologies/{ontologyKey}/model/import`

Import never creates its target. When the named ontology does not exist the script stops
and prints the registry call that creates it. Prints the imported lens keys on success.

The target may be bare or populated, but any entity type, relation type, lens or custom
search index key that already exists there blocks the whole import with a conflict naming
every clash. There is
no merge and no overwrite: resolve the clashes, or import into a bare ontology.

Because the payload carries no ontology identity, the same file imports into any
ontology under any key — which is how an ontology is cloned: export A, create B, import
into B.

### Export Data

Export one ontology's instance data (entities and relations) to a JSON file.

```bash
node scripts/export-data.mjs [-o <output>] [--ontology <key>] [--lens <key>] [--base-url <url>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-o, --output` | `./ontoforge/data.json` | Output file path |
| `--ontology` | see Environment | Ontology key |
| `--lens` | auto-detected | Lens key the data is read through |
| `--base-url` | see Environment | OntoForge server URL |

If `--lens` is omitted, the script uses an unscoped lens of that ontology and reports
which one; without an unscoped lens it stops. A scoped lens, named with `--lens`, exports
only the subset it exposes.

**API used**: `GET /api/ontologies/{ontologyKey}/model/export` (for type discovery),
then `GET /api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/entities/{type}` and
`/relations/{type}` (paginated, max 200 per page)

This is the only instance-data export there is — the server's own export/import covers
the design and nothing else.

### Import Data

Import instance data from a JSON file, automatically remapping entity IDs.

```bash
node scripts/import-data.mjs <file> [--ontology <key>] [--lens <key>] [--base-url <url>]
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `<file>` | yes | Path to data JSON file |
| `--ontology` | see Environment | Ontology key |
| `--lens` | no (auto-detected) | Lens key the data is written through |
| `--base-url` | no | OntoForge server URL |

The import creates all entities first (building a map from old IDs to new IDs), then
creates all relations using the remapped IDs. Relations referencing unknown entities are
skipped with a warning. If `--lens` is omitted, the script uses an unscoped lens and stops
when the ontology has none. The lens must expose every type and property the file
carries — a scoped lens rejects what it hides.

**API used**: `POST /api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/entities/{type}`,
`POST /api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/relations/{type}`

### Rebuild Search Data

Search indices keep themselves current: every write enqueues the entries it changes, and a
background worker builds them, so nothing needs rebuilding after a data import or an
embedding-model change. Their progress is `GET /api/ontologies/{ontologyKey}/model/search-indices`
(each index's `status.state`: `ready`, `building`, `stale`, `failed`, `unavailable` without
an embedding provider, `disabled` when switched off); one index is rebuilt from scratch
with `POST /api/ontologies/{ontologyKey}/model/search-indices/{indexKey}/rebuild`.

This script rebuilds what lies outside the search indices: the saved-query description
vectors and the width of their vector index. On Neo4j, which has no search indices and
computes its own search data with each write, it also rebuilds every entity's vector and
every document's chunks. Run it after changing the embedding model, once per ontology. It
covers the whole ontology, so no lens is involved.

```bash
node scripts/rebuild-search-data.mjs [--ontology <key>] [--base-url <url>]
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--ontology` | see Environment | Ontology key |
| `--base-url` | no | OntoForge server URL |

**API used**: `POST /api/ontologies/{ontologyKey}/model/rebuild-search-data`

Streams progress to stderr. On completion, prints a per-group summary. It runs without an
embedding provider and reports the vectors as skipped.

## Ordering Rules

1. **The ontology before anything.** Create it in the registry first — no script creates
   one, and import refuses a target that does not exist.
2. **Schema before data.** The schema defines entity types and relation types. Data
   cannot be imported until the schema exists.
3. **Entities before relations.** The data import script handles this automatically.
4. **Search follows the data import on its own.** On PostgreSQL the search indices build
   the imported entities' entries in the background, and search answers from them as they
   become ready; on Neo4j each write computes its entity's search data. No rebuild is
   needed.
5. **A clear key space for a schema import.** The import API does not overwrite or merge.
   If the target ontology already holds a type, lens or custom search index with the same key, the import
   fails with a 409 Conflict naming every clash. Import into a bare ontology, or delete
   the clashing objects first.

## Typical Workflows

### Bootstrap a new project from an existing design

```bash
# 1. Start OntoForge
docker compose up -d

# 2. Wait for PostgreSQL to be ready (health check)

# 3. Create the ontology — nothing is auto-created
curl -X POST http://localhost:8000/api/ontologies \
  -H 'Content-Type: application/json' \
  -d '{"key":"my_ontology","displayName":"My Ontology"}'

# 4. Import the design
node scripts/import-schema.mjs ./ontoforge/schema.json --ontology my_ontology

# 5. Optionally import seed data — search indices then build in the background
node scripts/import-data.mjs ./ontoforge/data.json --ontology my_ontology
```

Set `ONTOFORGE_ONTOLOGY=my_ontology` once instead of repeating `--ontology`.

### Snapshot one ontology for version control

```bash
export ONTOFORGE_ONTOLOGY=my_ontology

# Export the design (always do this)
node scripts/export-schema.mjs -o ./ontoforge/schema.json

# Export the data (if instance data should be versioned too)
node scripts/export-data.mjs -o ./ontoforge/data.json
```

### Clone an ontology

```bash
node scripts/export-schema.mjs --ontology source -o /tmp/design.json
curl -X POST http://localhost:8000/api/ontologies \
  -H 'Content-Type: application/json' -d '{"key":"clone"}'
node scripts/import-schema.mjs /tmp/design.json --ontology clone
```

## File Formats

### Schema file (transfer format v6.0)

Produced by `GET /api/ontologies/{ontologyKey}/model/export`:

```json
{
  "formatVersion": "6.0",
  "keywordLanguages": ["german", "english"],
  "searchIndices": {
    "custom": [
      {
        "key": "person_employment",
        "name": "People by employment",
        "description": "People with their roles at companies.",
        "entityType": "person",
        "fields": ["name"],
        "header": null,
        "relations": [
          {
            "relationType": "works_for",
            "direction": "outgoing",
            "fields": ["role"],
            "target": { "company": ["name"] },
            "label": "Employment",
            "template": null
          }
        ],
        "semantic": { "enabled": true, "template": null },
        "keyword": { "enabled": true }
      }
    ],
    "disabled": []
  },
  "entityTypes": [
    {
      "key": "person",
      "displayName": "Person",
      "nameProperty": "name",
      "properties": [
        { "key": "name", "displayName": "Name", "dataType": "string", "required": true }
      ]
    }
  ],
  "relationTypes": [
    {
      "key": "works_for",
      "displayName": "Works for",
      "fromEntityTypeKey": "person",
      "toEntityTypeKey": "company",
      "properties": [
        { "key": "role", "displayName": "Role", "dataType": "string", "required": false }
      ]
    }
  ],
  "lenses": [
    {
      "key": "my_lens",
      "name": "My Lens",
      "indexInclusions": [],
      "aiAgents": [],
      "savedQueries": []
    }
  ]
}
```

(The `company` entity type is left out of the example for brevity.)

- `keywordLanguages` — the languages keyword search stems in: `["english"]`,
  `["german"]` or `["german", "english"]`. Import replaces the target's set with it.
- `searchIndices` — `custom`, the custom search-index definitions, and `disabled`, the
  keys of the managed indices switched off (`<type>~default`, `<type>~<documentProperty>`).
  Managed indices are not carried; the imported schema derives them. Optional.
- `nameProperty` — each entity type's name property, one of its own `string` properties.
- A lens without `includes` is **unscoped** and sees the whole schema. A scoped lens lists
  the type keys it exposes and optionally restricts the visible properties.
  `indexInclusions` lists the search indices a scoped lens searches, by key; an unscoped
  lens searches every index and lists none.

The format version decides how import reads the file: `6.0` (or none) is the current
format; `5.0` — one `textSearchLanguage` instead of `keywordLanguages`, no search indices,
no name properties — is converted on the way in; any other version is refused. Import
provisions no search entries: each index is built in the background once data exists.

### Data file (v1.0)

Instance data grouped by type key. This format is the scripts' own — the server has no
instance-data transfer format.

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

On import, `_id`, `_entityTypeKey`, `_relationTypeKey`, `_createdAt`, and `_updatedAt`
are stripped. Entity IDs in relations are remapped to the newly created IDs. Document
properties are exported with their full content, not as size stubs.

## Related Skills

- **ontoforge-setup** — Bootstrap a project with Docker Compose, environment variables, and MCP configuration.
- **ontoforge-runtime-api** — Build against the OntoForge runtime REST API.
- **ontoforge-okf** — Sync individual Markdown documents with entities, one file per entity.
