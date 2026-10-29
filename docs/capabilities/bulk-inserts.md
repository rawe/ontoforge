# Bulk inserts

How a client — an agent, a script, an import — writes many entities and relations in one
go. A bulk insert is not a write path of its own: it fills [changesets](changesets.md)
with staging requests that each list many calls, names entities by their
[identity](entity-identity.md), and commits in chunks. This page is the recipe; the rules
it follows stay in those two documents: [puts](changesets.md#put),
[staging many calls](changesets.md#many-calls-in-one-request), and
[changeset limits](changesets.md#limits), along with the identity rules.

Vocabulary: [glossary](../glossary.md#changesets). Routes:
[../interfaces/](../interfaces/runtime-rest.md#changesets).

## When to use it

A bulk insert fits a load of hundreds of objects or more, and any load that runs again
later. A handful of objects is simpler as immediate writes
([instance-data.md](instance-data.md)).

It needs:

- **The runtime REST mount.** Only REST takes a [list of calls](changesets.md#many-calls-in-one-request)
  and the [puts](changesets.md#put). An MCP client stages one call per tool call, with
  `changeset_id`, and has no put.
- **A lens that shows what is written**, every type and property; a put also needs the
  type's whole identity shown ([entity-identity.md](entity-identity.md#through-a-lens)).
- **Leave to stage**, and to commit or someone who commits: write access `full` commits
  itself, `propose` submits for a person ([rulesets.md](rulesets.md#write-access-levels));
  with authentication on, the lens role Writer or Proposer
  ([authentication.md](authentication.md)).

## Before the load

Read the lens schema, `GET …/schema`, once. Its types decide which call each record takes,
and so what a second run of the load does:

| The type | Staged as | A second run |
|---|---|---|
| Entity type with `identityProperties` | `put_entity` | updates the entity with that identity |
| Entity type without | `create_entity` | creates it again |
| Relation type that is [one per pair](schema-modeling.md#one-per-pair) | `put_relation` | updates the relation that links the pair |
| Any other relation type | `create_relation` | creates it again |

Where reruns matter, give the entity types an identity and the plain link types one per
pair before the first load ([schema-modeling.md](schema-modeling.md#the-identity)).

## The load

1. **Start a changeset**, `POST …/changesets`, with a note that names the source.
2. **Stage the entities**, `POST …/changesets/{id}/writes` with a list of calls. Each answer
   carries the staged object's id and, for a put, `action` `create` or `update`.
3. **Stage the relations** after their ends. Name each end by identity
   (`fromEntityIdentity`, `toEntityIdentity`), or by the id an entity's answer carried. An
   end staged earlier in the same changeset, even in the same request, is found
   ([entity-identity.md](entity-identity.md#in-a-changeset)).
4. **Commit**, `POST …/changesets/{id}/commit`, when the changeset is full or the load is
   done; with write access `propose`, submit it instead ([below](#with-review)). Then start
   the next changeset and go on.
5. **Remove what the source dropped**, if the load must. Nothing removes a record a batch
   does not name: list what is stored, filtered on `_identity`
   ([instance-data.md](instance-data.md)), and stage `delete_entity` by `identity`.

## Chunks

A load is cut at two sizes:

- **The request:** at most 1,000 calls, and a body under the server's
  [`REQUEST_BODY_LIMIT`](../../README.md#configuration). A larger body is refused with `413`
  and nothing staged; split the list and send both halves.
- **The changeset:** its [limits](changesets.md#limits) on objects and bytes. A request
  past them is refused as a conflict, "is full", with nothing staged: commit what is
  staged, start a new changeset and send the same request to it.

Each commit is all or nothing; the load as a whole is not. Between two commits, readers see
the part committed, and search builds its entries in the background
([search-indices.md](search-indices.md#lifecycle)).

## When something fails

- **A refused request staged nothing.** A `422` lists each failed call by its index in
  `details.items`; correct those calls and send the whole request again. A conflict
  because the changeset changed in between is sent again as it is.
- **A rejected commit persisted nothing.** It lists its violations
  ([changesets.md](changesets.md#commit-validation)); unstage or correct the objects they
  name, [check](changesets.md#the-check), and commit again.
- **A load that stopped midway** is run again: the puts update what the first run wrote,
  and the creates write again. A load with creates is rerun only into an ontology it has
  not written yet.
- **A draft left behind** is discarded, or expires ([limits](changesets.md#limits)).

## With review

A Proposer, a person or an agent, stages the load the same way and submits each
changeset with a note; a person reviews it and commits it
([changesets.md](changesets.md#the-review)). A load of several changesets is reviewed and
committed changeset by changeset. A relation's ends must be stored or created in its own
changeset, so a relation whose end waits in a submitted changeset is staged once that one
is committed.

## Ready-made loaders

- **The `ontoforge-sync` skill's data import** loads an exported data file this way, puts
  where the lens schema allows them, and commits whenever a changeset is full
  (`plugins/ontoforge/skills/ontoforge-sync/SKILL.md`).
- **The development fixtures** load the same way ([../../fixtures/README.md](../../fixtures/README.md)).

## Through the interfaces

| | REST | MCP | Web UI |
|---|---|---|---|
| A list of calls per request | `writes` of one changeset | — | — |
| Put | `put_entity`, `put_relation` in `writes` | — | — |
| One call at a time, start, commit, review | as in [changesets.md](changesets.md#through-the-interfaces) | the write tools with `changeset_id`, the changeset tools | the Changesets page reviews and commits a load's changesets |
