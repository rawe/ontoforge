# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo does not use a root `GLOSSARY.md`. When a skill refers to `GLOSSARY.md` or "the glossary", read [docs/glossary.md](../glossary.md) instead.

## Before exploring, read these

- **`docs/README.md`** — reading paths and the documentation map. Read the
  [concepts](../concepts.md) for the mental model and use the [glossary](../glossary.md)
  for the project vocabulary.
- **[Architectural constraints](../architecture-constraints.md)** — the concise common
  constraints to read before changing system behavior. Detailed rules remain in their
  owning documents.
- **The owning documents for the work** — read the relevant capability sections for
  behavior and rules, the interface or product sections for the surface being changed,
  and architecture or storage documentation when the change touches those boundaries.
  Follow the map from the README; a link from another document is not a substitute for
  reading the owning explanation.
- **`docs/adr/`** — read relevant linked ADRs for the context and trade-offs of consequential
  architectural choices. An ADR does not replace the current behavior in its owning document.

## Recording decisions

Every architectural decision requires user approval. Only qualifying consequential,
costly-to-reverse choices need an ADR; apply [recording decisions](../workflows/recording-decisions.md)
rather than automatically using a skill's ADR format.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the [glossary](../glossary.md). Don't drift to synonyms the glossary avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag conflicts

Check proposed changes against the architectural constraints, the relevant owning
documents and applicable ADRs. Investigate disagreements with code and tests;
surface unresolved conflicts or changes to an architectural decision rather than silently
overriding them.
