# Relation-facts roadmap

**Status:** active
**Last updated:** 2026-04-20 (M3 cut; generalized `expand` de-promised from M6)

## What this is

The implementation roadmap for the relation-facts feature. Each milestone is **deployable on its own** and **delivers user-visible value or prevents future migration**. Milestones are ordered — earlier ones unblock later ones. Detailed scope lives in the two companion docs; this roadmap only captures the slicing, the check-off boundary, and the order.

## Companion docs

- [graphiti-inspired-rearchitecture.md](graphiti-inspired-rearchitecture.md) — end-state vision and full phase plan
- [relation-facts-semantic-search.md](relation-facts-semantic-search.md) — Phase 0 + Phase 1 implementation plan, referenced by the early milestones below

## Milestones

- [x] **M1 — Walking skeleton for semantic relation search** _(shipped 2026-04-20, branch `feature/relation-facts`)_
- [x] **M2 — Staleness + reconcile worker** _(shipped 2026-04-20, branch `feature/relation-facts`)_
- ~~**M3 — Graph expansion, first hop (`expand`, depth = 1)**~~ **Cut** — see below.
- [ ] **M4 — Entity-side semantic parity**
- [ ] **M5 — Fulltext + hybrid search**
- [ ] **M6 — Saved-query pipelines as composable step types**
- [ ] **M7 — Temporal (bi-temporal relations)**
- [ ] **M8 — Ingest-from-text (episodes)**
- [ ] **M9 (optional) — Advanced extensions: LLM facts, per-field vectors, communities**

### M1 — Walking skeleton for semantic relation search ✅

**Status:** shipped 2026-04-20 on branch `feature/relation-facts`. 286 unit tests pass; integration tested end-to-end against live Neo4j 2026.02 + Ollama `nomic-embed-text`.

**Essence.** Minimum end-to-end path: define a relation type with a fact template, create instances, query semantically, get back matching facts with their fact strings. The core capability, working for demos and narrow pilots. Phase 0 system-property reservations ride along so later milestones don't need a migration.

**Scope defined in:** `relation-facts-semantic-search.md` §3 (Phase 0 reservations), §4 (`factTemplate` modeling), §5 (storage + per-type vector index), §6.1 (create write path), §7.1 (the new semantic endpoint), §8 (MCP tool).

**Demo criterion.** A relation type with a fact template has instances. `GET /search/semantic/relations?q=…` and the matching MCP tool return expected facts with `_fact` + endpoint IDs. Existing endpoints untouched.

**What shipped (brief):**
- **Modeling** — `RelationType.factTemplate: string | null` on create/update/response/export/import and in the modeling MCP tools. Constrained sandboxed-Jinja2 validator (`modeling/fact_template.py`) enforcing filter whitelist, tag whitelist, 2000-char source cap, `__` rejection, and variable-reference checks against the declared source/target/relation property sets. Reserved-schema-key blocklist (`episode`, `mentions`, `provenance`, case-insensitive). User property keys starting with `_` rejected.
- **Storage** — per-semantic-relation-type vector index created idempotently at startup and on `factTemplate` set, with `WITH [_groupId, _validAt, _invalidAt, _relationTypeKey]` pushed into the index.
- **Runtime write path** — every entity and relation write now persists the Phase 0 system properties (`_groupId`, `_validAt`, `_invalidAt`, `_embeddingState`, `_embeddingVersion`); a one-shot idempotent backfill runs at startup for pre-existing data. Semantic relations additionally render `_fact` from the template, try-sync-embed, and set `_factVersion`. Embedding failure is graceful: the relation is still persisted with `_embeddingState="failed"`.
- **Read path** — `GET /api/runtime/{ontologyKey}/search/semantic/relations?q=…&limit=…&groupId=…&k=…`: embeds `q`, fans out one Cypher vector search per eligible relation type in parallel, fuses with RRF in application code, isolates per-index failure. Matching MCP tool `semantic_search_relations`. Response shape per §7.1 (locator + `_fact` + `score` + `matched_via:["vector"]`; no user-defined relation properties).
- **Frontend** — relation-type editor (create + edit) gains a "Fact template" textarea with helper text; a "Semantic" badge appears on list cards and the editor header when `factTemplate` is non-null. Backend 422 messages surface via the existing toast flow.
- **Docs** — `docs/api-contracts/modeling-api.md` and `docs/api-contracts/runtime-api.md` updated.

