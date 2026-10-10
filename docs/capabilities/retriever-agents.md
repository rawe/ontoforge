# Retriever agents

A retriever agent answers questions over one lens's [search indices](search-indices.md).
It is a stored configuration: which indices it searches, which exact filters a question
may set, which fields the answer may cite and how strict semantic matching is. A question
runs a fixed pipeline — a planning model turns it into searches, the index search runs
them, an answer model writes the reply from what they found. Questions form a
conversation held by the server as a [thread](threads.md). A question can also be
[retrieved](#retrieve) instead: planned and searched, returning the found entities
without an answer. Saving an agent stores the configuration only: no vectors, no graph
data, no conversation. Every lens also has a
[default retriever agent](#the-default-retriever-agent), derived from its managed indices
and never stored.

Vocabulary: [../README.md](../README.md#glossary). The rules these follow:
[../decisions.md](../decisions.md). Every route: [../interfaces.md](../interfaces.md).

## Ownership and persistence

An agent belongs to exactly one lens of one ontology. Its key is unique in that lens and
follows the lens-resource [key](../README.md) rule, at most 64 characters. It carries a
name (1 to 200 characters), an optional description, a configuration version, the
configuration, the warnings of a conversion ([below](#converting-version-1-configurations))
and timestamps. This release writes and runs configuration version 2.

Saving an agent changes nothing else: no schema, no instance, no index, no other lens.
A save creates the agent or replaces its name, description and configuration; its identity
and creation time stay, and its conversion warnings are cleared. Deleting an agent removes
it alone; deleting its lens deletes its agents. Retriever agents are separate from the
tool-using [agents](ai-agents.md).

## The configuration

| Field | Meaning |
|---|---|
| `indices` | The search indices the agent searches, 1 to 12, each once: `{index}` by key, managed or custom, optionally with `relations` — the relation types of the index's relation groups the agent may use. Without `relations` every relation group the lens shows counts |
| `filters` | Up to 12 exact conditions a question may set: `{id, entityType, path, field}`. `entityType` is a result type, `path` 0 to 2 relation hops (`relationTypeKey`, `direction` `outgoing` or `incoming`) from it, `field` a property of the entity the path reaches. Ids are unique within the agent |
| `answerFields` | Per result type, 1 to 12 of its properties the answer model receives |
| `threshold` | The cosine similarity a semantic match must reach, −1 to 1, default 0.35 |
| `answerFieldCharacters` | The characters of one answer field, and of one matched entry text, passed to the answer model; 100 to 2,000, default 800 |

The **result types** are the root entity types of the chosen indices; an agent finds
entities of those types and no others. A fact about an entity's relation is found through
a custom index with a relation group for it, which a question uses by searching that
index ([search-indices.md](search-indices.md#relation-groups)). A filter is the exact,
structural counterpart: it compares a stored value and reaches up to two hops, further
than a relation group's one.

The threshold is the cosine of the embedding model; the index search measures similarity
as `(1 + cosine) / 2`, so the agent searches with that floor
([search.md](search.md#similarity-floor)). It removes semantic matches below it, never a
keyword match, and only in a search that no filter or previous reference restricts
([below](#retrieval)). It is a model-specific cut-off, not a confidence.

## Validation and warnings

A configuration is checked against its lens — its schema and its
[search catalog](search.md#the-search-catalog), the indices the lens can search:

- the configuration version is 2 and the shape and limits above hold;
- every index is in the catalog, and chosen once — an index the lens does not include or
  whose root type it does not expose is not in it, nor is a switched-off managed index or
  a deleted one;
- every relation type in an index's `relations` is the relation type of a relation group
  of that index the lens shows;
- every filter's `entityType` is a result type, each hop of its path is a relation type
  the lens shows leaving the type reached so far, and its field is visible on the type
  the path reaches;
- every result type has answer fields, every answer field is visible on its type, and no
  other type has answer fields.

Every error is collected. **A save refuses an invalid configuration** — a create, a
replace, a copy or move into its target lens, a single-agent import. **A stored agent
can still become invalid**, because what its lens offers changes underneath it: a schema
or scope change, an index deleted, excluded from the lens or switched off. Nothing
cascades to agents. Every read reports the current result as
`validation: {valid, errors, warnings}`; an invalid agent stays readable and exportable,
and a question to it is refused until it is valid again. A stored configuration of
another version or shape stays as stored: it is reported invalid, never converted or
replaced with defaults on read.

**Warnings** are notes a conversion left — soft conditions it dropped, a key it renamed.
They never make an agent invalid or block a save; they stay with the agent, through copy
and move, until its next save.

## Converting version-1 configurations

Version 1 configured retrievers by result buckets with search fields and hard or soft
conditions. A version-1 configuration is converted to version 2 wherever one arrives: in
storage brought up to date ([../storage-adapters.md](../storage-adapters.md)), in a
single-agent import, and in a `5.0` [transfer](transfer.md) payload.

- Each bucket searches its type's default index when it searched a non-document field,
  and the passage index of every document property it searched
  ([search-indices.md](search-indices.md#managed-indices)). Its answer fields stay its
  type's answer fields.
- Each hard condition becomes a filter with the same path and field. A filter id another
  bucket already used gets its type key as prefix.
- Soft conditions have no counterpart — their content belongs in a custom index with a
  relation group — and are dropped, each with a warning naming the relation path the
  group would need.
- Threshold and answer-field characters carry over.
- A key with `-` has each `-` replaced by `_`; when that key is already taken in the
  lens, it gets the first free suffix of `_2`, `_3`, … A key without `-` stays as it is.
  Each rename leaves the warning `Key renamed from '<old>' to '<new>'.`

The converted configuration is then validated like any other: a single-agent import
refuses it if the lens cannot run it, while storage and transfer keep it and reads report
it invalid.
A configuration that is no readable version-1 shape is refused by import and left as it
is in storage, where reads report it invalid.

## Answering a question

The agent is loaded from storage by lens and key — or derived, for the
[default agent](#the-default-retriever-agent) — and checked against the lens again; a
request can never supply or override a configuration, so changes run once saved. A
question makes two model calls — plan and answer — with retrieval between them, or three
when a follow-up's planning is repeated once ([below](#planning)); no other model call is
repeated, and a failed call is never retried. A [retrieve](#retrieve) makes one.
Cancelling the request stops further work.

### Planning

The planning model receives the question, the recent conversation, the search modes the
server can run and, from the lens's catalog, each of the agent's indices: its name,
description and root type, what its own entry holds, the relation groups the agent may
use with what one relation entry holds, the document it reads passages of, and its
modes. It also receives the agent's filters, with what each compares — and, where the
compared field holds at most 50 distinct stored values, those values, listed once per
compared type and field — and — only when they may be referred to
([below](#follow-up-questions)) — the previous turn's results.
A planning input over 24,000 characters refuses the question;
fewer indices or filters fix it.

It returns up to four **sub-queries** and an optional `unsupportedReason`. A sub-query
names some of the agent's indices, optionally relation types among those the agent
allows for them, a `query` with up to three `variants` — further ones and empty ones are
dropped and long ones cut to 200 characters, never failing the plan — a `mode` —
`semantic`, `keyword` or `hybrid` — exact `filters` with values, and an optional
reference to previous results. One entry never holds two relations
([../decisions.md](../decisions.md#behaviour)), so a condition the user states a value
for is attached as an allowed filter of the result type to the sub-query searching that
type; the planner splits into a further sub-query, fused per entity, only when the
condition needs another relation group and no filter covers it. A question no index can
answer returns no sub-query and a reason.

**Queries are the planner's words; exact restrictions are the user's.** A query and its
variants may be phrased freely and may name an entity taken from an answer — a follow-up
restates its topic from the conversation. Only what restricts results exactly must come
from the user: a filter value must occur in a verbatim quote of the current question or
an earlier user message, and a reference to previous results must rest on the user's own
referring words. An answer's text is never evidence for a filter.

**A listed value is chosen, not invented.** Users rarely name a value as it is stored —
"hall 3" for "Hall 3 - Energy Technology", "the platform team" for "Software Platform".
Where a filter's values are listed, the planner sets the listed value the user's quoted
words name, in its stored spelling, or leaves the filter out and keeps the words in the
query when none is named. The quote must still be the user's verbatim words; a value that
is neither listed nor in the quote is left out. The comparison stays exact, so the
condition is still proven, and a limitation names how the words were read ("hall 3" read
as the condition "located in Hall Name: Hall 3 - Energy Technology"). A value the user
states that is not listed is kept as stated and matches nothing.

Before anything is searched, the server checks the plan and leaves out what it cannot
honour, naming each omission in the limitations the answer model receives — in plain
words from the lens's display names, never by sub-query number, key or id, and in the
same text the diagnostics report: an index the
agent does not search, a relation it does not allow for the sub-query's indices, a filter
that is not the agent's or not for the sub-query's result types, a filter value without
that quote and not a listed value it names, and an invalid previous-result reference — the sub-query then runs as a fresh
search. A mode the server cannot run is replaced by its first available one. A sub-query
left with no index, or without a query and with neither an applied filter nor a previous
reference, is dropped. The question goes on with what remains; only a malformed plan, or
one with neither sub-queries nor an `unsupportedReason`, refuses it.

**A follow-up whose plan searches nothing is planned once more.** When the question has a
conversation before it and its checked plan has no sub-query, only an `unsupportedReason`,
the planning model is called a second time with the same input and an added instruction
to restate the topic and all constraints from the conversation as sub-queries. The second
plan is used; when it searches nothing either, the question is answered as unsupported.
When the repeated call fails or returns a malformed plan, the first plan stands. Either
way a limitation names the repetition. A question without a conversation is never
planned twice.

### Retrieval

Each sub-query runs its query and each variant as one index search over its indices, in
the server, at most 30 entities each. Own-field and passage entries always count; of the
relation entries only those of the chosen relation types — the agent's subset when the
plan names none. In a sub-query without filters or a previous reference, semantic
matches below the threshold do not count. The rankings of the query and its variants,
and then of all sub-queries, are fused per entity by reciprocal rank
(`1 / (60 + rank)`); an entity found by several sub-queries keeps what matched in each.

**Filters restrict a sub-query to entities.** A filter finds the entities at the end of
its path whose field equals the value — compared after Unicode normalisation, lower-casing
and collapsing white space — and follows the path back to the result type. Several
filters, and a previous-result reference, intersect. The restriction applies to the
indices of the filter's result type; other result types of the sub-query stay
unrestricted. Each step keeps at most 1,000 entities, and the answer is told when one was
cut.

**A restricted sub-query is an exact candidate set.** When filters or a previous
reference restrict a sub-query, its query only orders the entities they allow: no
threshold applies, and the allowed entities the search did not rank follow the ranked
ones, without a match. A sub-query without a query lists them only. Either way at most
100 entities are kept, and the answer is told when more match.

An index whose build state is not `ready` still answers, and the answer is told that
results may be incomplete ([search-indices.md](search-indices.md#status)).

### Evidence and the answer

The answer model sees the lens's display names, never ids, keys or paths. Each result
reaches it with its type's display name, its label — its name property's value — its
answer fields read through the lens and named by display name, and per search that found
it: that search's query (empty for an exact list), what matched — the entity's own
fields, one relation, named by its relation group's label or else the relation type's
display name, with the entity at its other end by label and type, or a passage of the
named document — the entry's text, and the search's filters the entity satisfies, each
as a plain condition built from display names ("lives in City Name: Berlin"). A satisfied
filter is an established fact the answer may state, in its own words. The plan reaches
the answer model the same way: per search its query, the relation groups it was
restricted to by label, and its conditions. Answer fields and entry texts are cut to the
configured characters; the entry text is withheld when the index reads properties the
lens hides ([ontology-lenses.md](ontology-lenses.md#search-through-a-lens)). Evidence is
added best first up to 8,000 characters; results that do not fit are omitted and named
as an unassessed remainder, never as further matches. Scores never reach the answer
model.

The answer model replies in the language of the user's current question, from this
evidence alone: the conversation only tells it what the question refers to and is never
evidence. It names an entity only when the evidence supports every fact asked for; a
result a filtered sub-query returned without a matched entry satisfies that sub-query's
filters, not its query. It lists every supplied record for a pure exact list, explains an
`unsupportedReason` as a data gap and respects every limitation. It states facts in plain
words — never sub-queries, filter ids or paths, index keys or entity ids — and tells
results with the same name apart by their fields. Search evidence does not prove that a
result fits ([../decisions.md](../decisions.md#interfaces)).

### Follow-up questions

A question continues its [thread](threads.md); the thread keeps each answered turn's
results, so the next question may restrict a sub-query to the previous turn's results —
"these", "their stands" — directly or through a filter whose path leads to them. The
client sends nothing but its question and the thread's id. Only results the server
verified can be referred to: the previous turn must have listed by filters and references
alone, with every result reaching the answer model; only then does the planner see them,
after they are checked against the current data again. The reference must rest on the
user's own referring words, and a singular one needs exactly one result. A turn that
searched by text yields candidates, not verified results: a reference to them is ignored
with a limitation. So are results the agent found under another configuration: each turn
runs the agent's current configuration, and results found before it was saved are not
offered to the planner.

A reference the planner cannot restrict by — to such candidates, or with no verified
results at all — is never answered as unsupported: the planner restates the earlier
question as a fresh search that carries all of its constraints, dropping none, together
with the new condition. Any follow-up restates its topic in its search phrases. A pronoun
or a left-out subject is resolved from the last exchange alone — the entity the last user
message named, or, when that message named none, the one the answer to it named — never
from an earlier exchange; the query names that entity. A follow-up the planner still
answers as unsupported is planned once more ([above](#planning)).

The planning and answer models see the thread's recent turns, as its user messages and
answers; how many: [../architecture.md](../architecture.md#thread-store).

### Diagnostics

On request, the stream also reports what the agent did: the validated plan, one result
row per entity and sub-query with what matched and its answer fields, the limitations,
the number of index searches, phase timings and bounded traces of every model call —
the plan, a repeated plan, the answer. Diagnostics are for debugging: they are sent only
when a question asks for them, and any question may. Progress — which phase runs — and
the answer text are always streamed. The event format is in [../interfaces.md](../interfaces.md#retriever-agent-list-chat-and-retrieve).

## Retrieve

Retrieve answers one query with the entities the agent finds — no answer text: a
question's run without the answer step. It runs
exactly the first two phases of [answering a question](#answering-a-question), unchanged:
[planning](#planning) and [retrieval](#retrieval). There is no conversation: no thread,
no reference to earlier results, so planning is never repeated and a retrieve makes
exactly **one model call**. No answer model runs, and answer fields are
not read into the response; the caller reads the entities it needs through the runtime
interfaces. The agent is loaded and checked as for a question, a request can never supply
a configuration, the planner input cap and the plan checks apply, and every refusal is
the question's. Cancelling the request stops further work.

The response is the fused result list, best first. The order is the match grade: there is
**no score**. Each result carries its identity, entity type and label — its name
property's value, or none — and two independent facts:

- **Conditions** — the exact conditions it is proven to satisfy: the union, over every
  sub-query that returned it, of the agent's filters that sub-query applied for its type,
  each once. A condition names the filter, the compared value and the condition in plain
  words from the lens's display names, as the answer model receives it ("reported by
  Customer Name: Acme"). The server compared the stored value.
- **Matched** — the text match of the first sub-query, in plan order, that ranked the
  entity, in the form of a search hit's ([search.md](search.md#response)); none when every
  sub-query only listed it. The entry text is withheld where the index reads properties
  the lens hides.

| Conditions | Matched | Meaning |
|---|---|---|
| some | set | Proven condition, and on topic |
| some | none | Proven condition; listed only, topic not established |
| none | set | Similarity candidate |

Beside the results come the limitations, in the plain words the answer model would
receive, and the planner's unsupported reason when no index can answer. No result — no
match, or an unsupported question — is not an error. A retrieve carries no
diagnostics; they belong to the question's stream only.

## The default retriever agent

Every lens has an implicit retriever agent, keyed `_default`. It is not stored and cannot
be created, replaced, deleted, copied, moved, exported or imported; no stored key can
begin with an underscore, so it can never be shadowed. Modeling does not know it: it is
not listed, read or written there. The runtime list names it first, as `Default`, marked
built in. It exists wherever the adapter stores search indices, and both
[answering a question](#answering-a-question) and [retrieve](#retrieve) serve it.

Its configuration is derived from the lens for every question, deterministically — the
same lens and schema give the same configuration, so a follow-up may refer to the previous
turn's results until the schema changes:

| Field | Derived as |
|---|---|
| `indices` | Every managed index in the lens's [search catalog](search.md#the-search-catalog) — each exposed type's default index and each visible document property's passage index — that is switched on. No relation narrowing; custom indices are not included |
| `filters` | Per result type whose name property the lens shows: one on that name, and one per relation type the lens shows with the type at one end, in each direction in which it is that end — both for a self-relation — comparing the name of the other end's type, when the lens exposes that type and shows its name property |
| `answerFields` | Per result type: its name property, then its further visible `string` properties in schema order, up to 12 |
| `threshold`, `answerFieldCharacters` | The defaults |

The derived filter ids are the result type's key alone for a name, and the result type's
key, the relation type's key and the direction, joined by dots, for a relation — the ids
a retrieve's conditions name.

The stored limits of twelve indices and twelve filters do not apply; the derived
configuration is valid by construction. The planner input cap applies unchanged: a lens
whose derived configuration exceeds it refuses the question, saying the lens is too
large for the default agent and a configured agent is needed. Nothing is trimmed. A lens
with no managed index switched on for a type it shows has nothing to search, and a
question to its default agent is refused.

## Copy, move and portable JSON

Copy and move address a target lens and key **in the same ontology**. The configuration
must be valid in the target lens, and the target key must be free — an existing one is a
conflict, never overwritten. Copy creates an independent agent and keeps the source; move
keeps the agent's identity and changes its lens and key in one step. A source changed
since it was read refuses the operation instead of transferring a different
configuration from the one validated.

Validation of the target precedes the storage transfer, which does not lock the schema:
a concurrent schema or lens change can leave the transferred agent invalid, which its
next read reports.

The portable form of one agent is `{key, name, description, configVersion, config}` — no
lens, identity, timestamps, warnings, vectors or conversation. Import creates the agent in
the addressed lens, validates it there, and refuses an existing key. A version-1 export
is converted first, its key renamed if needed among the keys the lens already holds. This is the way to take an agent to another ontology.

## Transfer

Whole-design [transfer](transfer.md) nests each lens's agents in their portable form
under its `assistants`, as `retrievers`. Import checks their keys, names and
configuration shape — not what they reference, so an exported agent that became invalid
still imports and is reported invalid there — and writes them last, once the indices
exist. A `5.0` payload's
`retrievers` are converted.

## Adapters without search indices

Retriever agents search search indices, so they exist only where the storage adapter
stores them. Elsewhere every retriever-agent operation is refused as a disabled feature,
export carries no `retrievers`, and import checks them and keeps none.

## Through the interfaces

Retriever agents are managed through modeling REST, addressed by lens key and agent key,
and through the modeling MCP server's tools to list, read, create or replace and delete
one; copy, move, export and import are REST only. At
runtime a list names every agent of the lens — runnable or not, without configuration or
validation, the default first; a question runs by agent key on a thread and streams its
progress and answer, a thread reads back, and a retrieve answers one query with one plain
response ([../interfaces.md](../interfaces.md)). All address the default agent by its key.
Management, the runtime list, reading a thread, copy, move, export and import call no
model. A question or a retrieve needs a
language-model provider — without one it is refused as a disabled feature before anything
is read or streamed; without an embedding provider it searches by keyword only. No MCP
tool runs an agent; the modeling MCP server's whole-schema read and export carry them
like REST.
