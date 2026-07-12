# F09 — Decision Log Stopped at 007; Shipped Features Live in the Ideas Folder

> **Severity: Medium (process)** · **Effort: Small–Medium** · **Type: Documentation process**

## Finding

Two related process breakdowns:

**1. `decisions.md` is frozen at decision 007** while at least these architecture-shaping
decisions were made and shipped afterwards:

- The **lens-model pivot** (global schema, ontologies as views — a self-described breaking change)
- Embedding/semantic-search subsystem and provider abstraction (Ollama + OpenAI-compatible)
- **Neo4j 5 → 2026 upgrade** with in-index vector filtering (and dropping `__contains` on
  semantic search)
- AI runtime engine (PydanticAI, tool allowlists, agent configs, A2A exposure)
- Saved queries as **multi-step pipelines** (replacing single-Cypher, format 2.1 → 2.2)
- Claude plugin / skill distribution model

Worse, decisions 006/007 now contradict reality (modeling MCP documented as `/mcp/model/{key}`,
implemented as global `/mcp/model`).

**2. Implemented features are documented only in `docs/feature-ideas/`** — `ontology-views.md`
("Status: Implemented"), `cypher-query.md`, `ai-runtime.md`, `saved-queries*.md`, large parts of
`semantic-search-extensions.md`, and `in-index-vector-filtering.md` ("Changes Implemented") are
de-facto feature documentation wearing an "idea" label. `_feature_drafts.md` still lists shipped
features (Cypher query, OpenAI embeddings) as drafts. This violates the repo's own lifecycle rule
(PRD → Architecture → Code) and its single-source-of-truth principle.

## Impact

The decision log is the tool that makes the "every architectural decision needs user approval"
rule auditable — with a frozen log, past decisions are unrecoverable context. The ideas-folder
drift means the *most accurate* docs in the repo are the ones labeled as speculation.

## Proposed Correction

1. **Backfill `decisions.md`** with concise entries (008+) for the six decisions above, and amend
   006/007 with a one-line "superseded by the lens model: modeling MCP is global" note (merge
   rather than chain, per the log's own rules).
2. **Introduce a `docs/features/` tier** for shipped-feature documentation. Move the implemented
   content of `ontology-views.md` into architecture.md (F08) and relocate
   `cypher-query.md`, `ai-runtime.md`, `saved-queries*.md`, `in-index-vector-filtering.md`, and
   the implemented sections of `semantic-search-extensions.md` to `docs/features/` (updated to
   present tense, stripped of proposal language). `docs/feature-ideas/` then contains only real
   ideas: auth, data scoping, and the remaining semantic-search extensions.
3. Prune `_feature_drafts.md` to the two genuinely open drafts.
4. Update the README's docs listing (it omits `testing.md`, `testing-strategy.md`,
   `runtime-usage.md`, `runtime-ui-architecture.md`) and skill-and-marketplace.md's stale script
   paths.

## Dependencies

- Step 2 depends on F08 (architecture absorbs the normative lens-model content first).
- The `docs/features/` tier is a structure decision → confirm with the user before moving files.

## Acceptance

- Every file under `docs/feature-ideas/` describes something that does not exist yet.
- `decisions.md` explains, in order, how the system got to its current shape.
