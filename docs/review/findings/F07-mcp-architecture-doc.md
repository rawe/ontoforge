# F07 — mcp-architecture.md Describes the Pre-Lens Modeling MCP

> **Severity: High** · **Effort: Medium** · **Type: Documentation rewrite**

## Finding

`docs/mcp-architecture.md` reflects the old per-ontology modeling model, while the code implements
a **global** modeling MCP where the ontology is an explicit tool argument:

- Doc: modeling MCP mounted at `/mcp/model/{ontologyKey}`, "no tool takes an ontology parameter",
  ontology key resolved from URL/header. Code: mounted at `/mcp/model` with **no** middleware;
  ontology-affecting tools take an explicit `ontology_key` parameter.
- Tool catalog drift: 6 registered tools are undocumented (`delete_ontology`,
  `add/remove_entity_type_to/from_ontology`, `add/remove_relation_type_to/from_ontology`,
  `validate_ontology`); the header claims 27 tools but lists 21; several documented signatures
  are wrong (`set_saved_query` takes `steps`, not `cypher`; `import_schema` has no `overwrite`;
  `create_ontology(key, name, description)`; `cascade` flags undocumented).
- Wire-name mismatch: the doc calls the Cypher tool `cypher_query`, the registered name is
  `execute_cypher_query`. `run_saved_query`'s argument is `params`, not `parameters`.
- The §5 client-config examples show a modeling URL with an ontology key
  (`/mcp/model/my_ontology`) that the server cannot resolve — the actual example files in the
  repo root are correct; the doc's inline snippets are not.
- `decisions.md` 006/007 also record the modeling MCP as key-scoped (`/mcp/model/{key}`) —
  superseded by the lens model but never amended (see F09).

The runtime MCP section is largely accurate (17 tools, resolution order URL → header → env var),
except for undocumented `fields`/`filters` parameters.

## Impact

MCP is OntoForge's flagship integration surface — this doc is what users read to connect agents.
Wrong mount URLs and wrong tool signatures produce broken client configs and confused LLM tool
use.

## Proposed Correction

Rewrite the modeling half of `mcp-architecture.md` around the global-schema model, regenerate
both tool catalogs from the registration code (`_MODELING_TOOL_DEFS`, `_MCP_TOOL_DEFS` — names,
signatures, descriptions are all in one place there), fix the §5 examples to match
`mcp-example*.json`, and document the real trust model (see F04). Add `constants.py` to the
module list and the `tool_names.py` dependency note.

Consider adding a small doc-drift guard: a backend test that renders the registered tool names
into a fixture and fails when the doc's catalog table diverges — cheap protection for the most
drift-prone doc in the repo.

## Dependencies

- After F08 (architecture facts), alongside F06. Decision entries via F09.

## Acceptance

- Every registered MCP tool appears in the doc with its wire name and actual signature; the doc's
  config snippets are byte-compatible with `mcp-example.json` / `mcp-example-header.json`.
