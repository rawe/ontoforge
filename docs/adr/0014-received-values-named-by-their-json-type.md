# 0014. A rejected value is named by its JSON type

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

A coercion failure produces a message that reaches the caller verbatim, inside
`details.fields` of a `VALIDATION_ERROR`. Such a message has two halves — the type that
was expected, and a description of what arrived instead — and the two are not drawn from
the same type system. The expected half describes a schema declaration. The received half
describes a raw value that arrived over the wire.

Naming the received value required picking a vocabulary, and the obvious candidates are
not interchangeable, because neither type system covers both halves.

## Alternatives considered

- **The implementation language's type names** — rejected: it tells a caller what the
  server is written in, which the no-vendor-vocabulary rule already forbids for the
  storage backend and forbids here for the same reason. It also has to be redone the next
  time the language changes, which is precisely the property the rule exists to prevent.

- **OntoForge data types on both halves** — rejected, and this is the alternative most
  likely to be re-proposed, because symmetry looks like consistency. It cannot work: the
  data types are a *schema* vocabulary. A received `{}` or `[]` has no data type at all,
  and `date`, `datetime` and `document` have no counterpart among received values. Using
  them for the received half would mean inventing words for values the schema cannot
  describe — a worse leak than the one being removed, because it would be untrue rather
  than merely parochial.

- **Structured `expected` and `received` members instead of prose** — rejected as
  speculative. It changes `details.fields` from a string map to an object map, breaking
  every client that renders it and forcing a mixed shape for the failures that carry no
  type at all (a missing required property). No caller parses the prose today.

## Outcome

The expected half names an OntoForge data type; the received half names a JSON type,
JSON being the wire format and therefore neutral with respect to any implementation
language. Where the JSON type says nothing useful — a non-integer number rejected for an
`integer` property — the rejected value is quoted instead. The rule is in
[../decisions.md](../decisions.md#naming).
