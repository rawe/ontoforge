# Search ranking rationale

For contributors changing the ranking implementation or evaluating retrieval behavior.
The current contract is in [search](../capabilities/search.md#ranking); this guide explains
the trade-offs behind it. Index content and composition belong to
[search indices](../capabilities/search-indices.md#composition).

## Combine methods without rewarding a richer schema

An entity can occur in several indices: its own fields, document passages and relation
entries. Its type determines how many indices can contain it. Summing its contributions
would therefore reward schema eligibility rather than relevance; the evaluation that
motivated the policy placed the expected entity first substantially less often with that approach.
That observation motivated the current policy, not a guarantee for every model or dataset.

Dividing a sum by the entity's eligible indices would need a policy for absent
contributions. A document leader outside a limited property ranking could then lose to
a much weaker property-only candidate. The current ranking instead uses the entity's
best entry within each retrieval method.

Scores from indices using the same method share a scale. Fusing those rankings by best
reciprocal rank would discard that comparable information and treat every index's first
hit as equal. Reciprocal-rank fusion is used between methods, whose scores are not
directly comparable; appearing in several indices of one method does not add a bonus.

## Resolve ties without inventing measurements

Encounter order alone left relevant document leaders behind property leaders at equal
rank. Semantic similarity can refine a tied group, but only if every entity in that
group has a measured similarity. Treating an unmeasured value as zero invents a negative
preference. Comparing entities pairwise can produce inconsistent ordering across a group.
The current group-wide rule and final id ordering avoid those problems.

## Keep candidates separate from confidence and evidence

A top relative score is not evidence of a perfect answer: semantic ranking can return
candidates even when none answers the question. Similarity depends on the embedding model. A universal minimum, or
requiring keyword evidence for every hit, would discard useful paraphrases; related
passages can also score highly without answering the question. Floors tried in the
evaluation motivating the policy removed useful candidates. The current caller-specific
floor behavior is specified in [similarity floor](../capabilities/search.md#similarity-floor).

Measurements describe the entry actually evaluated. An unmeasured similarity is not a
negative, and one vector for composed text cannot identify a particular property as the
cause of a match. Such an attribution would be invented. Evidence and the final rank
therefore remain distinct ([response](../capabilities/search.md#response)).

Keyword text holds values only, so schema labels cannot become matching content. Stripping
labels from a labelled representation when reading it would not reliably reconstruct
the value boundaries: values may contain the separators, and stored text may be stale.
Separate keyword composition avoids both that ambiguity and matching schema vocabulary.
