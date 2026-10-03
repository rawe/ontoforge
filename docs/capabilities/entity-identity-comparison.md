# Entity identity comparison

A read-only, optional judgment about whether two partial property snapshots describe
the same real-world entity. It uses a Decision provider, independently of the
language-model and embedding providers. It does not find candidates, read their
instance data, merge entities or write anything.

## Input and context

One request addresses an ontology and a lens and names one `entityTypeKey`. Both
snapshots belong to that same type and contain caller-supplied properties only.
They may be incomplete: required values need not be present, and missing or null
values mean unknown information rather than disagreement.

Only JSON scalars and null are accepted. Unknown, system, document and lens-hidden
properties are rejected; a type outside the lens is not found. The operation does
not coerce snapshots into valid entity writes. The provider receives the snapshots
plus the type's human-readable name and description, and the names, descriptions
and data types of the participating properties. Defaults and unrelated properties
are excluded.

String values and schema names and descriptions are shortened to 500 Unicode code
points. `truncatedFields` identifies each shortened input or metadata field using
paths such as `left.name`, `schema.description` or
`schema.properties.name.description`. The prepared JSON context must fit within
16 KiB in UTF-8 after shortening; a larger context is rejected before a provider
call.

## Judgment

The server asks one fixed `choice` question with three options:

| Decision | Meaning |
|---|---|
| `same` | The supplied information supports a shared real-world identity |
| `different` | The supplied information supports distinct real-world identities |
| `insufficient` | The information cannot distinguish the two outcomes |

Similar names alone do not establish identity. Instructions and option descriptions
are server-owned; callers cannot supply a rubric or turn the operation into a
general decision endpoint. Snapshot values and schema descriptions are treated as
data, not instructions.

The answer carries the decision, probabilities for all three options, the provider's
confidence and truncation metadata. Probabilities and confidence are model judgments,
not calibrated guarantees. An `insufficient` answer is a normal outcome. Failures
remain errors, with no retry, language-model fallback or automatic action.

## Through the interfaces

REST exposes the operation under the lens's runtime prefix as
`POST /decisions/compare-entities`. The body contains exactly `entityTypeKey`,
`left` and `right`, with each snapshot a property-key-to-scalar-or-null map. The
response contains `decision`, `probabilities` (keys `same`, `different`,
`insufficient`), `confidence` and `truncatedFields`. See [interfaces](../interfaces.md).
There is no MCP tool.

The server feature report exposes `entityIdentityComparison`. Without a configured
Decision provider it is false, and calling the operation returns the ordinary
`FEATURE_DISABLED` validation error. Disconnection cancels an in-flight comparison.

The web client's extraction review offers an explicit comparison of its edited
proposal against already retrieved candidates. This is advisory; choosing an
existing entity remains manual. See [product surface](../product-surface.md#ai-panel).
