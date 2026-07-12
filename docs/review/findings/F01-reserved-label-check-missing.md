# F01 — Reserved-Label Collision Check Is Documented but Not Implemented

> **Severity: High (code bug)** · **Effort: Small** · **Type: Code correction**

## Finding

`architecture.md` §4 and §4.2 state that the modeling service rejects entity type keys whose
PascalCase label would collide with schema node labels (`Ontology`, `EntityType`, `RelationType`,
`PropertyDefinition`). This check does not exist in the code: `create_entity_type` in
`modeling/service.py` performs only a duplicate-key check. No reserved-label validation exists
anywhere in the backend.

## Impact

Creating an entity type with key `ontology`, `entity_type`, `relation_type`, or
`property_definition` produces instance nodes labeled `Ontology`, `EntityType`, etc. Instance
nodes then share a label with schema nodes. Every Cypher query in the modeling repository that
matches on these labels (schema load, export, validation, cascade checks) would pick up instance
nodes — corrupting schema reads and potentially schema mutations. This silently breaks the core
label-convention separation the whole storage model depends on.

## Proposed Correction

Implement the check as documented, in the modeling service (`create_entity_type`, and key changes
if renaming is ever allowed — keys are immutable today, so creation is the only entry point):

- Reject keys whose PascalCase conversion equals any schema label. The reserved set must cover
  **all** current schema labels, not just the four documented ones:
  `Ontology`, `EntityType`, `RelationType`, `PropertyDefinition`, `AiAgentConfig`, `SavedQuery`.
- Return a 422 `VALIDATION_ERROR` naming the collision.
- Apply the same check on **import** — imported entity types bypass `create_entity_type` and must
  not smuggle reserved keys in.
- Update `architecture.md` §4.2 to list the complete reserved set (see F08).

## Dependencies

None. Can be fixed immediately and independently.

## Acceptance

- Unit tests: creating/importing entity types `ontology`, `ai_agent_config`, `saved_query`, etc.
  fails with a structured validation error; a harmless key like `person` still works.
- The reserved set is defined in one place (e.g. a constant next to the PascalCase conversion) so
  future schema labels only need one edit.
