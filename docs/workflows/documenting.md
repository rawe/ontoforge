# Writing and updating documentation

Use this workflow when adding a feature description, changing documented behavior or
reorganizing existing content. The [documentation principles](../AGENTS.md) define the
boundaries; the [documentation map](../README.md#documentation-map) identifies the current
homes. The same workflow applies to a person and to an agent.

## Start with the reader's question

Name what the reader needs to understand or do, and what they already know. For example,
"load a dataset again without duplicates" needs a procedure and links to identity rules;
"understand how identity is enforced" needs the capability explanation. These are related
questions, not two copies of the same page.

Find the existing owner before drafting. Read its relevant sections and check related API
or UI documentation when the change affects those surfaces. Use the glossary's terms.
If the accounts disagree, investigate against the implementation and tests; surface an
unresolved behavior or design conflict rather than choosing a version silently.

## Extend a page or create one

Extend the owning page when the information answers its existing question. A new limit,
failure case or example usually belongs alongside the behavior it qualifies.

Create a page when there is a distinct reader task or concept that needs its own coherent
explanation. Introduce its purpose and scope, and make it discoverable from the relevant
index or parent page. Do not create a new page just because a feature changed or a choice
was made. When splitting a large page, use meaningful topic boundaries rather than a
target word count.

For example:

- Identity declaration and uniqueness belong in
  [entity identity](../capabilities/entity-identity.md), not a new decision rule.
- A loading procedure belongs in [bulk inserts](../capabilities/bulk-inserts.md); the
  underlying staging and commit guarantees stay in [changesets](../capabilities/changesets.md).
- A new REST route belongs in the [interface map](../interfaces/README.md) and the system's
  OpenAPI description; its feature semantics belong in the capability document.
- A configuration variable and default belong in the root
  [configuration reference](../../README.md#configuration). A procedure for one script
  stays beside that script.

Architectural choices use the separate [decision workflow](recording-decisions.md).
The [architectural constraints](../architecture-constraints.md) are the shared starting
point for changes to system behavior, not a destination for every new feature rule.

## Draft at the appropriate level

Use a structure that fits the question. These are starting points, not required headings
or templates to fill with empty sections.

| Kind of explanation | Useful structure |
|---|---|
| Concept | What it is, why it matters, how it relates to other concepts, a clarifying example |
| Capability | Purpose and scope, behavior and rules, limits and important failures, representative examples, links to its interfaces |
| Reference | Scope, consistent entries for the contracts or options, relevant qualifications, links to explanatory material |
| Procedure | Intended result, prerequisites, ordered actions, how to recognize success, relevant failure or recovery steps |
| Architecture | Responsibilities and boundaries, essential invariants, consequential flows and trade-offs |

State the important behavior on the page that owns it. Identify preconditions and
consequences, distinguish defaults from requirements, and include failure cases that
change what a caller or operator must do. Explain a non-obvious constraint briefly where
it applies; a rule does not need a separate record merely to be enforceable.

Keep implementation details where they help a contributor change the implementation.
For example, architecture should explain what makes a schema cache safe across servers;
an implementation guide can explain its internal capacity or eviction mechanism.

## Connect the explanation

An overview should give enough context to understand the system before sending a reader
to details. Link to the owning section when the reader needs a contract, procedure or
deeper explanation. A related page may summarize the consequence that matters to its
reader, but should not maintain another full account of the same rules.

Update the relevant entry in the documentation map or local navigation when adding or
moving a page. If a change affects multiple surfaces, update the API or UI-specific
account without copying the whole capability explanation into it.

When moving content, account for its facts, qualifications, examples and useful rationale
before deleting the old text. Record the old and new homes in the change description so
a reviewer can check preservation. Search for incoming links and references, including
ones in source code; update their destinations or preserve a useful compatibility anchor.
A link that resolves but sends the reader back to the starting page is not a useful fix.

## Review the result

Read it as someone who did not implement the change. Can that reader answer the original
question without reconstructing essential behavior from several pages? Does each page
stay at its intended level, and is the next useful detail easy to find?

Before delivering the change:

- Check the documented behavior against the relevant implementation and tests where
  needed; distinguish verified facts from unresolved questions.
- Check the glossary terms, detailed owner and any summaries for agreement.
- Verify changed relative links and section anchors, and inspect tables, examples or
  diagrams when their rendering matters.
- For moved content, compare the old explanation with its destinations, including limits,
  exceptions and rationale. A shorter page alone does not demonstrate preservation.
- State what was checked and what was not. Link checks do not establish behavioral
  correctness, and a sampled review is not an exhaustive information audit.
