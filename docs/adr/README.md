# Architecture Decision Records

Records of decisions where real alternatives were weighed. Their purpose is narrow: to
stop a settled argument from being reopened. If a record does not tell you what was
rejected and why, it should not exist.

**The rules themselves live in [`../decisions.md`](../decisions.md)**, which is
authoritative and current. A record here never restates a rule — it records the
deliberation that produced one, and links to it. Where a record and a rule appear to
disagree, the rule wins; the record is simply the older state.

## When to write one

Most decisions need no record. State the rule in `../decisions.md`, with the reason it
exists, and stop.

Write a record here only when the answer to this is yes:

> Will someone plausibly re-propose the option we rejected?

That is the whole test. "Both MCP servers run in one process" needs no record — the rule
and its reason say everything. "A retryable-503 error taxonomy was rejected as
speculative" does, because it is a reasonable idea that will come back, and the next
person deserves to know it was already considered rather than overlooked.

## Naming

One file per decision, `NNNN-kebab-title.md`, zero-padded to four digits. Numbers are
permanent and never reused — other documents cite them.

## Template

```markdown
# NNNN. <Title>

- **Status:** Accepted
- **Date:** <when it was settled>

## Context

<The force that made a decision necessary.>

## Alternatives considered

<What was weighed, and why each was rejected. This is the reason the record exists.>

## Outcome

<One line naming the rule this produced, linking to ../decisions.md. Not a restatement
of the rule.>
```

## Records are corrected or deleted

A record that no longer matches reality is corrected or deleted — a stale reference is
not left as written. Immutability is the wider custom for decision records, but here the
owner may correct a record; heavy history tracking is a deliberate non-goal. When a
decision is genuinely reversed, prefer a new record that supersedes the old one, with the
old record's status set to `Superseded by NNNN`, so the rejected alternatives stay
readable alongside the decision that replaced them.

## Records 0001–0013

These predate the convention above. They were converted from an earlier decision log in
which every decision got an entry, so several carry no alternatives and restate their rule
— which the current convention would not produce. They are kept as written rather than
rewritten to fit a rule adopted after them.
