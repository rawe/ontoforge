# Schema transfer

Export produces one JSON document describing the whole design of one ontology. Import
recreates that design in another ontology — on the same server or elsewhere. It is how a
design moves between a laptop, a staging deployment and production, and how an ontology
is cloned.

## What the format carries

One payload, covering one ontology's entire design. There is no partial export: no
per-lens export, no per-type export, no filter — and no wider one: nothing spans
ontologies, transfer included.

| Carried | Detail |
|---|---|
| Entity types | Key, display name, description, the key of its name property, and every property definition |
| Relation types | The same, plus the keys of the source and target entity types |
| Property definitions | Key, display name, description, data type, required flag, default |
| Lenses | Key, name, description, their type inclusions — absent entirely for an unscoped lens — and the keys of the search indices they include |
| Agents | Every agent of every lens: key, name, description, system prompt, tool allowlist |
| Saved queries | Every saved query of every lens: key, name, description, steps, parameters |
| Retrievers | Every retriever of every lens: key, name, description, configVersion, config |
| Keyword language set | The languages keyword search stems in, at the top level of the payload |
| Search indices | The custom index definitions and the managed indices switched off, at the top level of the payload |

Agents, saved queries and retrievers are nested inside the lens they belong to, because that is where
they belong ([ai-agents.md](ai-agents.md), [saved-queries.md](saved-queries.md), [retrievers.md](retrievers.md)).

> **Instance data is not part of the format.** No entities, no relations, no document
> content, no chunks, no embedding vectors. Exporting a design and importing it elsewhere
> produces an empty graph with the right shape. There is no instance-data export anywhere
> in the system, so this format is not a backup and must not be used as one — a database
> backup is.

> **The ontology's identity is not part of the format either.** No ontology key and no
> display name appear in the document. An ontology's key is addressing, chosen by
> whoever creates the target — never content. "Identifiers regenerated, keys preserved"
> extends one level up: the document is portable into any ontology under any key.

Server-managed timestamps are not carried either. Imported objects are new objects and are
timestamped as such.

