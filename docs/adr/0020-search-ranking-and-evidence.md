# Search ranking without an index bonus, and no score in results

Current behavior: [Ranking](../capabilities/search.md#ranking),
[similarity floor](../capabilities/search.md#similarity-floor),
[entity search](../capabilities/search.md#entity-search)

## Context

Search ranks entities across several indices (own fields, passages, relation entries,
several types) and up to two retrieval methods. An entity's type decides which indices
can hold it, so any combination that adds contributions favours types that have more of
them, for example a document property. A score shown to a caller reads as relevance or
confidence, which no ranking score is.

## Decision

Within one retrieval method an entity ranks by its best entry, with no bonus for
occurring in several indices; the methods are fused by reciprocal rank. Ties are never
broken by an invented measurement. A result carries its rank and the entry that matched,
never a score.

## Rejected

- **Summing an entity's contributions across indices.** Entities whose schema allows more
  indices win structurally. In evaluation it placed the expected entity first far less
  often.
- **Dividing the summed score by schema eligibility.** It needs a policy for absent
  contributions, and a document leader outside a limited property ranking can lose to a
  much weaker property-only candidate.
- **Fusing per-index rankings by best reciprocal rank.** Within one method the indices'
  scores already share one scale, so rank fusion throws away comparable information and
  treats every index's first hit as equal.
- **Encounter order alone for equal scores.** It left relevant document leaders behind
  property leaders at equal rank.
- **Treating an unmeasured similarity as zero in ties, or comparing tied entities
  pairwise.** The first invents a negative preference. The second can order a group
  inconsistently.
- **A score or a normalized relative score in results.** A top score of 1.0 reads as a
  perfect answer, and even an unrelated query has a best result.
- **One minimum similarity for every caller.** Useful paraphrases have no lexical match,
  related passages can score high without answering, and the floors that were tested
  removed useful candidates. A similarity floor is model-specific.
- **Labelled text for keyword matching, or stripping labels when reading it.** The first
  lets schema names match. The second cannot reliably reconstruct value boundaries when
  values contain separators or the text is stale.
