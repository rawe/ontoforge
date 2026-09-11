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
default 10; search has no paging, offset or minimum score.

| Search kind | Ranked unit | Match |
|---|---|---|
| Property search | one entity, using its string properties | entity-level semantic evidence and, when known, contributing keyword property keys |
| Document search | a passage of a document property | property key and the best passage's character coordinates |

Both kinds run by default. A kind with nothing to search contributes nothing by default;
requesting it explicitly is a validation error. A named document property restricts only
document search: on one type it must be an exposed document property; across types it
selects the types declaring that document property. No matching property is an error.

Long text belongs in a `document` property, which is chunked, ranked passage by passage,
and whose match names the property and the passage.

### Strategies and availability

| Strategy | Requirement | Scoring |
|---|---|---|
| `semantic` | an embedding provider | vector similarity |
| `keyword` | the adapter supports keyword ranking | stemmed full-text ranking in the ontology language |
| `hybrid` | both requirements | reciprocal rank fusion of semantic and keyword rankings |

The default is the first available of `hybrid`, `keyword`, `semantic`. The feature report
lists available strategies in that order, and every response names the applied strategy.
An unknown strategy is a validation error; a built but unavailable strategy is rejected
with the disabled-feature refinement and a message naming the available strategies. With
no available strategy the operation is disabled. The semantic-search feature boolean is
kept for saved-query discovery, which ranks by vector alone.

Without a provider, property keyword values and document chunks are still stored. Keyword
search works on a supporting adapter. Configuring a provider later does not retroactively
embed data: the rebuild below supplies missing vectors.

### Fusion and matches

Hybrid first fuses rankings of the same units within each kind, using the sum of
`1 / (60 + rank)` with ranks starting at one. Document search then collapses passages to
entities: the best passage determines entity order, while each matching document property
contributes its best passage. The service grows the passage budget until the ranking is
exhausted, so a long document cannot hide another entity or another matching document
property. An entity appears once, and its matches survive fusion.

When both kinds run over more than one searched type, the entity score is the maximum
of its reciprocal kind-rank contributions, using the same constant and one-based ranks.
Having a document therefore supplies no additive cross-kind bonus. Equal scores prefer
the greater semantic similarity found in each entity's returned matches, but only when
every entity in that tied group has a measured similarity. Otherwise the whole group
retains encounter order, with properties encountered before document-only entities.
Equal similarities also retain encounter order. Discarded passages supply no tie evidence.

With at most one searched type, including a lens or filter narrowed to one type, both
kinds still use summed reciprocal ranks. A single kind keeps its strategy ranking.

### Response

The envelope carries `query`, `type` (null across types), `in` (defaults filled), `strategy`,
`filter` (empty when absent), and `hits`. Each hit carries `entity`, `relativeScore`, and
`matches`. There is no aggregate confidence, snippet or total.

The relative score is 1.0 for the best hit and each other hit's ordering number as a
fraction of the best, comparable only within that response. For one kind under semantic
or keyword search it is a ratio of source scores; under hybrid or cross-kind fusion it
is rank-derived. Cross-type best-kind scoring can produce multiple 1.0 hits whose tie
order is resolved separately. Neither a 1.0 score nor a smooth tail says that the query
has a relevant answer. Search returns candidates even for an unrelated query.

An entity match carries `kind: "properties"`. A passage match carries
`kind: "document"`, `propertyKey`, `charOffset` and `charLength`, directly usable with a
[document read](documents.md). The entity match comes first, then passage matches in
document-ranking order, with one per document property.

Every match also carries `evidence`:

| Field | Meaning |
|---|---|
| `semanticSimilarity` | Original measured similarity, `(1 + cosine) / 2`, or null when unavailable or unmeasured. It is not a probability or calibrated confidence. |
| `keywordMatch` | True when the normalized query terms matched this stored search unit; null when unavailable or unmeasured. False requires an explicit negative evaluation; source rankings alone emit only true/null. |
| `keywordPropertyKeys` (property matches only) | Keys whose indexed values supplied keyword query terms, or null when complete, lens-safe attribution is unavailable. A listed property need not satisfy the whole query on its own. |

Evidence belongs to the composed entity representation or to the precise returned
passage. Missing from a limited ranking does not prove a non-match. Keywords can span
several properties; semantic matching over composed text does not identify an individual
property. Property-key attribution is withheld if any supporting key is hidden by the
lens or no longer an exposed string property. Null must not be read as false.

