# FT03 — Embedding Lifecycle Management

> **Type: Feature concept** · **Effort: Medium** · **Priority: Medium — consolidates four open ideas into one coherent capability**
> Consolidates the open items of `docs/feature-ideas/semantic-search-extensions.md`
> (embeddable flag, re-embed on schema change, MCP min score) with the already-shipped
> `POST /api/model/rebuild-embeddings` endpoint.

## Problem

Semantic search shipped feature-by-feature and its *write path* is now ahead of its *maintenance
path*. Embeddings are built once at entity write time from all string properties. Three staleness
sources have no managed answer:

1. **Schema changes** (property added/removed/renamed) silently invalidate existing embeddings.
2. **Provider/model changes** invalidate *all* embeddings (different vector space).
3. **Noise properties** (URLs, codes, serialized JSON) pollute embeddings with no opt-out.

There is already a rebuild endpoint, but the ideas folder still proposes a second one at a
different path (`/api/runtime/{key}/admin/re-embed`) — a sign this area needs one consolidated
design instead of three drafts.

## Concept

One capability, three parts, built on the existing rebuild endpoint:

1. **`embeddable` flag on PropertyDefinition** (default `true`, string properties only).
   `build_text_repr` honors it. Schema change → affected types are marked "embeddings stale".
2. **Staleness tracking + manual rebuild** (KISS: no background jobs). Store the embedding
   config fingerprint (provider, model, dimensions, schema-text-repr hash per type) alongside the
   index metadata. `GET /api/runtime/features` (or a small status endpoint) reports which types
   are stale; the existing `rebuild-embeddings` endpoint gains `entity_type_key` and batching
   parameters and becomes the single rebuild path. UI: a "re-embed" action with staleness badge
   on the schema page. Drop the duplicate `admin/re-embed` idea.
3. **MCP quality floor**: `EMBEDDING_MIN_SCORE` env var applied as default `min_score` in the MCP
   `semantic_search` tool (REST keeps its explicit parameter). One config value, big effect on
   agent result quality.

## Why this direction

The project's core promise is *trustworthy* structured knowledge. Semantic search that silently
serves stale or noisy vectors undermines exactly that trust for the AI-agent audience OntoForge
is targeting. Lifecycle management is what turns "vector search demo" into "dependable feature".

## Dependencies

- Independent of FT01/FT02. The `embeddable` schema flag is a PropertyDefinition extension →
  export format bump; coordinate with FT05/FT06 so the format moves once, not three times.
- Doc side lands in the (post-F09) `docs/features/` semantic-search doc.

## Open questions for the user

- Staleness handling: manual rebuild with visible badge (recommended, KISS) vs. automatic
  background re-embed?
- Is `EMBEDDING_MIN_SCORE` server-global enough, or per-ontology (agent configs could carry it)?
  Recommended: server-global first.
