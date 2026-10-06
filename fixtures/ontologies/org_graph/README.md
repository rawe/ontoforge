# org_graph

Graph structure, query and lens fixture: people, teams, projects, skills and policy
versions of the fictional engineering company Corvane Engineering. Use it for multi-hop
traversal, self-relations, relation properties, OQL (multi-hop, aggregates, OPTIONAL
MATCH), saved query pipelines with typed parameters, every lens scoping variant, query-path
and relation-existence filters, and near-duplicate people for identity comparison.
Everything except identity comparison and the agent works without any AI or embedding
provider. All people, teams and texts are invented.

## Schema

| Type | Kind | Properties |
|---|---|---|
| `person` | entity | `name` (string, required), `email` (string), `employee_number` (string, `E-1234`), `birth_date` (date), `hired_at` (datetime), `salary` (float, euros), `level` (integer, career grade 1–8), `status` (string, required, default `active`; `active`, `on_leave` or `left`) |
| `team` | entity | `name` (string, required), `cost_center` (string, `CC-123`), `budget` (float) |
| `project` | entity | `name` (string, required), `code` (string, `PRJ-ABC`), `started_on` (date), `budget` (float), `priority` (integer, 1 lowest to 5 highest), `status` (string: `planned`, `active`, `on_hold`, `completed`) |
| `skill` | entity | `name` (string, required), `category` (string), `level` (string: `junior`, `mid`, `senior`) |
| `policy_document` | entity | `title` (string, required), `version` (integer), `published_on` (date), `body` (document) |
| `manages` | relation `person` → `person` | `since` (date) |
| `member_of` | relation `person` → `team` | `role` (string, required), `allocation` (float, 0.0–1.0) |
| `works_on` | relation `person` → `project` | `hours_per_week` (float) |
| `owned_by` | relation `project` → `team` | — |
| `has_skill` | relation `person` → `skill` | `proficiency` (integer, 1–5) |
| `requires_skill` | relation `project` → `skill` | — |
| `supersedes` | relation `policy_document` → `policy_document` | — (newer version → the version it replaces) |

Every type and property carries a description. `person.level` (integer) and `skill.level`
(string) share a key on purpose. Every type's name property is `name`, except
`policy_document`'s, which is `title`. Keyword languages: english.

Search indices: managed only, no custom index — the default index of every entity type
and the passage index `policy_document~body`.

## Lenses

| Lens | Declared | Entity types exposed | Relation types exposed |
|---|---|---|---|
| `all` | unscoped | all | all |
| `directory` | entity inclusions only: `person` (allowlist without `salary`, `birth_date`), `team` | `person` (6 properties), `team` | inferred: `manages`, `member_of` (with `allocation`) |
| `staffing` | relation inclusions only: `works_on`, `has_skill`, `requires_skill` | all, with all properties (including `salary`) | `works_on`, `has_skill`, `requires_skill` |
| `management` | entity `person`, `team`; relation `manages`, `member_of` (allowlist `role`) | `person` (all properties), `team` | `manages`, `member_of` without `allocation` |

`directory` and `management` include the search indices `person~default` and
`team~default`; `staffing` includes every index. All four lenses pass lens validation and
schema validation.

## Agent and saved queries

All on `all`.

- `org_analyst` — tools `list_saved_queries`, `run_saved_query`, `search_saved_queries`,
  `execute_query`, `get_schema`.

