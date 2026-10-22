# Rulesets of fixed rules, write access on one ladder

## Context

The clients of one URL need several limits that a person sets and may change at any time:
where in a hierarchy they may write, how they may change data, and more to come. Each
limit has to be clear to the person who picks it, and checked in one place.

## Rejected

- **A list of typed rules per ruleset**, each a kind with its own configuration. Each kind
  occurs at most once, so the list holds fixed fields as rows, and every new kind still
  needs its code, checks and docs, behind a more complex store, body and editor.
- **A record per client, a seat, with rules attached.** The name says nothing about what
  is limited, one key may serve several clients, and it invites identity features, which
  are out of scope.
- **One flag per limit, each with its own check.** Every flag adds a check in its own
  place, and the tool list, the check and the refusal text drift apart; one operation table
  gives all three.
- **Levels or switches a person defines.** Free combinations of operations are hard to
  explain and to test; three fixed levels each say in one line what a client can do.
- **More levels for another kind of limit**, such as no deletes. The ladder stays one
  order, each level allowing what the one below allows; another kind of limit is a rule of
  its own.
