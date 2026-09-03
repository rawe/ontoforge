# Documents

`document` is the data type for one large body of text on an entity — a biography, a
specification, a set of notes. It is a property like any other, but it is read, written,
searched and embedded differently from a `string`, and those differences are the whole
point of the type.

## What it does

A plain `string` property fails at length in three separate ways, and the `document` type
answers each:

- **It dilutes retrieval.** An entity's embedding is built from its string properties
  concatenated; one long value drowns out the rest, and a single vector over many pages
  retrieves badly. Document values are excluded from the entity embedding and embedded as
  passages instead.
- **It bloats every read.** Listing entities would carry full documents into every client
  and every model context. Reads return a size stub, never the content.
- **It cannot be edited in parts.** Changing one sentence would mean sending the whole text
  back. Two partial-write operations edit in place.

With an embedding provider configured, document values are additionally split into chunks
that carry their own vectors, so [search](search.md) can match a passage and resolve it
back to the owning entity. Without a provider, a document property is simply long text: it
stores, reads, slices and edits exactly the same, with no chunks and no vectors.

## Rules

**Entity types only.** Where the type may be declared, and where it is refused, is a
property-definition rule — [schema-modeling.md](schema-modeling.md#data-types). One
consequence beyond the schema: a saved query may not declare a `document` parameter either.

**Values are text.** Anything supplied is coerced to a string, exactly as for `string`. The
content is treated as Markdown by convention; nothing parses or validates it.

**No size limit.** When embeddings are enabled, `string` values are subject to the storage
adapter's limit on indexed property values. Document values are never carried into an index
as metadata, so the limit does not apply to them — which is the second reason to prefer the
type over a long `string`.

### The stub read model

Wherever an entity is returned — one instance, a list, a neighbour, a search hit, a query
result, over REST or over MCP — a document property is replaced by a stub:

```json
{ "document": true, "length": 40213 }
```

`length` is a character count, not bytes. It is recorded when the value is written; if that
bookkeeping is missing, the length is measured from the value on read, so the stub is
always correct.

A document property that has never been set is absent from the payload entirely. There is
no stub for an unset value, and no way to distinguish "unset" from "not selected" other
than by the projection that was asked for.

Full content reaches a caller in exactly two ways:

1. the document read operation below, which is the only way to get a *slice*;
2. naming the property in a `fields` projection
   ([instance-data.md](instance-data.md#field-projection)), which returns the whole text
   inline in place of the stub. Projection is applied after scoping, so a lens that hides
   the property still hides it.

One gap is worth knowing before it surprises you: in [OQL](oql.md), returned nodes and
scalar columns of the form `variable.property` are stubbed, but a scalar column given an
alias is not — it returns the raw text.

### Reading a slice

The read operation takes an entity type, an entity id and a property key, and returns the
value with character-based `offset` and `limit`. With neither, it returns the whole
document. The response reports the property key, the content, the offset it started at, the
length of the content actually returned, and the total length of the document — so a caller
can page a long document without a second call to discover its size, and so a search hit's
character coordinates can be fetched directly.

Slicing is forgiving: an offset past the end returns empty content rather than an error, and
a limit reaching past the end is truncated. An unset value reads as an empty document.

The operation is not found when the entity or the entity type does not exist, when the
property is not exposed by the lens, or when it exists but is not a `document` — a
non-document property is never readable this way.

### Partial writes

Two operations edit in place. Writing the whole value through an ordinary entity create or
update remains valid and does exactly what it says.

**Exact string replacement.** Give the string to remove and the string to put in its place.
It fails when the old string is empty, when the new string is missing or identical to the
old one, when the old string does not occur, and — this is the important one — when it
occurs **more than once**. Ambiguity is a failure, not a coin flip: the caller must extend
the string until it is unique, or opt in to replacing every occurrence at once.

**Range overwrite.** Give a character offset, a length and the replacement content. Length
zero inserts at the offset; an offset equal to the total length appends. It fails when
either number is negative, when the offset is past the end of the document, or when the
range extends past the end. An optional expected string may be supplied: the current
content of the range must equal it, or the write is refused as a conflict. That guard is
the only compare-and-swap anywhere in the runtime, and it exists because offsets go stale —
they are usually read from a search hit or an earlier slice, and the document may have
moved underneath them.

Both operations answer with the new total length, the offset and length of the region that
was written, how many replacements were made, and roughly 200 characters of surrounding
context together with the offset that context starts at — enough to verify the result
without re-reading the document. When every occurrence is replaced, the written region
describes the first one only.

Both persist the whole new value and then re-synchronize the property's chunks.

### Chunking

Chunks are produced only when an embedding provider is configured, synchronously with the
write that changed the value.

The text is walked from the start. For each chunk a target end is set at the configured
chunk size, and a boundary is searched **backwards** from there, taking the first that
matches:

1. a paragraph break;
2. a sentence ending — a full stop, question mark or exclamation mark followed by a space
   or newline;
3. any whitespace;
4. failing all of those, a hard cut at the target.

The cut is made *after* the matched separator, and the backwards search never passes the
midpoint of the chunk, so a document without boundaries still yields chunks of at least
half the target size. The next chunk begins the configured overlap distance before the
previous chunk's end — always advancing by at least one character — so consecutive chunks
share text and a passage split across a boundary is still matchable whole. Empty text
yields no chunks; text shorter than the target yields exactly one; the final chunk runs to
the end.

Chunk size and overlap are deployment configuration, global to the server, not per property.
Overlap must be smaller than the size.

Each chunk records its ordinal, its exact character offset and length in the source
document, its text and its vector. **Chunks are internal.** Nothing addresses them: there is
no chunk id, ordinal or listing anywhere in the API, they are absent from the schema, they
are rejected by the query validator, and they are not exported. The only trace they leave is
in a search hit, which reports the matched passage as a character offset and length — the
coordinates the document read operation takes. See [search.md](search.md).

### Embedding behaviour

**Documents are excluded from the entity's own embedding** — the composition rules for that
text, and why documents stay out of it, are in
[search.md](search.md#what-gets-embedded). The consequence here: adding, changing or
removing a document value never re-embeds the entity, only its chunks.

**Chunks are reused by content, and only at the configured model's width.** On every
re-write the property's existing chunks are read into a text-to-vector map, deleted, and the
new value re-chunked; a new chunk whose text is byte-identical to one of the old ones keeps
that vector, and only the rest are embedded afresh. A stored vector of any other width is
never reused — it came from a different embedding model, and no index of the current width
could be built over it. That check is also what makes a rebuild after a model switch
re-embed at all: the text is unchanged there, so reuse by content alone would keep every
stale vector and regenerate none. Because chunk boundaries are found by scanning local text, the chunker
re-synchronizes on the same paragraph and sentence breaks after an edit, so most chunks come
back unchanged at shifted offsets and a small edit costs a handful of embedding calls. The
worst case degrades to a full re-embed and no further.

Synchronization is per property: rewriting one document property never disturbs another
property's chunks on the same entity.

Chunks are removed with the thing they belong to:

| When | What happens |
|---|---|
| The document value is set to null or emptied | Its chunks are deleted and none replace them |
| The entity is deleted | All of its chunks go with it |
| The property definition is deleted | Every chunk of that entity type and property is dropped, with its vector index |
| The entity type is deleted | The same, for each of its document properties |

The embedding rebuild operation regenerates chunks along with entity embeddings, which is
how documents written while no provider was configured — or imported without their derived
data — acquire vectors. See [search.md](search.md).

### Searching document content

Literal text search on an entity list does **not** cover documents, so a term appearing in a
document but nowhere else returns nothing from it. Two things do reach the content: a
property filter naming the document property with the substring operator, and semantic
search, which matches passage by passage. Both are in [search.md](search.md).

## Through the interfaces

The full index of routes and tools is [interfaces.md](../interfaces.md).

| Operation | REST | Runtime MCP |
|---|---|---|
| Read or slice a document | one read on the document route | `get_document` |
| Exact string replacement | the document write, selecting that operation | `edit_document` |
| Range overwrite | the document write, selecting the other operation | `write_document` |

REST exposes one write operation with the mode named in the body; MCP splits it into two
tools, so a model chooses by tool rather than by argument. Both reach the same service and
obey the identical rules.

An agent reads documents too, and only reads them: `get_document` is grantable to one,
alongside a passage search that MCP spells as an argument on semantic search. The rules
are in [ai-agents.md](ai-agents.md). Declaring the property at all is
[schema modeling](schema-modeling.md), over its own routes and tools.

In the web UI, document properties appear as a compact size badge in tables and as a
collapsed section on an entity's detail view; expanding fetches the content and renders the
Markdown, and editing opens a plain text editor with a preview and saves the whole value
through the ordinary entity update — the partial-write operations exist for programmatic
callers, not for the UI. See [product-surface.md](../product-surface.md).
