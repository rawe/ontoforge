# Saved queries

A saved query is a stored, named, parameterized pipeline of query steps that belongs to
one lens. It exists so a client can *find* a query instead of composing one.

## What it does

Composing a query from scratch demands that the caller get every type key, property key
and pattern right in one shot. A large model with a good prompt manages this; a small one
does not, and every attempt costs tokens. Saved queries move that work to design time.
The designer writes and validates the pipeline once; at run time a caller picks a key,
supplies typed parameters, and receives rows. It never sees the query text.

A saved query carries a **key**, a **name**, a **description**, an ordered list of
**steps**, and a list of declared **parameters**. The description is not decoration — it
is the surface that semantic discovery searches, and the text a model reads to decide
whether this query answers the question in front of it. So is each parameter's
description, which is what the caller reads to know what to put in it.

### The pipeline

Steps run in declaration order. There is no branching, no looping and no conditional
execution; the only control flow is the order they are written in. There are two kinds:

| Step type | Carries | Does |
|---|---|---|
| `oql` | an OQL query | Runs the query against the lens, exactly as an ad-hoc query would |
| `semantic_search` | an entity type key and a search text, optionally a result limit and a minimum score | Runs semantic search over that entity type |

Only the **last step's** output is returned. Intermediate step outputs exist solely to
feed later steps through bindings; they are never sent to the caller. The shape of the
response is therefore the shape of whatever the final step produces — a column list plus
rows for an `oql` step, a search response for a `semantic_search` step. See
[oql.md](oql.md) and [search.md](search.md) for those shapes.

### Parameters and substitution

A parameter declares a name, a description and a data type. Any schema data type except
`document` is allowed — parameters are scalars.

The two step kinds consume parameters differently, and the difference matters:

- An `oql` step's `$name` placeholders are **bound as query parameters**. The value never
  becomes part of the query text, so no escaping question arises and a value cannot alter
  the query's shape.
- A `semantic_search` step's search text is **textually substituted**: each `$name` is
  replaced by the string form of the parameter's value. A `$name` that matches no
  parameter is left in the text verbatim.

### Bindings

A binding is how a later step consumes a column that an earlier step produced. A step
declares bindings as a map from a query-parameter name to a reference of the exact form:

```
{{stepName.fieldName}}
```

Resolving it collects `fieldName` from every row of that earlier step's output, in row
order, into a **list**, and supplies that list as the named query parameter. It is always
a flat list — there is no aggregation, reshaping or scalar extraction. The consuming
query is expected to use it as a set, typically with a membership test.

What counts as a "field" depends on the producing step. Rows of an `oql` step are its
result rows, so a field is one of its returned column names. Rows of a `semantic_search`
step are the matched entities' property maps with the similarity score added under
`_score`, so a field is a property key, a system property, or `_score`.

## Rules

### Identity and ownership

- Query keys match `^[a-z][a-z0-9_-]*$` at up to 64 characters — hyphens are allowed,
  unlike the type and property keys described in [../README.md](../README.md).
- A key is unique within its lens. Two lenses may each hold a `people_by_skill`.
- Writing a saved query is an upsert on that key: it creates or replaces wholesale.
- Saved queries belong to a lens ([ontology-lenses.md](ontology-lenses.md)). Deleting the
  lens deletes them, and they travel with it through
  [transfer](transfer.md).
- Defining, replacing or deleting one is a modeling operation and invalidates the schema
  cache described in [../architecture.md](../architecture.md).

### Structure

- A pipeline has at least one step.
- Step names match `^[a-zA-Z_]\w*$` and are unique within the pipeline. They are the
  handles bindings refer to.
- An `oql` step must carry a query. A `semantic_search` step must carry both an entity
  type key and a search text.
- A `semantic_search` step's limit is 1–100 and defaults to 10 when omitted; its minimum
  score is 0–1 and is unbounded when omitted.
- A binding must reference a step declared **strictly earlier**. Self-references and
  forward references are rejected, which makes a cycle unexpressible.
- A binding expression must match the reference form exactly; anything else is rejected.

### Parameter cross-checks at definition time

Both directions are enforced, and the second one surprises people:

- Every `$name` referenced by any step, and not supplied by a binding, **must** be a
  declared parameter.
- Every declared parameter **must** be referenced by at least one step.

