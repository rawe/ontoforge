# Navigators

A navigator answers questions by walking one lens's graph: it finds what the question
names, follows relations from there to what the question asks for, and answers from the
entities it met, citing each one. It is the assistant kind for questions that span
relations — "who works on projects that require Kubernetes", "Lena's reports and their
teams" — which a ranked search cannot answer and an open tool loop answers slowly.

A turn is a fixed pipeline with two model calls. Everything between them reads the lens
and calls no model, so the client can draw the pipeline, light up each step as it runs, and
show every entity the answer may use before the answer arrives. Questions form a
conversation held by the server as a [thread](threads.md). Every lens also has a
[default navigator](#the-default-navigator), derived from the lens and never stored.

Vocabulary: [../README.md](../README.md#glossary). The rules these follow:
[../decisions.md](../decisions.md). Every route: [../interfaces.md](../interfaces.md).

## Ownership and persistence

A navigator belongs to exactly one lens of one ontology. Its key is unique among the
lens's navigators and follows the lens-resource [key](../README.md) rule, at most 64
characters. It carries a name (1 to 200 characters), an optional description, a
configuration version, the configuration and timestamps. This release writes and runs
configuration version 1.

A save creates the navigator or replaces its name, description and configuration; its
identity and creation time stay. Saving changes nothing else. Deleting a navigator removes
it alone; deleting its lens deletes its navigators.

## The configuration

| Field | Meaning |
|---|---|
| `hops` | How far an exploring walk goes from an anchor, 1 to 3, default 2 |
| `relationTypes` | The relation types a walk may follow, or `null` for every one the lens shows |
| `anchorTypes` | The entity types a mention may resolve to, or `null` for every one the lens shows |
| `maxEntities` | The evidence entities the answer model receives at most, 10 to 80, default 40 |
| `instructions` | Up to 4,000 characters of further guidance for the answer — tone, focus, format — or `null` |

## Validation

A configuration is checked against its lens: the version is 1, the shape and limits above
hold, every relation type in `relationTypes` is one the lens shows, every entity type in
`anchorTypes` is one the lens exposes, and neither list names a type twice. Every error
is collected.

**A save refuses an invalid configuration. A stored navigator can still become invalid**
when its lens changes underneath it: a type removed from the schema or the scope. Nothing
cascades to navigators. Every read reports the current result as
`validation: {valid, errors, warnings}` — a navigator has no warnings; the field keeps
the shape every kind shares. An invalid navigator stays readable and exportable, and a
question to it is refused until it is valid again.

## Answering a question

The navigator is loaded by lens and key — or derived, for the default — and checked
against the lens again; a request never supplies a configuration. A question makes exactly
two model calls, and neither is retried. Cancelling the request stops further work.

### Understand

The first model call reads the question against the lens's schema — each entity type
with its display name and description, each relation type the navigator may follow with its
endpoints — the recent conversation, and the entities the previous answer cited. It
returns, as structured output:

- **mentions** — the concrete things the question names (names, titles, codes, values),
  each with the entity types it may be;
- **targets** — the entity types the answer is about;
- **a path** — the relations from the mentions to the targets, in order, up to three hops,
  each with a direction: from the relation's source side, from its target side, or either;
- whether the question **refers back** to the previous answer's entities;
- a **topic** phrase, for a question that names nothing and does not refer back.

Every type and relation it returns is checked against the lens and the configuration;
anything else is dropped.

### Anchor

The entities the walk starts from:

- **A mention is resolved through the lens's search**, and by substring listing when
  search finds nothing. An entity is a match **by name** when one of its values contains
  the mention or the mention contains its label; up to three such matches are kept.
- **A name that matches nothing is never silently replaced.** Without a match by name,
  the best search hit alone is kept as a **closest match**, marked so on its card, and the
  answer is told to say that the named thing was not found and which closest match was
  used instead.
- A question that refers back starts from the previous answer's entities, read again so
  that entities deleted since, or no longer shown, drop out.
- A question with neither starts from the best matches of its topic, documents included.

Only entity types in `anchorTypes` are anchored.

### Walk

From the anchors, along the relation types the navigator may follow and the lens shows:

- **With a path, the walk follows it hop by hop**, each hop only along its relation. A
  direction is a hint: a hop that finds nothing in it takes either direction, and a hop
  along a relation type whose two ends are the same entity type always takes both — which
  way such a relation points is told to the answer in the relation's own words. A hop that
  finds nothing ends the path unreached.
- **Without a path, the walk explores** breadth first along every allowed relation, up to
  `hops` hops, and stops after the hop that first reaches an entity of a target type.
- **The walk widens once.** When the path reached nothing or missed one of the target
  types, or an exploration reached no target type and may still go further, a second walk
  explores every allowed relation — one hop further than the first when that first walk
  explored. The answer is told.

Only entities of types the lens exposes are taken, with what the lens shows of them. A walk
reads at most 40 relations per entity, expands at most 60 entities per hop and collects at
most 400; when it is cut, the answer is told that only the closest part was read.

### Focus

The evidence the answer receives, at most `maxEntities`: the anchors first, then the
entities of the target types — the best connected first, then the closest — each together
with the path that led to it, then the remaining entities by distance. Entities that do not
fit are counted, and the answer is told how many more were found.

### Answer

The second model call answers from the evidence alone: each entity as its type's display
name, its label and up to six visible fields, the relations between evidence entities as
sentences in display names, and the notes the turn collected. It never sees ids, keys or
scores. It cites every entity it names by the entity's ref — `[E2]` — names an entity only
when its relations and fields support what is asked, says plainly when the evidence does
not answer the question, and answers in the language of the question. The navigator's
`instructions` are appended to its own. The answer streams as it is written.

### Follow-up questions

A question continues its [thread](threads.md); the client sends only its question and the
thread's id. The thread keeps the conversation and the entities the last answer cited — or,
when it cited none, its evidence beyond the anchors — at most 20. A follow-up that refers
back ("which of them…", "their managers") starts from those entities. Each turn runs the
navigator's current configuration.

## What the client sees

A turn streams its work before its answer, in display names only:

- **The pipeline** — its steps, which of them call the model, and the edges between them,
  once, first.
- **Each step** — when it starts and how it ends (done, skipped or failed), how long it
  took, a one-line summary in plain words — "Path manages → member of: 6 entities ·
  reached Person at hop 2" — and, for the walk, which round.
- **The entities** — each with a ref unique in the turn, its type, label, up to six fields,
  its role — anchor, reached by the walk, or carried over from the previous answer — its
  distance from the nearest anchor, why it is there ("Lena Fischer manages Kira Novak", or
  "Closest match for “Nordwind Robotics” — not the same name"), and whether it is evidence;
  and the relations between them. They are sent after the anchors, after each walk and
  after the focus, each time replacing what the client had under the same refs.
- **A summary** — model calls, duration, entities met, evidence, hops — once, before the
  end of the turn.

Only evidence can be cited. The event format is in
[../interfaces.md](../interfaces.md#navigator-list-and-chat).

## The default navigator

Every lens has an implicit navigator, keyed `_default`, named `Default`. It is not
stored, cannot be created, replaced or deleted, and modeling does not know it. Its
configuration is the defaults: every relation and entity type the lens shows, two hops,
forty evidence entities, no instructions. The runtime list names it first, marked built in.

## Transfer

Whole-design [transfer](transfer.md) nests each lens's navigators under its `assistants`,
as `navigators`, in their portable form: `{key, name, description, configVersion, config}`.
Import checks their keys, names and configuration shape — not what they reference, so a
navigator that became invalid still imports and is reported invalid there — and writes them
last.

## Through the interfaces

Navigators are managed through modeling REST, addressed by lens key and navigator key: list,
read one, create or replace, delete. At runtime a list names every navigator of the lens —
runnable or not, without configuration or validation, the default first; a question runs by
navigator key on a thread and streams its work and answer, and a thread reads back
([../interfaces.md](../interfaces.md)). Management, the runtime list and reading a thread call
no model. A question needs a language-model provider — without one it is refused as a
disabled feature before anything is read or streamed; without an embedding provider,
mentions are resolved by keyword. No MCP tool manages or runs a navigator.