**Known follow-ups (not bugs, by design):**
- Hidden-data leak via `_fact` when a template references a property hidden by the lens's allowlist (§4.4) — accepted risk, mitigation parked.
- Pre-existing doc drift in `docs/api-contracts/modeling-api.md` (uses `sourceEntityTypeId` / nested `/ontologies/{id}/...` paths while the implementation uses `sourceEntityTypeKey` / flat routes). Out of M1 scope, worth reconciling separately.

**Not in M1 (and where it lives):**
- Staleness when entity properties change → **M2**
- Graph expansion from a seed entity (1-hop) → **cut** (see M3). Use existing `get_neighbors` for depth-1 traversal.
- Entity-side cross-type semantic search + `embeddable` → **M4**
- Fulltext / hybrid → **M5**
- Saved-query steps + deeper graph traversal (multi-hop, multi-seed) → **M6**
- `search/any` composer → bundled into **M4**
- Temporal → **M7**
- Ingest-from-text / episodes → **M8**

### M2 — Staleness + reconcile worker ✅

**Status:** shipped 2026-04-20 on branch `feature/relation-facts`. 310 unit tests pass (baseline 291 + 19 new). Scope delivered matches the spec exactly: no new endpoint, no schema additions, no per-type templateVersion.

**What shipped (brief):**
- **Entity-update stale-marking** (§6.2) — `runtime/repository.py::update_entity` runs a second statement against the same session after the primary `SET`, flipping every adjacent semantic relation (undirected `-[r]-()` with `r._factVersion IS NOT NULL`) to `_embeddingState = "stale"`. Gated on `set_properties` or `remove_properties` being non-empty; no-op updates skip the pass.
- **Template-update stale-marking** (§6.3) — `modeling/service.py::update_relation_type` runs a single `MATCH ()-[r]-()` statement after a successful schema write whenever `fact_template_provided` is true (set / change / clear all trigger it), marking every instance of that relation type stale. Runs before `_invalidate_runtime_schema_cache()` and index creation.
- **Background reconcile worker** (§6.4) — new `runtime/reconcile.py`. `run_reconcile_loop(driver)` is a single asyncio task started in `main.py` lifespan when an embedding provider is configured, cancelled + awaited on shutdown. `drain_once` picks up to `RECONCILE_BATCH_SIZE` stale/failed semantic relations per pass, reconciles each (re-render + re-embed), and reports `{processed, failed, skipped}`. Template-null path zeros out `_fact` / `_embedding` / `_factVersion` and sets state to `ok`.
- **In-memory exponential backoff** — keyed by relation `_id`, `(attempts, last_attempt_epoch)`, base 30s / cap 1h / max 10 attempts. Not persisted: process restart re-reads the DB and retries everything.
- **Two config knobs** in `config.py`: `RECONCILE_INTERVAL_SECONDS` (default 30) and `RECONCILE_BATCH_SIZE` (default 50).
- **Docs** — `docs/api-contracts/modeling-api.md` notes the `factTemplate` PATCH side effect; `docs/api-contracts/runtime-api.md` notes the entity-update side effect.

**Essence.** M1 ships a feature that works on day one and slowly drifts afterwards: change Alice's `displayName` and every `_fact` referencing her is outdated, but still what semantic search matches against. M2 closes that correctness gap so the feature is trustworthy under real data evolution. Entity updates mark touched semantic relations as stale (dumb, over-inclusive rule); a background worker re-renders `_fact` and re-embeds. `factTemplate` changes and previously failed embeddings use the same path.

**Scope defined in:** `relation-facts-semantic-search.md` §6.2 (entity-update propagation), §6.3 (template-update propagation), §6.4 (background reconcile worker). `_embeddingState` / `_embeddingVersion` / `_factVersion` were already reserved in M1, so M2 only adds behavior.

**Demo criterion.** Change a property that a semantic relation's template references; within the reconcile window, that relation's `_fact` and `_embedding` reflect the new value, and `search/semantic/relations` returns content consistent with the update. A previously `failed` relation recovers once the model is available again.