Callers should inspect entity values and read passages before making claims from them.
Related content can provide a useful starting entity for graph traversal without
containing the requested answer. There is no automatic similarity floor.

Entities carry every lens-exposed property by default, with document values stubbed.
Projection works as on the entity list, including raw document text when explicitly
named. It never projects matches; the entity id always survives and the type key survives
across types. Technical text and vectors never appear in entities or design exports.

### Scope and filters

Cross-type search ranks the exact exposed set through per-type indexes in one statement,
with one globally ordered page and no per-type quota. No shared cross-type index exists.
Property filters narrow this set to types declaring every key. A key declared nowhere,
or with conflicting data types across its declaring types, is a validation error. A query
path similarly drops types its relation does not touch. This set feeds both kinds.

Filters run inside every ranking. They follow entity-list resolution, coercion and
collected-error rules, but substring operators are rejected. Path conditions are accepted
only where the adapter declares support; rejection names the entity list as the
alternative. Adapter limitations are recorded in [../storage-adapters.md](../storage-adapters.md).

### Text-search language

An ontology's `textSearchLanguage` is chosen at creation, defaults to `english`, and is
immutable. `english` and `german` are supported. The bound store carries it; requests and
environment variables cannot override it. Export includes the language as a required
field, and import rejects a language differing from the existing target ontology.

### Property keyword text

Keyword search uses a separate values-only representation. Only nonempty values of
schema-declared `string` properties contribute, in full-schema order, separated by one
newline. Type keys, property keys and display labels are not searchable keyword content.
Documents, numbers, dates, datetimes and booleans do not enter this representation.
An entity without contributing values has no property keyword match.

The combined value text has a 30,000-codepoint budget including separators. The last
included value is truncated to that budget, and the exact indexed property segments
are retained for attribution. Query terms are normalized in the ontology's language and
matched permissively: a hit carries at least one surviving term, each term also matching
as a prefix, potentially across multiple properties. Rank order, not membership,
separates a hit carrying every term from one carrying a single term. Property attribution
requires every surviving term to be present exactly, so a hit matched on part of the
query, or by prefix alone, reports unavailable attribution rather than a partial list.
Short content terms are often more useful than a full question for keyword search.

Creation, string-value updates and the rebuild below maintain the keyword representation.
Non-string updates leave it intact. Schema edits do not refresh stored representations.
Until refreshed, membership can reflect stale stored values and unavailable property
attribution remains null. Document keywords continue to use passage text.

## What gets embedded

An entity's vector comes from one composed text: the entity type key, then each `string`
property that has a value, written as `key=value`, in the order the schema declares them.

```
person: name=Alice Chen, role=Distributed Systems Engineer
```

The rules behind that line are what a reimplementation has to match:

- **Only `string` properties contribute.** Integers, floats, booleans, dates and datetimes
  are excluded — an entity is not findable by meaning through its numeric fields. Filter
  on those instead.
- **`document` properties are excluded.** They are chunked and embedded separately, and
  that is what the document ranking searches. A document's content therefore never
  influences its own entity's vector, and a very long document cannot drown out the
  entity's short identifying fields.
- Properties with no value are skipped. An entity with no string values embeds as its type
  key alone.
- **The text is composed from the full schema, not from the lens.** Two lenses exposing
  different subsets of a type still see identical vectors. Whether a property contributes
  to retrieval is a schema fact, never a lens fact.
- The composed text is capped at 30 000 characters and truncated at the cap.
- Composition is deterministic, so re-embedding an unchanged entity reproduces the same
  text.

## Keeping search data current

Property text and document chunks are recomputed automatically; vectors are added when a provider is configured:

- on entity creation, always;
- on entity update, whenever the update touches any `string` property — the vector is
  recomputed from the merged post-update state, not from the submitted fragment;
- for document properties, per changed property: its passages are discarded, the value is
  re-chunked, and the new passages are embedded. Passages whose text is unchanged reuse
  their existing vector — unless it is of another width, which no current index could hold
  — so editing part of a large document re-embeds only the passages the edit touched
  ([documents.md](documents.md)).

Not recomputed, and all three are traps:

- **A schema change refreshes nothing.** Adding a string property to an entity type leaves
  every existing entity's stored text reflecting the schema as of its last write. The
  property contributes to retrieval only for entities written afterwards.
- **Deleting a string property leaves its values behind.** Deleting the definition does not
  delete stored values, and neither stored text records which property a word came from, so
  an entity keeps matching on a value the schema no longer declares — in keyword search and
  semantic search alike. The match cannot say which property it came from, because the
  property is gone. This is deliberate: a schema edit stays instant and writes no instance
  data. The leftovers are cleared on the next rebuild.
