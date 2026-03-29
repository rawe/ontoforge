---
name: ontoforge
description: "Export and import OntoForge ontology schemas. Use when the user wants to export an ontology schema to a JSON file or import one from a JSON file."
---

# Goal

Export and import OntoForge ontology schemas via the Modeling REST API. These operations handle schema only (entity types, relation types, properties) — not instance data.

## Export Schema

Export an ontology schema to a single JSON file.

**Script**: `${CLAUDE_PLUGIN_ROOT}/skills/ontoforge/scripts/export_schema.py`

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/ontoforge/scripts/export_schema.py <ontology_key> [-o <output_path>]
```

**Parameters**:
- `ontology_key` (required) — Ontology key (e.g. `my_ontology`)
- `-o, --output` (optional) — Output file path. Default: `./ontology/<ontology_key>.json`

**Output**: Path to the exported JSON file.

The exported file is the standard OntoForge transfer format and can be committed to a repository for version control.

## Import Schema

Import an ontology schema from a JSON file, completely replacing any existing schema with the same ontology ID.

**Script**: `${CLAUDE_PLUGIN_ROOT}/skills/ontoforge/scripts/import_schema.py`

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/ontoforge/scripts/import_schema.py <file>
```

**Parameters**:
- `file` (required) — Path to the schema JSON file (previously exported via Export Schema)

**Output**: Confirmation with ontology key and name.

The import always overwrites the existing ontology if one exists with the same ID. All entity types, relation types, and properties are replaced atomically.

## Environment

Both scripts read the OntoForge server URL from (in order):
1. `--base-url` flag
2. `ONTOFORGE_BASE_URL` environment variable
3. Default: `http://localhost:8000`

## Related: Project Setup

To bootstrap a new project with OntoForge (Docker Compose, environment variables, `.mcp.json`), use the **ontoforge-setup** skill (also part of this plugin). It ships templates for Docker Compose and MCP configuration and walks through the setup interactively.
