# What exists today: every read operation

Facts only. What the goal is: [goal.md](goal.md). How we plan to proceed:
[approach.md](approach.md).

This document had a second half proposing a target design. It was removed on purpose: we
agreed to measure what is needed before designing anything. The findings below stay,
because they are observations, not proposals.

## The three interfaces

| Interface | Address | Who calls it |
|---|---|---|
| **REST API** | `/api/...` — registry, server, modeling, runtime | The web client and integrators |
| **MCP server** | Two mounts under `/mcp/...` | An external coding agent |
| **Agent tools** | The tool list an agent configuration may allow | Our own agents |

All three call the service layer directly. None is built on another.

---

# 1. The read operations

## Registry and server — REST only

| Read | REST | MCP | Agent |
|---|---|---|---|
| List ontologies | `GET /api/ontologies` | not offered, by rule | not offered |
| Read one ontology | `GET /api/ontologies/{key}` | not offered, by rule | not offered |
| Which features are switched on | `GET /api/server/features` | not offered | not offered |

Keeping the registry out of MCP is a written rule, not an oversight. The feature report has
no tool either, so a model **cannot ask whether semantic search is available**; it finds
out by being rejected. For our own agents this is handled elsewhere — tools that need
embeddings are dropped from the list when no provider is configured. For an external MCP
client, nothing handles it.

## Modeling reads

| Read | REST | MCP | Agent |
|---|---|---|---|
| The whole design | `GET /model/export` | `get_schema` **and** `export_schema`, which do the same thing | not offered |
| List lenses | `GET /model/lenses` | only inside the whole design | not offered |
| Read one lens | `GET /model/lenses/{id}` | not offered | not offered |
| List entity types | `GET /model/entity-types` | not offered | not offered |
| Read one entity type | `GET /model/entity-types/{id}` | not offered | not offered |
| List relation types | `GET /model/relation-types` | not offered | not offered |
| Read one relation type | `GET /model/relation-types/{id}` | not offered | not offered |
| List a type's properties | `GET /model/{owner}/{id}/properties` | not offered | not offered |
| List what a lens includes | `GET /model/lenses/{id}/includes/...` | not offered | not offered |
| List agent configurations | `GET /model/lenses/{key}/ai-agents` | `list_ai_agents` | not offered |
| List saved queries | `GET /model/lenses/{key}/saved-queries` | `list_saved_queries` | not offered |
| Check schema or lens | `POST .../validate` | `validate_schema`, `validate_lens` | not offered |

REST offers ten separate modeling reads. MCP offers one read of the whole design, two
lists and two checks. There is no partial modeling read on MCP at all: a model that wants
one entity type's properties has to pull the entire design of the ontology.

## Runtime reads

`yes` = offered in full, `blank` = not offered, `reduced` = offered but with less.

| Read | REST | MCP | Agent |
|---|---|---|---|
| The scoped schema | `GET /schema` | `get_schema` | `get_schema` — reduced, returns text rather than JSON |
| List the visible entity types | `GET /schema/entity-types` | | |
| Read one entity type | `GET /schema/entity-types/{key}` | | |
| List the visible relation types | `GET /schema/relation-types` | | |
| Read one relation type | `GET /schema/relation-types/{key}` | | |
| List entities | `GET /entities/{type}` | `list_entities` | `list_entities` — reduced |
| Read one entity | `GET /entities/{type}/{id}` | `get_entity` | `get_entity` — reduced |
| Read part of a document | `GET .../documents/{prop}` | `get_document` | `get_document` |
| Read an entity's neighbours | `GET .../neighbors` | `get_neighbors` | `get_neighbors` — reduced |
| List relations | `GET /relations/{type}` | `list_relations` | `list_relations` — reduced |
| Read one relation | `GET /relations/{type}/{id}` | `get_relation` | not allowed, on purpose |
| Search by meaning | `GET /search/semantic` | `semantic_search` | `semantic_search` — reduced, plus `search_documents` |
| Run a query | `POST /query` | `execute_query` | `execute_query` |
| List saved queries | `GET /saved-queries` | `list_saved_queries` | `list_saved_queries` |
| Search saved queries | `GET /saved-queries/search` | `search_saved_queries` — reduced | `search_saved_queries` — reduced |
| Run a saved query | `POST /saved-queries/{key}/run` | `run_saved_query` | `run_saved_query` |
| List agents | `GET /ai/agents` | | |
| Read an agent card | `GET /ai/.../agent.json` | | |

