# Search

Finding things. Two mechanisms answer two different questions: literal text matching,
which is always available, and semantic retrieval, which needs an embedding provider.

## What it does

|  | Literal matching | Semantic retrieval |
|---|---|---|
| Answers | "which records contain this text" | "which records mean this" |
| Lives on | list operations | one dedicated search operation |
| Available | always | only with an embedding provider |
| Ordering | the requested sort field | by vector similarity |
| Reaches document content | no | yes, passage by passage |
| Spans types | one type per request | one type or all in-scope types |

They are not layered. Literal matching is not a fallback the server substitutes when
semantics are unavailable, and semantic retrieval never consults the literal matcher. A
client picks per request. Both obey the lens: nothing out of scope is searched, and
nothing out of scope is returned.

## Literal matching

The entity list operation accepts a free-text term. It is matched case-insensitively as a
substring against every `string` property the lens exposes on that type; matching one
property is enough. This is substring containment, not tokenized full-text search — no
stemming, no word boundaries, no relevance ranking. Results come back in the sort order
the request asked for. `document` properties are never searched this way; their content is
reachable only through semantic retrieval and through document reads
([documents.md](documents.md)).

Property filters are the exact half of the same surface, available on both entity and
relation lists; the operators they offer are listed in
[../interfaces.md](../interfaces.md#listing-sorting-filtering). Every filter names a
property that must exist in the scoped property set of the type being listed, and its value
must coerce to that property's data type; either failure is a validation error naming the
property. Relation lists take property filters and endpoint constraints but no free-text
term.

## Semantic retrieval

### Without a provider

The search operation is rejected as a validation error carrying the disabled-feature
refinement described in [../architecture.md](../architecture.md#error-model). A global
feature-discovery operation reports availability so clients can hide the surface instead
of failing.

The consequence that is easy to miss: with no provider, **no vectors are written either**.
Entities and documents created while the provider is absent, or while it is failing, carry
no vector. Configuring a provider afterwards does not retroactively embed them — they stay
invisible to semantic retrieval until an explicit rebuild.

### The three scopes

A request selects what is ranked. The default is both.

| Scope | Ranks | A hit is |
|---|---|---|
| Entities | one vector per entity, built from its string properties | the entity as a whole |
| Documents | passage vectors over document properties | the parent entity of the best-matching passage |
| Both | both rankings, fused | either, with fused ordering |

Document ranking runs over every (entity type, document property) pair the lens exposes
and no others: a lens that hides a document property never touches its passages. Passage
hits are deduplicated to their parent entities — the highest-scoring passage per entity
wins and supplies that hit's match information; other passages of the same entity are
discarded.

### Fusion, and what a fused score is not

Searching both scopes fuses them by reciprocal rank fusion: each entity scores the sum of
`1 / (60 + rank)` over the rankings it appears in, and results are ordered by that sum. An
entity found in both rankings therefore outranks one found in either alone, regardless of
raw similarity.

**A fused score is not a similarity and must never be shown as one.** It is a
rank-derived ordering number: it has no relation to 1.0, no meaning in isolation, and no
comparability across responses. It must not be rendered as a similarity, a confidence or a
percentage, and it must not be compared against a similarity threshold. Every hit carries
its raw similarity separately; that is the number to display and to threshold.

When exactly one scope was searched, the hit's score *is* the raw cosine similarity, and
the match information repeats it. Only the fused case differs — so a client that displays
a score must know which scope produced it.

### What a hit reports

Every hit carries the entity, a score, and a `matchedVia` object saying what actually
matched.

| Field | Present on | Meaning |
|---|---|---|
| `source` | every hit | `entity` or `document` |
| `similarity` | every hit | raw cosine similarity of the matched vector — the comparable number |
| `propertyKey` | document hits | which document property matched |
| `charOffset` | document hits | where the matching passage starts in the full property value |
| `charLength` | document hits | how long it is |
| `snippet` | document hits, unless suppressed | the passage's leading ~200 characters |

The offsets are character coordinates into the complete property value, and they are
directly usable as the offset and length of a document read — so a client can fetch
exactly the passage that matched without downloading the document
([documents.md](documents.md)). Suppressing snippets removes only the text; the
coordinates remain.

When an entity appears in both rankings, the document match information wins regardless of
which similarity is higher, because it carries the retrieval coordinates and those are the
more actionable information. That hit's entity-side similarity is not surfaced at all.

### Minimum score

An optional floor between 0 and 1 is applied to the **raw similarity within each ranking,
before fusion** — never to the fused score. Raising it therefore changes which entities
enter the fusion, and so reorders fused results, but it never filters on the number a
fused response reports.

### One type or all types

Naming an entity type restricts the search to it; a type the lens does not expose is not
found. Omitting the type searches every entity type in scope at once, and then the only
thing identifying what a hit is, is the entity type key carried as a system property on
the returned entity. Field projection consequently always retains that system property in
cross-type mode, on top of the identifier it always retains.

A scoped lens searching all types over-fetches from the shared cross-type index and
discards hits whose type is out of scope. The candidate pool is capped, so a narrow lens
over a large graph can return fewer hits than requested even when more matching entities
exist. This is a known limit of cross-type search, not an error condition.

### Property filters on search

- **Filters require a type.** Cross-type search rejects them, because property definitions
  are per entity type and a filter key means nothing without one.
- **Substring containment is rejected.** Equality and the ordered
  comparisons are supported; for substring filtering, use the entity list operation.
- Everything else matches the list operation's filter syntax, including validation against
  the scoped property set and coercion to the declared data type.
- Document hits are filtered after their parent entities have been resolved, against the
  same filter set and the same operators, so both scopes honour the same constraints.

Result entities are filtered to the lens's properties and document properties appear as
stubs, exactly as on any other read. Stored vectors never appear in a response.

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

## Keeping embeddings current

Recomputed automatically, when a provider is configured:

- on entity creation, always;
- on entity update, whenever the update touches any `string` property — the vector is
  recomputed from the merged post-update state, not from the submitted fragment;
- for document properties, per changed property: its passages are discarded, the value is
  re-chunked, and the new passages are embedded. Passages whose text is unchanged reuse
  their existing vector, so editing part of a large document re-embeds only the passages
  the edit touched ([documents.md](documents.md)).

Not recomputed, and both are traps:

- **A schema change does not re-embed anything.** Adding a string property to an entity
  type leaves every existing entity's vector reflecting the schema as of its last write.
  The property contributes to retrieval only for entities written afterwards.
- **A failed embedding does not fail the write.** The entity or passage is stored without
  a vector and is simply absent from semantic results. The failure is logged, not returned.

Both are repaired by the same operation.

### Rebuild

One global modeling operation — it covers the whole schema and all data, not one lens. It
is rejected if no embedding provider is configured. It:

1. ensures every semantic index exists, recreating any whose vector width no longer
   matches the provider's;
2. recomposes the text of every entity of every entity type and rewrites its vector;
3. discards, re-chunks and re-embeds every document property value;
4. re-embeds every saved-query description ([saved-queries.md](saved-queries.md)).

It streams progress while running, as newline-delimited JSON: a progress record per
processed item carrying the entity type key it belongs to, the count so far and that
group's total, then a final summary with per-type processed and failed counts and the
overall totals. An item whose embedding call fails is counted as failed and keeps whatever
vector it already had.

So rebuild repairs: missing indexes, drifted index widths, entities and passages that were
never embedded, vectors stale with respect to a schema change, and chunking stale with
respect to changed chunk-size configuration.

### Vector index width drift

A vector index fixes its vector width when it is created. Changing the embedding model, or
its configured width, makes the provider emit vectors of a different width, which an
existing index refuses. Nothing about the index looks wrong to the database — it stays
healthy and online — so the failure does not appear at startup. It appears as a storage
error on the first operation that touches the index.

Startup detects the condition rather than the symptom: with a provider configured, each
semantic index's configured width is compared against the provider's, and every mismatch
is reported as a warning identifying the index by what it covers — an entity type, a
document property on an entity type, cross-type entity search, or saved-query descriptions
— never by a physical index name, and naming rebuild as the remedy.

Startup warns and does not repair; the reasoning is in
[../decisions.md](../decisions.md#behaviour). Rebuild does repair, dropping and recreating
each mismatched index at the provider's width immediately before regenerating the vectors
that fill it.

## Through the interfaces

Complete operation and tool index: [../interfaces.md](../interfaces.md).

| Capability | REST | MCP | Web client |
|---|---|---|---|
| Literal matching | query parameters on the runtime list operations | the runtime list tools | list and table views |
| Semantic retrieval | one runtime search operation | `semantic_search` on the runtime server | command palette, relation target picker, extraction dedupe |
| Availability | a global feature-discovery operation | — | drives what the client shows |
| Rebuild | one modeling operation, streaming | — | alongside schema transfer |

One difference worth knowing: the MCP tool exposes scope, snippets, filters and field
projection, but **no minimum score** — it always searches without a floor. A model that
needs a similarity threshold has to apply it to the reported raw similarity itself.

In the web client, the command palette uses semantic retrieval where available and falls
back to per-type substring listing otherwise; entity deduplication during extraction
review deliberately searches the entity scope only, so that a similarity threshold remains
meaningful. See [../product-surface.md](../product-surface.md).
