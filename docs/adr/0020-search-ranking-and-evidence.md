# Search ranking without an index bonus, and evidence kept apart from rank

Rule: [Search](../decisions.md#search)

## Context

Search ranks entities across several indices (own fields, passages, relation entries,
several types) and up to two retrieval methods. An entity's type decides which indices
can hold it, so any combination that adds contributions favours types that have more of
them, for example a document property. Scores and match evidence also have to keep
honest meanings: a normalized top score implies a perfect answer, and keyword text that
carries schema labels lets keys count as content.

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
- **One minimum similarity for every caller, or dropping hits without keyword evidence.**
  Useful paraphrases have no lexical match, related passages can score high without
  answering, and the floors that were tested removed useful candidates. A similarity
  floor is model-specific.
- **Labelled text for keyword matching, or stripping labels when reading it.** The first
  lets schema names match. The second cannot reliably reconstruct value boundaries when
  values contain separators or the text is stale.
- **Attributing a semantic match to an individual property.** One vector describes the
  composed text, so any property cause would be invented.
