# 0020. Best-kind search ranking with separate measured evidence

- **Status:** Accepted
- **Date:** 2026-09-08

## Context

Search combines semantic and keyword rankings within each kind, then combines entity
properties with document passages. Summing at both levels rewards entities whose schema
allows both kinds, disadvantaging equally useful entities with no document property.
Normalizing every result by the best score also makes an unrelated query appear to have
a perfect first answer. Meanwhile, reusing labeled semantic text for keyword indexing
allows schema keys to count as content and obscures which values supplied query terms.

The owner authorized empirical implementation and selection with a preserved baseline,
freshly fixed query judgments, isolated database evaluation and no repository push.

## Alternatives considered

- **Keep summed fusion at both levels.** It preserves behavior but retains the structural
  disadvantage. In the initial five answer queries it placed only two expected entities
  first; in ten additional answer queries it placed five first.
- **Divide the cross-kind sum by schema eligibility.** It won the small initial fixture,
  but a document leader outside a limited property ranking can lose to a much weaker
  property-only candidate. This requires a policy about absent contributions. It also
  performed worse than the selected tie refinement on the additional query set.
- **Best kind rank with encounter-order ties only.** This removes the additive bonus
  without deciding why a contribution is absent. It improved early retrieval but left
  relevant document leaders behind property leaders when both had rank one.
- **Use selected-match semantic evidence within exact rank ties.** This improved the
  additional-query result from six expected entities first to nine, while preserving
  the primary best-kind rank. Missing measurements leave the whole group stable;
  ranking an unknown measurement as zero or using pairwise conditional comparisons
  would introduce unsupported preferences or inconsistent ordering. The evidence is
  model-specific and the small same-corpus evaluation is not universal validation.
- **Apply max globally.** It changes single-type fusion unnecessarily. The scope guard
  preserves named types and requests narrowed to one type, as well as one-kind rankings.
- **Filter by a universal minimum similarity or by missing keyword evidence.** Useful
  paraphrases can have no lexical match, and related passages can score highly without
  answering the question. Tested floors removed useful candidates. Retaining measurements
  with explicit meanings supports inspection without claiming calibrated confidence.
- **Keep labeled keyword text, or strip labels while reading it.** The former preserves
  matches against schema names; the latter cannot faithfully reconstruct boundaries when
  values contain separators or indexed text is stale. Separate retained value segments
  make keyword content and attribution explicit without changing semantic vectors.
- **Match the entire query independently against each property.** It misses valid
  queries spanning values. Contributing-term attribution is the useful weaker claim;
  it must remain unknown when parser boundaries or lens visibility prevent completeness.
- **Attribute semantic relevance to an individual property.** One vector describes the
  combined text. Inventing a property cause would provide a false explanation.

## Outcome

The search fusion, measured-evidence, values-only keyword and answer-sufficiency rules
in [decisions.md](../decisions.md#interfaces).
