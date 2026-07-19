---
name: ontoforge-runtime-api
description: "Use when the user needs to build against the OntoForge runtime REST API: curl calls, API clients, request payloads, query parameters, or endpoint selection under /api/runtime. This skill is runtime-only and does not cover the modeling API."
---

# Goal

Help the user build correct calls against the OntoForge **runtime REST API** only.

Do not use this skill for schema design or modeling endpoints under `/api/model/...`.

## Primary Reference

Read [runtime-api.md](references/runtime-api.md) first. It is the bundled runtime API reference for this skill.

## Workflow

1. Map the user request to the correct endpoint family in `references/runtime-api.md`.
2. Use the bundled endpoint definitions there as the source of truth for path shape, request body, and query parameters.
3. Treat `/api/runtime/{ontologyKey}` as the base path for ontology-scoped calls. The only non-scoped runtime endpoint is `GET /api/runtime/features`.
4. If entity type keys, relation type keys, or property keys are unknown, start with schema introspection endpoints before generating write or query calls.
5. Preserve documented filter syntax exactly: `filter.{key}` and `filter.{key}__{op}`.
6. Set `Content-Type: application/json` on JSON `POST` and `PATCH` requests.

## Boundaries

- Runtime only: schema introspection, entity CRUD, relation CRUD, neighbors, semantic search, OQL query, feature discovery, AI runtime endpoints, saved queries, and runtime data wipe.
- Not modeling: ontology creation, schema mutation, saved query definition, AI agent configuration, import/export via `/api/model/...`.

## Output Style

When answering:
- name the exact endpoint first
- include required path parameters
- include relevant query parameters
- include the JSON body when applicable
- then produce the requested artifact: `curl`, client code, fetch wrapper, SDK helper, or typed interface
