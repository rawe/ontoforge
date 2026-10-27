# One search entry per relation instance

Status: Accepted

Current behavior: [Search index entries](../capabilities/search-indices.md#entries)

## Context

A search index may enrich what an entity is found by with its relations and the entities
at their other end, for example a person found by their role at a company and that
company's industry. Hits stay entities either way. The question is how relation
instances become indexed content: together in one text per entity, or apart.

## Decision

Compose one relation search entry per relation instance of each configured group,
keeping that relation's properties paired with the entity at its other end. Do not
combine different relations or every combination of relations into a single entry.

## Consequences

Each employment, for example, keeps its role paired with the correct company, remains
searchable beyond any arbitrary relation cap, and can be named as match evidence. A
relation change does not require re-embedding one whole combined text. The trade-off is
potentially multiple embeddings per entity when semantic search is enabled, and no single entry answering facts spread over two
relations; exact filters or entity-level ranking fusion address those questions.

## Rejected

- **One text per entity, with a capped block per relation group.** One keyword
  representation is a bag of words, so a role from one relation matches a company from
  another. One vector blurs which role goes with which company. Relations beyond the cap
  become unsearchable, one changed relation re-embeds the whole text, and a hit cannot
  say which relation matched. Its one advantage was answering facts spread over two
  relations, at one embedding per entity.
- **One entry per combination of relation instances.** Combinations multiply with every
  instance, nobody can say which make sense, and one change re-embeds every combination
  containing it.
