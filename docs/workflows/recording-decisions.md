# Recording architectural decisions

This guide explains when to record an architectural decision and where the resulting
information belongs. Approval and recording are separate: the root
[AGENTS.md](../../AGENTS.md) states when to involve the user in an architectural choice.
Existing ADRs were written under a broader threshold and are pending review against this
guide. Their presence alone does not mean a similar new choice warrants an ADR; retain
them until their useful content and links have been reviewed.

## What deserves an ADR

An architecture decision record (ADR) is for a consequential architectural choice
whose reversal would be costly or disruptive. Use judgment: consider the breadth of
impact, the cost of migration or replacement, and effects on data, security,
deployment, interoperability and compatibility. A decision need not affect every
component to be consequential. Record the trade-off when its context will matter to
someone revisiting it later.

Routine implementation choices, naming conventions, individual feature rules, defaults,
limits and procedures do not by themselves need an ADR. A decision is not important
merely because alternatives were considered or an agent might make a mistake. Discuss a
choice with the user when required even if it does not warrant a record.

When unsure, explain the choice, consequences and likely cost to reverse it rather than
creating an ADR by default. If the trade-off is still unclear, raise it for review.

## Where information belongs

- **System structure and major invariants:** [architecture.md](../architecture.md).
- **Feature behavior, constraints, limits and examples:** the owning document in
  [capabilities/](../capabilities/).
- **Interface behavior and access:** [interfaces.md](../interfaces.md); the web client
  belongs in [product-surface.md](../product-surface.md).
- **Storage contract and implementation:** [storage-adapters.md](../storage-adapters.md).
- **Configuration and procedures:** the configuration table in the root
  [README.md](../../README.md) and the relevant [workflow](./).
- **Terms:** the [glossary](../README.md#glossary).
- **The reasoning behind a hard-to-reverse architectural choice:** an ADR in [adr/](../adr/).

The current [decisions.md](../decisions.md) is an existing collection of rules, not a
requirement to add an entry for every choice. Its contents remain in force while they are
reviewed and moved to their owning documents. Preserve their meaning and update links
when moving them; do not remove a rule just because it does not merit an ADR.

## Write an ADR

Write one short record per consequential decision. Use a four-digit number greater than
any previously used in `adr/NNNN-slug.md`; numbers are never reused, including after a
record is removed. Include the decision itself so the record can be understood without
reconstructing it from rejected options:

```markdown
# <Decision title>

## Context

<The problem, relevant constraints and why a choice is needed.>

## Decision

<The choice and its scope.>

## Consequences

<The important benefits, costs, risks and implications of reversing it.>

## Alternatives considered

<The material alternatives and why they were not chosen, when useful.>
```

Keep only the context and alternatives needed to understand the trade-off. The current
system's behavior and rules belong in their owning documents; an ADR explains why a
major choice was made and does not replace them. Link to a relevant ADR where its
rationale helps a reader, rather than requiring every rule to link to one. Existing ADRs
may use an older format; do not rewrite them solely to match this template.

## When a decision changes

Update the current-state documentation and any affected links. Assess whether the new
choice meets the ADR threshold; ordinary changes need no new ADR. Under the existing
repository convention, revise or remove an ADR that no longer describes a decision in
force. Git preserves the earlier record. Do not delete current behavior or constraints
when removing a record of its rationale.
