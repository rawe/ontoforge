# people_basic

Simple general-purpose fixture: people working for companies. Use it for CRUD, lens
scoping (one scoped and one unscoped lens), agents and saved queries. All names and
addresses are fictional.

## Schema

| Type | Kind | Properties |
|---|---|---|
| `person` | entity | `name` (string, required), `email` (string), `age` (integer), `active` (boolean, default true), `bio` (document) |
| `company` | entity | `name` (string, required), `founded` (date), `employee_count` (integer) |
| `works_for` | relation `person` → `company` | `role` (string), `since` (date) |

Text-search language: english.

## Lenses

| Lens | Scope | Agents | Saved queries |
|---|---|---|---|
| `test_lens` | unscoped | — | — |
| `hr_view` | `company` (all properties), `person` (`name`, `email` only), `works_for` | `assistant`, `unrestricted` | `people-by-name`, `similar-then-fetch` |

## Data

| Type | Count |
|---|---|
| `person` | 14 (8 with a `bio`, 2 inactive, some without `email`) |
| `company` | 6 (one without `founded`) |
| `works_for` | 15 (two people with two employers, some without `role` or `since`) |
