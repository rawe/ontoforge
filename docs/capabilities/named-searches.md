# Named searches

A named search is a search tree stored under a key in a lens. The designer composes the
search once — which indices, which methods, how the rankings combine, what restricts
them — and a caller later supplies a query text and, if it wants, filters. It never sees
the tree.

## What it holds

A named search carries a **key**, a **name**, a **description** and a **tree**. The tree
is JSON: one node at the root, each node an object with a `kind` and that kind's fields
only; a node's inputs are nodes again.

| Node | Fields | Yields |
|---|---|---|
| `keywordSearch` | `index`, `text`; optional `match` (`any`, the default, or `all`), `relations`, `parts` | The entries of one [search index](search-indices.md) ranked by keyword score for the text |
| `semanticSearch` | `index`, `text`; optional `minSimilarity` (0 to 1), `relations`, `parts` | The entries of one search index ranked by semantic similarity to the text, those below the floor left out |
| `group` | `key` (`entity` or `passage`), `input` | One item per entity, or per passage, kept by its best entry |
| `merge` | `inputs` | Rankings of one score kind as one, by score |
| `fuse` | `inputs` | Rankings of one result unit as one, by reciprocal rank |
| `restrict` | `input`, `filters` | The ranking's items whose entity meets the filter of its type; items of other types are kept |
| `filter` | `entityType`, `conditions` | The entities of one type that meet the conditions — only as a filter of `restrict` |
| `cut` | `input`, `limit` (1 to 100); optional `perEntity` (1 to the limit) | The first `limit` items; of passages at most `perEntity` per entity |

A search node's `relations` names the relation types whose relation entries count;
without it, every relation type the lens shows counts. Its `parts` names the entry parts
that count — `self`, `relation`, `passage`; without it, every part counts. Ranking,
grouping, fusion and the scores are those of [ranked search](search.md#ranking).

A filter's `conditions` take the keys and values of the
[entity search's filters](search.md#scope-and-filters), checked against that one entity
type through the lens.

`$query` in a search node's text marks where the caller's query text goes; the rest of
the text stays as written. Two search nodes may carry different texts, `"$query"` and
`"$query employer"` for example.

A minimal tree — people ranked by keyword and by meaning, fused, the first ten:

    {"kind": "cut", "limit": 10, "input": {"kind": "fuse", "inputs": [
      {"kind": "group", "key": "entity", "input":
        {"kind": "keywordSearch", "index": "person~default", "text": "$query"}},
      {"kind": "group", "key": "entity", "input":
        {"kind": "semanticSearch", "index": "person~default", "text": "$query"}}]}}

## Rules

### Identity and ownership

- Keys follow the lens-resource [key](../glossary.md#schema-and-design) rule, at up to 64
  characters, and are unique within the lens. Name and description are required.
- Writing a named search is an upsert on its key: it creates or replaces it wholesale.
- Named searches belong to a lens ([ontology-lenses.md](ontology-lenses.md)). Deleting
  the lens deletes them, and they travel with it through [transfer](transfer.md).

### Checks at save

A tree is checked when it is saved, and every violation is reported together, each at
its path below `tree` (`tree.input.inputs.1.index`):

- **Shape.** Each node has the fields of its kind and no other; a field it does not
  define, or a kind not in the table, is refused at its path. There is no `append`, no
  sub-query and no fixed list of ids.
- **A cut above every search node.** A search reads as deep as the limit of the nearest
  cut above it requires.
- **`$query` in at least one search node's text**, or the query would go nowhere.
- **The tree's rules, against the lens:**
  - a merge combines rankings of one score kind — one method, one text and, for semantic
    rankings, one embedding model; texts are compared as written, `$query` included;
    rankings of different kinds are fused instead;
  - every search node reaches the root through exactly one group, and every fuse lies
    above the groups, so an item votes once;
  - a fused ranking, which keeps only an order, is only fused again, restricted or cut;
  - a merge or fuse combines one result unit, entities or passages;
  - a floor belongs to a semantic search;
  - a filter enters a ranking only through restrict, one filter per entity type;
  - each index is one the lens can search, each entity type one it shows;
  - the root is a ranking of entities or passages, and `perEntity` cuts passages.
- **Each filter's conditions** resolve against its entity type through the lens; a key
  the type does not have, or the lens hides, is refused at its path
  (`tree.input.filters.0.conditions.age__gte`).
- **Shapes the search runs:**
  - below a `passage` group only passage entries count: a search node there without
    `parts` counts passages only, and one whose `parts` name another part is refused at
    its `parts`;
  - a merge combines the entries of search nodes and merges, never grouped rankings —
    those are fused;
  - passages fuse straight from their groups: a fuse of passages takes no fuse and no
    cut.

The lens checks are skipped when the lens's schema cannot be loaded, as for a
[saved query](saved-queries.md#validation-at-definition-time-versus-run-time).
No other limit applies: neither the number of nodes nor the number of texts is capped.

## Running one

A caller lists a lens's named searches and runs one by its key with a query text. It sees
neither the tree nor its indices: the listing gives each search's key, name, description,
`result` — what a run returns, `entities` or `passages`, the unit of the tree's root — and
`types`, the entity types whose indices the tree searches, sorted. An index the lens can no
longer search is left out of `types`.

A run takes the **query** — required, not blank — and optional **filter**s, nothing else:

1. The key is resolved within the lens; an unknown key is not found.
2. The query goes in place of every `$query` in every search node's text, as written: no
   character of the query is special, and a text without `$query` stays as it is.
3. The tree is checked against the lens again — the shape, lens and run-shape rules of
   [Checks at save](#checks-at-save), stored filters included. A search the lens no longer
   fits, because the lens was narrowed or an index switched off after it was saved, is a
   validation error naming the search and every path; it never runs. Nothing proactively
   invalidates a stored tree; re-saving it after such a change is the designer's job.
4. The filters take the keys and values of the
   [entity search's filters](search.md#scope-and-filters) and apply to the listed `types`:
   each type that resolves every key is restricted to the entities that meet them, and a
   type that does not resolve every key drops out — its entities are not found. A key no
   type resolves is a validation error at `filter.<key>`. With no type left, the result is
   empty and carries the limitation `filter-excludes-all-types`. The filters hold together
   with the tree's own stored filters.
5. The tree runs as [ranked search](search.md#ranking) ranks.

The response is the [entity search's](search.md#entity-search) when `result` is
`entities` and the [passage search's](search.md#passage-search) when it is `passages`, the
passage text always included: `ran`, `items`, `limitations`, each item as there.

**The match.** A tree may search several texts. Each item is found by the text it ranks
best in — by its rank in that text's ranking alone, not by a score — and on equal ranks by
the text earlier in the tree; its match, or its passage, and its scores are that text's.
When the tree searches more than one distinct text after the query is filled in, the
match, or the passage, also carries `queryText`: that text, query filled in. With one
text it carries no such field.

**Without an embedding provider** a semantic search node finds nothing and is reported
as the limitation `no-provider` naming its indices; the keyword nodes still run. A run is
never refused for it.

## Through the interfaces

| | Modeling (define) | Runtime (use) |
|---|---|---|
| REST | List, upsert by key, delete, under the lens's route | List, run by key |
| MCP | `list_named_searches`, `set_named_search`, `delete_named_search` | `list_named_searches`, `run_named_search` |

Complete operation index: [../interfaces/](../interfaces/README.md).
