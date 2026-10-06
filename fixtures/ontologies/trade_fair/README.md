# trade_fair

Retrieval and search fixture: exhibitors, halls and events of the fictional Meridian
Industrial Technology Fair 2027. Use it for retriever agents, semantic, keyword and hybrid
search over the managed search indices (properties and document passages), multi-passage
documents, and an agent. All companies, events and texts are invented.

## Schema

| Type | Kind | Properties |
|---|---|---|
| `exhibitor` | entity | `name` (string, required), `stand_number` (string, e.g. `2-A14`), `website` (string), `founded` (integer, year), `description` (document) |
| `hall` | entity | `name` (string, required), `hall_number` (string, `1`–`4`), `floor_area_sqm` (float) |
| `industry` | entity | `name` (string, required), `description` (string) |
| `product_group` | entity | `name` (string, required), `description` (string) |
| `event` | entity | `title` (string, required), `event_type` (string: `talk`, `workshop` or `panel`), `starts_at` (datetime), `description` (document) |
| `located_in` | relation `exhibitor` → `hall` | — |
| `belongs_to_industry` | relation `exhibitor` → `industry` | — |
| `offers` | relation `exhibitor` → `product_group` | — |
| `hosts` | relation `exhibitor` → `event` | — |
| `takes_place_in` | relation `event` → `hall` | — |

