# Relation-facts roadmap

**Status:** active
**Last updated:** 2026-04-19

## What this is

The implementation roadmap for the relation-facts feature. Each milestone is **deployable on its own** and **delivers user-visible value or prevents future migration**. Milestones are ordered — earlier ones unblock later ones. Detailed scope lives in the two companion docs; this roadmap only captures the slicing, the check-off boundary, and the order.

## Companion docs

- [graphiti-inspired-rearchitecture.md](graphiti-inspired-rearchitecture.md) — end-state vision and full phase plan
- [relation-facts-semantic-search.md](relation-facts-semantic-search.md) — Phase 0 + Phase 1 implementation plan, referenced by the early milestones below

## Milestones

- [ ] **M1 — Walking skeleton for semantic relation search**
- [ ] **M2 — Staleness + reconcile worker**
- [ ] **M3 — Graph expansion, first hop (`expand`, depth = 1)**
- [ ] **M4 — Entity-side semantic parity**
- [ ] **M5 — Fulltext + hybrid search**
- [ ] **M6 — Saved-query pipelines + generalized `expand`**
- [ ] **M7 — Temporal (bi-temporal relations)**
- [ ] **M8 — Ingest-from-text (episodes)**
- [ ] **M9 (optional) — Advanced extensions: LLM facts, per-field vectors, communities**

### M1 — Walking skeleton for semantic relation search

**Essence.** Minimum end-to-end path: define a relation type with a fact template, create instances, query semantically, get back matching facts with their fact strings. The core capability, working for demos and narrow pilots. Phase 0 system-property reservations ride along so later milestones don't need a migration.

**Scope defined in:** `relation-facts-semantic-search.md` §3 (Phase 0 reservations), §4 (`factTemplate` modeling), §5 (storage + per-type vector index), §6.1 (create write path), §7.1 (the new semantic endpoint), §8 (MCP tool).

**Demo criterion.** A relation type with a fact template has instances. `GET /search/semantic/relations?q=…` and the matching MCP tool return expected facts with `_fact` + endpoint IDs. Existing endpoints untouched.

**Not in M1 (and where it lives):**
- Staleness when entity properties change → **M2**
- Graph expansion from a seed entity (1-hop) → **M3**
- Entity-side cross-type semantic search + `embeddable` → **M4**
- Fulltext / hybrid → **M5**
- Saved-query steps + deeper graph traversal (multi-hop, multi-seed) → **M6**
- `search/any` composer → bundled into **M4**
- Temporal → **M7**
- Ingest-from-text / episodes → **M8**

### M2 — Staleness + reconcile worker

**Essence.** M1 ships a feature that works on day one and slowly drifts afterwards: change Alice's `displayName` and every `_fact` referencing her is outdated, but still what semantic search matches against. M2 closes that correctness gap so the feature is trustworthy under real data evolution. Entity updates mark touched semantic relations as stale (dumb, over-inclusive rule); a background worker re-renders `_fact` and re-embeds. `factTemplate` changes and previously failed embeddings use the same path.

**Scope defined in:** `relation-facts-semantic-search.md` §6.2 (entity-update propagation), §6.3 (template-update propagation), §6.4 (background reconcile worker). `_embeddingState` / `_embeddingVersion` / `_factVersion` were already reserved in M1, so M2 only adds behavior.

**Demo criterion.** Change a property that a semantic relation's template references; within the reconcile window, that relation's `_fact` and `_embedding` reflect the new value, and `search/semantic/relations` returns content consistent with the update. A previously `failed` relation recovers once the model is available again.

**Not in M2 (and where it lives):**
- Template-to-property dependency index (narrowing the "mark-all-touching" rule) → later, not a milestone — revisit only if the stale queue becomes a bottleneck
- Graph expansion → **M3**
- Everything deferred from M1 stays deferred

### M3 — Graph expansion, first hop (`expand`, depth = 1)

