# Rulesets

A ruleset is a named record of one ontology holding the rules for the MCP clients of its
URL. Each rule takes away one kind of thing the lens allows — how a client may change
data, or where it may write — and [the rules](#the-rules) lists them. A ruleset that
limits nothing writes as the plain lens URL does, and reaches only the changesets started
through it.

Vocabulary: [../README.md](../README.md#rulesets). Parent relations, on which the anchor
rests: [schema-modeling.md](schema-modeling.md#parent-relations) and
[instance-data.md](instance-data.md#hierarchies). The changesets that write access
`propose` works through: [changesets.md](changesets.md).

## What it does

A person keeps a set of rulesets per ontology, each under its own key, and sets the rules
of each. A client is then configured with a ruleset mount URL naming a lens and a ruleset.
Every call through that URL is checked against the ruleset as it stands at that moment,
read afresh, so a change to a ruleset holds for every client using its URL from the next
call on. A changeset started through that URL belongs to its ruleset
([changesets.md](changesets.md#binding)).

No rule narrows reads: a ruleset mount lists, reads, searches and queries exactly as the
plain lens does.

A ruleset is not authentication ([../decisions.md](../decisions.md#scope)). It guards
against mistakes, not against a determined client, and every rule has the same two
escapes:

1. **The plain lens URL**, the ruleset mount URL without its ruleset, writes and commits
   as the lens allows.
2. **The ruleset maintenance**, available to any REST client, changes or deletes the
   ruleset.

## The record

A ruleset maps its key to one value per rule.

- **Key.** It follows the ruleset [key](../README.md) rule, at most 64 characters,
  and cannot be renamed. A key that breaks the rule is refused.
- **Its rules.** A new ruleset takes each rule's default ([below](#the-rules)), and so
  limits nothing.
- **It belongs to the ontology.** It names no lens: the same ruleset can be used through
  any lens, and what that lens shows decides only what the mount can see.
- **It is operational state, not design.** Rulesets are not part of the transfer format
  ([transfer.md](transfer.md)): they are never exported or imported, and they are deleted
  with their ontology.
- **Nothing records who uses it.** There is no view of the clients connected through a
  ruleset's URL.

### Maintenance

Rulesets are maintained without a lens, under the ontology's runtime prefix: list, read,
put and delete ([../interfaces.md](../interfaces.md#rulesets)).

- **Put** creates the ruleset or changes it, and answers the record with each rule's
  value. It sets each rule the body names and keeps the others; a new ruleset takes the
  default of each rule the body leaves out. What each rule accepts is in its own section.
- **Read and list** answer each record with each rule's value; the list is ordered by key.
- **Delete** removes the record. A client still using its URL then gets not found.
- **An unknown key is not found**, on read and delete alike. Nothing creates a ruleset but
  a put — in particular not a mount URL naming a key that does not exist.

## Ruleset mounts

A ruleset mount adds `/rulesets/{rulesetKey}` to a runtime mount URL, on MCP and as a REST
mirror of the runtime routes ([../interfaces.md](../interfaces.md#ruleset-mounts)). Every
call on it checks the ontology, then the lens, then the ruleset, reading the ruleset
afresh, so an unknown ruleset is not found on every call, reads included. Then its rules
are checked: write access first, whose refusal wins, then the anchor.

**`get_ruleset`**, and the REST mirror's root, tell the client what it may do: the
ruleset's key, then one field per rule, as that rule's section describes. The tool is
read-only, and no tool changes a ruleset: a person does, and may change it at any time,
which is why a client reads it again after a refusal.

The tools a ruleset mount lists, and their descriptions, follow its rules as they stand at
each request, so a change shows from the next request on.

## The rules

| Rule | Limits | Values | Default | Checked |
|---|---|---|---|---|
| [Write access](#write-access) | how a client may change data | `none`, `propose`, `full` | `full` | every call, on the URL it comes through |
| [Anchor](#anchor) | where in a hierarchy a client may write | one entity, or none | none | every write, and at the commit of the ruleset's changesets |

Every rule only takes away from what the lens allows, and a call must pass every rule.

## Write access

Write access limits how a client may change data. Its levels stand on one ladder, each
allowing what the one below allows and more. It holds whatever the other rules say, a
deleted anchor included.

### Write access levels

Every MCP tool and REST route of a ruleset mount needs one operation, from a closed list
the server fixes, and each level allows a fixed set of them:

| Operation | What it covers | `none` | `propose` | `full` |
|---|---|---|---|---|
| `read` | every read, list, search and query, the path read, `get_ruleset`, and the changeset reads: list, read, the staged text of a document, one entity as the changeset leaves it | ✓ | ✓ | ✓ |
| `stage` | start a changeset, stage a write into it, unstage, submit, unsubmit, discard | — | ✓ | ✓ |
| `commit` | commit a changeset | — | — | ✓ |
| `write` | every immediate write, document edits included | — | — | ✓ |

A create, update or delete of an entity or a relation is `write` without a changeset and
`stage` with one. So under `propose` a client plans its changes in changesets and submits
them, and a person commits them; under `none` it only reads.

### Where write access is checked

Every call through a ruleset mount is checked: the server reads the ruleset afresh and
compares the operation the call needs with the ruleset's level. This happens once the
ontology, the lens and the ruleset are found, and before anything else of the call, its
changeset included. A refusal is a conflict:

`Ruleset '{key}' gives write access '{level}': this connection cannot {verb}; {next step}`

| Refused operation | `{verb}` | `{next step}` under `propose` | under `none` |
|---|---|---|---|
| `write` | `write directly` | `stage the write into a changeset` | `it can only read` |
| `stage` | `start or change a changeset` | — | `it can only read` |
| `commit` | `commit` | `submit the changeset, and a person commits it` | `it can only read` |

Write access is judged on the URL of each call only, never on the ruleset a changeset was
started through. A changeset started through a `propose` ruleset is committed by a person
on the plain lens URL, as the Workbench does; a ruleset lowered to `none` still leaves its
changesets committable there.

### Write access through the interfaces

- **REST:** the ruleset's `writeAccess`, set by the maintenance put. The mirror answers or
  refuses each route by its operation.
- **MCP:** a ruleset mount lists only the tools whose operation its level allows; a level
  that stages but does not write lists the six write tools with `changeset_id` required.
  A call of a tool the level does not list, for example after the level was lowered,
  answers the refusal above. The tool count per level is in
  [../interfaces.md](../interfaces.md#mcp).
- **Web UI:** the Write access section of the Rulesets page's dialog, the level's chip on
  its row, and a line on the Connect panel.

## Anchor

The anchor points a ruleset at one entity, or at none. Writes through the ruleset's URL to
the anchor's hierarchy stay in its subtree; every other type is free. A ruleset without an
anchor does not limit where a client writes.

### The anchor's hierarchy

The **anchor's hierarchy** is the set of entity types joined by parent relations, in
either direction, to the type of the anchor's entity, together with those parent
relations. In a schema where a customer has projects and a project has tasks, an anchor at
a project has customer, project and task as its hierarchy. Every other type is **free**: a
person, a status, or the types of a separate tree are created, edited and deleted as
through the plain lens. An anchor at a type no parent relation touches has that type alone
as its hierarchy.

An entity is **covered** when it is the anchor's entity or has it among its ancestors
along the hierarchy's parent relations. The covered entities form the anchor's
**subtree**. Coverage is walked afresh on every check, so an entity moved out of the
subtree through the plain lens is outside on the next call.

The hierarchy and coverage follow the full schema, not the lens
([ontology-lenses.md](ontology-lenses.md#the-lensfull-schema-asymmetry)).

### Anchor states

Every read decides the state afresh, from the record and the ontology's full schema:

| Anchor | When | Writes through the ruleset mount |
|---|---|---|
| none (`null`) | The ruleset has no anchor | Not limited by the anchor |
| `found` | The entity is stored, under a type the schema still has | Kept in the subtree ([below](#what-is-held)) |
| `deleted` | The entity no longer exists, or its type was deleted | Every one refused |

A deleted anchor never falls back to none: deleting the anchor's entity locks its clients
out rather than setting them free.

The maintenance put sets the anchor to an entity, which must be stored under a type of the
full schema — an unknown type or entity is a field error on `anchor.type` or `anchor.id` —
or to null, which removes it. A delete racing the put can still leave the anchor deleted
at once.

### What is held

Through a ruleset whose anchor is found:

| Write | Allowed | Refused, as a field error on |
|---|---|---|
| Create an entity of a hierarchy type | with a [parent relation](instance-data.md#the-create-with-a-parent-relation) into the type whose parent is covered | `parentRelation` when missing, `parentRelation.type` for the wrong relation, `parentRelation.parentId` for a parent not covered; `entityTypeKey` when the lens shows no parent relation into the type, as for a hierarchy's top type |
| Create an entity of a free type | always, the parent relation optional | — |
| Update an entity, or edit its document | covered or free | `entityId` |
| Delete an entity | a covered or free leaf that is no ruleset's anchor | `entityId`, for an entity outside the subtree or one that is any ruleset's anchor |
| Create an ordinary relation | each end covered or free | `fromEntityId` or `toEntityId` |
| Update or delete an ordinary relation | each end covered or free | `relationId` |
| Create a parent relation of the hierarchy on its own | never: only a create with a parent relation writes one | `relationTypeKey` |
| Update a parent relation of the hierarchy | its child end covered, properties only | `relationId` |
| Delete a parent relation of the hierarchy | never: it would be half a move | `relationId` |
| Any write to a parent relation of another hierarchy | as through the plain lens | — |

The leaf-only rule holds on every mount ([instance-data.md](instance-data.md#leaf-only-deletes)).
Through a ruleset with an anchor an entity delete is checked in this order, and the first
refusal wins: outside the subtree, then the anchor of a ruleset, then has children — the
conflict every mount answers.

These refusals are collected with the write's other field errors in one validation error
and add no error code. They name only what the caller sent and the ruleset's key — never
an ancestor, a hidden type or another ruleset's key. A missing entity or relation stays
not found.

Two states refuse every write with a conflict, before the write is validated: a deleted
anchor, and an anchor's entity the lens hides. The conflict's message names only the
ruleset and the lens. At the commit of a changeset started through the ruleset, its anchor is judged
again, whichever URL the commit comes through ([changesets.md](changesets.md#binding)).

### Accepted races

Neither the parent rules nor the anchor locks anything. Three races follow, and are
accepted:

- **The parent rules** are checked once, in the service, against the cached schema. Two
  concurrent standalone parent-relation creates for the same child, or two that together
  close a cycle, can rarely both pass, and a child created while its parent is being
  deleted can rarely end up a root. A later [flag change](schema-modeling.md#parent-relations)
  reports such data. A create with a parent relation cannot hit the first two: its new
  entity has no competing parent.
- **The anchor** is read, and coverage walked, just before the write, not inside the
  write's transaction. A write can still commit when, during the call, a person moves or
  removes the anchor or deletes its entity, or a plain-lens client moves an entity out of
  the subtree. The next call sees the current state.
- **Several server instances** each check against their own cached schema
  ([../architecture.md](../architecture.md#schema-cache)).

Each write through a ruleset with an anchor costs a read of the ruleset and a walk per end
it checks, one step per level of the hierarchy.

### The anchor through the interfaces

- **`get_ruleset`** and the mirror's root give `anchor` as null without an anchor, and
  otherwise as its type, id and name, its state, whether the lens shows it, and its
  [hierarchy path](instance-data.md#the-path-read) through the lens:

  | Case | `visible` | `type`, `id`, `name` | `path` |
  |---|---|---|---|
  | `found`, the lens shows the entity's type | true | the entity's | root first, ending with the entity |
  | `found`, the lens hides the entity's type | false | null | empty |
  | `deleted` | true | null | empty |

- **MCP:** on a ruleset mount, `create_entity`'s description states the rule for
  hierarchy types. MCP flattens the field key into the error text, as for every field
  error ([../interfaces.md](../interfaces.md#errors)).
- **Web UI:** the Anchor section of the Rulesets page's dialog, with the entity picker, the
  anchor's path on its row, a line on the Connect panel, and a chip on the anchor's entity
  page.

## Through the interfaces

| | REST | MCP | Web UI |
|---|---|---|---|
| Maintain rulesets | lensless routes under the ontology's runtime prefix | — | the Workbench's Rulesets page |
| Use a ruleset | the ruleset REST mirror of the runtime routes | the ruleset mount | the Ruleset select on the Connect panel's runtime card |
| What the client may do | the mirror's root | `get_ruleset` | — |

`get_ruleset` exists only on a ruleset mount, and neither it nor `get_path` can be granted
to an [agent](agents.md).

The Workbench itself writes through the plain lens. What its Rulesets page and the Connect
panel offer is in [../product-surface.md](../product-surface.md#rulesets).
