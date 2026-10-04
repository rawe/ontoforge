---
name: ontology-fixtures
description: Development fixtures — known OntoForge ontologies with schema and data, loaded onto a running server. Use when developing or testing OntoForge itself and you need an ontology with data, or when creating, saving or repairing a fixture.
---

# Ontology fixtures

A fixture is one folder under `fixtures/ontologies/<name>/` and lives on the server as ontology `fx_<name>`. The registry of fixtures and what each is for is the table in [fixtures/README.md](../../../fixtures/README.md).

```sh
node fixtures/fixture.mjs load   <name> [--base-url URL]   # files -> server
node fixtures/fixture.mjs save   <name> [--base-url URL]   # server -> files
node fixtures/fixture.mjs unload <name> [--base-url URL]   # delete fx_<name>
```

- Work with a fixture: `load`, develop and test against `fx_<name>`, `unload`.
- Change a fixture or make a new one: build `fx_<name>` on the server, `save`, review the diff.
- Repair a fixture after an OntoForge format change: `load`, then `save`.

Write only to `fx_` ontologies — every other ontology on a dev server holds real data.

Read [fixtures/README.md](../../../fixtures/README.md) before creating a new fixture or when a command fails.
