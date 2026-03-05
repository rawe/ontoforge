# Import Notes for OntoForge Export Format

Reference for building an import script that consumes the export structure produced by `export_ontology.py`.

## Export Structure

```
data_<ontology_key>_<timestamp>/
├── <ontology_key>_schema.json       # Full schema (entity types, relation types, properties)
├── <entity_type_key>/               # One folder per entity type
│   └── <slug>.json                  # One file per entity, all properties, no UIDs
├── relations/
│   └── <relation_type_key>.json     # One file per relation type
```

## Entity Files

- **No UIDs** — files contain only user-defined properties (no `_id`, `_createdAt`, `_updatedAt`, `_entityTypeKey`).
- **Filename** is the slugified value of the first matching property from: `key`, `name`, `title`, `label`, `display_name`, `displayName`. Fallback: the original UUID.
- **Entity type** is determined by the parent folder name (matches `entityTypes[].key` in the schema).

## Relation Files

Each relation file is a JSON array. Each entry:

```json
{
  "from": { "type": "feature", "file": "validation-of-frontend-target-architecture" },
  "to": { "type": "work_package", "file": "poc-rest-api-cms-from-dcc" },
  "properties": { ... }
}
```

- `type` → entity type key (= folder name)
- `file` → filename without `.json` extension (= slug of the referenced entity)
- `properties` → only present when the relation has custom properties (defined in schema under `relationTypes[].properties`)

## Entity-to-Relation Resolution Strategy

Relations reference entities by **type + filename**, not by UUID. Import must:

1. **First pass — import all entities.** For each entity type folder, read every `.json` file and create it via the API. Store a mapping of `(entity_type, filename) → new_uuid` from the API response.
2. **Second pass — import all relations.** For each relation file, resolve `from` and `to` using the mapping built in step 1: look up `(entry.from.type, entry.from.file)` and `(entry.to.type, entry.to.file)` to get the UUIDs. Then create the relation via the API with `fromEntityId`, `toEntityId`, and any `properties`.

## Schema Handling

The schema file (`<ontology_key>_schema.json`) contains the full ontology definition. On import:

- If the target ontology **does not exist**: create it from the schema first (entity types, relation types, properties), then import data.
- If the target ontology **already exists**: validate that entity types and relation types match. Flag mismatches before importing data.

## API Endpoints for Import

Based on the runtime API (`POST` operations):

| Operation | Endpoint |
|---|---|
| Create entity | `POST /api/runtime/{ontologyKey}/entities/{entityTypeKey}` |
| Create relation | `POST /api/runtime/{ontologyKey}/relations/{relationTypeKey}` |

Entity creation body: flat JSON object with property key-value pairs (same shape as the exported files).

Relation creation body:
```json
{
  "fromEntityId": "<uuid>",
  "toEntityId": "<uuid>",
  "property_key": "value"
}
```
