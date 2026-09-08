# OntoForge Export Script

Exports all entities and relations from an OntoForge ontology into structured JSON files.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18 installed (no packages needed)
- OntoForge server running

## Usage

```bash
node export_ontology.mjs <ontology_key> -o <output_dir> [--base-url <url>]
```

### Server URL

Resolved in order: `--base-url` flag > `ONTOFORGE_BASE_URL` env var > `http://localhost:8000`.

```bash
# Set once via environment
export ONTOFORGE_BASE_URL=http://my-server:9000
```

### Examples

```bash
# Export to current directory (creates data_wacker_pi_planning_2026-03-05_101500/ inside)
node export_ontology.mjs wacker_pi_planning -o .

# Override server URL for a single run
node export_ontology.mjs wacker_pi_planning -o ./exports --base-url http://my-server:9000
```

## Output Structure

```
data_<ontology_key>_<timestamp>/
├── <entity_type>/          # one folder per entity type
│   ├── <slug>.json         # one file per entity (all properties, no UIDs)
│   └── ...
└── relations/
    └── <relation_type>.json  # one file per relation type
```

## File Naming

Entity filenames are derived by checking properties in order: `key`, `name`, `title`, `label`, `display_name`, `displayName`. First match is slugified. Fallback: entity UUID.

## Relations Format

Relations reference entities by type + filename (no UUIDs):

```json
{
  "from": { "type": "feature", "file": "validation-of-frontend-target-architecture" },
  "to": { "type": "work_package", "file": "poc-rest-api-cms-from-dcc" },
  "properties": {}
}
```

## Property keyword index migration / refresh

Stop backend writers, then run from the repository root. Replace `/path/to/your.env`
with the existing environment file used by your backend, configured for the PostgreSQL
database you intend to migrate:

```bash
ENV_FILE=/path/to/your.env server/node_modules/.bin/tsx scripts/rebuild_property_keywords.mts --ontology YOUR_KEY
```

Use `--all` instead of `--ontology YOUR_KEY` to process every PostgreSQL ontology.
The command uses the configured database credentials without displaying them. It takes
an exclusive entity-table lock for each ontology transaction, adds values-only keyword
columns to legacy namespaces, rebuilds their data from current schema-declared string
values, and replaces the old keyword generated column/index when needed. It never calls
inference, rewrites embeddings or semantic text, modifies documents, or changes entity
timestamps. Each ontology commits atomically; an error rolls back that ontology. Already
completed ontologies remain committed. It is safe to rerun: unchanged keyword rows are
skipped and the index is not replaced again.

Run this before starting updated code against an existing database. Fresh ontologies
already have the new columns. Run again after removing/re-adding schema string properties
when existing stored keyword text needs refreshing; schema editing alone does not rebuild
stored search representations. Deleted or lens-hidden supporting keys yield unknown
property attribution until refresh, rather than exposing a partial key list. The command
prints only each ontology key and scanned/updated/migrated counts. Take a database backup
before production maintenance; this command does not create one.
