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

`name` is the name property of both entity types. Keyword languages: english.

## Search indices

Managed only, no custom index: `person~default`, `person~bio` (passages) and
`company~default`.

## Lenses

| Lens | Scope | Search indices | Agents | Saved queries |
|---|---|---|---|---|
| `test_lens` | unscoped | every index | — | — |
| `hr_view` | `company` (all properties), `person` (`name`, `email` only), `works_for` | every index | `assistant`, `unrestricted` | `people-by-name`, `similar-then-fetch` |

`hr_view` includes `person~bio` although it hides `bio`, so lens validation warns about
it. Search there can find a person by bio text; the hit carries no bio and an empty
snippet.

## Data

| Type | Count |
|---|---|
| `person` | 14 (8 with a `bio`, 2 inactive, some without `email`) |
| `company` | 6 (one without `founded`) |
| `works_for` | 15 (two people with two employers, some without `role` or `since`) |
