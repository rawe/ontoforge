# Documentation Principles

These continue the two principles in the root [CLAUDE.md](../CLAUDE.md) — *consistency
first* and *single source of truth* — which apply everywhere. The ones below apply to
writing under `docs/`, and keep their original numbering.

3. **Progressive disclosure.** Layer documents from overview to detail. High-level docs link to deeper docs, not duplicate their content.
4. **When redundancy exists, maintain consistency.** Brief summaries referencing detail docs are acceptable. But if two places state the same fact, both must stay in sync. When they diverge, flag it.
5. **Don't document what the code makes obvious.** Reference code by semantic anchors (module names, class names, section names) — never by file:line numbers. Feature docs should weave code references into prose, not be bare reference lists. Avoid code blocks in docs unless needed to illustrate a major pattern.
6. **Respect document lifecycle.** Documents form a directed chain: concepts → architecture → capabilities → code. Later documents may reference earlier ones, never the reverse. Place information where it belongs in this lifecycle.
7. **Status quo only.** `docs/` describes the system as it is. No history, no dates, no "planned", no migration notes, no rejected alternatives — those belong in `docs/adr/`. Unbuilt ideas are not documented at all.
8. **Technology-neutral above the adapter.** Everything in `docs/` except `storage-adapters.md` must hold for a reimplementation in another language. No library names, no file paths, no class or function names.
