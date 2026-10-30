# Search ranking without an index bonus, and scores only on the matching entry

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
broken by an invented measurement. A result carries its rank and the entry that matched, with
each method's own score of that entry; the result as a whole never has a score.

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
- **A score or a normalized relative score for the result as a whole.** A top score of 1.0
  reads as a perfect answer, and even an unrelated query has a best result.
- **Every method's own best entry beside the match.** It repeated the match's place for most
  results and took a third of a search tool's response.
- **Only the score of the method the match ranks by.** The other method's score of the same
  entry is a different, equally valid measurement; dropping it hides that both found it.
- **One minimum similarity for every caller.** Useful paraphrases have no lexical match,
  related passages can score high without answering, and the floors that were tested
  removed useful candidates. A similarity floor is model-specific.
- **Labelled text for keyword matching, or stripping labels when reading it.** The first
  lets schema names match. The second cannot reliably reconstruct value boundaries when
  values contain separators or the text is stale.