**Essence.** First step of the generalized graph-traversal primitive from `graphiti-inspired-rearchitecture.md` §3.5 (#5): given a starting entity, return all relations touching it regardless of type. Turns M1's semantic locators into composable pipelines — "find candidate facts → see what else is connected to the involved entities" becomes one natural flow instead of N per-type calls. Shipped under the same endpoint name as the later generalized version, with a narrower parameter space today (single seed, `depth = 1`, no per-hop filtering).

**Scope defined in:** `relation-facts-semantic-search.md` §7.2 (shape and behavior), §8 (MCP tool), §10 (response-shape comparison). Aligned with `graphiti-inspired-rearchitecture.md` §3.5 primitive #5.

**Demo criterion.** Given a single entity id, the `expand` endpoint (REST + MCP) returns every relation touching that entity across types, respecting lens scope and direction, with the locator shape. A pipeline that starts from a semantic relation match and retrieves further relations on the involved endpoints works without branching per relation type.

**Not in M3 (and where it lives):**
- Multi-hop traversal (`depth > 1`) → **M6**
- Multi-seed input (`seeds: list[id]`) → **M6**
- Per-hop filters, cycle-handling semantics, and ranking over traversal results → **M6**
- User-property filters on the multi-type listing — intentionally excluded, per the β filter decision
- Cross-type list of relations *not* anchored to a seed entity — not a milestone; callers fetch by type via existing `list_relations` if the type is known
- Everything deferred from M1 / M2 stays deferred

**Preview of M4.** Entity-side cross-type semantic search + the `embeddable` flag that controls which properties feed an entity's `_embedding`. Entity side gains parity with what M1 delivered for relations.

### M4 — Entity-side semantic parity

**Essence.** Entity-side cross-type semantic search gains parity with the relation side delivered in M1. A new `embeddable: bool` flag on `PropertyDefinition` lets authors opt in per property to feed the entity `_embedding` — replacing today's indiscriminate "all string properties" composition. Flipping a flag triggers a lazy re-embed of the affected type. The existing single-type `semantic_search(entity_type_key=…)` endpoint remains untouched.

**Scope defined in:** `graphiti-inspired-rearchitecture.md` §3.1 (schema-level `embeddable`) and §3.5 (primitive #2, entity semantic). `relation-facts-semantic-search.md` §11 marks both as explicitly deferred from Phase 1.

**Demo criterion.** With `embeddable` flags set on at least one entity type, `GET /search/semantic/entities?q=…` (and the `semantic_search_entities` MCP tool) returns cross-type matches with the entity locator shape. Existing single-type semantic search is unchanged; flipping `embeddable` flags triggers a lazy re-embed of the affected type.

**Not in M4 (and where it lives):**
- `search/any` composer (cross-kind result fusion) → **parked**; see _Parked ideas_ below
- `searchable: bool` + fulltext indexes → **M5**
- Hybrid (vector + fulltext) fusion → **M5**
- Saved-query step integration → **M6**
- Multi-hop / multi-seed `expand` → **M6**
- Temporal → **M7**
- Ingest-from-text → **M8**
- Per-type weighting inside a single primitive — intentionally out (RRF treats types as peers)

**Preview of M5.** Fulltext + hybrid search. Adds `searchable: bool` on `PropertyDefinition`, per-label and per-relation-type fulltext indexes (BM25), and a `search/hybrid` endpoint that RRF-fuses vector + fulltext streams per target. Fills the "rare tokens / exact-match" gap that pure-semantic search has.

### M5 — Fulltext + hybrid search

**Essence.** Pure semantic search misses two things: exact-term matches (names, codes, rare tokens) and BM25-style keyword queries. M5 closes both gaps on both the entity side and the relation side. A `searchable: bool` flag on `PropertyDefinition` opts properties into per-label fulltext indexes; semantic relation types also get a per-type fulltext index over `_fact`. A new `search/hybrid` endpoint RRF-fuses the vector stream and the fulltext stream per target (entities or relations). The `matched_via` field now carries its full meaning: `["vector"]`, `["fulltext"]`, or `["vector", "fulltext"]` for stronger matches.

**Scope defined in:** `graphiti-inspired-rearchitecture.md` §3.1 (`searchable`), §3.2 (fulltext indexes), §3.5 (primitive #4 fulltext + hybrid composition). `relation-facts-semantic-search.md` §11 marks these as explicitly deferred from Phase 1.

**Demo criterion.** `searchable` flags are set on a few properties of at least one entity type and on relation `_fact` fields. `GET /search/hybrid?q=…&target=entities` and `&target=relations` return matches fused from vector + fulltext, with `matched_via` correctly annotating each item. A query with rare tokens that pure-semantic missed now surfaces the right matches via the fulltext leg; a query with fuzzy paraphrase still surfaces matches via the vector leg.

**Not in M5 (and where it lives):**
- Saved-query step integration for `hybrid_search` / `fulltext` → **M6**
- Multi-hop / multi-seed `expand` → **M6**
- Temporal → **M7**
- Ingest-from-text → **M8**
- Cross-kind hybrid (one endpoint returning entities + relations hybrid-fused) — extension of the `search/any` parked idea; stays parked

**Preview of M6.** Saved-query pipeline integration + deeper `expand`. Everything shipped through M5 becomes a composable step type; `expand` gains `depth > 1` and multi-seed input. This is where the "NL query → structured, typed result" pattern becomes a first-class surface.

### M6 — Saved-query pipelines + generalized `expand`

**Essence.** Two capabilities that only make sense together: the composable pipeline surface, and the expansion primitive that's most useful inside it. Every search capability shipped through M5 becomes a saved-query **step type** (`semantic_search_entities`, `semantic_search_relations`, `hybrid_search`, `fulltext`, `expand`, `seed_filter`), so callers can chain them declaratively. `expand` simultaneously gains `depth > 1` and multi-seed input — with cycle handling, per-hop filters, and result ranking — turning it from M3's one-hop convenience into the real graph-traversal primitive. The doc's "NL query → typed, structured result" pattern becomes a first-class surface backed by deterministic composable steps rather than glue code.

**Scope defined in:** `graphiti-inspired-rearchitecture.md` §3.5 primitive #5 (generalized `expand`), §3.6 (saved-query pipeline step types and the canonical NL → typed-result pattern). The existing saved-query pipeline engine is the integration point.

**Demo criterion.** A saved query of the form *"NL query → semantic match → expand two hops → filter by type → return typed entities"* runs end-to-end. `expand` handles multi-seed, `depth = 2` input with cycle handling and returns ranked typed locators. Existing saved-query pipelines continue to work unchanged; all new step types appear in the pipeline schema and compose with existing `cypher` and `semantic_search` steps.

**Not in M6 (and where it lives):**
- Temporal (`asOf`, fact history, temporal write semantics) → **M7**
- Ingest-from-text / episodes → **M8**
- LLM-synthesized facts / per-field vectors / community detection → **M9 (optional)**
- Any new retrieval primitive not already delivered by M1–M5 — out of roadmap; add separately if proven useful

**Preview of M7.** Temporal. `RelationType.temporal: bool` flips on; write path closes old + creates new instead of mutating in place; reads gain an `asOf` parameter; the ANTLR rewriter injects the temporal predicate for temporal types; a history endpoint surfaces supersession chains. Forward-compat fields `_validAt` / `_invalidAt` were reserved all the way back in M1, so M7 is a behavior change, not a migration.

### M7 — Temporal (bi-temporal relations)

**Essence.** Make relations *remember* their history: world-time carries real values instead of being null. Setting `RelationType.temporal: bool` flips the behavior on per type. Writes stop mutating in place — an update closes the old relation (world-time end = now) and creates a new one (world-time start = now, superseded-link back to the old id). Reads gain an optional `asOf: datetime` parameter; the ANTLR rewriter automatically injects the temporal predicate for temporal types so existing Cypher queries and saved-query pipelines work unchanged with time-travel semantics. A history endpoint surfaces supersession chains. The temporal system fields were reserved back in M1, so this is a behavior change, not a data migration.

**Note on naming.** The specific property names used for world-time boundaries (`_validAt` / `_invalidAt` in the earlier docs) and for supersession linkage (`_supersedes`) are **not finalized**. Alternatives such as `_expiresAt` are on the table. The earlier docs use the current placeholders; they will be updated once the naming is settled, not before.

**Scope defined in:** `graphiti-inspired-rearchitecture.md` §3.4 (bi-temporal model end-state). `relation-facts-semantic-search.md` §3 notes the fields as reserved-in-Phase-1, §11 marks temporal behavior as deferred, §12 flags in-place mutation as the explicit Phase 1 behavior that flips here.

**Demo criterion.** A relation type marked `temporal: true` shows old-and-new behavior on update: the prior instance is closed with a world-time end value, a new instance is created with a world-time start value and a supersession link to the old id. `GET /search/semantic/relations?q=…&asOf=<past date>` returns the state of the graph at that past point; the same query without `asOf` returns current state. A `/relations/{id}/history` endpoint returns the supersession chain for a relation. Non-temporal relation types continue to mutate in place, unchanged.

**Not in M7 (and where it lives):**
- `EntityType.temporal: bool` (temporal entities, not just relations) → out of roadmap; add separately if a concrete use case appears
- Ingest-from-text / episodes → **M8**
- LLM-synthesized facts / per-field vectors / community detection → **M9 (optional)**
- Temporal-aware conflict resolution on concurrent writes — out of scope; standard Neo4j transaction semantics apply

**Preview of M8.** Ingest-from-text. The `ingest_episode` tool + REST endpoint accept raw unstructured content, extract entities and relations against the active ontology (extraction menu = lens), dedupe by embedding cosine, and write with provenance via the reserved `Episode` system type and `MENTIONS` relation. `dry_run` returns the extraction plan without writing. The reserved `provenance` property and `Episode` / `MENTIONS` keys were blocked from user declaration back in M1, so no retrofit.

### M8 — Ingest-from-text (episodes)

**Essence.** Accept raw unstructured content (text, chat transcript, JSON blob) and extract entities + relations against the active ontology without the caller pre-shaping the data. The active lens is the **extraction menu** — only types visible in the lens are extractable. A new `ingest_episode` tool + REST endpoint runs the extraction (LLM-based, against the schema), dedupes against existing data by entity `_embedding` cosine + canonical-name match, and writes new entities and relations with provenance linkage. An `Episode` system node type stores the raw content; a `MENTIONS` system relation type links each extracted entity/relation back to its source episode. Every created entity and relation carries a `provenance` block (`episode_id`, `extracted_at`, `confidence`). `Episode`, `MENTIONS`, and `provenance` were all reserved back in M1, so this milestone is additive, not a migration. A `dry_run: true` parameter returns the extraction plan without writing — critical for tool-use determinism and review flows.

**Scope defined in:** `graphiti-inspired-rearchitecture.md` §3.7 (ingest-from-text conceptual shape, API signature, dedupe strategy). `relation-facts-semantic-search.md` §3 reserves `Episode`, `MENTIONS`, and `provenance`; §11 defers ingestion.

**Demo criterion.** A block of free-form text is posted to `ingest_episode(content, source_type, ontology_key, group_id, reference_time)`. The response lists created / invalidated / skipped entities and relations. Every new entity and relation is reachable via `expand` from the created `Episode` node through `MENTIONS` edges. `dry_run: true` returns the same plan but writes nothing. An existing entity with a matching canonical name is reused (not duplicated) when cosine similarity clears the dedupe threshold.

**Not in M8 (and where it lives):**
- LLM-synthesized fact sentences (replacing the deterministic template) → **M9 (optional)**
- Per-field vectors (multiple embeddings per entity) → **M9 (optional)**
- Community detection (Leiden `build_communities`) → **M9 (optional)**
- Temporal-aware ingestion semantics (auto-close on contradictory extraction) — out of roadmap; assume temporal M7 is in place and handle via standard temporal writes
- Multi-modal ingestion (images, PDFs) — out of roadmap; add separately if needed
- Custom extractor plug-ins — out of roadmap

**Preview of M9 (optional).** Revisit-only-if-needed features: LLM-synthesized facts as a fallback for complex templates the deterministic engine can't express; per-field vectors for entities that want independently searchable aspects; Leiden community detection for graph analytics. All three were explicitly marked optional in the source doc; none ships unless real usage data shows the simpler primitives hit a ceiling.

### M9 (optional) — Advanced extensions: LLM facts, per-field vectors, communities

**Essence.** A parking lot for three loosely-related features marked **revisit-only-if-needed** in the source doc's §6. Unlike earlier milestones, M9 is not a commitment — it's a named slot so the ideas don't get lost and a future reader knows where they would belong if usage data ever demands them. The three candidates are independent; M9 could in principle split into three sub-milestones when picked up.

**The three candidates:**

1. **LLM-synthesized facts as a template fallback.** When a deterministic `factTemplate` cannot cleanly express a multi-clause fact (conditional grammar, plural forms, nuanced phrasing), a per-type opt-in can route fact generation through an LLM at write time. The deterministic path stays default; LLM synthesis is the escape hatch. Adds per-write model cost and non-reproducibility, which is why it is deferred until there is evidence the deterministic engine hits a real ceiling.

    **Combined with M7 temporal.** LLM synthesis can phrase the fact in past or present tense depending on whether the relation is currently valid or already closed — "Alice works on Phoenix" vs "Alice worked on Phoenix". Deterministic templates can only approximate this through brittle conditional branches around every verb; an LLM produces the correct tense naturally. For retrieval, this meaningfully reduces the risk of an LLM consuming a stored fact and mistakenly interpreting a closed (historical) relation as still active.

2. **Per-field vectors.** Entities gain multiple independent embeddings — one per "aspect" (bio vs role vs achievements, for example). Queries can target a specific aspect. Adds schema complexity and storage overhead; only worthwhile if single-embedding retrieval is measurably confusing two distinct aspects of the same entity.

3. **Community detection (Leiden `build_communities`).** Graph-analytics layer on top of the stored relations: periodic Leiden clustering produces `:_Community` nodes per group, useful for dashboards and navigation. Expensive to maintain, out of scope for retrieval itself, and entirely additive — no existing data has to change.

**Scope defined in:** `graphiti-inspired-rearchitecture.md` §6 (all three explicitly marked optional / later). `relation-facts-semantic-search.md` §11 defers each independently.

**Demo criterion.** Per candidate when activated. For LLM facts: a relation type marked to use LLM synthesis produces natural-sounding fact strings the deterministic template couldn't, including correct tense on closed temporal relations; search quality on real queries measurably improves vs the deterministic baseline. For per-field vectors: a query targeting a specific aspect returns better results than the general embedding does. For communities: `:_Community` nodes exist and cluster membership is queryable; the Leiden job runs on schedule without blocking writes.

**Not in M9 (and where it lives):**
- Everything not on the three-candidate list — out of roadmap; add a dedicated milestone if proven useful
- Picking up *all three* at once is not required; each can ship independently when a case is made for it

**What comes after M9.** Nothing on the current roadmap. Further work would be new feature proposals in `docs/feature-ideas/` — either adding to `relation-facts/` or starting a new feature folder.

---

## Parked ideas

Ideas we discussed and deliberately left off the roadmap. A new reader — human or agent — should not interpret these as upcoming milestones or open gaps. They are recorded here so the reasoning is preserved and a future, concrete use case can reopen them with context.

### `search/any` composer (cross-kind result fusion)

A single endpoint that would call both `search/semantic/entities` and `search/semantic/relations` and RRF-merge the two streams into one ranked list of mixed locators (entities and relations interleaved, tagged with `kind`).

**Parked because.** The caller almost always has to branch on `kind` downstream anyway — entities and relations lead to different next-step tools, so a mixed list just relocates the switch without eliminating it. Three overlapping MCP tools (`semantic_search_entities`, `semantic_search_relations`, `search_any`) also encourage an LLM to default to the catch-all instead of reasoning about whether it needs a thing or a fact; two sharp-edged tools give better tool-use behavior. Client-side composition is ~10 lines if genuinely wanted. Revisit only if a real use case shows mixed results are materially better than two clean calls.