| Saved query | Steps | Parameters | Result |
|---|---|---|---|
| `skills-for-team-projects` | OQL, two hops `team <-owned_by- project -requires_skill-> skill` | `team` (string) | `Hardware Engineering`: Embedded C (Cobalt), Finite Element Analysis (Atlas, Harbor), Mechanical CAD (Atlas), PLC Programming (Cobalt, Harbor), Technical Writing (Harbor). `Software Platform`: Embedded C (Delta), Kubernetes (Beacon), Rust (Beacon, Delta), TypeScript (Beacon) |
| `direct-reports-per-manager` | OQL, `count` | — | Marcus Webb 9, Lena Fischer 4, Sofia Marchetti 4, Margit Olafsen 3, Daniel Okafor 2, Jonas Petersen 2, Hannah Cole 1, Priya Raman 1, Tomas Bergqvist 1 |
| `average-salary-per-team` | OQL, `avg` and `count` | — | Executive Office 204,250 (4), Finance 90,500 (2), Hardware Engineering 90,000 (7), Operations 85,400 (5), Software Platform 92,400 (11) |
| `persons-with-projects` | OQL, `OPTIONAL MATCH` | — | 38 rows; 9 people with null project and hours (below) |
| `persons-hired-after` | OQL | `since` (date) | `2024-01-01`: Hiro Tanaka, Tara Quinn, Isabel Moreau. `2024-04-16`: Hiro Tanaka, Tara Quinn |
| `projects-min-priority` | OQL | `min_priority` (integer) | `4`: Atlas Gearbox Redesign (5), Beacon Telemetry Platform (5), Cobalt Test Rig Automation (4), Delta Firmware Update Service (4) |
| `skill-holders-by-team` | search `skill` (`$q`, limit 3) → OQL holders (binding `{{skills._id}}`) → OQL teams (binding `{{holders.person_id}}`) | `q` (string) | `PLC`: Hardware Engineering 4 (Jonas Petersen, Liam O'Connor, Samuel Reyes, Tara Quinn), Software Platform 1 (Jonas Petersen). `Rust`: Software Platform 4 (Marcus Webb, Chen Wei E-1032, Isabel Moreau, Benedikt Sommer). `juggling`: no rows |

Notes on the results:

- Software Platform counts 11 members, 10 with a salary (Felix Braun has none); Jonas
  Petersen counts in Hardware Engineering and Software Platform.
- People without a project in `persons-with-projects`: Daniel Okafor, Eva Lindqvist,
  Felix Braun, Liam OConnor, Margit Olafsen, Pavel Dvorak, Priya Raman, Sam Reyes, Tomas
  Bergqvist. Isabel Moreau works on Delta with no hours.
- The order inside `collect(...)` lists is not fixed; compare them as sets.
- A wrong parameter value is rejected per parameter (`since=not-a-date`, `min_priority=high`);
  a missing one is rejected as missing.

## Data

| Type | Count |
|---|---|
| `person` | 30: 28 in a five-level management tree, plus 2 near-duplicate records without relations. 2 not active (Eva Lindqvist `on_leave`, Pavel Dvorak `left`); 28 got `status` from the default. Without `salary`: 3; without `email`: 2; without `birth_date`: 2 |
| `team` | 5 (Executive Office has no budget) |
| `project` | 8 (Harbor Sensor Calibration: no start date, no budget, nobody works on it) |
| `skill` | 10 (Technical Writing has no level) |
| `policy_document` | 6: Travel and Expenses Policy v1–v3, Remote Work Policy v1–v3 |
| `manages` | 27 (2 without `since`) |
| `member_of` | 29 (Jonas Petersen in two teams, allocation 0.8 and 0.2; Felix Braun without allocation) |
| `works_on` | 29 (Isabel Moreau's without hours) |
| `owned_by` | 8 |
| `has_skill` | 37 (Isabel Moreau's Rust without proficiency) |
| `requires_skill` | 16 |
| `supersedes` | 4 (v2 → v1 and v3 → v2 per policy) |

Management tree: Margit Olafsen (CEO) → Daniel Okafor, Priya Raman, Tomas Bergqvist →
Lena Fischer and Marcus Webb (under Okafor), Sofia Marchetti (under Raman), Hannah Cole
(under Bergqvist) → their staff → Samuel Reyes and Tara Quinn (under Jonas Petersen, who
reports to Lena Fischer).

Marcus Webb has 17 outgoing relations (9 `manages`, 1 `member_of`, 3 `works_on`,
4 `has_skill`) and 1 incoming (`manages` from Daniel Okafor).

## Test questions

All on `all` unless a lens is named.

| Question | Ask with | Correct answer |
|---|---|---|
| Who reports directly to Marcus Webb? | `person` list, `filter.manages:in.name=Marcus Webb` | Aisha Khan, Benedikt Sommer, Chen Wei (E-1032), Diego Alvarez, Eva Lindqvist, Felix Braun, Grace Mbeki, Hiro Tanaka, Isabel Moreau |
| Who manages Marcus Webb? | `filter.manages:out.name=Marcus Webb` | Daniel Okafor |
| Who has no manager? | `filter.manages:in__missing=true` | Margit Olafsen, Liam OConnor, Sam Reyes |
| Who manages anyone? | `filter.manages:out__exists=true` | the 9 managers of `direct-reports-per-manager` |
| Current policy versions | `policy_document` list, `filter.supersedes:in__missing=true` | Travel and Expenses Policy v3, Remote Work Policy v3 |
| First policy versions | `filter.supersedes:out__missing=true` | both v1 |
| Who works 30 or more hours a week on some project? | `filter.works_on@hours_per_week__gte=30` | Aisha Khan, Benedikt Sommer, Chen Wei (E-1032), Diego Alvarez, Hiro Tanaka, Kira Novak, Liam O'Connor, Rosa Delgado, Tara Quinn |
| Who is split across teams? | `filter.member_of@allocation__lt=1` | Jonas Petersen |
| Whose membership has no allocation? | `filter.member_of@allocation__missing=true` | Felix Braun |
| Who works on a planned project? | `filter.works_on.status=planned` | Aisha Khan, Chen Wei (E-1053), Marcus Webb, Noah Schmitt, Sofia Marchetti |
| Who rates a skill at 5? | `filter.has_skill@proficiency=5` | 11 people: Aisha Khan, Benedikt Sommer, Chen Wei (E-1032), Felix Braun, Hannah Cole, Kira Novak, Lena Fischer, Liam O'Connor, Marcus Webb, Olivia Grant, Tomas Bergqvist |
| Which project has nobody on it? | `project` list, `filter.works_on__missing=true` | Harbor Sensor Calibration |
| Which teams own a priority-5 project? | `team` list, `filter.owned_by.priority__gte=5` | Hardware Engineering, Software Platform |
| Who is five levels below the CEO? | OQL, four chained `manages` hops from a `person` | Samuel Reyes, Tara Quinn (top: Margit Olafsen) |
| How many people are two levels below Daniel Okafor? | OQL, two `manages` hops | 13 |
| Who holds the skills Harbor needs? | OQL `person -has_skill-> skill <-requires_skill- project` | Finite Element Analysis: Lena Fischer, Kira Novak; PLC Programming: Samuel Reyes, Jonas Petersen, Liam O'Connor, Tara Quinn; Technical Writing: Marcus Webb, Tara Quinn, Felix Braun |
| Who works on a project owned by a team they are not in? | OQL, comma-separated pattern parts | Aisha Khan (Ember), Jonas Petersen (Atlas, Cobalt — via his Software Platform membership), Liam O'Connor (Delta), Marcus Webb (Ember) |
| Staff and hours per project | OQL `OPTIONAL MATCH` with `count`, `sum` | Atlas 5/96, Beacon 5/124, Cobalt 4/90, Delta 6/100, Ember 5/58, Fjord 2/40, Granite 2/40, Harbor 0 |
| Current policy versions in OQL | `OPTIONAL MATCH (n:policy_document)-[:supersedes]->(d) WITH d, count(n) AS newer WHERE newer = 0` | both v3 |
| Who is connected to Lena Fischer by `manages` in either direction? | OQL undirected `-[:manages]-` | Daniel Okafor, Jonas Petersen, Kira Novak, Liam O'Connor, Maja Horvat |

Lens checks:

| Through | Request | Answer |
|---|---|---|
| `directory` | read Marcus Webb | no `salary`, no `birth_date` |
| `directory` | write `salary`, filter `salary__gt`, OQL `p.salary` | each rejected as an unknown property |
| `directory` | neighbours of Marcus Webb | 9 `manages` outgoing, 1 `member_of`, 1 `manages` incoming; no projects or skills |
| `directory` | OQL over `works_on` | rejected; available relation types `manages`, `member_of` |
| `staffing` | neighbours of Marcus Webb | 3 `works_on`, 4 `has_skill`; no `manages`, no `member_of` |
| `staffing` | `filter.manages:in.name=...`, OQL over `manages` | rejected; `salary` is readable |
| `management` | `member_of` relations, neighbours, OQL `m.allocation`, `filter.member_of@allocation__lt=1` | `allocation` stripped or rejected; `filter.member_of@role=Test Engineer` returns Samuel Reyes, Tara Quinn |

## Identity comparison pairs

Ground truth for `POST .../decisions/compare-entities` with `entityTypeKey: person`:

| Pair | Records | Ground truth |
|---|---|---|
| Spelling variant | Liam O'Connor (full record) and Liam OConnor (no hire date, salary, level or relations) — same email `liam.oconnor@corvane.example`, same employee number `E-1042`, same birth date | `same` |
| Same name | Chen Wei `E-1032`, `chen.wei@corvane.example`, born 1990-04-12, Software Platform — and Chen Wei `E-1053`, `wei.chen@corvane.example`, born 1978-11-03, Operations | `different` |
| Ambiguous | Samuel Reyes (full record) and Sam Reyes (only name, level 2 and status; no email, employee number or birth date) | `insufficient` |

## Known hard cases

Deliberate features of the data:

- **Self-relation direction marker.** `manages` and `supersedes` connect a type to itself.
  `filter.manages.name=...`, `filter.manages__exists=true` and
  `filter.supersedes__missing=true` are rejected with "needs a direction marker"; the
  `:in` / `:out` forms above work.
- **Cross-type filter conflict.** Search without `type` and with `filter.level=3` is
  rejected: `Conflicting data types for 'level': integer, string`. With `type=person`
  (integer) or `type=skill` (string, e.g. `filter.level=senior`) the filter is accepted.
- **Outgoing-first neighbour limit.** Neighbours of Marcus Webb with `limit=10` and
  `direction=both` return 9 `manages` and 1 `member_of`, all outgoing, and no incoming
  neighbour, although Daniel Okafor manages him; `direction=incoming` shows him.
- **The lens matrix cliff edge.** `directory` names only entity types and gets `manages`
  and `member_of` by inference. Adding any relation inclusion to it would remove every
  relation type it does not name. `management` is the explicit form of the same view.
- **Allowlists exist only on inclusions.** `staffing` cannot hide person properties
  (`salary` is visible there), and `directory` cannot hide `member_of.allocation`; only
  `management` hides it.
- **Same name, different people.** The two Chen Wei records differ only in properties;
  grouping or joining by `name` merges them. `persons-with-projects` returns
  `employee_number` to tell them apart.
- **Missing values.** `avg(p.salary)` skips Felix Braun; `count(p)` counts him.
  `filter.salary__missing=true` returns Felix Braun, Liam OConnor, Sam Reyes.
- **Date parameter against a datetime.** `persons-hired-after` compares the date
  parameter with `hired_at`; `since=2024-04-15` includes Isabel Moreau, hired
  2024-04-15T08:00:00Z.
- **Defaults.** 28 people were written without `status` and carry `active` from the
  default. No lens hides `status`, so the lens/full-schema default asymmetry is not
  exercised here.
- **Search step strategy.** `skill-holders-by-team` runs the default search strategy.
  The results above are with `keyword` (no embedding provider), where `PLC` and `Rust`
  each match one skill. With an embedding provider the default becomes `hybrid`, which
  returns up to 3 skills for any text and changes the result.

## Needs a provider

Nothing above needs one: all lists, filters, neighbours, OQL, saved queries (keyword search
step) and lens checks run without any provider. Identity comparison needs a Decision
provider (otherwise `FEATURE_DISABLED`; the ground truth is above). The agent needs a
language-model provider, and its `search_saved_queries` tool needs an embedding provider.
