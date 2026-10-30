# Any-term keyword matching by default, all-term on request

Current behavior: [Methods and availability](../capabilities/search.md#methods-and-availability),
[entity search](../capabilities/search.md#entity-search)

## Context

Keyword search needs one way to combine query terms by default, and a way to ask for the
other.

## Decision

Keyword matching is any-term by default; the keyword method's own option, `match: "all"`,
asks for all-term matching.

## Rejected

- **All-term matching as the default.** One absent term empties the whole result, which
  for a compounding language is the ordinary case.
- **All-term over exact terms without prefix matching.** All-term means every term, not
  no morphology.
