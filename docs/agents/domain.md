# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo does not use a root `GLOSSARY.md`. When a skill refers to `GLOSSARY.md` or "the glossary", read the glossary section of `docs/README.md` ([docs/README.md#glossary](../README.md#glossary)) instead.

## Before exploring, read these

- **`docs/README.md`** — concepts, the map of all other docs, and the [glossary](../README.md#glossary).
- **`docs/decisions.md`** — binding rules. Output that would violate one must stop and surface the conflict.
- **`docs/adr/`** — read the ADRs linked from the rules that touch the area you're about to work in.

## Recording decisions

Every architectural decision requires user approval. Record it as [docs/workflows/recording-decisions.md](../workflows/recording-decisions.md) describes; it replaces the skill's own ADR format.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the [glossary](../README.md#glossary). Don't drift to synonyms the glossary avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag conflicts

If your output contradicts a rule in `docs/decisions.md` or an existing ADR, surface it explicitly rather than silently overriding.
