# A rejected value is named by its JSON type

Current behavior: [Errors](../interfaces.md#errors)

## Context

A coercion failure reaches the caller verbatim. It has two halves: the type that was
expected, which is a schema declaration, and a description of what arrived, which is a
raw wire value. No single type system covers both halves.

## Decision

A field error names the expected schema type and describes the received value by its
JSON type, as a string.

## Rejected

- **The implementation language's type names.** They tell a caller what the server is
  written in, and would have to be redone whenever the language changes.
- **OntoForge data types on both halves.** Data types are a schema vocabulary. A received
  `{}` or `[]` has none, and `date`, `datetime` and `document` have no counterpart among
  received values, so the message would be untrue rather than merely parochial.
- **Structured `expected` and `received` members instead of prose.** Speculative. It
  turns `details.fields` from a string map into an object map and forces a mixed shape
  for failures that carry no type. No caller parses the prose.