There are three more reads on REST that run a model and deliberately have no tools:
`POST /ai/query`, `POST /ai/chat` and `POST /ai/a2a`.

**Counts.** 18 runtime reads on REST. 12 read tools on the runtime MCP mount, out of 20
tools. 12 tools an agent may be given. The numbers happen to match; the sets do not. Agents
have `search_documents`, which MCP does not have. MCP has `get_relation`, which agents may
not be given.

---

# 2. Where the three interfaces disagree

One table per operation.

## Listing entities

| | REST | MCP | Agent |
|---|---|---|---|
| Page size | 1–200, default 50, out of range is rejected | 1–200, default 50, out of range is pulled into range | at most 50, default 20 |
| Page offset | yes | yes | **not offered, always 0** |
| Sort field | yes | yes | **not offered, always creation time** |
| Sort direction | yes | yes | **not offered, always ascending** |
| Free-text term | called `q` | called `search` | called `search` |
| Property filters | `filter.<key>` | a `filters` object | a `filters` object, values must be strings |
| Filters that reach through a relation | yes | yes | yes |
| Choose which properties come back | yes | yes | **not offered** |
| Response | items, total, limit, offset | same | same |

## Listing relations

| | REST | MCP | Agent |
|---|---|---|---|
| Page size and offset | yes, yes | yes, yes | at most 50 / **no offset** |
| Sort field and direction | yes | yes | **not offered** |
| Filter by the two ends | yes | yes | **not offered** |
| Property filters | yes | yes | **not offered** |
| Choose which properties come back | **not offered anywhere** | | |

## Reading one entity, reading neighbours, reading a document

| | REST | MCP | Agent |
|---|---|---|---|
| Entity read: choose properties | yes | yes | **not offered** |
| Neighbours: restrict to one relation type | yes | yes | **not offered** |
| Neighbours: direction | fixed list of values | **any text** | **any text** |
| Neighbours: page size | 1–200, default 50 | same, default 50 | at most 50, default 20 |
| Neighbours: choose properties | yes | yes | **not offered** |
| Document: offset and length | yes | yes | yes |

## Searching by meaning

| | REST | MCP `semantic_search` | Agent `semantic_search` | Agent `search_documents` |
|---|---|---|---|---|
| The search text | `q` | `query` | `query` | `query` |
| Entity type | optional | optional | **required** | optional |
| What is searched | fixed list, default everything | **any text**, default everything | **not offered, always everything** | **fixed to documents** |
| Page size | 1–100, default 10 | 1–100, default 10 | at most 20, default 10 | at most 20, default 5 |
| Minimum score | yes | **not offered** | **not offered** | **not offered** |
| Property filters | yes | yes | **not offered** | **not offered** |
| Choose which properties come back | yes | yes | **not offered** | **not offered** |
| Text excerpts | yes, on by default | yes | always on | always on |

## Searching saved queries

| | REST | MCP | Agent |
|---|---|---|---|
| Page size | 1–20, default 3 | **fixed at 3** | **fixed at 3** |
| Minimum score | 0–1, default 0.7 | **fixed at 0.7** | **fixed at 0.7** |

## Running a query

Identical on all three: one query string in, columns and rows out. No page size, no offset,
no count, and **no upper limit on rows anywhere**. An unbounded query returns every
matching row into a model's context.

---

# 3. The four separate search indexes

Search by meaning runs over four separate index families, reached through two unrelated
sets of parameters.

| Index | What gets ranked | How you reach it | Can it be filtered? |
|---|---|---|---|
| Per entity type | one entity | `/search/semantic` with a type | Yes |
| Across all entity types | one entity | `/search/semantic` without a type | **No — the storage call has no filter argument** |
| Document passages | one passage, reported as its entity | `/search/semantic` with `searchIn=documents` | Yes |
| Saved-query descriptions | one saved query | `/saved-queries/search` — a different route | Not applicable |

`searchIn=all` combines the entity ranking with the document ranking. The saved-query index
combines with nothing and shares no vocabulary with the others: different page-size range,
different default, a minimum score that has a default where the others have none.

**There is no keyword ranking anywhere.** The free-text term on the entity list is
case-insensitive substring matching used as a filter: it does not rank, results come back
in whatever order `sort` asked for, and the term is silently ignored when the type has no
string property. So a combination of keyword and meaning cannot be expressed today, because
there is no second ranking to combine with.

---

# 4. What the responses promise

The same field names mean different things across the reads.

