# OntoForge Export Script

Exports all entities and relations from an OntoForge ontology into structured JSON files.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) installed
- OntoForge server running

## Usage

```bash
uv run export_ontology.py <ontology_key> -o <output_dir> [--base-url <url>]
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
uv run export_ontology.py wacker_pi_planning -o .

# Override server URL for a single run
uv run export_ontology.py wacker_pi_planning -o ./exports --base-url http://my-server:9000
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
