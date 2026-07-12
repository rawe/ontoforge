# F03 — Modeling→Runtime Coupling Exceeds the Documented Boundary

> **Severity: Medium (architecture erosion)** · **Effort: Medium** · **Type: Code refactoring + doc update**

## Finding

`architecture.md` §3.2 and `decisions.md` 004 define the dependency rule
`modeling → core ← runtime` and state that the **only** coupling from modeling to runtime is the
schema-cache invalidation call. In reality, `modeling/service.py` imports four runtime internals:

| Import | Used for |
|---|---|
| `runtime.embedding.build_text_repr` | Rebuilding embeddings on schema change |
| `runtime.service.PropertyDef`, `to_pascal_case` | Label conversion / property metadata |
| `runtime.tool_names.VALID_AGENT_TOOLS` | Validating AI agent tool lists |
| `runtime.cypher.validate_and_rewrite` | Validating saved-query Cypher at design time |

The reverse rule (runtime never imports modeling) still holds.

## Assessment

None of these imports is wrong *functionally* — modeling legitimately needs label conversion,
Cypher validation, and the tool-name registry. The problem is that this shared logic lives in
`runtime/` although it is not runtime-specific. The documented architecture was right; the code
grew past it without the shared pieces being lifted into `core/`. Left alone, the boundary keeps
eroding and "extract runtime as its own service later" (decision 001's escape hatch) quietly
becomes impossible.

## Proposed Correction

Move genuinely shared building blocks to `core/` (mechanical refactor, no behavior change):

- `to_pascal_case` / `to_upper_snake_case` and naming helpers → `core/naming.py`
- Cypher validation/rewriting (`runtime/cypher.py`) → `core/cypher.py` — it validates against a
  schema cache, which both modules consume
- Text-representation builder for embeddings (`build_text_repr`) → `core/embedding.py`
  (the provider ABC already lives there)
- Tool-name constants (`runtime/tool_names.py`) → `core/tool_names.py`

After the move, the modeling module imports only `core/` plus the single documented
`invalidate_loaded_schema_cache()` hook. Update `architecture.md` §3.1/§3.2 and `decisions.md`
004 to reflect the final layout (part of F08/F09).

## Dependencies

- Independent of all other findings; best done **before** new features add more cross-imports.
- Touches many import statements — do it in one dedicated PR with the full test suite as a guard.

## Acceptance

- `grep "from ontoforge_server.runtime" backend/src/ontoforge_server/modeling/` returns only the
  cache-invalidation import.
- All backend tests pass unchanged.