Every type and property carries a description. Stands are an exhibitor property, halls
their own entity ([decision](../../../docs/decisions.md#retrieval-evaluation-dataset)).
Every type's name property is `name`, except `event`'s, which is `title`. Keyword
languages: english.

## Search indices

Managed only, no custom index: the default index of every entity type (`exhibitor~default`
holds `name`, `stand_number`, `website`; `event~default` holds `title`, `event_type`) and
the passage indices `exhibitor~description` and `event~description`.

## Lenses

| Lens | Scope | Search indices | Retriever agents | Agents | Saved queries |
|---|---|---|---|---|---|
| `all` | unscoped | every index | `event_finder`, `fair_guide` | — | — |
| `visitor_guide` | `exhibitor` (without `founded`), `hall`, `industry`, `product_group`, `located_in`, `belongs_to_industry`, `offers` — no events | every index except the two `event` ones | `exhibitor_finder` | `visitor_assistant` | `exhibitors-in-hall`, `find-exhibitor-stands` |

## Retriever agents

| Agent | Lens | Searches | Filters | Answer fields |
|---|---|---|---|---|
| `exhibitor_finder` | `visitor_guide` | `exhibitor~default`, `exhibitor~description` | `hall` (`located_in` → `hall_number`) | `name`, `stand_number`, `website`, `description` (800 characters) |
| `event_finder` | `all` | `event~default`, `event~description` | `hall` (`takes_place_in` → `hall_number`); `event_type` (own field) | `title`, `event_type`, `starts_at`, `description` (800 characters) |
| `fair_guide` | `all` | `exhibitor~default`, `exhibitor~description`, `event~default`, `event~description` | `hall` on exhibitors (`located_in`), `event_hall` on events (`takes_place_in`), both → `hall_number` | exhibitor `name`, `stand_number`, `founded`, `description`; event `title`, `event_type`, `starts_at` (600 characters) |

Every agent uses threshold 0.35. No index has a relation group, so an exhibitor's
industries and product groups, and an event's hosts, are found only where a description
names them; a custom index on `exhibitor` with relation groups on `belongs_to_industry`
and `offers` would make the first two searchable.

## Agent and saved queries

- `visitor_assistant` — finds exhibitors for a visitor's interest and names stand and hall;
  tools `get_schema`, `search`, `search_documents`, `get_document`, `list_entities`,
  `get_entity`, `get_neighbors`, `execute_query`, `list_saved_queries`, `run_saved_query`.
- `exhibitors-in-hall` — OQL, parameter `hall` (hall number); exhibitors and stands of one hall.
- `find-exhibitor-stands` — search step over `exhibitor` with parameter `q`, feeding an OQL
  step that returns stand number and hall.

## Data

| Type | Count |
|---|---|
| `exhibitor` | 25 (7, 7, 5 and 6 per hall; 9 descriptions of 1,900–2,250 characters, the rest one or two sentences) |
| `hall` | 4 |
| `industry` | 6 |
| `product_group` | 10 |
| `event` | 10 (4 workshops, 4 talks, 2 panels; 3 descriptions of 1,800–2,000 characters) |
| `located_in` | 25 |
| `belongs_to_industry` | 37 (12 exhibitors in two industries) |
| `offers` | 21 (6 exhibitors offer nothing, 2 offer two groups) |
| `hosts` | 16 (the keynote has no host) |
| `takes_place_in` | 10 |

The long descriptions split into two passages each at the default chunk size.

## Test questions

The data is built so that each question below has known correct answers and known near
misses. A near miss shares words or topic with the question but does not answer it.

**"Recycling solutions for plastics"** — exhibitors

| | Exhibitor | Why |
|---|---|---|
| Correct | Polycycle Systems | builds mechanical recycling lines for plastic waste |
| Correct | ClearLoop Sorting | builds sensor-based sorting machines for plastic waste |
| Correct | Verdant Polymers | sells compounds with up to 70 percent post-consumer recyclate |
| Correct | Lakemere Compounds | compounds increasingly based on recycled polypropylene |
| Near miss | Ferrum Reclaim | recycles scrap metal; says it does not process plastics |
| Near miss | Cellforge Battery Recycling | recycles lithium-ion batteries; "Recycling" in the name |
| Near miss | Moldwell Injection Technologies | molding machines that process recycled material; does not recycle |
| Near miss | Hearthline Heat Recovery | in the Recycling and Circular Economy industry; recovers waste heat |

**"Workshops about machine safety"** — events

| | Event | Why |
|---|---|---|
| Correct | Hands-on Workshop: Risk Assessment for Machine Guarding | workshop on risk assessment and guarding |
| Correct | Commissioning Safety Light Curtains Without Downtime | workshop on mounting and testing safety light curtains |
| Near miss | Workshop: Programming Your First Cobot Cell | about robot programming; its later passage covers safe operation |
| Near miss | Talk: Securing OT Networks in Brownfield Plants | a talk, and about network security, not machine safety |
| Near miss | Workshop: Ergonomic Risk Assessment with Wearable Sensors | a workshop on body strain, not machine hazards |

**"Agricultural film hot-wash"** — passages

| | Passage | Why |
|---|---|---|
| Correct | Polycycle Systems, last paragraph of the description (second passage) | presents the hot-wash line for agricultural film |
| Near miss | Polycycle Systems, first passage | mentions the hot-wash stage, not agricultural film |

## Known hard cases

Deliberate features of the data:

- Negation: Ferrum Reclaim's description mentions plastics only to say it does not process them.
- Name match: Cellforge Battery Recycling has "Recycling" in its name. `exhibitor~default`
  holds only name, stand and website; the description is searched as passages of
  `exhibitor~description`.
- Late relevance: Verdant Polymers' description first mentions recycling after character
  1,000; `exhibitor_finder` cuts answer text at 800 characters (`answerFieldCharacters`).
- Search limit: `find-exhibitor-stands` searches with limit 5, fewer than the four correct
  and four near-miss exhibitors of the plastics question.
- Lens and text: `visitor_guide` hides events, but exhibitor descriptions name the
  workshops, talks and panels they host, so event facts are reachable as text on that lens.

## Needs an embedding provider

Semantic and hybrid search. Without one, keyword search over every index, saved queries
and all model-free management work, and the semantic representations report
`unavailable`. Retriever-agent chat and the agent need a language-model provider;
without an embedding provider, retriever-agent chat searches by keyword only.
