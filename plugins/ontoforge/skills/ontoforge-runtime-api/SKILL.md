---
name: ontoforge-runtime-api
description: "Use when the user needs to build against the OntoForge runtime REST API: curl calls, API clients, request payloads, query parameters, or endpoint selection under /api/runtime. This skill is runtime-only and does not cover the modeling API."
---

# Goal

Help the user build correct calls against the OntoForge **runtime REST API** only.

Do not use this skill for schema design or modeling endpoints under `/api/model/...`.

## Primary Reference

Read [runtime-api.md](references/runtime-api.md) first. It points to the exact docs that define the runtime endpoints and the practical usage patterns.

## Workflow

1. Map the user request to the runtime endpoint family in `references/runtime-api.md`.
2. Read the linked contract section in `../../../../docs/api-contracts/runtime-api.md` before generating code.
3. Use `../../../../docs/runtime-usage.md` when the user wants concrete `curl` examples or request patterns.
4. Treat `/api/runtime/{ontologyKey}` as the base path for ontology-scoped calls. The only non-scoped runtime endpoint is `GET /api/runtime/features`.
5. If entity type keys, relation type keys, or property keys are unknown, start with schema introspection endpoints before generating write or query calls.
6. Preserve documented filter syntax exactly: `filter.{key}` and `filter.{key}__{op}`.
7. Set `Content-Type: application/json` on JSON `POST` and `PATCH` requests.

## Boundaries

- Runtime only: schema introspection, entity CRUD, relation CRUD, neighbors, semantic search, Cypher query, feature discovery, AI runtime endpoints, saved queries, and runtime data wipe.
- Not modeling: ontology creation, schema mutation, saved query definition, AI agent configuration, import/export via `/api/model/...`.
