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
| Entity types | Key, display name, description, and every property definition |
| Relation types | The same, plus the keys of the source and target entity types |
| Property definitions | Key, display name, description, data type, required flag, default |
| Lenses | Key, name, description, and their inclusions — absent entirely for an unscoped lens |
| Agents | Every agent of every lens: key, name, description, system prompt, tool allowlist |
| Saved queries | Every saved query of every lens: key, name, description, steps, parameters |

Agents and saved queries are nested inside the lens they belong to, because that is where
they belong ([ai-agents.md](ai-agents.md), [saved-queries.md](saved-queries.md)).

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

## The format version

The payload declares a format version, and export always writes the current one: `4.0`.

**It is informational.** Import reads no meaning from it: the version is never dispatched
on, and a payload with an unknown version or no version at all is processed identically.
There is no negotiation, no compatibility check, and **no conversion of older payloads**
— an old document fails on its shape, not on its version. Concretely, a pre-4.0 document
carries its lenses under a field name the current shape does not accept, and is rejected
as a plain validation error like any other malformed payload. That rejection is intended
and final; no converter exists. A reimplementer should treat the version as a label for
humans, bumped only when the payload shape changes incompatibly — never as a dispatch
key.

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
key, relation type key or lens key in the payload is already present in the target
ontology, the import fails with a conflict naming every such key. Only the target's own
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

Every imported object — type, property, lens, agent, saved query — receives a freshly
generated internal identifier. Nothing in the payload carries one, and nothing from the
source ontology's identifiers survives.

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
- `document` properties are permitted on entity types only. One on a relation type is
  rejected, naming the property and its type.
- Every agent's tool allowlist is checked against the read-only agent tool set, exactly as
  at definition time. An unknown tool name fails the import.
- Every saved query's steps are checked structurally, exactly as at definition time:
  known step types, unique step names, required fields per type, well-formed bindings
  referring only to earlier steps, and the parameter cross-checks in both directions.
  Saved-query parameters may not have the `document` data type.

One difference from definition time is worth knowing: an imported saved query's OQL text
is **not** parsed and checked against the lens. A pipeline that is structurally sound but
names a type the lens does not expose imports successfully and fails when it is first run.

### Side effects of import

Import is not purely additive to the target's schema — it also provisions search
artefacts and computes embeddings, all within the target ontology.

- **Index creation.** For each imported entity type, if an embedding provider is
  configured, a vector index is created for the type, with its non-document properties
  registered as in-index filter properties, plus one index per document property. The
  target ontology's index for saved-query descriptions is ensured once at the end.
  Without an embedding provider none of this happens, and semantic search over the
  imported schema stays unavailable until the rebuild operation described in
  [search.md](search.md) is run against a configured provider.
- **Embedding.** Each imported saved query's description is embedded as it is written, so
  the queries are semantically discoverable immediately. Nothing else is embedded — there
  is no instance data to embed.
- **Cache invalidation.** Import clears the schema cache, as any modeling change does.

Import answers with the lenses it created.

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
