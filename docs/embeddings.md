# Embedding lifecycle

How OntoForge creates embeddings, detects when they go stale, and brings them back into sync. One place to look for "how does semantic search stay correct when the data changes?".

## What carries an embedding

Three kinds of records:

1. **Entities** — one `_embedding` per entity node. Composed at write time from the concatenation of the entity's string properties in schema-declared order, prefixed with the entity type key.
2. **Semantic relations** — relation types with a non-null `factTemplate` render a deterministic `_fact` sentence per instance; the embedding is computed over `_fact`. Relation types without a `factTemplate` are structural-only and carry no embedding.
3. **Saved queries** — one `_embedding` per saved query, derived from its description.

## Write-time path (synchronous, best-effort)

On entity create / update (when a string property actually changes) or semantic-relation create / update, the server renders the text input and calls the embedding provider inline. The outcome is recorded on the node or edge via two system properties:

| Property | Values | Meaning |
|---|---|---|
| `_embeddingState` | `"ok"` · `"stale"` · `"failed"` · `"pending"` | Lifecycle state |
| `_embeddingVersion` | int | Monotonic bump on every rewrite |

Semantic relations additionally carry `_factVersion` that tracks how many times `_fact` has been re-rendered.

Provider failures do not block writes. A relation or entity that fails to embed is persisted with `_embeddingState = "failed"` and no vector — it is retrievable by id and filters, but invisible to vector search until the background worker reconciles it. `"pending"` is reserved for future asynchronous write flows; the current path never emits it.

## Staleness triggers

The server flips embeddings from `"ok"` to `"stale"` automatically on two events:

1. **Entity property change.** Any entity update that mutates user properties marks every adjacent semantic relation (source- or target-facing, all types) as stale. The rule is intentionally over-inclusive — relations whose templates don't actually reference the changed property get reconciled anyway. A narrower template-to-property dependency index is a potential later optimisation; the current pass is the honest baseline.
2. **`factTemplate` change on a relation type.** Setting, changing, or clearing a template marks every existing instance of that type as stale. A cleared template is handled specially by the worker — see below.

Entity-side staleness — opt-in re-embed when an `embeddable` flag flips on a property — is not yet shipped. Today every entity property composes into its embedding; schema-driven entity re-embed goes through the manual `rebuild-embeddings` endpoint.

## Two recovery mechanisms

### Background reconcile worker — automatic, continuous

A single asyncio task, started from the backend lifespan when `EMBEDDING_PROVIDER` is configured and cancelled on shutdown. Every `RECONCILE_INTERVAL_SECONDS` it queries up to `RECONCILE_BATCH_SIZE` semantic relations whose state is `"stale"` or `"failed"` and reconciles each: re-render `_fact` against current source + target data, re-embed, bump versions, set state back to `"ok"`.

Cleared-template edge case: if the relation type's `factTemplate` is now `null`, the worker zeroes `_fact` / `_embedding` / `_factVersion` and sets state `"ok"`. The relation is no longer semantic and drops out of future passes.

Failures inside the worker do not bubble out — the loop absorbs exceptions and keeps running. Per-item `"failed"` items are held off by in-memory exponential backoff (base 30 s, cap 1 h, 10 attempts), then parked until process restart. Backoff state is not persisted — a restart retries every `"failed"` item once, which is the right behaviour after an outage.

Implementation: `backend/src/ontoforge_server/runtime/reconcile.py`.

**Current scope: semantic relations only.** Entity embeddings are not touched by the worker; they are re-created only on the entity's own write path or via the rebuild endpoint below.

### `POST /api/model/rebuild-embeddings` — manual, destructive to indexes

The big hammer. Drops every vector index, recreates them at the provider's current dimension, then re-embeds every entity, every semantic relation, and every saved query from scratch. NDJSON progress stream. Reach for it when:

- **Changing the embedding model or its dimensions.** Vector indexes are pinned to a dimension at creation; the worker never drops indexes, so a dimension mismatch (e.g. `nomic-embed-text` 768 → `mxbai-embed-large` 1024) requires the full rebuild.
- **After a bulk import** where you'd rather not wait for the worker to drain item-by-item.
- **When entity-side composition semantics change** (today rare; becomes the normal path once entity-side `embeddable` flags land).

Full contract: [`api-contracts/modeling-api.md`](api-contracts/modeling-api.md) → `POST /api/model/rebuild-embeddings`.

## When to reach for which

| Situation | Path |
|---|---|
| Entity property edited, semantic relations touching it need new `_fact` | Worker (automatic). |
| `factTemplate` set or changed | Worker (automatic). |
| Embedding provider was down, a few relations are `"failed"` | Worker (automatic, with backoff). |
| Switched embedding model or changed `EMBEDDING_DIMENSIONS` | `rebuild-embeddings` (manual). |
| Bulk-imported thousands of entities and want a known-clean state | `rebuild-embeddings` (manual). |
| Want to forcibly re-run the full pipeline for audit / demo | `rebuild-embeddings` (manual). |

## Operator knobs

| Variable | Default | Notes |
|---|---|---|
| `EMBEDDING_PROVIDER` | *(unset — disabled)* | No provider → no embeddings, no worker. See README env table for the full set. |
| `RECONCILE_INTERVAL_SECONDS` | `30` | Worker tick interval. Shorter = faster propagation, more DB polling. |
| `RECONCILE_BATCH_SIZE` | `50` | Per-tick drain cap. Controls worst-case embedding-provider QPS. |

## See also

- [`api-contracts/runtime-api.md`](api-contracts/runtime-api.md) — entity-update side effect, semantic search endpoints
- [`api-contracts/modeling-api.md`](api-contracts/modeling-api.md) — `factTemplate` side effect, `rebuild-embeddings`
