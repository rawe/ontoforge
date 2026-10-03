# Retriever storage migration

This command creates only the new lens-owned retriever configuration storage. It does not alter existing schema objects, instances, agents, saved queries, embeddings, or languages. It does not initialize a model provider.

Run from `server/`, using the normal `ENV_FILE` configuration mechanism. Do not use a live target until isolated tests and a concrete dry-run report have been reviewed.

```sh
npx tsx src/maintenance/migrateRetrievers.ts --dry-run --ontology example
npx tsx src/maintenance/migrateRetrievers.ts --apply --ontology example
```

Repeat `--ontology KEY` for several registered ontologies, or use `--all` explicitly. Omitting the mode defaults to dry-run. A compiled build uses `node dist/maintenance/migrateRetrievers.js` with the same arguments. No credential values are printed.

Dry-run opens the selected adapter without startup DDL and reports `missing`, `ready`, or `incompatible`. It performs no schema or data writes. Apply reports `created`, `unchanged`, or `failed`. Missing/unknown ontology keys reject the selection before any migration. An incompatible existing structure is never repaired or replaced automatically.

PostgreSQL uses one transaction and advisory lock per registered namespace. A failure rolls back that ontology; separate ontologies can complete independently, and rerunning checks already completed structures. New ontologies receive the same table DDL during normal provisioning. The table contains config metadata, JSON, a config version, a lens FK with delete cascade, and lens-local key uniqueness.

Neo4j retains its one-ontology limit. It adds only ID and `(ownerLensId,key)` uniqueness constraints on internal `_RetrieverConfig` nodes. There are no node or relationship writes in this initial migration. Constraint DDL is not globally transactional: a failed run can leave the first new constraint installed, and rerunning completes the remaining one. New ontology provisioning shares this same ensure operation. `_HAS_RETRIEVER` links belong to config CRUD, not this migration.

No browser localStorage configurations are uploaded automatically. Config payload version 1 is validated by the API; the physical version column permits preserving and diagnosing unsupported stored versions. Migration receipts describe storage status only, not config validity. Keep the reviewed receipt; never substitute design import, wipe, or vector rebuild for this command.
