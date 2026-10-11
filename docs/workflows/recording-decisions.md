# Recording Decisions

> What counts as a decision, where it is written and in which format. This is the only
> place that says so; every other document links here.

Every architectural decision needs the user's approval before it is made. Once approved,
it is recorded as below.

## Rule or ADR

| | [decisions.md](../decisions.md) | [adr/](../adr/) |
|---|---|---|
| Answers | What must I not violate? | Why not the obvious alternative? |
| Holds | Every rule in force, grouped by concern | The rejected alternatives behind one rule |
| Written | For every decision | Only when alternatives were seriously weighed and would plausibly be proposed again |
| Read | Before any work | When working on the rule that links to it |

Most decisions need only the rule.

## Rule

A rule belongs in `decisions.md` when it constrains the design and an agent could break
it without noticing. It goes under the section of its concern:

```markdown
**<The rule, in one sentence.>** <The reason, in one or two sentences.>
→ [adr/NNNN](adr/NNNN-slug.md)
```

The link exists only when an ADR does. No examples, field lists, limits or procedures.

## ADR

One file per rule, `adr/NNNN-slug.md`, numbered with the next free four-digit number;
numbers are never reused.

```markdown
# <The decision, as a short title>

Rule: [<Section>](../decisions.md#<section>)

## Context

<The situation that forced a choice, in two or three sentences.>

## Rejected

- **<Alternative>.** <Why not, in one or two sentences.>
```

An ADR never restates the rule and carries no status or date.

## When a decision changes

`decisions.md` and `adr/` hold only what is in force. Change or delete the rule, rewrite
or delete its ADR, and write a new ADR only if the new decision was itself deliberated.
Git keeps the history.

## What belongs elsewhere

- A capability's behaviour, fields and limits — its document in `capabilities/`
- The web client — `product-surface.md`
- Procedures — `workflows/`
- Terms — the [glossary](../README.md#glossary)
- History, dates, migrations — git
