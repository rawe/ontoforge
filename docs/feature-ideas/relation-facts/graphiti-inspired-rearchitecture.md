# Graphiti-inspired re-architecture

**Status:** proposal / discussion
**Last updated:** 2026-04-19
**Inspiration source:** [Graphiti](https://github.com/getzep/graphiti) — a temporal knowledge-graph framework by Zep. This document is **not** a call to become Graphiti; it's a selective borrowing of ideas that address known gaps in OntoForge, mixed with preservation of what OntoForge does strictly better.

No backwards compatibility is required. Instance data and schema can be reshaped freely.

---

## 1. What OntoForge already does better than Graphiti (keep)

These are strengths Graphiti does **not** have. Do not trade them away in the re-architecture.

1. **True 1:1 native Neo4j mapping.** `(:Person)-[:WORKS_ON]->(:Project)` with per-type labels and per-type relationship names. Graphiti collapses everything to `(:Entity)-[:RELATES_TO]->(:Entity)` and stores the type name as a string property. OntoForge keeps the Neo4j planner, Cypher fluency, and native per-label indexes.
2. **Cypher 25 `SEARCH … IN (VECTOR INDEX …) SCORE AS` with in-index `WHERE`.** True k-NN with metadata filters pushed into the index. Graphiti does brute-force `vector.similarity.cosine(...)` over metadata-filtered candidates. At scale, OntoForge wins; at small scale both work.
3. **Schema-validated, strongly-typed writes.** Properties are typed and coerced; raw Cypher reads are ANTLR-parsed, validated, and rewritten per lens. Results are structurally predictable by construction.
4. **Ontology-as-lens.** Global schema governance separate from per-use-case access scope. Graphiti has nothing analogous.
5. **MCP-first, dual-server architecture.** Modeling and runtime surfaces split cleanly; fits orchestration.
6. **Saved-query pipelines.** Deterministic, composable multi-step retrieval — already in OntoForge, Graphiti has no equivalent.

**Design rule:** every proposal below must coexist with these six. If it can't, flag it.

---

## 2. The core shift

OntoForge today treats **entities as the semantic unit** and **relations as purely structural**. One `_embedding` per entity, no embedding on relations, no "fact" concept.

Graphiti's most valuable idea — worth adopting on top of the native mapping — is that **the relation (the fact) is also a semantic unit**. "Alice is tech lead on Phoenix" is a retrievable object, not just a pointer between two retrievable objects.

Adopting this means: relations carry optional embeddings and an indexable "fact" string. Semantic search can target entities, relations, or both. Combined with hybrid (vector + fulltext) retrieval and deterministic typed reads, this delivers the target goal:

> **General semantic discovery → deterministic, structurally typed results.**

---

## 3. Conceptual target model (all features, end-state)

We will not implement all of this at once. Section 4 stages the work. This section is the north star — the shape of the system after the full re-architecture, so shortcuts taken in early phases don't paint us into a corner.

### 3.1 Schema model

Unchanged concepts: `EntityType`, `RelationType`, `PropertyDefinition`, `Ontology` (lens), `INCLUDES_TYPE` edges with optional property allowlist. Inspired by Graphiti: the concept that the schema itself drives extraction / fact-generation / embedding composition.

Additions to `PropertyDefinition`:
- `embeddable: bool` (default `false`) — property contributes to the entity `_embedding` only when `true`.
- `searchable: bool` (default `false`) — property is included in a per-label fulltext index. Orthogonal to `embeddable`.

Additions to `EntityType`:
- `factTemplate: str | None` — optional. Used when this type appears as a **subject** in a relation's fact (see §3.3).

Additions to `RelationType`:
- `semantic: bool` (default `false`) — when `true`, every instance of this relation has an `_embedding` and participates in relation-level semantic search.
- `factTemplate: str` — required when `semantic = true`. A Jinja-style template producing the deterministic fact sentence. Uses schema variables (see §3.3). No LLM.
- `temporal: bool` (default `false` initially, **all relations must tolerate this becoming `true` later without migration** — see §3.4 and §5).

Additions to `Ontology`:
- `defaultGroupId: str | None` — the group_id written to new data created through this lens when the caller doesn't supply one.
- `groupIdPolicy: "strict" | "open"` (default `"open"`).
  - `"open"` = reads see any group_id the lens would otherwise match (current behavior — preserves existing data-sharing semantics).
  - `"strict"` = reads are filtered to `defaultGroupId` (true data-level isolation without multi-DB).

### 3.2 Storage mapping

Still 1:1 to native Neo4j. The existing dual-label (`:_Entity:Person`) and native rel-type (`:WORKS_ON`) model is preserved. What changes is the set of system properties reserved on every node and every relation.

**Every entity node** carries (in addition to today's `_id`, `_entityTypeKey`, `_createdAt`, `_updatedAt`, `_embedding`):
- `_groupId: str` — always set (defaults to `"default"` for global data). From day one — see §5.
- `_validAt: datetime | null` — reserved, populated only when containing type is temporal. See §3.4.
- `_invalidAt: datetime | null` — reserved, populated only when temporal.
- `_embeddingState: "ok" | "pending" | "failed" | "stale"` — replaces the silent "no embedding" state.
- `_embeddingVersion: int` — bumped when the set of contributing properties or the embedding model changes, so stale vectors are detectable without inspecting content.

**Every relation edge** carries:
- `_id`, `_relationTypeKey`, `_createdAt`, `_updatedAt` (existing)
- `_groupId: str` — always set
- `_fact: str | null` — the deterministic fact sentence (see §3.3). Populated iff type's `semantic = true`.
- `_embedding: list<float> | null` — populated iff `semantic = true`.
- `_factVersion: int` — bumps when the template or contributing props change
- `_validAt: datetime | null`, `_invalidAt: datetime | null` — reserved for temporal.
- `_embeddingState`, `_embeddingVersion` — same semantics as on nodes.

**Indexes** (all created declaratively from the schema):
- Existing: per-entity-type vector index on `_embedding`, entity-type range index, uniqueness constraints.
- New: per-relation-type vector index on `_embedding` for types with `semantic = true`, with `WITH [r._groupId, r._validAt, r._invalidAt, r._relationTypeKey]` in-index filter properties so the Cypher 25 `SEARCH` clause can push all common filters into the index lookup. Neo4j 2026 supports relationship vector indexes via `db.create.setRelationshipVectorProperty` and `CALL db.index.vector.queryRelationships(...)` — or, preferably, the `SEARCH` clause form OntoForge already uses.
- New: per-label **fulltext** index over properties where `searchable = true`, keyed on `(_groupId, <fields>)`.
- New: per-relation-type fulltext index over `_fact` and `_relationTypeKey`, keyed on `_groupId`.

### 3.3 Deterministic fact sentences

Inspired by Graphiti's embedded `e.fact` — but Graphiti generates facts with an LLM. OntoForge does not need that: the schema already knows type names, property names, display names, and the source/target entity types. A deterministic template plus the ontology metadata produces a perfectly usable fact sentence without a model call, reproducibly.

Template variables available:
- `{source.displayName}`, `{source.<propertyKey>}` (any entity prop)
- `{target.displayName}`, `{target.<propertyKey>}`
- `{relation.<propertyKey>}` (any relation prop)
- `{relation.displayName}` — the RelationType's displayName

Example — `WORKS_ON` relation from `Person` to `Project`:
```
factTemplate: "{source.displayName} works on {target.displayName}{% if relation.roleOnProject %} as {relation.roleOnProject}{% endif %}."
```
Produces:
> "Alice works on Project Phoenix as tech lead."

Example — `DECIDED_BY` relation from `Decision` to `Person`:
```
factTemplate: "{source.statement}, decided by {target.displayName}{% if relation.decidedAt %} on {relation.decidedAt|date}{% endif %}."
```
Produces:
> "Phoenix beta ships by June 30, 2026, decided by Alice on 2026-04-13."

Rules:
- Missing optional properties must cleanly drop out (Jinja `{% if %}`), never emit `None`.
- Templates are validated at schema write time: all referenced property keys must exist, all referenced types must match the relation's source/target.
- `factVersion` starts at 1 per relation type. Incremented whenever the template, its referenced property set, or the embedding model changes — triggers background `_fact` + `_embedding` regeneration.
- **Template authoring is a first-class modeling tool** (MCP `set_fact_template`, REST PUT). A preview endpoint renders the template against a sample relation before commit.

Why this is better than Graphiti's LLM-generated facts for OntoForge's use case:
- **Reproducible.** Same schema + same data → same fact string, bit-for-bit.
- **Auditable.** Users can see and edit the template.
- **Free.** No per-write LLM call. An ingestion firehose doesn't cost model tokens.
- **Typed-aware.** Uses schema property types and display names, not string scraping.

Cost: less flexible than natural-language synthesis for complex multi-clause facts. Mitigation: rich template language with filters (`|date`, `|lower`, `|default`), and the option to add an LLM-synth fallback later if ever needed (not in scope).

### 3.4 Bi-temporal model (conceptual only — not in first phases, see §4)

Eventually every relation in a `temporal = true` type (and optionally entities) records two independent timelines:
- **World time:** `_validAt`, `_invalidAt` — when the fact was/is true in the real world.
- **System time:** `_createdAt`, `_updatedAt` (existing) — when OntoForge learned it / changed its record.

Writes to a temporal relation never mutate in place. Updating closes the old relation (`_invalidAt = now_world`) and creates a new one (`_validAt = now_world`, old `_id` linked via a `_supersedes` property if useful).

Reads gain an `asOf: datetime | null` parameter. With `asOf` set, every query filters `_validAt <= asOf AND (_invalidAt IS NULL OR _invalidAt > asOf)`. Cypher reads executed through the ANTLR rewriter can have the `asOf` filter injected automatically by the rewriter for `temporal = true` types.

**This is not implemented in phase 1.** Its only cost in phase 1 is **reserving the `_validAt` / `_invalidAt` properties** and carrying them through vector-index `WITH [...]` lists. If we skip the reservation, we pay a full-graph index rebuild later.

### 3.5 Search model — five primitives

Every search in the system is composed of these five primitives. The primitives are deterministic given fixed inputs; composition is explicit.

1. **Structured filter** — existing. Property filters + sort + pagination. Zero ML, fully deterministic.
2. **Entity semantic (vector)** — existing, extended to respect `_groupId` and `_validAt`/`_invalidAt` in-index.
3. **Relation semantic (vector)** — new. Cypher 25 `SEARCH` over per-relation-type vector indexes, in-index filtered by `_groupId`, `_relationTypeKey`, temporal range.
4. **Fulltext (entity or relation)** — new. Native Neo4j fulltext indexes, per label or per relation type. Terms-only, BM25.
5. **Graph traversal** — new expansion primitive: given a seed set of `_id`s, return the typed k-hop neighborhood with filters. Exposed as `expand(seeds, depth, direction, relation_type_keys, limit)`.

Composition — new top-level endpoints and MCP tools:
- `search/hybrid` — runs (2|3) and (4) in parallel on the same query, combines with **RRF** (reciprocal rank fusion). Deterministic given fixed rank cutoff `k` (default 60). Parameters: `target: "entities" | "relations" | "both"`, `strategy: "rrf" | "vector_only" | "fulltext_only"`, standard filters, `min_score`.
- `search/expand` — graph primitive, standalone or chained via saved query.

Important architectural choice: **search returns locators, not payloads.** Every search endpoint returns `{ matches: [{_id, _entityTypeKey | _relationTypeKey, score, matched_via: ["vector" | "fulltext" | "filter" | "cypher"]}], query, total }`. Full typed objects are fetched via existing `get_entity` / `list_entities` / `get_relation` / `list_relations`, which already enforce lens scoping and typing. This gives you:
- a free-form retrieval funnel
- a deterministic, schema-validated readout
- no "search-result shape" leakage into the domain response contract

### 3.6 Saved-query pipelines — new step types

Existing pipelines already chain `cypher` and `semantic_search` steps. Extend with:
- `hybrid_search` — new step (§3.5 `search/hybrid`).
- `relation_search` — new step (§3.5 primitive 3, semantic over relation facts).
- `fulltext` — new step (§3.5 primitive 4).
- `expand` — new step (§3.5 primitive 5).
- `seed_filter` — new step: takes an input list of `_id`s and returns them unchanged if they pass a structured filter. Deterministic intersection.

The NL-to-typed-result pattern becomes a standard saved-query shape:
```yaml
steps:
  - key: candidates
    type: hybrid_search
    params: { query: "{{input.query}}", target: "entities", limit: 50 }
  - key: typed
    type: cypher
    params:
      cypher: |
        MATCH (p:Person)
        WHERE p._id IN $seed_ids AND p.active = true
        RETURN p ORDER BY p.name
      bindings: { seed_ids: "{{candidates.matches[*]._id}}" }
```

Structurally typed, deterministic output, starting from a natural-language query. This is the first-class pattern for combining semantic discovery with structured results.

### 3.7 Ingest-from-text (conceptual — not first phases)

Long-range: accept raw unstructured content (text, message, JSON) and extract entities + relations against the active ontology. The ontology lens is the **extraction menu** — only types visible in the lens are extractable.

API shape (not for now):
```
ingest_episode(
  content, source_type, ontology_key,
  group_id, reference_time,
  entity_type_hints?, dry_run=false
) -> { episode_id, created: {...}, invalidated: {...}, skipped: {...} }
```

- Dedupe by (`_entityTypeKey`, canonical name match) + `_embedding` cosine threshold.
- `dry_run: true` returns the extraction plan without writing. Critical for tool-use determinism.
- An `Episode` node type (system-reserved) stores the raw content + `_validAt` + `source` and MENTIONS-links the created entities/relations for provenance.

This is the biggest UX unlock but also the biggest LLM dependency. Not in phase 1. **Reservation required now:** the `Episode` system node type, `MENTIONS` system relation type, and the `provenance` field (`{episode_id, extracted_at, confidence}`) on every created entity and relation so phase-N inserts don't require a full-graph migration.

### 3.8 Community / summarization (out of scope; mentioned only)

Graphiti's `build_communities` (Leiden) is not in scope. It's expensive to maintain, and the user's immediate need is structured retrieval, not graph analytics. If ever needed later, communities would be another per-group artifact (`:_Community` nodes with `_groupId`), not instance data. No reservation required today — communities are strictly additive.

---

## 4. Staged implementation plan

Order chosen to deliver user-visible search improvements first, defer temporal complexity, and reserve the fields that phase-N features need so we never pay a migration penalty.

### Phase 0 — Forward-compat reservations (no user-visible change)

Purely schema/storage plumbing. Ship before any other phase.

- Add always-populated `_groupId` on every new entity and relation. Default value `"default"` for existing data — a one-time backfill migration.
- Add nullable `_validAt`, `_invalidAt` on every new entity and relation (never populated yet).
- Add `_embeddingState`, `_embeddingVersion` on entities. Back-populate existing entities with `ok` and version `1`.
- Vector-index `WITH [...]` lists extended to include `_groupId`, `_validAt`, `_invalidAt` on all new indexes. Existing indexes rebuilt once.
- Add `Episode` (system) and `MENTIONS` (system) reserved type keys. Unused in phase 0. Block users from creating custom types with these keys.
- Add `provenance` reserved property key on every type. Unused in phase 0. Block user declarations of `provenance`.

### Phase 1 — Richer entity embeddings + hybrid search

Delivers the "semantic that actually works on rare tokens" outcome.

- `PropertyDefinition.embeddable: bool`. Rebuild an entity's `_embedding` by concatenating **only** embeddable properties in schema-declared order.
- `PropertyDefinition.searchable: bool`. Auto-create per-label fulltext indexes over the union of searchable properties.
- `search/hybrid` endpoint + MCP tool. RRF over entity-vector + label-fulltext.
- Search responses shift to the **locator-only** shape. Existing `semantic_search` endpoint migrated.
- Background re-embed when `embeddable` flags change (reuses existing `rebuild-embeddings` endpoint).

Explicit non-goals for phase 1: relation embeddings, temporal, episodes.

### Phase 2 — Relation facts + relation semantic search

Delivers the "search over facts, not just entities" capability.

- `RelationType.semantic: bool` and `factTemplate: str`. Template validation at schema write time.
- `_fact` materialization on write (deterministic, no LLM). `_factVersion`.
- Per-relation-type vector index on `_embedding` with `SEARCH` clause. Per-relation-type fulltext index on `_fact`.
- `hybrid_search(target: "relations" | "entities" | "both")`. Saved-query steps `relation_search`, `fulltext`.
- Background recompute job when templates change.

### Phase 3 — Graph expansion + typed-result pipelines

Delivers the "NL → typed result" primary UX pattern.

- `search/expand` primitive.
- Saved-query `expand` and `seed_filter` step types.
- Canonical saved queries shipped: "NL → entities → related projects", "NL → facts → involved people", etc.

### Phase 4 — Temporal (flip the switch the reservations enable)

Delivers as-of queries and fact history.

- `RelationType.temporal: bool`. (`EntityType.temporal` later if wanted.)
- Write path: closes old + creates new on temporal updates. No in-place mutation for temporal relations.
- Reads: `asOf` parameter; ANTLR rewriter injects the temporal predicate automatically for temporal types.
- `_supersedes` linkage; history endpoint.

### Phase 5 (optional) — Ingest-from-text

- `ingest_episode` MCP tool + REST endpoint.
- `Episode` system type + MENTIONS provenance writes.
- `dry_run`, per-ontology extraction-menu scoping, entity_type_hints.

### Phase 6 (optional, later) — LLM-synthesized facts, per-field vectors, community detection

Revisit after real usage data says the deterministic template or single-vector model hits a ceiling.

---

## 5. Forward-compatibility contract (shortcuts to avoid)

These are the concrete traps a naive phase-1-only design would fall into. Avoid them by respecting the Phase 0 reservations — they're all cheap to commit now and expensive to retrofit.

| Shortcut that would hurt later | Phase-0 commitment that prevents it |
|---|---|
| Don't write `_groupId` now; add in phase 4 | Every entity/relation already has `_groupId`, always populated, indexed in every vector index's `WITH [...]`. Zero retrofit cost. |
| Don't reserve `_validAt` / `_invalidAt` | Both nullable fields exist on every entity and relation; vector indexes already include them. Phase 4 flips a schema flag and starts populating. |
| Embed all string props now, introduce `embeddable` as opt-in in phase 1 | The old "all string props are embedded" rule never ships. `embeddable` defaults to `false`. Schema authors opt in from day one. Migration is a schema-only change. |
| Let schema authors use `provenance`, `_groupId`, `_validAt`, `Episode`, `MENTIONS` as custom keys now | Phase 0 reserves them. Schema validator rejects user use. |
| Ship hybrid without a `strategy: "vector_only" | "fulltext_only" | "rrf"` toggle and fixed RRF `k` | Included in phase 1 endpoint from day one. Deterministic behavior pinnable by callers. |
| Mutate relations in place now; add temporal later | Phase 1-3 relation updates are in-place, **but only because `temporal = false` for every type**. Phase 4 makes the flip per-type and the rewriter adapts. Requires no retrofit because `_validAt`/`_invalidAt` exist already. |
| Let search endpoints return full payloads in phase 1 | Locator-only return shape is part of the phase 1 response contract. Saves a breaking change later. |
| Hard-code the fact template as a Python f-string | Fact templates are a first-class `RelationType` schema field from phase 2 onward. Registered in the export format. `factVersion` bumped on change. |
| Compute entity embeddings from all string properties then filter | `_embedding` input set is driven by `embeddable` flags only. Changing the flag triggers a versioned re-embed. |

If any of these shortcuts becomes tempting during implementation, it's a signal to either (a) do the phase-0 reservation first, or (b) explicitly document and accept the migration cost.

---

## 6. What's explicitly out of scope

- Replacing the native Neo4j mapping with Graphiti's fixed-skeleton model. OntoForge's mapping is stronger.
- Replacing the `SEARCH … IN (VECTOR INDEX …)` path with Graphiti-style brute-force cosine. OntoForge's index strategy is stronger.
- LLM-generated fact sentences.
- Multi-DB isolation (use `_groupId` strict mode instead).
- Analytics / centrality / community detection.
- Write-path sync to external graph engines.

---

## 7. Open questions for follow-up

1. **Default `groupIdPolicy` for new ontologies:** `"open"` (preserves current shared-data behavior) or `"strict"` (safer but may surprise existing callers)?
2. **Relation semantic default:** should `semantic` default to `false` (opt-in per type) or `true` for new types that define a `factTemplate`? Leaning `false` + explicit flag.
3. **Fact template engine:** full Jinja2, a constrained subset, or a custom small expression language? Full Jinja is most expressive but adds a runtime dependency; constrained subset is safer.
4. **Fulltext analyzer choice per label** — English stemmer by default, or let schema author pick per property? Probably `analyzer: str | null` on searchable properties.
5. **Locator-only search responses** — is this acceptable as the first breaking change in phase 1, or do we want a `?include=entity` expansion param for clients that would otherwise make two hops? Recommending strict locator-only, with saved queries as the expansion pattern.
6. **Vector index rebuild cost on flag changes:** phase 1 can hide this behind a queued background job, but users will notice staleness. Do we expose `_embeddingState = "stale"` in search responses so clients can tell?
7. **Template language for dates and numbers:** at minimum `|date`, `|date(fmt)`, `|default(x)`, `|lower`, `|title`, `|join(", ")`. Confirm the list.

---

## 8. Credit

The relation-level embedding + fact sentence + bi-temporal edge concepts, the episode ingestion pattern, and the hybrid-search-with-RRF composition are all from [Graphiti (getzep/graphiti)](https://github.com/getzep/graphiti). What's new here is the synthesis with OntoForge's native-Neo4j 1:1 model and Cypher 25 `SEARCH` approach — those are OntoForge-native choices worth preserving. Where Graphiti's approach would weaken OntoForge (fixed generic skeleton, LLM-only fact synthesis, brute-force cosine), this document declines the borrowing.
