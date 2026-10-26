# Changesets

A changeset holds runtime writes of one lens that are staged over any length of time and
then committed together: all of them persist, or none does. A client plans a change of
many objects — a move, a subtree delete, a nested create — can hand the plan over with a
note, and a person commits it after reviewing it.

Vocabulary: [../README.md](../README.md#changesets). The writes it stages:
[instance-data.md](instance-data.md) and [documents.md](documents.md#partial-writes).

## What it does

A changeset is the set of what its commit will apply to the stored data: one **staged
object** per entity or relation it touches, with its action — create, update or delete —
and per property of that object at most one **staged value**. It keeps no history of the
calls that built it.

A changeset is started through a runtime mount, and each later call stages its write into
it instead of writing: nothing changes yet, the call is merged into the set, and it
answers the id of the object it staged. Staging holds nothing between calls. The commit
applies every staged object in one database transaction, validates the end state, and
persists all of it or nothing.

**Reads never see staged data.** Every read, list, search and query answers the stored
data alone; a changeset's plan is seen only through the changeset's own reads
([below](#the-review)). A write without a changeset is written at once, unless the
[write access](rulesets.md#write-access) of the URL's ruleset refuses it.

### States

| State | What it allows |
|---|---|
| `draft` | stage, unstage, cut, rebase, check, submit, commit, discard |
| `submitted` | check, unsubmit, commit; it is frozen for everything else |

A changeset starts as a draft. After a commit or a discard it is gone, and every call
naming it answers not found — the same answer as for an id that never existed, one that
expired, or one bound elsewhere ([below](#binding)). A rejected commit leaves it exactly as
it was.

Every changeset has a `version`, which every change of its content or state raises: a
staged call that changes the set, an unstage, a cut, a rebase, a submit, an unsubmit. A
staged call that changes nothing keeps it.

Every changeset has a **number** that people call it by: one more than the highest number
among its lens's changesets when it starts, or 1, whichever ruleset it is started through.
Numbers are not unique over time: once the highest is committed or discarded, the next
start gets it again. Nothing looks a changeset up by its number; every call names the id.

## Staging

Seven calls can be staged, with the values of their immediate counterparts: create, update
and delete of an entity, and of a relation, and a
[partial document write](documents.md#partial-writes). Beside them a [put](#put) stages a
create or an update, whichever the data calls for. Each is merged into the set:

| Call | What it does to the set |
|---|---|
| Create | Adds a create object with one value per property sent. A create with its [parent relation](instance-data.md#the-create-with-a-parent-relation) adds the relation's create object too. |
| Update of a stored object | Adds an update object if none is staged, and writes one value per key sent, a null removing the property; a key sent again replaces its value. |
| Update of an object created here | Merges into the create's values; a null takes that value out. |
| Delete of a stored object | Makes its object a delete and drops its staged values. |
| Delete of an object created here | Takes the object out of the set. |
| Document edit | Applies the edit to the property's staged text, or else to the stored one — empty on an entity created here without it — and stages the whole result as the property's value, as an update does. |

An entity delete also takes out every staged relation at that entity, which the store
would delete with it, and answers their ids. An update, delete or document edit of an
object this changeset deletes is refused as the immediate write refuses a missing target.

- **Identities resolve at staging.** A call may name an entity by its
  [identity](entity-identity.md#in-a-changeset) wherever it may name it by id. The
  identity is resolved once, in the changeset's view — an entity created, renamed or
  deleted here counts as this changeset leaves it — and the staged object holds the id.
  An identity two entities hold in that view is refused as a conflict.
- **Ids are final.** A staged create gets its id at staging, and it keeps it when
  committed. Later calls of the same changeset may name it: an update or delete of the
  created entity, a relation to it, a create beneath it.
- **One text per document.** A staged document value is always the whole text: the text a
  create or update sends, or the text an edit leaves. Each later edit applies to it.
- **Before.** The first time a changeset touches a key of a stored entity or relation, the
  stored value of that key is recorded as the value's before, an absent key distinct from
  null, a document by its hash and length. Staging never refreshes it: a later call
  sending the key again keeps it, and only a [rebase](#unstage-cut-and-rebase) replaces
  it. A value of a create has no before, and a delete has no values.
- **What staging checks:** that the changeset is a draft, that the anchor of the URL's
  ruleset is neither deleted nor an entity the lens hides ([below](#binding)), that the
  type is visible through the lens, the property values exactly as the immediate write
  does — every fault collected, with the same field errors — a document edit as the
  immediate edit does, against the text it applies to, and that the target of an update,
  delete or document edit exists, created by this changeset or else stored, and not
  deleted by it.
- **What waits for the commit:** relation ends, the
  [parent rules](instance-data.md#the-parent-rules), leaf-only deletes and the anchor's
  subtree. Defaults are applied at the commit, from the full schema as it is then.
- **One change at a time.** A staged call is merged into the changeset as it read it: one
  changed in between refuses the call as a conflict, with nothing staged, and the call can
  be sent again.

### Put

A put names what it writes by what identifies it, and becomes an ordinary create or update
at staging. It exists only in a changeset; an immediate write is always an explicit create
or update.

- **An entity put** sends a type and values, and the values build the entity's
  [identity](entity-identity.md). The entity that has that identity in the changeset's
  view is updated, or else a new one is created. A type whose whole identity the lens does
  not show, or values that build no identity, are refused with the create's field errors.
- **A relation put** sends a type, both ends by id or identity, and values, on a relation
  type that is [one per pair](schema-modeling.md#one-per-pair); on any other type it is
  refused. The relation that links the pair in the changeset's view, stored and not
  deleted here or created here, is updated, or else one is created.
- **As an update,** a put keeps the keys it does not send, and a null removes a value.
- **The set holds what it became.** The answer says which, as `action` `create` or
  `update`; the review, the check and the commit see an ordinary create or update. An
  identity or pair another write takes after staging is caught by the commit, as for any
  create.

### Many calls in one request

A staging request may list up to 1,000 calls instead of one. They are staged in list order,
so a later call may name an entity an earlier one creates, by id or by identity, and whole
or not at all: every call is checked, and if any fails nothing is staged and the refusal
names each failed call by its index in the list, with its own error. A refusal of the
changeset itself — not found, submitted, full, changed in between — refuses the request as
it refuses one call. The answer lists each call's answer in list order. Each call counts
toward the changeset's [limits](#limits); a larger import commits in several changesets.

### Unstage, cut and rebase

Three calls change a draft changeset by the id of a staged object:

- **Unstage** takes the object out with all its values. Unstaging a delete brings back
  nothing the delete dropped.
- **Cut** takes one staged value out; an update left without values goes too.
- **Rebase** accepts the stored values now, for an update of a stored object: the before
  of each value it names — all of them by default — becomes the stored value now, and the
  staged values stay. A create or a delete is refused as a conflict; a key without a
  staged value, or a target that is gone, is not found.

Nothing cascades: a staged relation at an entity whose create was unstaged is
[dangling](#commit-validation), and a create cut short of a required value fails
`replay`, until they are fixed too. **Discard** deletes a draft changeset with all its
staged objects.

## The commit

The commit persists the whole changeset or nothing. It takes, optionally, the version the
caller looked at; another version is refused as a conflict before the changeset is
checked.

1. **The lock-free pass**, holding nothing: every staged object and value is checked
   against the lens and the stored data as they are now. Any fault rejects the commit here.
2. **The lock.** The ontology's commit lock, then the changeset itself. One commit runs per
   ontology at a time: a second answers a conflict at once rather than wait. Immediate
   writes take no such lock. A changeset changed since the pass answers a conflict.
3. **Drift and the anchor, under the lock.** Every stored target of an update or delete is
   locked and the current values of an update's staged keys compared with their befores
   again; on a changeset started through a ruleset, the ruleset is read afresh and its
   anchor judged before anything is applied.
4. **The phases.** The staged objects are applied in a fixed order: entity creates, entity
   updates, relation deletes, relation creates, relation updates, entity deletes. Each
   phase is written in batches of up to 1,000 objects, each batch a few statements, each
   object checked as the immediate write checks it and queuing the search work the
   immediate write would. A delete whose target is already gone counts as done and is listed in the
   answer as already gone. An object that cannot be applied stops the commit.
5. **Commit validation** over the end state, identities included, then the staged objects are deleted with the
   changeset, and everything persists at once.

An identity another write took after the pass is caught when everything persists: the
commit is refused as a conflict, "An identity was taken meanwhile; nothing was persisted.
Check and commit again", and the changeset is kept as it was. A check runs that last
identity test before it rolls back, so it reports such a clash as `duplicate_identity`.

A relation create of a [one-per-pair](schema-modeling.md#one-per-pair) type takes its
pair's lock in the phases, as the immediate create does, the locks of a batch in one fixed order, after the relation deletes ran:
a pair this changeset frees is free, and one another write linked after the pass is a
`duplicate_pair` violation that stops the commit.

The commit answers how many staged objects it committed and the ids of the deletes already
gone. A rejected commit persists nothing, keeps the changeset, its state and its version,
and lists the violations of the step that rejected it, at most 100 with their total. Each
names the staged object it sits on, and the property when it concerns one value; those on
the whole changeset come first, then the others in the order the checks find them.

### The check

A **check** runs the commit's own steps on a draft or a submitted changeset, all five, and
then rolls everything back instead of persisting. It answers what a commit of that version
would — the number of staged objects and the deletes already gone, or the same violations —
with the version it checked, and it changes nothing: neither the data and its search work,
nor the changeset's state, version or last change. It holds the commit lock while it runs
and counts as a running commit. A commit after a check can still differ when the data or
the changeset change meanwhile.

### Commit validation

| Kind | When |
|---|---|
| `not_visible` | The object's type, or a property it sets, is no longer visible through the lens |
| `replay` | A value the lens no longer accepts, a value a create requires that is missing, an update's values that over the stored ones now make no [identity](entity-identity.md#in-a-changeset), or an object that could not be applied |
| `missing` | The stored target of an update is gone |
| `dangling` | An end of a staged relation create is neither stored nor created in this changeset, or an end of a staged relation is deleted in it |
| `drift` | The current value of an update's key differs from its before |
| `duplicate_identity` | An entity the changeset gives an [identity](entity-identity.md#in-a-changeset) would share it with another entity after the commit |
| `duplicate_pair` | A relation the changeset creates of a [one-per-pair](schema-modeling.md#one-per-pair) type would link the same source and target as another relation of the type after the commit: a stored one the changeset does not delete, or another staged create |
| `has_children` | A deleted entity still has children that the changeset neither deleted nor moved |
| `hidden_relations` | A deleted entity has relations of a type the lens does not show ([delete](instance-data.md#entities)) |
| `endpoint_type` | A relation end exists with the wrong entity type |
| `two_parents`, `cycle` | A parent link the changeset creates breaks the [parent rules](instance-data.md#the-parent-rules) |
| `outside_subtree` | On a changeset whose ruleset has an anchor, an entity of the anchor's hierarchy outside its [subtree](rulesets.md#the-anchors-hierarchy), before or after the commit |
| `deletes_anchor` | On a changeset whose ruleset has an anchor, a delete of an entity that is a ruleset's anchor |
| `ruleset_gone` | The changeset's ruleset was deleted; on the whole changeset |
| `anchor_deleted` | The entity of its ruleset's anchor no longer exists, or its type was deleted; on the whole changeset |
| `anchor_hidden` | The entity of its ruleset's anchor is one the lens hides; on the whole changeset |

The first seven are the lock-free pass's, and they are also what submit and every read of
a changeset's objects report. `drift` and `replay` sit on the value they concern, and a
missing required value on its object; the others sit on the object. A property the lens
hides is `not_visible` on its object and is never named. A violation's message names only
what the lens shows — never an id, a hidden type, a child, or another ruleset's key; the
review read carries the names. The parent rules are the immediate write's, judged once
over the end state, so a plan may pass through states that break them.

### Drift

Current values that differ from before reject the commit: a staged rename of P2 has
before "P2" and after "P2 Website"; once a person renames P2 to "P2 Mobile", its current is
"P2 Mobile", which is `drift`, and the commit persists nothing. A value changed and changed
back is no drift, and a key the changeset does not stage is not compared. Compare before
and current, then rebase the value to keep it over the change, or cut it. Under the lock
the targets are compared again, so a change that lands while the commit waits is caught
too.

### Waits

Writes to rows a commit has locked wait for it; the commit waits at most five seconds for
a row someone else holds, and then answers a conflict with nothing persisted. Every call
that changes a changeset whose commit runs answers a conflict at once.

## Binding

A changeset is bound to the lens it was started through, and to the ruleset of that URL,
if any.

- **The plain lens URL reaches every changeset of its lens**; a ruleset's URL only those
  started through that ruleset, even when it limits nothing. Through another lens, or
  another ruleset's URL, a changeset is not found.
- **Write access follows the URL of each call**, never the changeset's ruleset
  ([rulesets.md](rulesets.md#where-write-access-is-checked)).
- **The commit judges the anchor of the changeset's ruleset**, whichever URL it comes
  through: committed through the plain lens URL, its staged objects must still stay in
  the anchor's subtree.
- **The anchor's state.** When the anchor of a changeset's ruleset is deleted, or is an
  entity the lens hides, staging through the ruleset's URL and submit answer a conflict,
  and the commit rejects with `anchor_deleted` or `anchor_hidden`; unstage, cut, rebase,
  unsubmit and discard still work. Whether the staged objects stay in the subtree is
  judged by the commit and a check only.
- **A ruleset deleted** makes its URL answer not found; its changesets stay reachable
  through the plain lens URL, and their commit rejects with `ruleset_gone`.
- **A lens deleted** deletes its changesets, draft and submitted, and reports how many
  ([ontology-lenses.md](ontology-lenses.md#what-a-lens-is)).

Changesets are operational state, not design: they are not part of the
[transfer format](transfer.md), and they are deleted with their lens or their ontology.

## The review

**Submit** runs the lock-free pass and, when it finds no fault, freezes the changeset and
hands it over, with an optional note that replaces the stored one. A fault leaves it a
draft and lists the violations. While submitted, staging, unstaging, cutting, rebasing and
discarding are refused as a conflict.

**Unsubmit** makes it a draft again, from whoever calls it, with a required note that
replaces the stored one — the way to send a plan back, or to turn it down before
discarding it.

A [check](#the-check) shows the client before it submits, and the reviewer before they
commit, everything the commit would find, the parent rules and the anchor included.

**Committing a submitted changeset is the approval.** The reviewer commits with the version
they looked at, so a plan changed since then is refused rather than committed unseen. A
rejected commit leaves it submitted. A submitted changeset never expires and cannot be
discarded, so one that vanished was committed — or its lens was deleted.

**What a reviewer sees**, through the lens as it is now, on every read:

- **the list** of the lens's changesets — or the ruleset's, through its URL —
  by number, lowest first, each with its number, state, version, note, ruleset, number of
  staged objects, counts per operation — the action and kind of each object, such as
  `create_entity` — and the type keys it names that the lens shows, with a count of the
  others;
- **the staged objects** in the order the changeset first touched them, paged, each with
  its action, the name of the entity or the names of the relation's ends, the identity
  it gives an entity (before and after, when it sets or changes one), its values —
  an update's before, current and after, a create's after — and the lock-free pass's
  faults as markers, on the value or on the object they concern:
  `drift`, `dangling`, `missing`, `not_visible`, `replay`, `duplicate_identity`,
  `duplicate_pair`;
- **the staged text of a document property**: its staged value, the text a commit would
  leave, on an entity stored or created by the changeset, whole or by character range, as
  a [document is read](documents.md#reading-a-slice). When nothing is staged for it, or
  the changeset deletes the entity, it is not found.
- **one entity as the changeset leaves it**, by id or by identity in the changeset's
  view: a stored entity, or one the changeset
  creates, with its staged values applied, before defaults, and marked deleted when the
  changeset deletes it; beside it its staged object, as the review shows it, markers
  included. Staged relations at it are not part of it. An entity neither stored nor
  created by the changeset is not found.

An object whose type the lens no longer shows is reduced to its id, kind, action, first
touch and markers; its id is what unstages it. A property the lens hides is left out, and
its staged text is not found; a document value is shown only by its length.

## Limits

- **An object cap** per changeset, set in the server's
  [configuration](../../README.md#configuration), by default 10,000 staged objects; a call
  that would add more is refused as a conflict.
- **A byte cap** per changeset, set in the server's
  [configuration](../../README.md#configuration): its staged values count as the UTF-8
  bytes of their JSON, the value and its before, document text included, and a call that
  would add bytes past the cap is refused as a conflict.
- **Expiry.** A draft changeset unchanged for 7 days is deleted. Every change of it, and a
  rejected commit, counts as a change; a submitted changeset never expires.
- **The note** is at most 1,000 characters.
- **One commit runs at a time in one server process**, a check counted as one; a second
  answers a conflict at once, holding nothing.

Each staged call reads its target once. Submit runs the lock-free pass over the whole
changeset, with no lock; the read of a changeset's objects judges the objects of its page
with the staged objects at their relation ends, as the read of one entity judges that
entity's object. No check reads the text of a stored document — drift compares its hash —
and only a staged document edit reads it, as the text it applies to. A commit holds one
database connection for its whole run, and every row it touches waits as long.

## Not possible

- Turning a plan down without a trace: a submitted changeset is unsubmitted with a note.
- The history of the calls that built a changeset, merging changesets, or a sign that two
  changesets touch the same object.
- Users, assignment, comments or notifications.
- A record of a commit, or undo.
- Reviewing through another lens.
- Staged data in reads.

## Through the interfaces

| | REST | MCP | Web UI |
|---|---|---|---|
| Start, list, read, unstage, cut, rebase, check, submit, unsubmit, commit, discard | routes under `changesets` of a runtime mount | eleven changeset tools | the Workbench's Changesets page: start, list, review with the staged text of a document, remove an object, cut a value, accept current, check, submit, unsubmit, commit, discard; an entity's page, as the pinned changeset leaves it |
| Stage | `writes` of one changeset | the six write tools and the two document tools with `changeset_id` | the Workbench's writes while a changeset is pinned, except the Explorer canvas's |

Routes and tools: [../interfaces.md](../interfaces.md#changesets). No MCP tool reads one
entity as the changeset leaves it. An MCP mount keeps no changeset of its own: every call
names one by `changeset_id`, and a call that forgets it writes immediately, unless the
ruleset's [write access](rulesets.md#write-access-through-the-interfaces) requires
`changeset_id`. In the Workbench a person pins a
draft, and the Workbench's writes stage into it until they leave it
([../product-surface.md](../product-surface.md#changesets)).