**Not in M2 (and where it lives):**
- Template-to-property dependency index (narrowing the "mark-all-touching" rule) → later, not a milestone — revisit only if the stale queue becomes a bottleneck
- Graph expansion → **cut** (see M3).
- Everything deferred from M1 stays deferred

### M3 — Cut: Graph expansion, first hop (`expand`, depth = 1)

**Status:** cut after scope analysis. Not shipping. Earlier draft spec lives in `relation-facts-semantic-search.md` §7.2 for history but is not implemented.

**What this was going to be.** A depth-1 `search/expand` endpoint returning every relation touching a seed entity in a uniform locator shape, positioned as the narrow start of the generalized expand primitive (§3.5 #5).

**Why it's cut.**

1. **`get_neighbors` already covers depth-1 traversal.** It supports direction, per-type filtering, field projection, and already returns `_fact` on semantic relations via `relationFields=["_fact"]`. The M3 endpoint's only real differences would have been a multi-type whitelist (saves one client-side merge) and a flat response shape (saves three lines of client `.map`). Neither is a capability gap.
2. **The `_groupId` filter was semantically wrong here.** Groups partition the working set; a seed entity lives in exactly one group, so its edges belong to that group by construction. A group predicate on a traversal primitive is either a no-op or nonsense — it belongs on search endpoints, not on expand.
3. **Uniform-locator composability with `search/semantic/relations`** was the strongest architectural argument, but the payoff only materializes when saved-query pipelines actually chain them — and the generalized expand those pipelines would need is itself deferred (see M6).
4. **Every new MCP tool is surface area** — docs, tests, LLM tool-choice confusion. Shipping a thin primitive that duplicates 90% of `get_neighbors` makes the tool menu worse, not better.

**What happens instead.** `get_neighbors` stays as-is. If a real user hits the multi-type-filter papercut, the fix is a ~3-line signature swap (`relation_type_key: str` → `relation_type_keys: list[str]`). Done then, not now.

**The generalized expand primitive (multi-hop, multi-seed, per-hop filters, ranking) is now open-ended**, not reserved inside M6. Re-opening criteria: concrete user cases where Cypher + the saved-query engine + `get_neighbors` are demonstrably insufficient for LLM-driven traversal. Ranking must be designed first (depth decay? embedding overlay? cross-encoder reranker?) before any `expand` primitive ships.

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
- Multi-hop / multi-seed `expand` → **no longer promised** (see M3 and M6).
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
- Multi-hop / multi-seed `expand` → **no longer promised** (see M3 and M6).
- Temporal → **M7**
- Ingest-from-text → **M8**
- Cross-kind hybrid (one endpoint returning entities + relations hybrid-fused) — extension of the `search/any` parked idea; stays parked

**Preview of M6.** Saved-query pipeline integration. Everything shipped through M5 becomes a composable step type, turning the "NL query → structured, typed result" pattern into a first-class surface backed by deterministic composable steps rather than glue code.

### M6 — Saved-query pipelines as composable step types

**Essence.** Every search capability shipped through M5 becomes a saved-query **step type** (`semantic_search_entities`, `semantic_search_relations`, `hybrid_search`, `fulltext`), so callers can chain them declaratively inside the existing pipeline engine. This turns the "NL query → structured, typed result" pattern into a first-class surface backed by deterministic composable steps rather than glue code.

**Scope defined in:** `graphiti-inspired-rearchitecture.md` §3.6 (saved-query pipeline step types and the canonical NL → typed-result pattern). The existing saved-query pipeline engine is the integration point.

**Demo criterion.** A saved query of the form *"NL query → semantic match → fulltext filter → return typed entities"* runs end-to-end. All new step types appear in the pipeline schema and compose with existing `cypher` and `semantic_search` steps.

**Not in M6 (and where it lives):**
- **Generalized `expand` (multi-hop, multi-seed, per-hop filters, ranking) — no longer promised.** M3 was cut (see above) and the generalized form is open-ended: re-opened only if concrete user cases show Cypher + saved queries + `get_neighbors` are insufficient. Ranking must be designed before any `expand` primitive ships.
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
