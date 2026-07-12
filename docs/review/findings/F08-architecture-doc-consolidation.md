# F08 — architecture.md Is Missing Whole Shipped Subsystems

> **Severity: High (anchor document)** · **Effort: Large** · **Type: Documentation consolidation**

## Finding

`architecture.md` is the system's anchor document, and it is mostly *correct* about what it
covers — but it stops at roughly the v2.0 feature set. Everything since is either missing or
wrong:

**Missing subsystems**
- **AI runtime**: `core/ai.py`, `runtime/ai_service.py`, AI endpoints (`/ai/query|extract|chat`,
  per-agent chat), AI agent configs, and the **A2A protocol** surface
  (`/.well-known/agent.json`, `/a2a`, `PUBLIC_URL`) — none appear in §3.
- **Embedding/semantic-search subsystem**: provider ABC, startup initialization, per-type +
  cross-type + saved-query vector indexes, Neo4j 2026 in-index `SEARCH` filtering, the 32 KB
  filter-value guard. §4.1 mentions indexes in passing; the subsystem design is undocumented.
- **Module tree** (§3.1) omits `core/ai.py`, `core/embedding.py`, `runtime/ai_service.py`,
  `runtime/cypher.py`, `runtime/embedding.py`, `runtime/tool_names.py`.

**Stale facts**
- §3.2/§4.4: export `formatVersion` "2.1" → code is **2.2**; SavedQuery is documented as a single
  `cypher` string but is a **steps pipeline** (`cypher` | `semantic_search`, bindings).
- §5.3 endpoint table misses `/features`, `/search/semantic`, `/query`, saved-query endpoints,
  and all AI/A2A endpoints.
- §6.2 "Runtime UI: Deferred to Phase 3" → a full runtime UI shipped (dashboard, instance lists,
  data graph, AI pages, agents, saved queries). §2 naming table still has "MCP: TBD".
- §7 exceptions table misses `CASCADE_REQUIRED` and `INVALID_JSON` (see F02).
- §8 config table misses all `EMBEDDING_*`, `AI_*`, and `PUBLIC_URL` settings; the Neo4j 5→2026
  upgrade is not reflected.
- §4.1 constraint listing omits `entity_type_key_unique`/`relation_type_key_unique` and misnames
  `agent_config_id_unique`.

**Structural issue** — the real specification of the lens model lives in
`docs/feature-ideas/ontology-views.md` ("Status: Implemented"), which is more detailed than
architecture.md itself (four-case scoping matrix, default application, cascade rules). The
architecture chapter of record lives in the ideas folder.

## Proposed Correction

One consolidation pass on `architecture.md`, treating the code as ground truth:

1. Fold the normative content of `ontology-views.md` (scoping matrix, property filtering,
   defaults, cascade enforcement) into §4; the ideas file then becomes a short pointer or is
   archived (see F09).
2. Add §3 sections for the embedding subsystem and the AI/A2A subsystem (design-level: providers,
   feature gating via `EMBEDDING_PROVIDER`/`AI_PROVIDER`, tool allowlists, A2A exposure).
3. Refresh the mechanical facts listed above (module tree, endpoint table, exceptions, config,
   formatVersion, SavedQuery steps, constraints, Neo4j 2026, §6 frontend incl. runtime UI and
   React Query, naming table).

This is the **first** doc to fix — F05, F06, F07, F10 all reference it.

## Dependencies

None upstream. Downstream: F05, F06, F07, F09, F10.

## Acceptance

- A reader of architecture.md alone can name every mounted router, subsystem, and config
  variable that exists in `main.py`/`config.py`.
- No statement contradicts the code; `ontology-views.md` no longer carries normative content.
