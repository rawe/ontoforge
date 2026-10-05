# Search

The entity list filters by a literal term. The search operation ranks entities for a query.
Neither server operation falls back to the other.

## Literal matching

The entity list's `q` is a case-insensitive substring filter over the lens-exposed `string`
properties of one type. It has no stemming, word boundaries, language or relevance order.
It composes with property filters, sort and offset. With no string property it is silently
ignored. It excludes documents; a per-property substring filter can reach document text.
See [instance-data.md](instance-data.md#query-paths) for property and query-path filters.

## Ranked search

Three independent dimensions select a ranking: scope (one entity type or every type the
lens exposes), search kind (properties, document, or both), and strategy. The query is
plain words, not an engine query language. The limit counts entities, from 1 to 100,
default 10; search has no paging or offset.

Ranked search reads [search indices](search-indices.md). Each search kind searches the
managed indices of the searched types:

| Search kind | Indices searched | Match |
|---|---|---|
| Property search | the default index of each searched type | the entity's own-field entry |
| Document search | the passage index of each searched document property | property key and the best passage's character coordinates |

Both kinds run by default. A kind with nothing to search contributes nothing by default;
requesting it explicitly is a validation error. A named document property restricts only
document search: on one type it must be an exposed document property; across types it
selects the types declaring that document property. No matching property is an error. An
index the lens does not search, or one whose entries are not yet built, contributes
nothing, and that is no error ([search-indices.md](search-indices.md#lifecycle)).

Long text belongs in a `document` property, which is chunked, ranked passage by passage,
and whose match names the property and the passage.

### Strategies and availability

Each strategy is a composition of retrieval methods; the methods are defined in the
[glossary](../README.md#glossary). Keyword ranking is stemmed full-text ranking in the
ontology's [keyword languages](#keyword-language).

| Strategy | Requirement | Retrieval methods |
|---|---|---|
| `semantic` | an embedding provider | semantic ranking |
| `keyword` | the adapter supports keyword ranking | the default keyword matching |
| `keyword-any` | as `keyword` | any-term keyword matching |
| `keyword-all` | as `keyword` | all-term keyword matching |
| `hybrid` | both requirements | semantic ranking and the default keyword matching, fused by reciprocal rank |

The default keyword matching is any-term keyword matching; `keyword` and `hybrid` always
use the same one. `keyword-any` and `keyword-all` each fix one retrieval method, whatever
the default is.

The default is the first available of `hybrid`, `keyword`, `semantic`. The feature report
lists available strategies in the order `hybrid`, `keyword`, `keyword-any`,
`keyword-all`, `semantic`, and every response names the applied strategy.
An unknown strategy is a validation error; a built but unavailable strategy is rejected
with the disabled-feature refinement and a message naming the available strategies. With
no available strategy the operation is disabled. The semantic-search feature boolean is
kept for saved-query discovery, which ranks by vector alone.

Without a provider no semantic entries are built, and keyword search works on its own.
Configuring a provider later builds the semantic entries in the background.

### Ranking

Each searched index is ranked once per retrieval method the strategy uses — semantic,
keyword, or both under `hybrid` — over the entries of its ready generation. Within one
method the rankings of every searched index — all types, own fields and passages alike —
are merged into one ranking by their own scores, which share one scale there: semantic
similarity under one embedding model, the native keyword score of one query. That ranking
is grouped by entity: an entity counts once, scored by its best entry, whichever index
holds it. A single method keeps those scores. Under `hybrid` the semantic and keyword
entity rankings are fused by reciprocal rank: an entity's score is the sum of
`1 / (60 + rank)` over the two, ranks starting at one, so only being found by both
methods adds up — being found by several indices never does. Equal scores prefer the
greater semantic similarity of each entity's best semantic entry, but only when every
entity in that tied group has one; otherwise, and among equal similarities, they are
ordered by entity id. What matched the entity is its best entry under the method in which
it ranks best, semantic on equal ranks.

Each index's ranking first fetches four times the limit in entries. When the result holds
fewer entities than the limit, every ranking not yet exhausted fetches once more, up to
1,000 entries, and the merge runs again; nothing further is fetched, so a search over
entities with many matching entries each can return fewer hits than the limit.

### Similarity floor

A REST caller may supply a minimum similarity, a number from 0 to 1 on the
`semanticSimilarity` scale below; absent means no floor. The floor is model-specific —
what counts as related depends on the embedding model — so REST never chooses one. The
MCP and agent search tools take none from the caller and instead apply the fixed floor
pinned by the rule *Search evidence does not establish answer sufficiency* in
[../decisions.md](../decisions.md) whenever the default strategy ranks semantically. A
floor applies to semantic entries only: each semantic ranking drops every entry measured
below the floor before it is grouped by entity, so the floor applies to an entity's best
semantic entry.
Under `semantic` the filtered ranking is the result, and zero hits is a valid outcome.
Under `hybrid` only the semantic rankings are filtered; keyword-only hits are untouched
and keep an unmeasured similarity, which is not a negative. Under `keyword`, `keyword-any`
or `keyword-all`, requested or reached as the default, the floor has nothing to apply
to and is a validation error naming the parameter rather than silently ignored.

### Response

The envelope carries `query`, `type` (null across types), `in` (defaults filled), `strategy`,
`minSimilarity` (null when absent), `filter` (empty when absent), and `hits`. Each hit
carries `entity`, `relativeScore`, `matches` and `matched`. There is no aggregate
confidence or total.

The relative score is 1.0 for the best hit and each other hit's ordering number as a
fraction of the best, comparable only within that response. Under one retrieval method it
is a ratio of that method's scores; under `hybrid` a ratio of fusion scores, and fusion
can produce multiple 1.0 hits whose tie order is resolved separately. Neither a 1.0 score nor
a smooth tail says that the query has a relevant answer. Search returns candidates even
for an unrelated query.

**Matches.** Each index that found the entity contributes one match, its best entry
there — under the method in which the entity ranks best, else under the other. The default index contributes an entity match, `kind: "properties"`. A passage
index contributes a passage match, `kind: "document"`, with `propertyKey`, `charOffset`
and `charLength`, directly usable with a [document read](documents.md). The entity match
comes first, then passage matches in ranking order, one per document property.

Every match also carries `evidence`, measured on the match's own entry wherever a ranking
fetched that very entry:

| Field | Meaning |
|---|---|
| `semanticSimilarity` | Original measured similarity, `(1 + cosine) / 2`, or null when unavailable or unmeasured. It is not a probability or calibrated confidence. |
| `keywordMatch` | True when the query terms matched this entry; null when unavailable or unmeasured. False requires an explicit negative evaluation; rankings alone emit only true/null. |
| `keywordScore` | The adapter's native full-text ranking measurement for this entry, passed through raw, or null when unavailable or unmeasured. A number exactly when `keywordMatch` is true. Higher is better within one ranking; it has no fixed upper bound and no meaning across responses, ontologies or languages, and is not comparable to `semanticSimilarity`. It exists for inspection and retrieval evaluation and never enters any ranking step. |

A method whose ranking did not fetch the match's entry — it ranked other passages of the
document, say — leaves that measurement null. Missing from a limited ranking does
not prove a non-match. Keywords can span several properties; semantic matching over
composed text does not identify an individual property. Null must not be read as false.

**What matched.** `matched` names the entity's best entry:

| Field | Meaning |
|---|---|
| `index` | The key of the index the entry belongs to |
| `partKind` | `self` (own fields), `relation` or `passage` |
| `relationType`, `relationId` | The relation of a relation entry; null otherwise |
| `target` | For a relation entry, the entity at the relation's other end: `id`, `type` and `label`, the value of its name property — null when empty or hidden by the lens. Null otherwise |
| `snippet` | The start of the entry's text, whitespace collapsed, at most 200 code points, an ellipsis marking a cut. Empty when the index reads a property the lens hides |
| `charOffset`, `charLength` | A passage's coordinates in its document; null otherwise |

It names the entry, never which retrieval method found it.

Callers should inspect entity values and read passages before making claims from them.
Related content can provide a useful starting entity for graph traversal without
containing the requested answer. Over REST there is no automatic similarity floor; only a
caller sets one. The MCP and agent search tools apply the fixed floor described under
[Similarity floor](#similarity-floor).

Entities carry every lens-exposed property by default, with document values stubbed.
Projection works as on the entity list, including raw document text when explicitly
named. It never projects matches; the entity id and type key always survive. Vectors
never appear in entities or design exports.

### Scope and filters

Cross-type search ranks the exact exposed set: one ranking per searched index, merged by
score into one globally ordered page with no per-type quota. No shared cross-type index exists.
Property filters narrow this set to types declaring every key. A key declared nowhere,
or with conflicting data types across its declaring types, is a validation error. A query
path similarly drops types its relation does not touch. This set feeds both kinds.

Filters run inside every ranking, on the entity owning each entry, so a ranking's page
counts entries that pass them. They follow entity-list resolution, coercion and
collected-error rules — negation and existence included — but substring operators are
rejected. An existence key naming a bare relation type narrows the set to the types the
relation touches, as a query path does. Path conditions and relation existence conditions
are accepted only where the adapter declares support; rejection names the entity list as
the alternative. Adapter limitations are recorded in
[../storage-adapters.md](../storage-adapters.md).

### Keyword language

Keyword entries are stemmed in every language of the ontology's **keyword language set**
— English, German, or both — into one representation, and the query is stemmed in each of
them. Within one language the query terms combine by the strategy's keyword matching,
each also matching as a prefix; the languages are alternatives, so a query matches in
whichever language stems it the way the entry was stemmed. Matches across languages come
from semantic ranking. No request names a language.

An ontology created on this server starts with German and English; one whose storage was
upgraded from an earlier layout starts with its text-search language alone
([../storage-adapters.md](../storage-adapters.md)). No interface reads or changes the set.

The **text-search language** is a separate setting: chosen at creation, `english` by
default or `german`, immutable, carried in export and checked on import
([transfer.md](transfer.md)). Ranked search does not read it; keyword entries are stemmed
in the keyword language set alone.

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
that were never embedded. An adapter that stores no search indices keeps search data of
its own, which the same operation rebuilds
([../storage-adapters.md](../storage-adapters.md#own-search-storage)).

## Vector index width drift

A vector index fixes its vector width when it is created. Changing the embedding model, or
its configured width, makes the provider emit vectors of a different width, which an
existing index refuses. Nothing about the index looks wrong to the database — it stays
healthy and online — so the failure does not appear at startup. It appears as a storage
error on the first operation that touches the index: a saved-query write that embeds its
description, or a saved-query discovery. Search indices are not affected: a changed model
builds new generations of their semantic entries
([search-indices.md](search-indices.md#lifecycle)).

Startup detects the condition rather than the symptom: with a provider configured, the
check walks every registered ontology, compares the configured width of each vector index
outside search indices against the provider's, and reports every mismatch as a warning
identifying the index by what it covers — saved-query descriptions — never by a physical
index name, and naming rebuild as the remedy.

Startup warns and does not repair; the reasoning is in
[../decisions.md](../decisions.md#behaviour). Rebuild does repair, in the three-phase
order above — drop, regenerate, build. A startup ensure that cannot succeed, which is what
an unfinished rebuild leaves behind, is reported against the ontology it belongs to and
does not stop the server from starting.

## Through the interfaces

The full contract is in [../interfaces.md](../interfaces.md). REST `GET /search`, MCP,
agent tools and saved-query search steps use one search operation and the same envelope.
MCP and agents expose `search` (both kinds) and `search_documents` (documents only, every
hit carrying a passage); neither tool takes a strategy or a floor — both apply the fixed
floor whenever the default strategy ranks semantically and echo it as `minSimilarity`,
null under a keyword default. Both allow an omitted entity type.
MCP additionally accepts filters and fields. Agent limits are 10 by default for search,
5 for document search, and 20 maximum. A saved-query search step requires one type and
uses the default kinds and strategy; see [saved-queries.md](saved-queries.md).

Saved-query discovery is separate: it retains its absolute cosine score and minimum
score, description-only embedding, and embedding-provider requirement.

The palette and relation picker use ranked search whenever the strategy list is nonempty,
falling back to literal entity lists otherwise. They show labels, type chips and one badge
per document match, with no score or passage text. Extraction review searches properties
for up to three existing candidates with no score threshold or displayed number.
