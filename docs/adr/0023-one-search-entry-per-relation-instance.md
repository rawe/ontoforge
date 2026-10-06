# 0023. One search entry per relation instance

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

A search index may enrich what an entity is found by with its relations and the entities
at their other end — a person found by their role at a company and the company's
industry. Hits stay entities either way. The question was how relation instances become
indexed content: together in one text per entity, or apart.

## Alternatives considered

- **One text per entity, a grouped block per relation, capped** — one entry, one vector
  and one keyword representation per entity, relation blocks in a fixed order up to a
  per-group cap and a character budget. Rejected: one keyword representation is a bag of
  words, so a role from one relation matches a company from another; one vector blurs
  which role goes with which company; relations beyond the cap become unsearchable and a
  high-degree entity's vector is diluted; one changed relation re-embeds the whole text;
  and a hit cannot say which relation matched. It did answer facts spread over two
  relations in one text, and cost one embedding per entity.
- **Combinations of relations in one entry** — one entry per combination of instances
  across relation types. Rejected: combinations multiply with every instance, nobody can
  say which of them make sense, and one change re-embeds every combination containing it.
- **One entry per relation instance, owned by the entity** — chosen. Each entry holds one
  relation's properties and its target's, after a short header of the entity's own
  fields, so a combination of own fields with one relation still matches. The best entry
  decides the entity's score, the shape document passages already had. Every instance is
  searchable with no cap, a relation change re-embeds one small entry, a hit can name the
  relation that matched, a search can choose which relations count, and a lens hiding a
  relation type or target type skips those entries at query time with no rebuild. Facts
  spread over two relations are not answered by one entry; an exact filter or fusion at
  entity level answers them. That limitation, and a backfill of one embedding per
  relation instance, were accepted.

## Outcome

The relation-entry rule in [decisions.md](../decisions.md#behaviour).
