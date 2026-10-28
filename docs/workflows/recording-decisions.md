# Recording architectural decisions

This guide explains when to record an architectural decision and where the resulting
information belongs. Approval and recording are separate: the root
[AGENTS.md](../../AGENTS.md) states when to involve the user in an architectural choice.
An ADR is a record of a selected architectural choice, not the general repository rulebook.

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

- **Essential architectural constraints:** [architecture-constraints.md](../architecture-constraints.md),
  the concise authoritative statements of boundaries contributors must preserve.
- **System structure, mechanisms and flows:** [architecture.md](../architecture.md),
  explaining how those constraints are realized.
- **Feature behavior, constraints, limits and examples:** the owning document in
  [capabilities/](../capabilities/).
- **Interface behavior and access:** [interfaces.md](../interfaces.md); the web client
  belongs in [product-surface.md](../product-surface.md).
- **Storage contract and implementation:** [storage-adapters.md](../storage-adapters.md).
- **Configuration and procedures:** the configuration table in the root
  [README.md](../../README.md) and the relevant [workflow](./).
- **Terms:** the [glossary](../glossary.md).
- **The reasoning behind a hard-to-reverse architectural choice:** an ADR in [adr/](../adr/).

Current obligations do not need a decision-log entry to be enforceable. Keep the common
architectural constraints concise and document feature and implementation rules at their
owners; do not build a second general rule collection beside them.

## Keep the common constraints selective

The constraints document is a required architectural starting point, not a replacement
for reading the affected feature. Add an entry only when it protects an important
architectural boundary or guarantee contributors need before designing changes. State
the obligation, a short reason and a link to its explanation. A feature default, parameter
limit, naming convention or implementation procedure belongs with its detailed owner.

The threshold for a constraint and for an ADR are different: a constraint states what
must hold now; an ADR preserves the context of a consequential choice. Neither requires
creating the other automatically. Keep the detailed mechanism out of the constraints
document and avoid a second authoritative statement of the same constraint elsewhere.

## Write an ADR

Write one short record per consequential decision. Use a four-digit number greater than
any previously used in `adr/NNNN-slug.md`; numbers are never reused, including after a
record is removed. Include the decision itself so the record can be understood without
reconstructing it from rejected options:

```markdown
# <Decision title>

Current behavior: <links to the owning documents>

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
rationale helps a reader, rather than requiring every rule to link to one. Write the
record once the architectural choice is approved; it carries no status or date. Do not
reformat an older record without improving its explanation.

## When a decision changes

`adr/` holds only decisions in force; git keeps the history. Update the current-state
documentation and any affected links, then rewrite or delete the ADR so it states the
decision as it now stands. Assess whether the new choice meets the ADR threshold:
ordinary changes need no new ADR, and a new qualifying choice may get its own.

Removing a record from `adr/` requires moving its useful content to the owning documents
and updating references; it must not erase a consequential decision's rationale that
still applies.
