# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo does not use a root `CONTEXT.md`. When a skill refers to `CONTEXT.md` or "the glossary", read the files below instead.

## Before exploring, read these

- **`docs/README.md`** — concepts, glossary, and the map of all other docs.
- **`docs/decisions.md`** — binding rules. Output that would violate one must stop and surface the conflict.
- **`docs/adr/`** — read the ADRs that touch the area you're about to work in.

## Recording decisions

Follow the repo convention (root `CLAUDE.md`): every architectural decision requires user approval. The outcome is recorded as a rule in `docs/decisions.md`; an ADR in `docs/adr/` only when alternatives were seriously weighed — the ADR carries the deliberation and links to the rule, never the rule itself.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/README.md`. Don't drift to synonyms the glossary avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag conflicts

If your output contradicts a rule in `docs/decisions.md` or an existing ADR, surface it explicitly rather than silently overriding.
