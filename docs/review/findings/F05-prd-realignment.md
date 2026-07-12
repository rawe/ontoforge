# F05 — PRD Describes the Pre-Lens Product Model

> **Severity: High (doc root cause)** · **Effort: Medium** · **Type: Documentation rewrite**

## Finding

`prd.md` still describes the original "an ontology owns its schema" product model. It is the
root of most downstream contradictions, because the docs lifecycle is PRD → Architecture → Code
and the PRD is the anchor everything else must be consistent with. Concrete contradictions:

| PRD says | Reality (architecture.md / code) |
|---|---|
| §3.2/§3.3/§7.1: type keys "unique within an ontology" | Keys are globally unique (Neo4j constraints) |
| §3.1: ontology *has* collections of entity/relation types | Ontologies are lenses over a global schema |
| §3.5: instance "belongs to exactly one ontology" | Instance data is shared across all ontologies |
| §5: modeling API addresses ontologies by UUID | Ontology CRUD uses UUID, but agents/saved queries use the key |
| §6: export/import is per-ontology | Export/import is one global document (`formatVersion` 2.2) |
| §9.4: MCP as separate processes wrapping REST (planned) | MCP embedded in FastAPI, calls services directly (decision 005) |
| §9.5: MCP tools mapped 1:1 to REST | Consolidated tool set (27 modeling / 17 runtime) |
| §3.4: property field `type`, "string only in MVP" | Field is `dataType` with 6-value enum |
| §2/§4: MCP, runtime "(planned)" | Both shipped, plus AI runtime, semantic search, saved queries |

## Impact

Anyone (human or AI session) using the PRD as ground truth will re-derive the old model. Given
CLAUDE.md's "consistency first — STOP on inconsistency" rule, a stale PRD actively blocks
AI-assisted work: every session that reads PRD + code must stop and ask.

## Proposed Correction

Rewrite `prd.md` as the product-level description of the **current** vision (it is a living PRD,
not a historical artifact):

- Core concepts: global schema, ontologies as lenses (unscoped/scoped), shared instance data.
- Scope: modeling mode, runtime mode, MCP (embedded, two servers), optional AI features and
  semantic search as product capabilities (provider-gated).
- Keep §9.6 Future Extensions as the honest backlog (auth, cardinality, versioned migrations…),
  pruned of what has shipped.
- Keep the PRD at product level — no endpoint tables, no storage details (those belong to
  architecture/contracts, per the progressive-disclosure principle).

## Dependencies

- Do **after** F08 (architecture.md consolidation) so the PRD can reference a corrected
  architecture document instead of restating details.
- The "ontology owns schema → lens model" pivot should get a decision entry (F09).

## Acceptance

- No statement in prd.md contradicts architecture.md or the code.
- PRD contains no "(planned)" markers for shipped functionality.
