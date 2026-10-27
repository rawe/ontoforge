# One search entry per relation instance

Current behavior: [Search index entries](../capabilities/search-indices.md#entries)

## Context

A search index may enrich what an entity is found by with its relations and the entities
at their other end, for example a person found by their role at a company and that
company's industry. Hits stay entities either way. The question is how relation
instances become indexed content: together in one text per entity, or apart.

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