- **A failed embedding does not fail the write.** The entity or passage is stored without
  a vector and is simply absent from semantic results. The failure is logged, not returned.

All three are repaired by the same operation.

### Rebuild

One modeling operation per ontology — it covers that ontology's whole schema and all its
data, not one lens and nothing beyond the ontology. There is no server-wide rebuild:
after an embedding-provider switch it is run once per ontology. It:

1. drops every one of the ontology's semantic indexes whose vector width no longer
   matches the provider's, and only those;
2. recomposes and stores each entity's semantic text and keyword value segments, and
   rewrites its optional vector;
3. discards and re-chunks every document property value, embedding every passage whose
   stored vector is not already of the provider's width — after a model switch that is all
   of them;
4. re-embeds every saved-query description ([saved-queries.md](saved-queries.md));
5. builds every semantic index the schema calls for and does not have — the ones it
   dropped in step 1, at the provider's width, and any that never existed.

**It runs without an embedding provider.** Steps 2 and 3 are then the whole operation, minus
the vectors: keyword segments are recomposed and passages re-chunked, neither of which needs
a model, and passages are themselves the document keyword index. Steps 1, 4 and 5 are
skipped, because without a provider there is no width to reconcile, no vector index to hold
and saved-query discovery — which ranks descriptions by vector alone — has nothing to
rebuild. The summary reports the omission; nothing is counted as failed.

The order is forced, not chosen: an index rejects every vector of a width other than its
own, so while a drifted one stands the new vectors cannot be written, and it cannot be
built over the old ones. Between step 1 and step 5 the ontology has no semantic index, and
a rebuild that dies in between leaves them absent with vectors of mixed width — the next
rebuild that runs to completion repairs that, since it regenerates every vector
regardless.

It streams progress while running, as newline-delimited JSON: a progress record per
processed item carrying the entity type key it belongs to, the count so far and that
group's total, then a final summary with per-type processed and failed counts, the overall
totals, and whether the embeddings were skipped. An item whose embedding call fails is
counted as failed; its refreshed keyword values remain searchable without a vector. A run
with no provider fails nothing — a missing vector is the intended result there, not a
failure — so the skip flag is what distinguishes it from a complete run.

So rebuild repairs: missing indexes, drifted index widths, entities and passages that were
never embedded, stored text stale with respect to a schema change — including the values of
a deleted string property — and chunking stale with respect to changed chunk-size
configuration.

### Vector index width drift

A vector index fixes its vector width when it is created. Changing the embedding model, or
its configured width, makes the provider emit vectors of a different width, which an
existing index refuses. Nothing about the index looks wrong to the database — it stays
healthy and online — so the failure does not appear at startup. It appears as a storage
error on the first operation that touches the index.

Startup detects the condition rather than the symptom: with a provider configured, the
check walks every registered ontology, compares each semantic index's configured width
against the provider's, and reports every mismatch as a warning identifying the index by
what it covers — an entity type, a document property on an entity type, or saved-query descriptions
— never by a physical index name, and naming rebuild as the remedy.

Startup warns and does not repair; the reasoning is in
[../decisions.md](../decisions.md#behaviour). Rebuild does repair, in the three-phase
order above — drop, regenerate, build. A startup ensure that cannot succeed, which is what
an unfinished rebuild leaves behind, is reported against the ontology it belongs to and
does not stop the server from starting.

## Through the interfaces

The full contract is in [../interfaces.md](../interfaces.md). REST `GET /search`, MCP,
agent tools and saved-query search steps use one search entry and the same envelope.
MCP and agents expose `search` (both kinds) and `search_documents` (documents only, every
hit carrying a passage); neither tool takes a strategy. Both allow an omitted entity type.
MCP additionally accepts filters and fields. Agent limits are 10 by default for search,
5 for document search, and 20 maximum. A saved-query search step requires one type and
uses the default kinds and strategy; see [saved-queries.md](saved-queries.md).

Saved-query discovery is separate: it retains its absolute cosine score and minimum
score, description-only embedding, and embedding-provider requirement.

The palette and relation picker use ranked search whenever the strategy list is nonempty,
falling back to literal entity lists otherwise. They show labels, type chips and one badge
per document match, with no score or passage text. Extraction review searches properties
for up to three existing candidates with no score threshold or displayed number.
