# Search

The entity list filters by a literal term. Ranked search ranks entities or passages for a
query, in two forms: the [**entity search**](#entity-search), which reads a scope of
types or named indices with the methods the request chooses, and the
[**passage search**](#passage-search), which ranks the passages of documents the same
way. No server operation falls back to another.

## Literal matching

The entity list's `q` is a case-insensitive substring filter over the lens-exposed `string`
properties of one type. It has no stemming, word boundaries, language or relevance order.
It composes with property filters, sort and offset. With no string property it is silently
ignored. It excludes documents; a per-property substring filter can reach document text.
See [instance-data.md](instance-data.md#query-paths) for property and query-path filters.

## Ranked search

This section describes what both searches share: how they rank, the similarity floor,
and how filters narrow them. The query is plain words, not an engine query language.
Search has no paging or offset.

Ranked search reads [search indices](search-indices.md). An index the lens does not
search, or one whose entries are not yet built, contributes nothing, and that is no error
([search-indices.md](search-indices.md#lifecycle)).

Long text belongs in a `document` property, which is chunked, ranked passage by passage,
and whose match names the property and the passage.

### Methods and availability

Ranked search has two retrieval methods, defined in the [glossary](../glossary.md):
semantic ranking, which needs an embedding provider, and keyword ranking — stemmed
full-text ranking in the ontology's [keyword languages](#keyword-language) — which needs an
adapter that ranks by keyword. Keyword matching is any-term by default and all-term on
request; all-term means that every term must match, still with stemming and prefix
matching ([ADR 0026](../adr/0026-any-term-keyword-matching.md)). The feature report says
whether ranked search can run at all; its semantic-search boolean also gates saved-query
discovery, which ranks by vector alone.

Without a provider no semantic entries are built, and keyword search works on its own.
Configuring a provider later builds the semantic entries in the background.

### Ranking

The alternatives weighed for ranking and evidence are in
[ADR 0020](../adr/0020-search-ranking-and-evidence.md).

Each searched index is ranked once per retrieval method the search runs — semantic,
keyword, or both — over the entries of its ready generation. Within one
method the rankings of every searched index — all types, own fields and passages alike —
are merged into one ranking by their own scores, which share one scale there: semantic
similarity under one embedding model, the keyword score of one query. That ranking is
grouped by entity: an entity counts once, scored by its best entry, whichever index holds
it. A single method keeps those scores. With both methods the semantic and keyword entity
rankings are fused by reciprocal rank: an entity's score is the sum of `1 / (60 + rank)`
over the two, ranks starting at one, so only being found by both methods adds up — being
found by several indices never does. Equal scores prefer the greater semantic similarity
of each entity's best semantic entry, but only when every entity in that tied group has
one; otherwise, and among equal similarities, they keep the order in which the rankings
first list them, the semantic ranking before the keyword ranking. What matched the entity
is its best entry under the method in which it ranks best, semantic on equal ranks. It
carries the score of every method that fetched this very entry — the same part of the same
index: the semantic similarity, the keyword score, or both. The two are never compared,
and the item as a whole has no score; its place is its rank. A method without a score may
still have found another entry of the entity, or this entry beyond the entries it fetched,
so a missing score says nothing about that method.

An entry's **keyword score** is the number of distinct query words it contains — those
left after stop words are dropped ([below](#keyword-language)) — plus, as
a fraction below one, the adapter's native full-text ranking of the entry. A word counts
once however differently the keyword languages stem it, and a word repeated in the query
counts once. An entry holding more of the query's words therefore always ranks above one
holding fewer; among equal counts the native ranking decides.

Each index's ranking first fetches four times the limit in entries. When the result holds
fewer entities than the limit, every ranking not yet exhausted fetches once more, up to
1,000 entries, and the merge runs again; nothing further is fetched, so a search over
entities with many matching entries each can return fewer items than the limit.

### Similarity floor

A REST caller may supply a minimum similarity in the `semantic` block of the
[entity](#entity-search) or [passage search](#passage-search), a number from 0 to 1 on
the `(1 + cosine) / 2` scale; absent means no floor. The floor is model-specific — what
counts as related depends on the embedding model — so REST never chooses one. The MCP and
agent search tools take none from the caller and instead apply a fixed floor of 0.75
whenever semantic search runs, because a model client cannot judge the raw scores. A
floor applies to semantic entries only: each semantic ranking drops every entry measured
below the floor before it is grouped, so the floor applies to an entity's best semantic
entry. With semantic search alone the filtered ranking is the result, and an empty result
is a valid outcome. With both methods only the semantic rankings are filtered; what
keyword alone finds is untouched.

### What matched

A retriever names, for each entity it found, the best entry that matched it as `matched`
([retrievers.md](retrievers.md)):

| Field | Meaning |
|---|---|
| `index` | The key of the index the entry belongs to |
| `partKind` | `self` (own fields), `relation` or `passage` |
| `relationType`, `relationId` | The relation of a relation entry; null otherwise |
| `target` | For a relation entry, the entity at the relation's other end: `id`, `type`, `label`, the value of its name property — null when empty or hidden by the lens — and `identity`, its [identity](entity-identity.md) — null when it has none or the lens does not show it. Null otherwise |
| `snippet` | The start of the entry's text, whitespace collapsed, at most 200 code points, an ellipsis marking a cut. Empty when the index reads a property the lens hides |
| `charOffset`, `charLength` | A passage's coordinates in its document; null otherwise |

It names the entry, never which retrieval method found it.

Search returns candidates even for an unrelated query. Callers should inspect entity
values and read passages before making claims from them. Related content can provide a
useful starting entity for graph traversal without containing the requested answer.
Vectors never appear in search results or design exports.

### Scope and filters

Cross-type search ranks the exact exposed set: one ranking per searched index, merged by
score into one globally ordered page with no per-type quota. No shared cross-type index exists.
Property filters narrow this set to types declaring every key. A key declared nowhere,
or with conflicting data types across its declaring types, is a validation error. A query
path similarly drops types its relation does not touch.

Filters run inside every ranking, on the entity owning each entry, so a ranking's page
counts entries that pass them. They follow entity-list resolution, coercion and
collected-error rules — negation and existence included — but substring operators are
rejected. An existence key naming a bare relation type narrows the set to the types the
relation touches, as a query path does. Path conditions and relation existence conditions
are accepted only where the adapter declares support; rejection names the entity list as
the alternative. Adapter limitations are recorded in
[../storage-adapters/](../storage-adapters/README.md).

### The search catalog

The catalog lists the indices a lens can search, in key order, so that a client or a
model can choose the `indices` of a search. Each is projected through the lens:

| Field | Meaning |
|---|---|
| `key`, `kind`, `name`, `entityType` | The index — `kind` is `default`, `passage` or `custom` |
| `description` | A custom index's description as written. A managed index's is composed for the lens from the fields it shows, so it never names a property or document the lens hides — with all of them hidden it names none; the stored description, which modeling reads, is unchanged |
| `fields` | The root fields the index reads that the lens shows |
| `relations` | The relation groups the lens shows — a group whose relation type, or the entity type at its other end, the lens hides is not listed — each with `relationType`, `direction` and `label`: the group's label, else the relation type's display name |
| `documentProperty` | The document the index reads passages of; null when it reads none or the lens hides it |
| `modes` | The representations the index keeps that can rank now — `semantic` only with an embedding provider — in the order `semantic`, `keyword` |
| `status` | The index's own build state ([search-indices.md](search-indices.md#status)) |

### Keyword language

Keyword entries are stemmed in every language of the ontology's **keyword language set**
— English, German, or both — into one representation, and the query is stemmed in each of
them. Within one language the query terms combine by the search's keyword matching,
each also matching as a prefix; the languages are alternatives, so a query matches in
whichever language stems it the way the entry was stemmed. A query word that any
language of the set treats as a stop word is left out in every language — "für" is not
searched as an English word — and a query of only such words finds nothing by keyword.
Matches across languages come from semantic ranking. No request names a language.

The set belongs to the ontology's design, not to the registry: creating an ontology names
no language, and a new one starts with German and English. One whose storage was upgraded
from an earlier layout starts with the single language it was created with
([../storage-adapters/](../storage-adapters/postgresql.md#how-ontologies-are-isolated)). The set
is read and changed through the ontology's search settings in modeling
([../interfaces/](../interfaces/modeling-rest.md#search-settings)); a change is validated whole
before anything is written and accepts the languages in any order, kept in the order
German, English. Changing it builds a new keyword generation of every index in the background —
keyword entries need no embedding calls — and the previous generations keep answering
until their successors are ready ([search-indices.md](search-indices.md#lifecycle)).
Transfer carries the set, and import replaces the target's with it
([transfer.md](transfer.md)).

## Entity search

The entity search ranks entities for one query text through a scope of
[search indices](search-indices.md), by the methods the request chooses, restricted by
exact filters. Ranking, grouping and fusion are those under [Ranking](#ranking). Only the
order is returned, never a score.

**Scope.** Without `types` or `indices` it reads every type the lens shows, through the
managed indices of that type the lens can search
([ontology-lenses.md](ontology-lenses.md#search-through-a-lens)). `types` reads the
managed indices of the named types. `indices` reads exactly the named indices, custom
ones included; a custom index is read only when named, and one with relation groups also
ranks an entity by its relation entries ([search-indices.md](search-indices.md#relation-groups)).
One scope field at a time. A type
the lens does not show, or an index the lens cannot search, is a validation error at its
position. A named type with no managed index to search contributes nothing and is
reported as a limitation.

**Methods.** One block per method: `keyword` with its matching, `any` (default) or
`all`, and `semantic` with its [similarity floor](#similarity-floor). The blocks sent
choose the methods, and two methods are fused by reciprocal rank. With neither block, both
run, or keyword alone when no embedding provider is installed. A `semantic` block without
an embedding provider is rejected as a disabled feature. A method that cannot run on an
index — switched off by the index definition, or without a ready generation
([search-indices.md](search-indices.md#lifecycle)) — finds nothing there and is reported
as a limitation, never as an error.

**Filters** follow [Scope and filters](#scope-and-filters). They are checked against the
scope's types, and a type that does not declare every key — or that a query-path key does
not resolve from — drops out. A key that no type of the scope resolves is a validation
error. With no type left, the result is empty and carries a limitation.

**Items.** An item names the entity — `_id`, `_entityTypeKey`, `name` and, when its type
declares an identity the lens shows, `identity`: the identity properties and their values,
in the identity's order — and the best entry that found it: its index, its part (`self`,
`relation` or `passage`), a snippet and its scores ([ranking](#ranking)). A passage adds
the document and the passage's place in it; a relation adds the relation type and the
entity at its other end, named without an identity. The snippet is withheld when the index
reads a property the lens hides; a passage's document is null when the lens hides it;
relation entries the lens cannot see are skipped. An entity deleted after ranking is left
out, so a page may be shorter than the limit.

**Limitations.** `ran` lists the methods that ran on at least one index. Each limitation
names its code:

| Code | Meaning |
|---|---|
| `not-searchable` | Named types — in the passage search also named documents — without a managed index the lens can search |
| `switched-off` | The index definition switches the method off on these indices |
| `not-ready` | No ready generation of the method on these indices |
| `filter-excludes-all-types` | No type of the scope declares every filter key |

## Passage search

The passage search ranks passages — chunks of [documents](documents.md#chunking) — for one
query text, through a scope of search indices that read a document. Methods, filters and
limitations are those of the [entity search](#entity-search); only the result unit
differs. A passage carries the scores of the methods that found it, as an entity search
entry does; the order is the rank.

**Scope.** Only an index over a document the lens shows can be searched: a passage
returns its text. Without `types`, `documents` or `indices` it reads every type the lens
shows, through its managed passage indices. `types` reads the managed passage indices of
the named types, `documents` (`type.property`) the managed passage index of each named
document, and `indices` exactly the named indices, custom ones included; a custom index is
read only when named. One scope field at a time. A type or property the lens does not
show, a property that is not a document, or an index without a document the lens shows is
a validation error at its position. A named type or document with no managed passage
index to search contributes nothing and is reported as a limitation.

**What counts.** Only passage entries count; the own-field and relation entries of a
custom index are ignored. A passage is one chunk of one document of one entity, so two
indices over the same document find the same passages, and each counts once, by its best
entry. The limit counts passages. `perEntity`, from 1 to the limit, keeps at most that
many passages per entity, in rank order; without it, there is no cap per entity.

**Filters** apply to the entity that owns the document.

**Items.** An item names the entity as the [entity search](#entity-search) does — `_id`,
`_entityTypeKey`, `name` and, where it applies, `identity` — and the passage: its
document, its chunk ordinal, its character offset and length, its scores and its text. The
text
is read when the search answers, from the document as it is then, at that offset and
length; it never includes the header the stored entry carries. `text: false` leaves it
out. An entity deleted after ranking is left out, so a page may be shorter than the limit.

## Rebuild

Search indices keep themselves current, a changed embedding model included
([search-indices.md](search-indices.md#lifecycle)). The one vector store outside them is
saved-query discovery's: the description vectors and their index
([saved-queries.md](saved-queries.md)). The search-data rebuild regenerates those; it does
not touch search indices.

It is one modeling operation per ontology, covering that ontology and nothing beyond it.
There is no server-wide rebuild: after an embedding-provider switch it is run once per
ontology. It:

1. drops the saved-query description index if its vector width no longer matches the
   provider's, and leaves it alone otherwise;
2. re-embeds every saved-query description;
3. builds the index at the provider's width if it is absent — the one step 1 dropped, or
   one that never existed.

**It runs without an embedding provider**, and then has nothing to do: without a provider
there is no width to reconcile and saved-query discovery, which ranks descriptions by
vector alone, has nothing to rebuild. The summary reports the omission; nothing is counted
as failed.

The order is forced, not chosen: an index rejects every vector of a width other than its
own, so while a drifted one stands the new vectors cannot be written, and it cannot be
built over the old ones. Between step 1 and step 3 the ontology has no saved-query
description index, and a rebuild that dies in between leaves it absent with vectors of
mixed width — the next rebuild that runs to completion repairs that, since it regenerates
every vector regardless.

It streams progress while running, as newline-delimited JSON: a progress record per
processed item carrying the group it belongs to, the count so far and that group's total —
the saved-query descriptions form one group — then a final summary with the processed and
failed counts, the overall totals, and whether the embeddings were skipped. An item whose
embedding call fails is counted as failed. A run with no provider fails nothing, so the
skip flag is what distinguishes it from a complete run.

So rebuild repairs a drifted width of the saved-query description index and descriptions
that were never embedded.

## Vector index width drift

A vector index fixes its vector width when it is created. Changing the embedding model, or
its configured width, makes the provider emit vectors of a different width, which an
existing index refuses. Nothing about the index looks wrong to the database — it stays
healthy and online — so the failure does not appear at startup. It appears as a storage
error on the first operation that touches the index: a saved-query write that embeds its
description, or a saved-query discovery. Search indices are not affected: a changed model
builds new generations of their semantic entries
([search-indices.md](search-indices.md#lifecycle)). The stored vectors are never at stake:
they live in their own column, not in the index.

Startup detects the condition rather than the symptom: with a provider configured, the
check walks every registered ontology, compares the configured width of each vector index
outside search indices against the provider's, and reports every mismatch as a warning
identifying the index by what it covers — saved-query descriptions — never by a physical
index name, and naming rebuild as the remedy.

Startup warns and does not repair
([ADR 0013](../adr/0013-semantic-index-width-drift-reported-at-startup.md)). Rebuild does repair, in the three-phase order above —
drop, regenerate, build. A startup ensure that cannot succeed, which is what an unfinished
rebuild leaves behind, is reported against the ontology it belongs to and does not stop
the server from starting: the server must remain available to finish the repair.

## Through the interfaces

The full contract is in [../interfaces/](../interfaces/README.md). REST
`POST /search/entities` is the [entity search](#entity-search), `POST /search/passages`
the [passage search](#passage-search), and `GET /search-indices` the catalog. A
saved-query search step runs the entity search ([saved-queries.md](saved-queries.md)).

The MCP and agent tool `search` runs the entity search, `search_documents` the passage
search, each answering with that search's response. They take its scope, filters and
limit — `search_documents` also the cap per entity and whether passages carry their
text — but no method block and no floor: they run what can run, semantic under the
fixed [similarity floor](#similarity-floor). Only MCP takes `indices`, and there
`list_search_indices` answers the catalog; agents see no index keys. Agent limits are
10 by default for search, 5 for document search, and 20 maximum.

Saved-query discovery is separate: it retains its absolute cosine score and minimum
score, description-only embedding, and embedding-provider requirement.

The palette and relation picker use ranked search whenever it can run, falling back to
literal entity lists otherwise. Neither displays a score or passage text; what they show
of an item is in
[../product-surface/](../product-surface/finding-and-collecting.md#matched-via).
