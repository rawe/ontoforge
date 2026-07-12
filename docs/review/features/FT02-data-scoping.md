# FT02 — Data Scoping (Scope Dimensions)

> **Type: Feature concept** · **Effort: Large** · **Priority: Medium-High — the natural next step of the lens idea**
> Builds on the existing proposal `docs/feature-ideas/data-scoping.md`; this concept adds
> readiness assessment and a recommended slice, it does not replace that document.

## Why this fits the project's direction

Ontology lenses answered "*which types and properties* can this consumer see?". Data scoping
answers the follow-up every real multi-consumer deployment asks next: "*which instances*?"
(per project, per customer). It is the second axis of the same core idea, composes cleanly with
scoped ontologies (the interaction section in the existing proposal is already thought through),
and it directly strengthens the MCP story: an agent session pinned to `X-Scope-Project-Key`
cannot read or write outside its project — a meaningful containment upgrade for AI writers.

## Readiness assessment

The proposal is sound but has four gaps to settle before implementation:

1. **Schema mechanism**: "mark entity types as scope-eligible" needs a concrete home — recommend
   a boolean `scopeDimension` on `EntityType` (modeling API + export format bump; interacts with
   FT06 format discipline).
2. **The reference-key convention is convention-only.** `project_key` is just a string property
   today; nothing guarantees it points at an existing Project. Decide whether scoping validates
   referential existence on write (recommended: yes, cheap single lookup) or stays convention.
3. **Bypass surfaces**: the Cypher query endpoint and semantic search must honor active scopes,
   or scoping is decorative. Cypher is the hard one — recommend V1 **rejects** `execute_cypher_query`
   when a scope header is active (clear error), rather than attempting query rewriting.
4. **Uniqueness caveat**: the proposal says the dimension's `key` gets a uniqueness constraint —
   Neo4j Community has no per-label property-uniqueness on non-`_Entity` labels in the current
   setup; enforce in the service layer like other validations.

## Recommended slice (V1)

- One scope mechanism end-to-end: schema flag → header parsing → read filtering → write injection,
  for entity CRUD + list + neighbors + semantic search. Cypher blocked under scope. No UI.
- V2: relation-instance filtering rules (both endpoints in scope?), UI scope switcher, Cypher
  rewriting.

## Dependencies

- **After FT01 (auth)** — scope headers without auth give isolation, not security; shipping them
  together avoids a false sense of tenancy.
- After F08 (docs stable) and ideally F03 (helpers in `core/`, since scoping touches the same
  service-layer seams).
- Interacts with FT05 (constraints) only at the validation-pipeline level — order flexible.

## Open questions for the user

- Is scoping a *convenience filter* or a *tenancy boundary*? The answer decides gap 3 (Cypher)
  and how strict write injection must be. Recommended: tenancy-grade within one trusted token,
  i.e. strict.
