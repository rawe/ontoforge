# Changesets

A changeset holds runtime writes of one lens that are staged over any length of time and
then committed together: all of them persist, or none does. A client plans a change of
many objects — a move, a subtree delete, a nested create — can hand the plan over with a
note, and a person commits it after reviewing it.

Vocabulary: [../README.md](../README.md#changesets). The writes it stages:
[instance-data.md](instance-data.md).

## What it does

A changeset is started through a runtime mount, and each later call stages its write into
it instead of writing: nothing changes yet, and the call answers the seq and id of what it
staged. Staging holds nothing between calls; each call appends to the journal.
The commit replays every staged write by seq in one database transaction, validates the
end state, and persists all of it or nothing.

**Reads never see staged data.** Every read, list, search and query answers the stored
data alone; a changeset's plan is seen only through the changeset's own reads
([below](#the-review)). A write without a changeset is written at once, unless the
[write access](rulesets.md#write-access) of the URL's ruleset refuses it.

### States

| State | What it allows |
|---|---|
| `draft` | stage, unstage, submit, commit, discard |
| `submitted` | unsubmit, commit; it is frozen for everything else |

A changeset starts as a draft. After a commit or a discard it is gone, and every call
naming it answers not found — the same answer as for an id that never existed, one that
expired, or one bound elsewhere ([below](#binding)). A rejected commit leaves it exactly as
it was.

Every changeset has a `version`, which every change of its content or state raises: a
staged or unstaged write, a submit, an unsubmit. A seq is higher than every seq the
changeset had before, so it is never reused, and seqs may skip numbers.

## Staging

Six writes can be staged, with the values of their immediate counterparts: create, update
and delete of an entity, and of a relation. A create may carry its
[parent relation](instance-data.md#the-create-with-a-parent-relation): **it is staged as
two writes**, the entity's create and then its parent relation's, by consecutive seqs; the
relation is a staged relation like any other.

- **Ids are final.** A staged create gets its id at staging, and it keeps it when
  committed. Later writes of the same changeset may name it: an update or delete of the
  created entity, a relation to it, a create beneath it.
- **Document values only whole.** A document property is staged as a whole new value,
  through a create or an update. [Partial document writes](documents.md#partial-writes)
  cannot be staged.
- **Before.** A staged update of a stored entity or relation records the stored values of
  the keys it sends, an absent key distinct from null, as its before. An update of an object
  this changeset creates has no before, and neither has a delete.
- **What staging checks:** that the changeset is a draft, that the anchor of the URL's
  ruleset is neither deleted nor an entity the lens hides ([below](#binding)), that the
  type is visible through the lens, the property values exactly as the immediate write
  does — every fault collected, with the same field errors — and that the target of an
  update or delete exists, stored or created by a staged create of this changeset.
- **What waits for the commit:** relation ends, the
  [parent rules](instance-data.md#the-parent-rules), leaf-only deletes and the anchor's
  subtree. Defaults are applied at the commit, from the full schema as it is then.

**Unstage** removes one staged write by its seq. Unstaging a create leaves the later writes
that name its id [dangling](#commit-validation). **Discard** deletes a draft changeset with
all its staged writes.

## The commit

The commit persists the whole changeset or nothing. It takes, optionally, the version the
caller looked at; another version is refused as a conflict before the changeset is
checked.

1. **The lock-free pass**, holding nothing: every staged write is checked against the lens
   and the stored data as they are now. Any fault rejects the commit here.
2. **The lock.** The ontology's commit lock, then the changeset itself. One commit runs per
   ontology at a time: a second answers a conflict at once rather than wait. Immediate
   writes take no such lock. A changeset changed since the pass answers a conflict.
3. **Drift and the anchor, under the lock.** Every stored target of an update or delete is
   locked and its current values compared with its before again; on a changeset started
   through a ruleset, the ruleset is read afresh and its anchor judged before the replay.
4. **The replay**, by seq, through the same store writes as the immediate path, each with
   its search work. A delete whose target is already gone counts as done and is listed in
   the answer as already gone. A write that cannot be replayed stops the replay.
5. **Commit validation** over the end state, then the staged writes are deleted with the
   changeset, and everything persists at once.

The commit answers how many staged writes it committed and the seqs of those already gone.
A rejected commit persists nothing, keeps the changeset, its state and its version, and
lists the violations of the step that rejected it, ordered by seq, at most 100 with their
total.

### Commit validation

| Kind | When |
|---|---|
| `not_visible` | The write's type or a property it sets is no longer visible through the lens |
| `replay` | A value the lens no longer accepts, or a write that could not be replayed |
| `missing` | The stored target of an update is gone |
| `dangling` | An id the write names is neither stored nor created by a staged write still in the changeset |
| `drift` | The current values of an update's patched keys differ from its before |
| `has_children` | A deleted entity still has children that the changeset neither deleted nor moved |
| `endpoint_type` | A relation end exists with the wrong entity type |
| `two_parents`, `cycle` | A parent link the changeset creates breaks the [parent rules](instance-data.md#the-parent-rules) |
| `outside_subtree` | On a changeset whose ruleset has an anchor, an entity of the anchor's hierarchy outside its [subtree](rulesets.md#the-anchors-hierarchy), before or after the commit |
| `deletes_anchor` | On a changeset whose ruleset has an anchor, a delete of an entity that is a ruleset's anchor |
| `ruleset_gone` | The changeset's ruleset was deleted; seq 0, the whole changeset |
| `anchor_deleted` | The entity of its ruleset's anchor no longer exists, or its type was deleted; seq 0 |
| `anchor_hidden` | The entity of its ruleset's anchor is one the lens hides; seq 0 |

The first five are the lock-free pass's, and they are also what submit and every read of
a changeset's writes report. A violation names only what the write sent and the lens shows — never
an id, a hidden type, a child, or another ruleset's key; its seq names the write, and the review
read carries the ids. The parent rules are the immediate write's, judged
once over the end state, so a plan may pass through states that break them.

### Drift

Current values that differ from before reject the commit: a staged rename of P2 has
before "P2" and after "P2 Website"; once a person renames P2 to "P2 Mobile", its current is
"P2 Mobile", which is `drift`, and the commit persists nothing. A value changed and changed
back is no drift, and a key the write does not send is not compared. Compare before and
current, and restage only if your change still applies. Under the lock the targets are
compared again, so a change that lands while the commit waits is caught too.

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
  through: committed through the plain lens URL, its writes must still stay in the
  anchor's subtree.
- **The anchor's state.** When the anchor of a changeset's ruleset is deleted, or is an
  entity the lens hides, staging through the ruleset's URL and submit answer a conflict,
  and the commit rejects with `anchor_deleted` or `anchor_hidden`; unstage, unsubmit and
  discard still work. Whether the writes stay in the subtree is judged at the commit only.
- **A ruleset deleted** makes its URL answer not found; its changesets stay reachable
  through the plain lens URL, and their commit rejects with `ruleset_gone`.
- **A lens deleted** deletes its changesets, draft and submitted, and reports how many
  ([ontology-lenses.md](ontology-lenses.md#what-a-lens-is)).

Changesets are operational state, not design: they are not part of the
[transfer format](transfer.md), and they are deleted with their lens or their ontology.

## The review

**Submit** runs the lock-free pass and, when it finds no fault, freezes the changeset and
hands it over, with an optional note that replaces the stored one. A fault leaves it a
draft and lists the violations. While submitted, staging, unstaging and discarding are
refused as a conflict.

**Unsubmit** makes it a draft again, from whoever calls it, with a required note that
replaces the stored one — the way to send a plan back, or to turn it down before
discarding it.

**Committing a submitted changeset is the approval.** The reviewer commits with the version
they looked at, so a plan changed since then is refused rather than committed unseen. A
rejected commit leaves it submitted. A submitted changeset never expires and cannot be
discarded, so one that vanished was committed — or its lens was deleted.

**What a reviewer sees**, through the lens as it is now, on every read:

- **the list** of the lens's changesets — or the ruleset's, through its URL —
  submitted first, then by last change, each with its state, version, note, ruleset,
  counts per operation, and the type keys it names that the lens shows, with a count of
  the others;
- **the writes by seq**, paged, each with the names of what it touches, an update's
  before, current and after values of the keys it sends, a create's values, and the
  lock-free pass's faults on it as markers:
  `drift`, `dangling`, `missing`, `not_visible`, `replay`;
- **the staged text of a document property**: the text a commit would leave, from the
  last staged write of the changeset that sets it — a create or an update, of an entity
  the changeset creates too — whole or by character range, as a
  [document is read](documents.md#reading-a-slice). When no staged write sets it, or a later
  one deletes the entity, it is not found.
- **one entity as the changeset leaves it**: a stored entity, or one the changeset
  creates, with the changeset's creates and updates of it applied by seq, before
  defaults, and marked deleted when its last staged write deletes it; beside it those
  writes, as the writes by seq show them, markers included. Writes of relations that name
  it are not among them. An entity neither stored nor created by the changeset is not
  found.

A write is shown by what it changes, not by the arguments it was staged with. A write
whose type the lens no longer shows is reduced to its seq, operation, time and markers; a
type or property the lens hides is left out, and its staged text is not found; a document
value is shown only by its length.

## Limits

- **At most 10,000 staged writes** per changeset; the next is refused as a conflict.
- **A byte cap** per changeset, set in the server's
  [configuration](../../README.md#configuration): its staged writes count as the UTF-8
  bytes of their JSON, the arguments and the recorded value before, document text included,
  and the write that would pass the cap is refused as a conflict.
- **Expiry.** A draft changeset unchanged for 7 days is deleted. Every change of it, and a
  rejected commit, counts as a change; a submitted changeset never expires.
- **The note** is at most 1,000 characters.
- **One commit runs at a time in one server process**; a second answers a conflict at
  once, holding nothing.

Each staged update reads its target once. Submit runs the lock-free pass over the whole
changeset, with no lock; the read of a changeset's writes judges the writes of its page
alone, as the read of one entity judges that entity's writes. No check reads the text
of a stored document: drift compares its hash. A commit holds one database connection
for its whole run, and every row it touches waits as long.

## Not possible

- Graph-rule faults before the commit: submit reports only the lock-free pass's.
- Turning a plan down without a trace: a submitted changeset is unsubmitted with a note.
- Editing or reordering a staged write in place, merging changesets, or a sign that two
  changesets touch the same object.
- Users, assignment, comments or notifications.
- A record of a commit, or undo.
- Reviewing through another lens.
- Partial document edits.
- Staged data in reads.

## Through the interfaces

| | REST | MCP | Web UI |
|---|---|---|---|
| Start, list, read, unstage, submit, unsubmit, commit, discard | routes under `changesets` of a runtime mount | nine changeset tools | the Workbench's Changesets page: start, list, review with the staged text of a document, unstage, submit, unsubmit, commit, discard; an entity's page, as the pinned changeset leaves it |
| Stage | `writes` of one changeset | the six write tools with `changeset_id` | the Workbench's writes while a changeset is pinned, except the Explorer canvas's |

Routes and tools: [../interfaces.md](../interfaces.md#changesets). No MCP tool reads one
entity as the changeset leaves it. An MCP mount keeps no changeset of its own: every call
names one by `changeset_id`, and a call that forgets it writes immediately, unless the
ruleset's [write access](rulesets.md#write-access-through-the-interfaces) requires
`changeset_id`. In the Workbench a person pins a
draft, and the Workbench's writes stage into it until they leave it
([../product-surface.md](../product-surface.md#changesets)).
