# search_bilingual

Search-index fixture: people, their employments and their cities, in German and English.
Use it for relation pairing in custom search indices (one entry per employment, never a
mix of two), bilingual keyword search (German and English stemming in one ontology),
cross-language semantic search, and a scoped lens that skips relation entries it cannot
see. All people, companies and texts are invented.

## Schema

| Type | Kind | Properties |
|---|---|---|
| `person` | entity | `name` (string, required, name property), `bio` (string, German, English or mixed), `cv` (document, German or English, a few paragraphs) |
| `company` | entity | `name` (string, required, name property), `industry` (string), `description` (string, German or English) |
| `city` | entity | `name` (string, required, name property), `country` (string) |
| `works_for` | relation `person` → `company` | `role` (string, English or German, e.g. `CTO`, `Geschäftsführerin`), `since` (integer, year) |
| `lives_in` | relation `person` → `city` | — |

Keyword languages: german, english.

## Search indices

Managed: `person~default`, `person~cv` (passages), `company~default`, `city~default`.

| Index | Root | Own fields | Relation group |
|---|---|---|---|
| `person_employment` | `person` | `name`, `bio` (header: the name) | `works_for` outgoing, label "Employment": `role`, `since`; target `company`: `name`, `industry` |
| `person_residence` | `person` | — (header: the name) | `lives_in` outgoing, label "Residence": target `city`: `name`, `country` |

## Lenses

| Lens | Scope | Search indices |
|---|---|---|
| `all` | unscoped | every index |
| `no_company` | `person`, `city`, `lives_in` — no `company`, no `works_for` | `city~default`, `person_employment`, `person_residence`, `person~cv`, `person~default` |

`no_company` includes `person_employment`, but hides its relation type and target type, so
search there skips every employment entry and only the own-field entry (name, bio) can
match. `company~default` is not searchable there.

## Data

| Type | Count |
|---|---|
| `person` | 12 (each with a bio and a CV of 330–780 characters, one passage each at the default chunk size; 7 CVs German, 5 English) |
| `company` | 6 (ACME, Foo Labs, Globex Research in English; Müller GmbH, Schneider & Partner, Nordlicht Energie AG in German) |
| `city` | 5 (Berlin, München, Hamburg, London, Zürich) |
| `works_for` | 16 (4 people with two employments) |
| `lives_in` | 12 |

Pairing traps — several employments per person, so a role and a company of different
employments must never match together:

| Person | Employments |
|---|---|
| Ada Lovelace | CTO at ACME (2020); Advisor at Foo Labs (2018) |
| Bob Martin | CTO at Foo Labs (2019); Software Engineer at ACME (2012) |
| Clara Schmidt | Advisor at ACME (2021) |
| Ines Wagner | CFO at ACME (2019) |
| Lukas Braun | CTO at Nordlicht Energie AG (2021) |
| Eva Hoffmann | Geschäftsführerin at Müller GmbH (2015); Beraterin at Schneider & Partner (2010) |
| Dieter Müller | Geschäftsführer at Müller GmbH (1998) |
| Grace Turner | Head of Research at Globex Research (2016); Advisor at Nordlicht Energie AG (2022) |

Inflection pairs: "Häuser" (Dieter Müller's bio, Müller GmbH) and "Haus"/"Hauses" (Jonas
Fischer's bio and CV); "studies" (Globex Research, Grace Turner) and "study" (Karen Lee).

## Test queries

`POST /api/ontologies/fx_search_bilingual/runtime/lenses/<lens>/search`, observed with
bge-m3; ties and lower ranks may shift with another model.

| Lens | Body | Expected top hit(s) |
|---|---|---|
| `all` | `{"query":"CTO ACME"}` | Ada Lovelace first, matched via `person_employment` → relation `works_for` → ACME ("Role: CTO … Company: ACME"); Ines Wagner (CFO at ACME) next; Bob Martin, CTO elsewhere, only lower through his Software Engineer entry at ACME |
| `all` | `{"query":"CTO Foo"}` | Bob Martin first, via Employment → Foo Labs (the company Foo Labs ties); Ada Lovelace below him via her Advisor entry at Foo Labs, never via her CTO entry |
| `all` | `{"query":"Advisor at Foo Labs","indices":["person_employment"]}` | Ada Lovelace, via Employment → Foo Labs |
| `all` | `{"query":"Häuser","mode":"keyword"}` | Jonas Fischer (CV: "Haus", "Hauses"), Dieter Müller and Müller GmbH ("Häuser") — German stemming pairs the forms |
| `all` | `{"query":"shopping studies","mode":"keyword"}` | Grace Turner ("studies"), Karen Lee ("study") |
| `all` | `{"query":"who builds houses in Bavaria","mode":"semantic"}` | Müller GmbH and Dieter Müller — English query, German text |
| `all` | `{"query":"offshore wind farm engineer","mode":"semantic"}` | Hans Becker's CV passage ("Offshore-Windparks", German) |
| `no_company` | `{"query":"CTO ACME","indices":["person_employment"]}` | no `works_for` entry ever matches; only own-field entries mentioning ACME in the bio (Ines Wagner, Bob Martin); Ada Lovelace does not appear |
| `no_company` | `{"query":"lives in Germany","indices":["person_residence"]}` | people living in Hamburg or München, via Residence entries |
| `no_company` | `{"query":"x","indices":["company~default"]}` | 422 at `indices.0`: not searchable in this lens |

Keyword search stems every entry and query in both languages, so a word can also match a
German form in the other language (`study` matches "studiert"); English-only rankings can
therefore include German CVs.

## Needs an embedding provider

Semantic and hybrid search. Without one, keyword search over every index works on its own
and the semantic representations report `unavailable`.