A consequence: a name that a binding supplies must *not* also be declared as a parameter.
It would be an unreferenced declaration, and the definition would be rejected.

### Validation at definition time versus run time

| Checked | At definition | At run |
|---|---|---|
| Key pattern, parameter data types | yes | — |
| Step structure, names, binding form and ordering | yes | — |
| Parameter cross-checks | yes | — |
| Each `oql` step parses and names only types and properties the lens exposes | yes | yes |
| Supplied parameters match the declaration | — | yes |
| Parameter values coerce to their declared types | — | yes |

Structural and cross-check failures are collected and reported together rather than one at
a time, as validation is expected to (see [../decisions.md](../decisions.md)). The OQL
check at definition time is skipped
when the lens's schema cannot be loaded; the run-time check is not, so a query stored
that way still fails safely on first use.

Nothing proactively invalidates a stored pipeline. A schema change that removes a type an
`oql` step names, or a lens narrowing that hides one, leaves the saved query in place; it
fails with a validation error the next time it runs. Re-validating stored queries after a
schema change is the designer's job.

### Execution

1. The key is resolved within the lens. An unknown key is not found.
2. Supplied parameters are matched against the declaration **exactly**: any missing
   parameter and any unrecognised one is an error, and all of them are reported together.
   There are no optional parameters and no defaults.
3. Each value is coerced to its declared data type using the same strict coercion as
   instance writes ([instance-data.md](instance-data.md)). All coercion failures are
   reported together, keyed by parameter name.
4. Steps run in order. Before each step, its bindings are resolved against the outputs
   already collected.
5. For an `oql` step, the full set of coerced parameters plus that step's resolved
   bindings are passed as query parameters — every parameter is passed to every step,
   whether or not that step references it. Where a binding name collides with a parameter
   name, the binding wins for that step.
6. Results of an `oql` step are post-processed exactly like an ad-hoc query: columns and
   properties the lens does not expose are stripped, and document properties are reduced
   to stubs ([documents.md](documents.md)).
7. The last step's output is returned.

Two rules that are easy to miss:

- A row that lacks the bound field is skipped, so a resolved binding may be shorter than
  the producing step's row count — and empty if no row carried it. An empty list is not
  an error; it flows into the next step and typically yields no rows.
- **Bindings on a `semantic_search` step are ignored.** They are resolved, but only
  declared parameters reach the search text. To consume collected values, feed them into
  an `oql` step.

A pipeline containing a `semantic_search` step needs an embedding provider and fails
without one, even if the caller only wanted the final `oql` step's rows.

### Discovery

Two ways, and they answer different questions.

**Listing** returns every saved query of the lens with its key, name, description and
parameter declarations. This is exhaustive but grows with the lens.

**Semantic search** ranks saved queries by the similarity of a natural-language phrase to
their *descriptions* — nothing else is embedded, not the name and not the steps. It
requires an embedding provider and is rejected as unavailable without one. It returns key,
name, description, parameters and a score, but **not** the steps. Its result count and
score floor default conservatively — the exact values and their ranges are with the route
in [../interfaces.md](../interfaces.md#saved-queries-1).

A saved query's description is embedded when it is written and when it is imported, so
editing a description re-embeds it. The bulk rebuild operation described in
[search.md](search.md) also re-embeds every saved query.

## Through the interfaces

Definition is a modeling concern, execution a runtime one — the same split as everywhere
else. Complete operation index: [../interfaces.md](../interfaces.md).

| | Modeling (define) | Runtime (use) |
|---|---|---|
| REST | List, upsert by key, delete, under the lens's route | List, semantic search, run by key |
| MCP | `list_saved_queries`, `set_saved_query`, `delete_saved_query` | `list_saved_queries`, `search_saved_queries`, `run_saved_query` |
| Web UI | The lens's saved-query editor, with a run panel | Quick-run cards on the workbench home and a library beside the query console |

The runtime listing and the modeling listing differ in one respect worth knowing: the
runtime one is served from the schema cache, so it reflects the state of the process that
answers it.

A model reaching this capability over MCP or as an agent tool sees three tools that
compose into one workflow: search or list to find a key and its parameters, then run it.
An agent restricted to exactly those three can query a graph usefully while being unable
to write a query at all — see [ai-agents.md](ai-agents.md).
