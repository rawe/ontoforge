# Any-term keyword matching by default, all-term as a strategy

Rule: [Search](../decisions.md#search)

## Context

Keyword search needs one way to combine query terms by default, and a way to offer the
other without splitting the caller's choice.

## Rejected

- **All-term matching as the default.** One absent term empties the whole result, which
  for a compounding language is the ordinary case.
- **A matching parameter beside the strategy.** It splits one choice over two axes.
- **All-term over exact terms without prefix matching.** All-term means every term, not
  no morphology.