| Operation | Page size | Offset | What `total` means | Order of results |
|---|---|---|---|---|
| List entities or relations | yes | yes | **all matches** | the requested sort, stable |
| Read neighbours | yes | no | **not returned** | outgoing first, then incoming, sharing one budget |
| Search by meaning | yes | no | **the size of this page** | by score |
| List saved queries | no | no | not returned | unspecified |
| Search saved queries | yes | no | not returned | by score |
| Run a query | in the query text | in the query text | not returned | in the query text |

And the score:

| Case | What the score is |
|---|---|
| Searching entities only | a similarity between 0 and 1, comparable, can be thresholded |
| Searching documents only | the same |
| Searching both | a combined ranking number. Not a similarity, not comparable between responses, must not be thresholded |
| Searching saved queries | a similarity |

Three interfaces return the same field name for two incompatible kinds of number, and the
only way to tell them apart is the `searchIn` value the caller sent.

---

# 5. Findings

The first four make a question impossible to answer at one interface while the same
question can be answered at another. Those are not design choices.

**Agent entity search silently includes documents.**
The agent's `semantic_search` calls the service without options, so it searches entities
*and* document passages combined. Its description says it searches entities and returns
similarity scores. Both are wrong: the score is a combined ranking number, and the tool
fully overlaps its sibling `search_documents`. An agent has no way to search entities only.

**Agent tools cannot reach the second page.**
`list_entities` and `list_relations` fix the offset at 0. Combined with a page size capped
at 50, an agent can never see item 51 of anything.

**Agent entity search requires a type while its sibling does not.**
`semantic_search` demands an entity type; `search_documents` does not. That is the opposite
of REST and MCP, where the type is optional in both cases.

**MCP accepts free text where REST accepts a fixed list.**
`search_in` and `direction` are plain strings on MCP and on the agent tools, but fixed
value lists on REST. `search_in` is checked later in the service; `direction` is not checked
at all.

The rest are inconsistencies rather than blockages.

**`total` means two different things.**
On lists it is the number of all matches. On search it is the number of rows in the page
being returned.

**`q` means two different things.**
On the entity list it is a substring filter. On the two search routes it is the search text.
MCP and the agent tools call the first one `search` and the second one `query`, so the
collision is REST-only — which means the interfaces also disagree about naming.

**Only REST can set a minimum score.**
MCP and agent tools cannot set one at all, and they are the callers most likely to need it.
On top of that, what the minimum applies to depends on what was searched: it filters each
ranking before they are combined, never the combined number that comes back.

**Saved-query search is a separate world.**
Its own route, its own limits, its own default minimum score, all fixed in place on MCP and
on the agent tools. It shares no vocabulary with the other searches.

**Search across all entity types cannot be filtered.**
The storage call for the cross-type search takes no filters, while the single-type search
does. A caller finds this out by being rejected.

**Relations cannot be projected.**
No interface lets a caller choose which properties of a relation come back, although every
other read that returns entities or relations does.

**Reading neighbours can hide incoming relations.**
There is one shared budget and outgoing relations are taken first. An entity with more
outgoing relations than the page size comes back with no incoming neighbours at all, which
reads as "nothing points at this entity" and is not true.

**Queries have no row limit.**
Nothing on any interface caps how many rows a query returns. The only limit is the one the
caller wrote into the query.

**Two names for one modeling read.**
`get_schema` and `export_schema` on the modeling mount do exactly the same thing. Together
they are also the only way to find out which lenses exist — there is no list-lenses tool.

**Partial schema reads are REST only.**
The four narrow reads of the scoped schema exist on REST and nowhere else. A model gets the
whole scoped schema or nothing.

---

# 6. Questions this raises

Listed without answers. They belong to later steps of [approach.md](approach.md).

- `searchIn` currently expresses two different things at once: what gets ranked, and
  whether two rankings are combined. It never expresses *how* a single ranking is
  computed, which is the option we want to add. How should those be separated?
- Is combining the entity ranking with the document ranking a capability worth keeping? It
  is the only reason the score field has two meanings, and it is currently the default.
- Should the four search indexes share one set of parameters, or stay separate on purpose?
- Should the interfaces be allowed to differ in how strict they are about values, or is
  that already covered by the existing rule that REST rejects out-of-range values while MCP
  pulls them into range?
- `get_relation` is deliberately kept away from agents because a relation is meant to be
  reached by listing or by traversal. Does that still hold for an agent that can also run
  queries, which return relation identifiers directly?
