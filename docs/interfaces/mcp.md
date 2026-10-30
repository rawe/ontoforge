# MCP

Two servers, mounted in the same process as REST and calling the same services directly.
Both use stateless HTTP with plain JSON responses, so one mount serves many clients and
no connection carries state. The deployment and transport choice is explained in
[ADR 0005](../adr/0005-mcp-in-process-stateless-http.md). Modeling and runtime remain separate
servers: no client reaches both through one MCP connection.

| | Modeling | Runtime |
|---|---|---|
| Mount | `/mcp/ontologies/{ontologyKey}/model` | `/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` |
| Bound to | One ontology | One ontology and one lens |
| Tools | 45 | 34; 35 on a ruleset mount, 34 with write access `propose`, 19 with `none` or for a Reader; 33 for a Proposer, 34 on a ruleset mount |
| Sign-in, authentication on | Bearer token of an Ontology Administrator | Bearer token of a Reader, Proposer or Writer on the lens |

## How a mount is bound

**The URL is the only binding channel.** Each mount names its scope in its own address —
there is no request header and no configured fallback, no tool takes an ontology
argument, and no runtime tool a lens argument. A URL that names no ontology (or, for runtime, no lens) is an unknown
route and answers the standard not-found error. One MCP client configuration entry per
ontology is the intended shape.

A bound client can never reach, list, or infer another ontology's existence: the binding
is fixed in the URL, and no mount exposes the registry. Ontology management — listing,
creating under an arbitrary key, renaming, deleting — is REST and web UI only, with one
carve-out: the modeling mount's `ensure_ontology` tool, which acts only on the mount's
own binding.

