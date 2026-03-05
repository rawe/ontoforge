# OntoForge Skill & Marketplace

> Feature proposal for providing an OntoForge skill that enables LLMs to interact with OntoForge through documented workflows, plus a marketplace for distribution.

## Motivation

The existing MCP server provides real-time, tool-based access to OntoForge for AI agents. However, not every interaction requires a live connection. Many common workflows — exporting an ontology for offline analysis, importing a modified ontology back, bootstrapping a new project — follow predictable patterns that can be expressed as standalone scripts. A skill packages these workflows so coding agents (e.g., Claude Code) can operate OntoForge efficiently from development environments without requiring a persistent MCP session.

## Concept

An OntoForge skill is a Claude Code plugin that exposes documented workflows as slash commands. Each workflow is implemented as a standalone Python script executed via `uv run`, using OntoForge's REST API under the hood. The skill complements the MCP server: MCP handles interactive, read-heavy operations; the skill handles batch and filesystem-oriented operations.

## Structure

The plugin follows the Claude Code plugin conventions:

- A **plugin manifest** (`plugin.json`) defining name, description, and version
- A **marketplace definition** (`marketplace.json`) for discovery and installation via `claude plugin marketplace add` / `claude plugin install`
- A **SKILL.md** file documenting each workflow (parameters, output format, usage examples)
- **Standalone Python scripts** using uv's PEP 723 inline script metadata for self-contained dependency declarations
- Scripts interact with OntoForge's REST API; the base URL is configurable via an environment variable (e.g., `ONTOFORGE_URL`, defaulting to `http://localhost:8000`)

This pattern has been proven in the DocFabric project, which uses the same plugin structure for document management workflows.

## Proposed Workflows

The exact set of skill workflows is to be defined, but candidates include:

- **Export** — Export a complete ontology (schema + data) to a local JSON file
- **Import** — Import an ontology from a local JSON file into OntoForge
- **Scaffold** — Generate a starter ontology definition from a description or template

## Marketplace

A marketplace entry allows the skill to be discovered and installed from within Claude Code and other compatible coding tools. The marketplace metadata lives in the OntoForge repository and points to the plugin source.

## Scope

- The skill is a thin wrapper around existing REST API capabilities — no new backend endpoints required
- Scripts are self-contained Python files with inline uv dependencies
- Distribution via Claude Code plugin marketplace
- Documentation via SKILL.md within the plugin directory

## Status

### Done

- **Export script** (`scripts/export_ontology.py`) — standalone PEP 723 script that exports schema + entities + relations to structured JSON files via the Runtime REST API. Includes pagination, slugified filenames, and UID-free output. Documented in `scripts/USAGE.md`.
- **Import design** (`scripts/IMPORT_NOTES.md`) — reference doc specifying the two-pass import strategy (entities first, then relations resolved by type + filename), schema handling, and required API endpoints.

### To Do

- Design and implement the full skill folder structure that Claude Code requires for context
- Import script
- Scaffold workflow (if included in initial release)
- `SKILL.md` documenting all workflows with parameters, output formats, and usage examples
- Plugin manifest (`plugin.json`) and marketplace definition (`marketplace.json`)
- Marketplace registration and distribution

## Open Questions

- Which workflows should be included in the initial release?
- Should the skill support multiple OntoForge instances (e.g., via environment variable)?
- Should there be a workflow for ontology validation or schema diffing?
