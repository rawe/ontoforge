# Recording architectural decisions

Every architectural decision needs the user's approval before it is made
([AGENTS.md](../../AGENTS.md)). Once approved, it is written down in up to three places,
each answering one question:

| Question | Where |
|---|---|
| What does the system do now? | The owning document ([one home per fact](../AGENTS.md)) — always |
| Which boundary must every change preserve? | [architecture-constraints.md](../architecture-constraints.md) — rarely |
| Why this and not the obvious alternative? | An ADR in [adr/](../adr/) — only when alternatives were weighed |

Most decisions need only the owning document.

## Architectural constraint

Add an entry only when it protects an important architectural boundary or guarantee that
contributors need before designing any change. State the obligation in one bold sentence,
a short reason and a link to its home. Feature defaults, limits, naming conventions and
procedures stay with their owners.

## ADR

Write an ADR when alternatives were seriously weighed and would plausibly be proposed
again. Rejected alternatives are written only in an ADR; the owning document links to it.

One file per decision, `adr/NNNN-slug.md`, numbered above any number used before; numbers
are never reused.

```markdown
# <The decision, as a short title>

Current behavior: <links to the owning documents>

## Context

<The situation that forced a choice, in two or three sentences.>

## Decision

<The choice and its scope, in one or two sentences.>

## Consequences

<Only when not obvious: the important costs and risks.>

## Rejected

- **<Alternative>.** <Why not, in one or two sentences.>
```

An ADR carries no status or date and does not repeat the owning document's rules.

## When a decision changes

`adr/` holds only decisions in force; git keeps the history. Update the owning document,
then rewrite or delete the ADR so it states the decision as it now stands. Write a new ADR
only if the new decision was itself weighed against alternatives.