A runtime mount URL may add `/rulesets/{rulesetKey}`: the mount is then also bound to that
ruleset, gains `get_ruleset`, and follows the ruleset's
[rules](../capabilities/rulesets.md#the-rules). Its tools are otherwise the runtime tools
that its write access allows
([capabilities/rulesets.md](../capabilities/rulesets.md#write-access-through-the-interfaces)).
On a ruleset mount `get_schema`'s description says to call it after `get_ruleset`, and
`create_entity`'s adds the anchor's rule. No mount creates a ruleset.

The modeling mount serves requests even when its ontology does not exist yet — that is
what lets `ensure_ontology` provision it; until then every other tool answers a
not-found tool error. With authentication on it does not: a missing ontology answers not
found like any ontology the caller holds no role in, and `ensure_ontology` creates
nothing. How a client signs in: [Sign-in](server.md#sign-in). The runtime mount requires both its ontology and its lens to
exist, and a ruleset mount its ruleset as well; its tools answer not-found tool errors
otherwise, reads included.

## Modeling tools

| Tool | Purpose |
|---|---|
| `ensure_ontology` | Create the ontology this mount is bound to if it does not exist yet; no-op if it does. Argument-less — it acts only on the mount's own ontology — and reports the key and whether it created. A created ontology starts bare and without a display name; naming is a REST/UI operation. With authentication on it creates nothing |
| `get_schema` | The ontology's whole design — types, relation types, properties, the keyword language set, the custom search indices and the switched-off managed ones, and every lens with its type inclusions, its search-index inclusions (`indexInclusions`), agents, saved queries, named searches, retrievers and navigators. Identical to `export_schema`, and the only way to enumerate lenses: there is no `list_lenses` |
| `create_entity_type` | Add an entity type together with its name property (`name_property`, default `name`), optionally with an identity (`identity_properties`) |
| `update_entity_type` | Change display name, description, name property (`name_property`) or identity (`identity_properties`; null clears it); the key is immutable |
| `delete_entity_type` | Remove an entity type and its properties |
| `create_relation_type` | Add a relation type between two entity types, optionally naming its parent end (`parent`) and turning one per pair on (`one_per_pair`) |
| `update_relation_type` | Change display name, description, parent end (`parent`; null clears it) or one per pair (`one_per_pair`); endpoints are immutable |
| `delete_relation_type` | Remove a relation type and its properties |
| `add_property` | Define a property on an entity type or a relation type |
| `update_property` | Change a property's metadata (`default_value`; null clears it); key and data type are immutable |
| `delete_property` | Remove a property definition; refused for an entity type's name property |
| `validate_schema` | Check the ontology's schema and every lens |
| `export_schema` | Produce a transfer payload |
| `import_schema` | Apply a transfer payload |
| `get_search_settings` | Read the keyword language set and the managed indices switched off |
| `set_search_settings` | Change `keyword_languages` and/or `disabled_indices`, as the REST route does |
| `list_search_indices` | List every search index, managed and custom, with its status |
| `get_search_index` | Read one search index with its status |
| `preview_search_index` | Validate a draft definition, estimate its build cost and outline its entries, without saving |
| `create_search_index` | Create a custom search index from a `definition` |
| `update_search_index` | Replace a custom search index's `definition`; the key cannot change |
| `delete_search_index` | Delete a custom search index |
| `get_search_index_status` | Read a search index's build status |
| `rebuild_search_index` | Start new generations of a search index and return its status |
| `create_lens` | Create a lens |
| `update_lens` | Change a lens's name or description |
| `delete_lens` | Delete a lens with its changesets, stating how many |
| `add_entity_type_to_lens` | Include an entity type in a lens, optionally narrowed to a property list |
| `remove_entity_type_from_lens` | Drop an entity type from a lens |
| `add_relation_type_to_lens` | Include a relation type in a lens, optionally narrowed to a property list |
| `remove_relation_type_from_lens` | Drop a relation type from a lens |
| `add_search_index_to_lens` | Include a search index in a lens, by `index_key` |
| `remove_search_index_from_lens` | Drop a search index from a lens, by `index_key` |
| `validate_lens` | Check one lens's inclusions against the schema; warnings name what limits its search indices |
| `list_agents` | List a lens's agents |
| `get_agent` | Read one agent, by `agent_key` |
| `set_agent` | Create or replace an agent |
| `delete_agent` | Delete an agent, by `agent_key` |
| `list_retrievers` | List a lens's retrievers, each with its validation |
| `get_retriever` | Read one retriever with its validation, by `retriever_key` |
| `set_retriever` | Create or replace a retriever from a `config` in the REST wire format; an invalid configuration is refused with every error in one message |
| `delete_retriever` | Delete a retriever, by `retriever_key` |
| `list_saved_queries` | List a lens's saved queries |
| `set_saved_query` | Create or replace a saved query pipeline |
| `delete_saved_query` | Delete a saved query |
| `list_named_searches` | List a lens's named searches, each with its tree |
| `set_named_search` | Create or replace a named search from a `tree` in the REST wire format; every violation is refused in one message |
| `delete_named_search` | Delete a named search, by `search_key` |

The per-lens tools take a `lens_key` naming a lens of the bound ontology.
`create_entity_type`, `update_entity_type`, `add_property`, `delete_property`, `delete_entity_type`,
`delete_relation_type` and `delete_search_index` take a `cascade` flag with the same
meaning as the REST parameter. The search-index tools take the index key as
`index_key` and a definition in the same wire format as REST, camelCase included.
`set_retriever` writes the current configuration version, so it takes no version argument.
Copying, moving, exporting and importing a single retriever are REST only.
There is no modeling tool for the search-data rebuild (`rebuild-search-data`).

## Runtime tools

Everything a client can do to instance data through one lens.

| Tool | Purpose |
|---|---|
| `get_ruleset` | Ruleset mounts only: what the connection may do — key, write access, and the anchor with its type, id, name, state, visible and path |
| `get_schema` | The scoped schema, as REST `/schema` returns it — the lens's key, name and description; types, properties, required flags, name properties, identity properties |
| `create_entity` | Create an entity, optionally with its parent relation (`parent_relation`: `type`, `parent_id` or `parent_identity`, `properties`) |
| `list_entities` | List entities with search, filters, sorting, paging and projection |
| `get_entity` | Read one entity by id |
| `get_path` | An entity's hierarchy path through the lens, root first |
| `get_document` | Read a document property, whole or by character range |
| `update_entity` | Partial update; a null clears a property |
| `edit_document` | Change part of a document by exact string replacement |
| `write_document` | Overwrite a character range of a document; also inserts and appends |
| `delete_entity` | Delete an entity and its relations; refused for an entity with children or with a relation the lens hides |
| `create_relation` | Connect two entities |
| `list_relations` | List relations, optionally by source or target |
| `get_relation` | Read one relation by id |
| `update_relation` | Partial update of relation properties |
| `delete_relation` | Delete a relation |
| `get_neighbors` | An entity's local neighbourhood, with projection on both entities and relations |
| `execute_query` | Run a read-only OQL query |
| `list_search_indices` | The lens's search catalog, to choose indices for `search` and `search_documents` |
| `search` | The entity search: rank entities for a text, under the fixed similarity floor |
| `search_documents` | The passage search: rank passages of documents for a text, under the same floor |
| `list_saved_queries` | Discover saved queries and their parameters |
| `run_saved_query` | Execute a saved query with parameter values |
| `search_saved_queries` | Find a saved query by describing what it should do |
| `list_named_searches` | List the lens's named searches: key, name, description, result and types |
| `run_named_search` | Run a named search by `key` with a `query` and optional `filters`; answers the entity or the passage search's response |
| `start_changeset` | Start a changeset, with an optional `note` |
| `list_changesets` | The changesets this mount reaches |
| `get_changeset` | A changeset with its staged objects by first touch |
| `get_staged_document` | The text a commit would leave in a document property, whole or by character range |
| `unstage` | Remove one staged object, by `object_id`, or with `property` cut one staged value |
| `rebase` | Rebase an update, by `object_id`, with optional `properties` |
| `submit_changeset` | Submit a changeset, with an optional `note` |
| `unsubmit_changeset` | Unsubmit a changeset, with a required `note` |
| `check_changeset` | Check a changeset: run the commit and roll it back |
| `commit_changeset` | Commit a changeset, with an optional `expected_version` |
| `discard_changeset` | Discard a draft changeset |

`get_entity`, `get_path`, `get_document`, `update_entity`, `edit_document`,
`write_document`, `delete_entity` and `get_neighbors` name the entity by `entity_id` or
`entity_identity`, exactly one; `create_relation` names its ends by `from_entity_id` or
`from_entity_identity` and `to_entity_id` or `to_entity_identity`, and `list_relations`
filters by either. `get_staged_document` takes an id only.

`create_entity`, `update_entity`, `delete_entity`, `create_relation`, `update_relation`,
`delete_relation`, `edit_document` and `write_document` take an optional `changeset_id`:
with it the call is staged into that changeset and answers as the staging route does.
Every changeset tool but `start_changeset` and `list_changesets` takes `changeset_id`;
`get_changeset` takes `offset` and `limit`, which it clamps into range, and
`get_staged_document` takes those of `get_document`. The changeset tools
answer what the REST routes answer, and `unstage` and `discard_changeset` a message.

An agent configuration may grant twelve tools: `get_schema`, `list_entities`,
`get_entity`, `get_document`, `list_relations`, `get_neighbors`, `search`,
`search_documents`, `execute_query`, `list_saved_queries`, `run_saved_query`,
`search_saved_queries`. Every write tool is outside that set, and so are the read-only
`get_relation`, `get_path`, `get_ruleset`, `list_changesets`, `get_changeset` and
`get_staged_document` — being
read-only is not sufficient to be grantable. `search` runs the
[entity search](../capabilities/search.md#entity-search) and answers its response; it takes
`query`, `types`, `filters` and `limit`, and on MCP `indices` instead of `types`.
`search_documents` runs the [passage search](../capabilities/search.md#passage-search) and
answers its response; it takes `query`, `types` or `documents`, `filters`, `limit`,
`per_entity` and `text`, and on MCP `indices` instead of `types` or `documents`. Agents
take no `indices`: they see no index keys. Neither tool takes a method block or a
similarity floor: they run what can run, semantic under the fixed floor of
[capabilities/search.md](../capabilities/search.md#similarity-floor). See
[capabilities/agents.md](../capabilities/agents.md).

`list_search_indices` answers the catalog of `GET /search-indices`, on MCP only.

`write_document` has no REST counterpart of its own: over REST both document edit forms
share one route, selected by the operation in the body.