The payload carries the ontology's
[keyword language set](search.md#keyword-language) as `keywordLanguages`. Import replaces
the target's set with it once the design is written; the set is the one part of the
target an import overwrites rather than adds to. An adapter without search indices has no
set: its export writes the set a new ontology starts with, German and English, and its
import validates the field and keeps nothing of it.

The payload carries the ontology's [search indices](search-indices.md) as
`searchIndices`: `custom`, every custom definition in the index wire format, in key
order, and `disabled`, the keys of the managed indices switched off. Managed definitions
are not carried — the imported schema derives them. The field is optional: without it a
payload has no custom index and every managed index on. Import adds the payload's
custom indices and switched-off keys to the target's, and every index's entries are then
built in the background ([below](#side-effects-of-import)). An adapter
without search indices exports both lists empty, and its import validates the field and
keeps nothing of it.

Each lens carries `indexInclusions`, the keys of the search indices it includes — managed
and custom alike — in key order
([ontology-lenses.md](ontology-lenses.md#search-through-a-lens)). Import writes each list
as it comes once every index exists, in place of the managed indices the import would
include in that lens on its own; a scoped lens without the field includes the managed
indices of the types it exposes. An adapter without search indices exports every list
empty, and its import validates them and keeps nothing of them.

## The format version

The payload declares a format version, and export always writes the current one: `6.0`.
The version is the format's own line, bumped only when the payload shape changes
incompatibly.

**Import dispatches on it.** It accepts two versions and refuses every other one with a
field error on the version:

| Version | Import |
|---|---|
| `6.0`, or no version at all | The current format, validated as described below |
| `5.0` | The previous format, converted on the way in |

A `5.0` payload differs from `6.0` in three ways. It carries no search indices — a
`searchIndices` field in it is ignored, and so is a lens's `indexInclusions`: each scoped
lens includes the managed indices of the types it exposes. It carries one
`textSearchLanguage`, `english` or `german`, in place of `keywordLanguages`; import takes
that language alone as the set. And its entity types carry no name property
([schema-modeling.md](schema-modeling.md#the-name-property)); import derives one per
entity type: the first `string` property among `name`, `title`, `label` and
`display_name`, in that order; otherwise the type's first `string` property in payload
order. A type without any `string` property is given a new non-required `string`
property `name` — `name_2`, `name_3`, … when `name` is taken — and that becomes its name
property. The same derivation brings storage written before name properties existed up to
date ([../storage-adapters.md](../storage-adapters.md)).

Each version requires its own language field — `keywordLanguages` in `6.0`,
`textSearchLanguage` in `5.0` — and both require the lenses field.

## Rules

### The target is an existing ontology, named by the request

Import writes into the ontology the request addresses. The target may be bare or
populated, but it must exist: **import never creates its target.** Creating an ontology
is a registry operation — over REST or the web UI, or, for an MCP client that owns its
mount, `ensure_ontology` followed by `import_schema`
([../interfaces.md](../interfaces.md)).

**Cloning** is therefore a composition, not a feature: export ontology A, create
ontology B, import into B — the same design over an empty graph. There is no first-class
clone or template operation.

### Conflicts: all-or-fail on an existing key

Import refuses to touch anything that already exists in the target. If any entity type
key, relation type key, lens key or custom search index key in the payload is already
present in the target ontology — or appears twice among the payload's custom indices —
the import fails with a conflict naming every such key. Only the target's own
key space is consulted — the same keys in other ontologies are invisible and irrelevant.
There is no merge, no skip-existing and no per-object choice.

Two consequences:

- **A payload must be self-contained.** A relation type's endpoint entity types must be
  present in the same payload; referring to an entity type that exists only in the target
  is rejected. In practice this is not a restriction, because such a type would have
  triggered a conflict anyway.
- **Import validates before it writes.** The entire payload is checked first — every key
  conflict and rule violation is reported together, and a rejected payload writes
  nothing. Only a clean payload starts writing. The residual risk is a crash mid-write,
  which can leave a partial schema; a retry after cleanup then behaves like a fresh
  import.

### Replacing an existing design

There is no overwrite, replace or merge mode. Replacing a design means deleting the
clashing objects first, subject to the cascade protocol in
[schema-modeling.md](schema-modeling.md), and importing into the space that leaves —
or deleting and recreating the whole ontology and importing into it bare.

### Identifiers are regenerated, keys are preserved

Every imported object — type, property, lens, agent, saved query, retriever, search
index — receives a freshly generated internal identifier. Nothing in the payload carries
one, and nothing from the source ontology's identifiers survives.

Keys, by contrast, are preserved verbatim. That is what makes the format portable: after
an import, the same key names the same thing in both ontologies, while the identifiers
behind them differ.

For a caller this means: **an identifier obtained from the source ontology is meaningless
against the target.** Any script, saved artifact or external reference that pins a type by
identifier breaks across a transfer; one that pins it by key does not. This is the same
reason keys are the only currency of the public surface — see
[../decisions.md](../decisions.md).

Instance identifiers are unaffected, since there are no instances in the payload.

### What import validates

Import is a write path, and the write-path rules apply to it:

- **Reserved keys are rejected.** A type key that would collide with the active storage
  adapter's own objects is refused, with an error naming the reserved set and not the
  vendor. The reserved set is the adapter's to declare; see
  [../storage-adapters.md](../storage-adapters.md).
- In a `6.0` payload every entity type names its name property, and it must be one of
  that type's own `string` properties; a missing or unsuitable one is rejected, naming
  the type.
- `document` properties are permitted on entity types only. One on a relation type is
  rejected, naming the property and its type.
- Every custom search index is validated against the payload's own schema, exactly as at
  definition time ([search-indices.md](search-indices.md#validation-and-limits)), and
  every switched-off key must name a managed index that schema derives. An invalid one
  fails the import, naming the index and the offending path.
- Every key in a lens's `indexInclusions` must name a custom index of the payload or a
  managed index its schema derives, once per lens; an unknown or repeated key fails the
  import, naming the lens and the index. Whether the lens includes the index's root type
  is not checked: like type inclusions, index inclusions are written as they come, and
  lens validation warns about an index the lens cannot search
  ([ontology-lenses.md](ontology-lenses.md#validation-warnings)).
- Every agent's tool allowlist is checked against the read-only agent tool set, exactly as
  at definition time. An unknown tool name fails the import.
- Every saved query's steps are checked structurally, exactly as at definition time:
  known step types, unique step names, required fields per type, well-formed bindings
  referring only to earlier steps, and the parameter cross-checks in both directions.
  Saved-query parameters may not have the `document` data type.

One difference from definition time is worth knowing: an imported saved query's OQL text
is **not** parsed and checked against the lens. A pipeline that is structurally sound but
names a type the lens does not expose imports successfully and fails when it is first run.

Retriever configurations are checked against the visible schema of their payload lens
before any writes. Unsupported config versions, duplicate retriever keys and invalid
references reject the import. Omitting `retrievers` remains valid. Export preserves raw
stored configurations even if invalid; reimport rejects them until repaired. The outer
format version does not validate `configVersion`; these are separate contracts. Older
readers that ignore unknown fields do not preserve retriever definitions.

### Side effects of import

Import is not purely additive to the target's schema — it also provisions search
artefacts and computes embeddings, all within the target ontology.

- **Index creation.** If an embedding provider is configured, the target ontology's
  index for saved-query descriptions is ensured once at the end. Without one it stays
  missing until the server starts with a provider configured, or the rebuild operation
  described in [search.md](search.md#rebuild) runs against one.
- **Search indices.** The managed search indices of the imported schema come into
  existence and are included in every scoped lens that exposes their root types — the
  imported ones among them ([search-indices.md](search-indices.md#managed-indices)) —
  and the payload's custom indices are created. An imported lens that carries
  `indexInclusions` then includes exactly those indices. Import provisions no entries: each
  index gets its generations, which the worker builds in the background
  ([search-indices.md](search-indices.md#lifecycle)); with no instance data imported,
  there is nothing to build until data is written.
- **Embedding.** Each imported saved query's description is embedded as it is written, so
  the queries are semantically discoverable immediately. Nothing else is embedded — there
  is no instance data to embed.
- **Cache invalidation.** Import clears the schema cache, as any modeling change does.

Retriever definitions do not trigger embeddings on import. Import answers with the lenses it created.

## Through the interfaces

Both operations are modeling operations on one ontology, so both live under the
ontology's modeling surface and neither takes a lens. Complete operation index:
[../interfaces.md](../interfaces.md).

| | Export | Import |
|---|---|---|
| REST | One operation returning the payload | One operation writing into the addressed ontology |
| MCP | `export_schema` | `import_schema` — the bound ontology is the target |
| Web UI | The studio's transfer surface downloads the payload as a file | The same surface uploads one into the current ontology, and reports a key conflict as such |

The modeling MCP server's schema-introspection tool returns this same payload, so a model
can read the entire design in one call.
