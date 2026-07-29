# Session 09 — Saved queries and agent configurations

**Goal:** the two per-lens stored configurations: saved queries (define, run, search) and
agent configs (define only — running them is session 11). Modeling + runtime + MCP.

**Prerequisites:** 01–08 (07 for OQL steps, 08 for description embedding and
`semantic_search` steps).

**Normative:** `docs/capabilities/saved-queries.md` (entire document — pipeline,
parameters, bindings, definition-time vs run-time validation, execution order, discovery),
`docs/capabilities/ai-agents.md#agents` (config fields + rules; the grantable tool set),
`docs/interfaces.md` (agent-config + saved-query routes — **addressed by ontology key
and item key**, unlike the rest of modeling REST; runtime saved-query routes; the
grantable-tools list under "Runtime tools").

**Reference (Python):** `core/ai.py` (AgentConfig / SavedQueryConfig / StepConfig
dataclasses), `runtime/tool_names.py` (`VALID_AGENT_TOOLS` — the exact ten),
`modeling/service.py` + `modeling/router.py` (both config surfaces),
`runtime/service.py` (execution, listing from cache, search), `mcp/modeling.py`,
`mcp/runtime.py`, `adapters/neo4j/modeling_store.py` (agent + saved-query storage,
including the denormalized ontology key + description embedding on the saved-query node).

## Scope

**In:**
- **Agent configs (modeling):** `GET/PUT/DELETE /api/model/ontologies/{ontologyKey}/ai-agents[/{agentKey}]`.
  Key pattern `^[a-z][a-z0-9_-]*$`; PUT is upsert answering 201/200; fields: name,
  description, systemPrompt, tools allowlist. Allowlist validated against the fixed
  ten-name grantable set (define the constants now; the tools themselves run in 11) —
  an unknown name is rejected and the error names the valid set. Deleting the lens
  deletes its agents; every mutation invalidates the schema cache. MCP:
  `list_ai_agents`, `set_ai_agent`, `delete_ai_agent`.
- **Saved queries (modeling):** same route/upsert shape under `saved-queries`. Full
  definition-time validation, all failures collected: key pattern (hyphens allowed);
  ≥1 step; step names `^[a-zA-Z_]\w*$` unique; per-type required fields (`oql` → query;
  `semantic_search` → entity type key + search text, limit 1–100 default 10, min_score
  0–1); bindings exactly `{{stepName.fieldName}}` referencing a strictly earlier step;
  parameter cross-checks **both directions** (every non-binding `$name` declared; every
  declared parameter referenced — so a binding-supplied name must NOT be declared);
  parameter types = any data type except `document`; each `oql` step parsed and
  lens-checked (skipped only when the lens schema cannot load). Description embedded on
  write (and re-embedded on description edit); stored steps/parameters as serialized
  text the store does not interpret. MCP: `list_saved_queries`, `set_saved_query`,
  `delete_saved_query`.
- **Runtime:** `GET /saved-queries` (served **from the schema cache**),
  `POST /saved-queries/{queryKey}/run`, `GET /saved-queries/search` (`q`, `limit` 1–20
  default 3, `min_score` default 0.7; embedding-backed, FEATURE_DISABLED without a
  provider; returns key/name/description/parameters/score — never steps). Execution
  semantics, exactly per docs: exact parameter match (no optionals, no defaults; missing
  and unrecognized collected together), strict coercion collected per parameter, steps
  in order, bindings resolved to flat row-order lists (rows lacking the field skipped;
  empty list flows on), `oql` steps get **all** coerced parameters plus their bindings
  (binding wins on collision) as bound query parameters; `semantic_search` steps get
  **textual** `$name` substitution and **ignore bindings**; `_score` available as a
  binding field on search-step rows; last step's output returned, post-processed like
  an ad-hoc query; a pipeline containing a `semantic_search` step fails without a
  provider. Nothing proactively invalidates stored pipelines — a schema change surfaces
  at next run. Runtime MCP: `list_saved_queries`, `run_saved_query`,
  `search_saved_queries`.
- Rebuild (08) now actually re-embeds saved-query descriptions — turn that list-and-set
  path live and extend the rebuild integration test.

**Out:** running agents (11), transfer of both (10).

## Test plan

Port `backend/tests/modeling/test_saved_queries.py`, `test_ai_agents.py` (config parts),
`backend/tests/runtime/test_saved_queries.py`:

- **Unit:** every definition-time rule with collect-all; both cross-check directions
  incl. the binding-name-must-not-be-declared consequence; forward/self binding
  rejection; run-time exact-match + coercion collection; binding resolution (flat list,
  skipped rows, empty); binding-wins-collision; textual substitution incl. unmatched
  `$name` left verbatim; agent allowlist validation.
- **Integration (Ollama):** define → run a two-step pipeline (search step feeding an
  `oql` step via binding... note bindings on search steps are ignored — test the
  documented direction: oql → oql, and search → oql); saved-query search ranks by
  description; runtime listing reflects cache invalidation after an upsert.
- **MCP:** all six tools; upsert created-vs-updated reporting.

## Definition of done

Frontend saved-query editor, run panel, quick-run cards, and agents tab work against the
TS server. All tests + regression green. Overview updated.
