# Architecture Decision Records

An archive of the decisions taken on OntoForge, kept for the reasoning behind them and the
alternatives already weighed against them. It is history, not current documentation — a
record here describes what was decided at the time it was decided, in the vocabulary of
that time.

**The current binding rules live in [`../decisions.md`](../decisions.md).** That file is
authoritative. Where a record here and a rule there disagree, the rule wins and the record
is simply the older state.

Because records are immutable, some cite documents, modules or route shapes that have
since been renamed or removed. Those references are left as written — correcting them
would rewrite the record. Read them as evidence of what existed at the time, and take the
current documentation set as the description of what exists now.

## Naming

One file per decision, `NNNN-kebab-title.md`, with the number zero-padded to four digits.
The numbers are the original decision-log numbers and are permanent — other documents cite
them.

## Template

```markdown
# NNNN. <Title>

- **Status:** Accepted
- **Date:** <approval date, if one was recorded>

## Context

<The problem or force that made a decision necessary.>

## Decision

<What was decided.>

## Consequences

<What follows — constraints imposed, and what was given up.>

## Alternatives considered

<What was rejected and why. Omitted when none were recorded.>
```

The `Date` line is omitted where the source recorded no approval date. The
`Alternatives considered` section is omitted where none were recorded.

## Records are immutable

A record is never edited to reflect a change of mind. When a decision changes, write a new
record that supersedes it and set the old record's status to `Superseded by NNNN`. This
keeps the reasoning of the superseded decision — and the alternatives it weighed —
readable alongside the one that replaced it.
