/** The built-in skill `search-design`: its SKILL.md. */
export default `---
name: search-design
description: Make an OntoForge ontology's data findable - when the managed search indices suffice and when to define a custom index, how to cut relation groups, header and templates, and how to package search for callers as search profiles, retrievers and saved queries, with worked examples of each. Use when designing or reviewing search indices, composing a search tree, configuring a retriever, or writing a saved query that searches.
---

# Search design

Search finds entities through **search indices**. An index belongs to the ontology,
names a root entity type, and composes text entries for each entity of that type; every
hit is an entity of the root type. A lens decides which indices its callers search.

## Start with the managed indices

\`list_search_indices\` shows what exists. The server keeps two kinds by itself:

- \`<entityTypeKey>~default\`: every own \`string\` property of the type.
- \`<entityTypeKey>~<documentPropertyKey>\`: the passages of one document property.

They follow the schema with no configuration. Switch off one that only adds noise with
\`set_search_settings\` \`disabled_indices\` (it lists every managed index to switch off;
the rest are on). Set \`keyword_languages\` to the languages the data is written in.

## When a custom index pays off

Define one with \`create_search_index\` when the managed ones cannot find what callers ask
for:

- **Facts on relations.** "Who worked at Acme as an engineer?" needs the relation's
  properties and the related entity's name in one entry. Only a custom index has
  **relation groups**.
- **Non-string values.** Integers, floats, booleans, dates and datetimes are indexed only
  when a custom index lists them in \`fields\`.
- **Sharper meaning.** Fewer, chosen fields keep a vector focused; a \`template\` turns
  labelled lines into prose that reads like the questions.
- **What a lens may see.** An index reads the full schema, so values a lens hides can
  still drive its ranking. A custom index over only the fields a lens shows avoids that.

## Cutting a definition

- **One entry per relation instance.** A relation group yields one entry per relation,
  with that relation's \`fields\` and the \`target\` entity's fields. An entry never combines
  two relations. A question spanning two relations is answered by an exact filter or by
  fusing two rankings at entity level, not by one entry.
- **One hop.** A group follows one relation type in one \`direction\` from the root:
  \`outgoing\` when the root is the relation type's source, \`incoming\` when it is its target.
- **Costs grow with relations.** Each group multiplies entries, and changes to related
  entities re-index the relations pointing at them. At most 12 fields (own, relation and
  target together) and 4 groups. Several small indices are often cheaper than one big one.
- **Header.** By default every relation and passage entry starts with the root's name
  property, so the entry says whose it is. Set \`header\` to other own fields, or \`[]\` for
  none.
- **Templates.** \`{x}\` is a field, \`{target.x}\` a target field. A clause whose placeholder
  has no value is dropped up to the next \`,\`, \`;\`, \`.\` or line break. Placeholders are not
  validated: a misspelt one silently never has a value, so check the outline.
- **Description.** Write \`description\` for whoever picks an index to search: what it
  finds and by which facts.

Example:

\`\`\`json
{
  "key": "person_employment",
  "name": "People by employment",
  "description": "People with their roles at companies and since when.",
  "entityType": "person",
  "fields": ["name", "bio"],
  "relations": [{
    "relationType": "works_for", "direction": "outgoing",
    "fields": ["role", "since"], "target": {"company": ["name"]},
    "label": "Employment",
    "template": "{name}, {role} at {target.name}, since {since}."
  }]
}
\`\`\`

## The index workflow

1. \`preview_search_index\` with the draft. Read \`issues\`, then the \`outline\`: the tokens
   \`⟦root.x⟧\`, \`⟦relation.x⟧\`, \`⟦target.x⟧\` and \`⟦passage⟧\` show which field lands where.
   Check \`estimate\` for the build cost per representation.
2. \`create_search_index\`. Building runs in the background; \`get_search_index_status\`
   until \`state\` is \`ready\`. A new entity is searchable only once its entries are built.
3. For each scoped lens that should search it: \`add_search_index_to_lens\`, then
   \`validate_lens\` for warnings about hidden fields.
4. To change it: \`update_search_index\` with the whole definition. Only touched
   representations rebuild; the current entries serve until then.

## Packaging search for callers

Callers of a lens can search indices directly. Three stored, lens-owned objects give
them more:

| Need | Use |
|---|---|
| A fixed, tuned ranking that callers run with a query text | search profile (\`set_search_profile\`) |
| Natural-language questions answered by a model, citing found entities | retriever (\`set_retriever\`) |
| An exact, parameterized query, often search then graph traversal | saved query (\`set_saved_query\`) |

Each is checked against the lens when saved. A later lens or index change can leave it
invalid; save it again.

### Search profiles

The designer composes a search tree once; the caller supplies only the query and
optional filters. \`$query\` in a search node's \`text\` marks where the query goes, and
texts may differ (\`"$query"\` and \`"$query employer"\`).

- **Hybrid ranking** (keyword and meaning, fused, first ten):

  \`\`\`json
  {"kind": "cut", "limit": 10, "input": {"kind": "fuse", "inputs": [
    {"kind": "group", "key": "entity", "input":
      {"kind": "keywordSearch", "index": "person~default", "text": "$query"}},
    {"kind": "group", "key": "entity", "input":
      {"kind": "semanticSearch", "index": "person~default", "text": "$query"}}]}}
  \`\`\`

- **Passages** of documents: group by \`passage\` and limit passages per entity with
  \`perEntity\` on the cut:

  \`\`\`json
  {"kind": "cut", "limit": 10, "perEntity": 2, "input": {"kind": "group", "key": "passage",
    "input": {"kind": "semanticSearch", "index": "person~bio", "text": "$query"}}}
  \`\`\`

- **Several indices, one method and text**: \`merge\` the search nodes, then group. Different
  methods or texts: group each, then \`fuse\`.
- **A stored filter**: wrap a ranking in \`restrict\` with one \`filter\` per entity type,
  for example \`{"kind": "restrict", "input": <ranking>, "filters": [{"kind": "filter",
  "entityType": "person", "conditions": {"lives_in.name": "Berlin"}}]}\`, below the cut.
- \`minSimilarity\` on a semantic node drops weak matches; leave it out unless results show
  noise.

### Retrievers

A retriever answers questions with a planning and an answer model over the indices in
its \`config\`. The root types of those indices are its result types. Facts on relations
are found through a custom index with a relation group; \`filters\` are the exact,
structural counterpart and reach up to two hops. Keep \`answerFields\` to what an answer
should cite. \`threshold\` is a model-specific cut-off, not a confidence; keep the default
unless matches are clearly too loose or too strict.

\`\`\`json
{"indices": [{"index": "person~default"}],
 "filters": [{"id": "city", "entityType": "person",
   "path": [{"relationTypeKey": "lives_in", "direction": "outgoing"}], "field": "name"}],
 "answerFields": {"person": ["name", "email"]}}
\`\`\`

### Saved queries

A saved query moves query composition to design time: a caller, often a small model,
finds it by its \`description\` and fills typed \`parameters\`. Write both descriptions for
that reader. Only the last step's output is returned.

A common shape searches first and traverses the graph second. A search step's entities
expose only \`_id\`, \`_entityTypeKey\` and \`name\` to bindings, so a later \`oql\` step reads
further properties by id:

\`\`\`json
{"steps": [
  {"name": "skills", "type": "search", "types": ["skill"], "query": "$q", "limit": 5},
  {"name": "results", "type": "oql",
   "oql": "MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id IN $ids RETURN p",
   "bindings": {"ids": "{{skills._id}}"}}],
 "parameters": [{"name": "q", "description": "The skill to look for", "dataType": "string"}]}
\`\`\`
`;
