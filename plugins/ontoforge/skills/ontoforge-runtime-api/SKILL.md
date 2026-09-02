---
name: ontoforge-runtime-api
description: "Use when the user needs to build against the OntoForge runtime REST API: curl calls, API clients, request payloads, query parameters, or endpoint selection under /api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}. This skill is runtime-only and does not cover the modeling API or the ontology registry."
---

# Goal

Help the user build correct calls against the OntoForge **runtime REST API** only.

Do not use this skill for schema design, which lives on the modeling surface under
`/api/ontologies/{ontologyKey}/model/...`, or for managing ontologies themselves, which
is the registry at `/api/ontologies`.

## Primary Reference

Read [runtime-api.md](references/runtime-api.md) first. It is the bundled runtime API
reference for this skill.

## Ontology and lens

Every runtime call names two keys, and confusing them is the most common mistake against
this surface:

- **Ontology** — the isolated unit that owns a schema, its lenses and all of its instance
  data. Nothing spans two ontologies.
- **Lens** — a named view over one ontology's schema. Runtime reads and writes instance
  data through a lens, which may expose the whole schema or only part of it.

The base path is `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`. There is no
default ontology and no default lens: both must be resolved before any call is generated.

## Workflow

1. Map the user request to the correct endpoint family in `references/runtime-api.md`.
2. Use the bundled endpoint definitions there as the source of truth for path shape,
   request body, and query parameters.
3. Resolve the ontology key and the lens key first — every ontology-scoped call needs
   both. The only runtime-relevant route outside the prefix is
   `GET /api/server/features`, which describes the deployment.
4. If entity type keys, relation type keys, or property keys are unknown, start with the
   schema introspection endpoints before generating write or query calls. They are
   already filtered to the lens, so what they omit is not reachable through it.
5. Preserve documented filter syntax exactly: `filter.{key}` and `filter.{key}__{op}`;
   on entity lists and semantic search `{key}` may also be a query path, whose rules are
   in the reference. Repeat `fields` rather than comma-separating it.
6. Set `Content-Type: application/json` on JSON `POST` and `PATCH` requests.
7. Probe `GET /api/server/features` before building anything on semantic search or the
   AI routes — both need an external provider and are absent without one.

## Boundaries

- Runtime only: schema introspection, entity CRUD, document reads and partial writes,
  relation CRUD, neighbors, semantic search, OQL query, saved query listing/search/run,
  the AI runtime endpoints, and feature discovery.
- Not modeling: creating or changing entity types, relation types, properties or lenses;
  defining saved queries; configuring AI agents; schema export and import; rebuilding
  embeddings.
- Not the registry: creating, listing, renaming or deleting ontologies.
- Absent everywhere: there is no data-wipe endpoint, no bulk write, no instance-data
  export and no health endpoint. Do not generate calls for them.

## Output Style

When answering:
- name the exact endpoint first
- include the ontology key and lens key in the path
- include required path parameters
- include relevant query parameters
- include the JSON body when applicable
- then produce the requested artifact: `curl`, client code, fetch wrapper, SDK helper, or typed interface
