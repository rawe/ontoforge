# Anchors

An anchor is a named record of one ontology that a person points at one entity. An MCP
client connected through the anchored URL of a runtime mount has its writes to that
entity's hierarchy held to the entity and its descendants; everything else it writes as
through the plain lens URL.

Vocabulary: [../README.md](../README.md#hierarchies-and-anchors). Parent relations, on
which every hierarchy rests: [schema-modeling.md](schema-modeling.md#parent-relations) and
[instance-data.md](instance-data.md#hierarchies).

## What it does

A person keeps a set of anchors per ontology, each under its own key, and points each one
at an entity, or at none. A client is then configured with an anchored mount URL naming a
lens and an anchor. Every write through that URL is checked, in the service just before
it is written, against the anchor as it stands at that moment, so re-pointing an anchor
redirects every client using its URL from the next call on. A write staged into a
[changeset](changesets.md#binding) through that URL is held at the changeset's commit.

An anchor is not authentication. A client configured with the plain lens URL is not held,
and nothing stops a client from being given that URL instead
([../decisions.md](../decisions.md#scope)); neither is its [staged-only
flag](changesets.md#staged-only), which has two escapes. Reads are not narrowed either: an
anchored mount lists, reads, searches and queries exactly as the plain lens does.

## The record

An anchor maps its key to an entity — its type key and id — or to nothing.

- **Key.** It follows the anchor [key](../README.md) rule, at most 64 characters,
  and cannot be renamed. A key that breaks the rule is refused.
- **Staged-only.** A flag, off for a new anchor. When on, every write through the
  anchor's URL must be staged into a changeset, and no changeset can be committed through
  it ([changesets.md](changesets.md#staged-only)). It is read before the state is judged,
  so it holds on an unanchored or dangling anchor too.
- **It belongs to the ontology.** It names no lens: the same anchor can be used through
  any lens, and what that lens shows decides only what the mount can see.
- **It is operational state, not design.** Anchors are not part of the transfer format
  ([transfer.md](transfer.md)): they are never exported or imported, and they are deleted
  with their ontology.
- **Nothing records who uses it.** There is no view of the clients connected through an
  anchor's URL.

### States

Every read decides the state afresh, from the record and the ontology's full schema:

| State | When | Writes through the anchored mount |
|---|---|---|
| `anchored` | The entity is stored, under a type the schema still has | Held to the anchored subtree ([below](#the-write-guard)) |
| `unanchored` | The record points at nothing | As through the plain lens |
| `dangling` | The entity no longer exists, or its type was deleted | Every one refused |

A dangling anchor never falls back to unanchored: deleting the anchored entity locks its
clients out rather than setting them free.

### Maintenance

Anchors are maintained without a lens, under the ontology's runtime prefix: list, read,
put and delete ([../interfaces.md](../interfaces.md#anchors)).

- **Put** creates the anchor or re-points it, and answers the record with its state in
  either case. It sets the staged-only flag when the body carries one, and otherwise keeps
  it, on a re-point or an unanchor too. It names an entity, which must be stored under a
  type of the full schema — an unknown type or entity is a field error on `entity.type` or
  `entity.id` — or nothing, which unanchors it. A delete racing the put can still leave
  the anchor dangling at once.
- **Read and list** answer each record with its state and its staged-only flag; the list
  is ordered by key.
- **Delete** removes the record. A client still using its URL then gets not found.
- **An unknown key is not found**, on read and delete alike. Nothing creates an anchor but
  a put — in particular not a mount URL naming a key that does not exist.

## Anchored mounts

An anchored mount adds `/anchors/{anchorKey}` to a runtime mount URL, on MCP and as a REST
mirror of the runtime routes ([../interfaces.md](../interfaces.md#anchored-mounts)). Every
call on it checks the ontology, then the lens, then the anchor, reading the anchor afresh,
so an unknown anchor is not found on every call, reads included.

**`get_anchor`**, and the REST mirror's root, tell the client where it stands: the
anchor's key, its state, whether it is staged-only, whether the lens shows its entity, the
entity with its name, and the entity's [hierarchy path](instance-data.md#the-path-read)
through the lens.

| Case | `visible` | `entity` | `path` |
|---|---|---|---|
| Anchored, the lens shows the entity's type | true | the entity | root first, ending with the entity |
| Anchored, the lens hides the entity's type | false | null | empty |
| Unanchored, or dangling | true | null | empty |

The tool is read-only, and no tool sets an anchor: a person does, and may change it at any
time, which is why a client reads it again after a refusal.

The mount of a staged-only anchor lists the six write tools with `changeset_id` required,
and leaves out `commit_changeset`, `edit_document` and `write_document`, which could only
be refused there; the anchor is read on every request, so turning the flag on or off
changes the tool set from the next one.

## The write guard

### The anchor's hierarchy

The **anchor's hierarchy** is the set of entity types joined by parent relations, in
either direction, to the anchored entity's type, together with those parent relations.
In a schema where a customer has projects and a project has tasks, an anchor at a project
has customer, project and task as its hierarchy. Every other type is **free**: a person,
a status, or the types of a separate tree are created, edited and deleted as through the
plain lens. An anchor at a type no parent relation touches has that type alone as its
hierarchy.

An entity is **covered** when it is the anchored entity or has the anchored entity among
its ancestors along the hierarchy's parent relations. The covered entities form the
**anchored subtree**. Coverage is walked afresh on every check, so an entity moved out of
the subtree through the plain lens is outside on the next call.

The hierarchy and coverage follow the full schema, not the lens
([ontology-lenses.md](ontology-lenses.md#the-lensfull-schema-asymmetry)).

### What is held

On an anchored mount whose anchor is anchored:

| Write | Allowed | Refused, as a field error on |
|---|---|---|
| Create an entity of a hierarchy type | with a [parent relation](instance-data.md#the-create-with-a-parent-relation) into the type whose parent is covered | `parentRelation` when missing, `parentRelation.type` for the wrong relation, `parentRelation.parentId` for a parent not covered; `entityTypeKey` when the lens shows no parent relation into the type, as for a hierarchy's top type |
| Create an entity of a free type | always, the parent relation optional | — |
| Update an entity, or edit its document | covered or free | `entityId` |
| Delete an entity | a covered or free leaf no anchor points at | `entityId`, for an entity outside the subtree or one any anchor points at |
| Create an ordinary relation | each end covered or free | `fromEntityId` or `toEntityId` |
| Update or delete an ordinary relation | each end covered or free | `relationId` |
| Create a parent relation of the hierarchy on its own | never: only a create with a parent relation writes one | `relationTypeKey` |
| Update a parent relation of the hierarchy | its child end covered, properties only | `relationId` |
| Delete a parent relation of the hierarchy | never: it would be half a move | `relationId` |
| Any write to a parent relation of another hierarchy | as through the plain lens | — |

The leaf-only rule holds on every mount ([instance-data.md](instance-data.md#leaf-only-deletes)).
On an anchored mount an entity delete is checked in this order, and the first refusal
wins: outside the subtree, then pointed at by an anchor, then has children — the conflict
every mount answers.

Guard refusals are collected with the write's other field errors in one validation error
and add no error code. They name only what the caller sent and the anchor's key — never an
ancestor, a hidden type or another anchor's key. A missing entity or relation stays not
found.

Two states refuse every write with a conflict, before the write is validated: a dangling
anchor, and an anchored entity the lens hides — a message naming only the anchor and the
lens. An unanchored anchor holds nothing.

### Accepted races

Neither the parent rules nor the guard locks anything. Three races follow, and are
accepted:

- **The parent rules** are checked once, in the service, against the cached schema. Two
  concurrent standalone parent-relation creates for the same child, or two that together
  close a cycle, can rarely both pass, and a child created while its parent is being
  deleted can rarely end up a root. A later [flag change](schema-modeling.md#parent-relations)
  reports such data. A create with a parent relation cannot hit the first two: its new
  entity has no competing parent.
- **The guard** reads the anchor and walks coverage just before the write, not inside the
  write's transaction. A write can still commit when, during the call, a person re-points
  or unanchors the anchor or deletes its entity, or a plain-lens client moves an entity
  out of the subtree. The next call sees the current state.
- **Several server instances** each check against their own cached schema
  ([../architecture.md](../architecture.md#schema-cache)).

Each anchored write costs an anchor read and a walk per end it checks, one step per level
of the hierarchy.

## Through the interfaces

| | REST | MCP | Web UI |
|---|---|---|---|
| Maintain anchors | lensless routes under the ontology's runtime prefix | — | the Workbench's Anchors page |
| Use an anchor | the anchored REST mirror of the runtime routes | the anchored runtime mount | the Anchor select on the Connect panel's runtime card |
| Where the client stands | the mirror's root | `get_anchor` | — |

`get_anchor` exists only on an anchored mount, and neither it nor `get_path` can be
granted to an [agent](agents.md). On an anchored mount, `create_entity`'s description also
states the rule for hierarchy types. MCP flattens the field key into the error text, as
for every field error ([../interfaces.md](../interfaces.md#errors)).

The Workbench itself writes through the plain lens. What its Anchors page and the Connect
panel offer is in [../product-surface.md](../product-surface.md#anchors).
