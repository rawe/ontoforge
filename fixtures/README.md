# Development fixtures

Known ontologies — schema plus instance data — that you load into a running OntoForge
server, work with, save back, and remove. They are for development and manual or agent
testing; the automated test suites use their own fixtures under `server/tests/fixtures/`
(see [docs/workflows/testing.md](../docs/workflows/testing.md)).

Each fixture is one folder under `ontologies/`. The folder name is the fixture name, and
the fixture always lives on the server as the ontology `fx_<name>`.

```
ontologies/<name>/
  README.md     purpose, types, lenses, sizes
  schema.json   the ontology's design export, unchanged (GET /model/export)
  data.json     instance data, in the ontoforge-sync plugin's data file format
```

## Commands

`fixture.mjs` needs Node 18+ and nothing else. Run it from the repository root:

```sh
node fixtures/fixture.mjs load   people_basic   # create fx_people_basic, import schema + data
node fixtures/fixture.mjs save   people_basic   # write fx_people_basic back into the folder
node fixtures/fixture.mjs unload people_basic   # delete fx_people_basic from the server

node fixtures/fixture.mjs load people_basic --base-url http://localhost:8010
```

The server is `--base-url`, else `ONTOFORGE_BASE_URL`, else `http://localhost:8000`.

- **load** — creates `fx_<name>`, imports `schema.json` (its keyword languages
  included), writes `data.json` through the schema's unscoped lens, then waits until
  every search index of the ontology has built its entries, printing progress. Failed
  items are reported, and after 15 minutes the tool stops waiting with a warning — the
  data is loaded either way and the indices keep building in the background. On a
  server whose storage has no search indices (Neo4j) it rebuilds search data instead.
  Refused when `fx_<name>` already exists (unload first). When a step after creating the
  ontology fails, the tool prints the server's error and leaves the partial ontology in
  place — run `unload` before loading again.
- **save** — reads `fx_<name>` and overwrites `schema.json` and `data.json` (creating the
  folder if needed). Data is read through the unscoped lens; IDs are the server's IDs as
  returned.
- **unload** — deletes `fx_<name>`. Refused when the folder `ontologies/<name>` does not
  exist.

## Typical flow

1. `load <name>` against your server.
2. Develop or test against ontology `fx_<name>`.
3. `unload <name>` when done. If you changed the fixture on purpose, `save <name>` first.

## Making a new fixture

1. Build ontology `fx_<name>` on a server — at least one unscoped lens is required.
   `<name>` matches `^[a-z][a-z0-9_]*$`; `fx_<name>` is at most 59 characters.
2. `save <name>` — this creates `ontologies/<name>/` with `schema.json` and `data.json`.
3. Add `ontologies/<name>/README.md` and a row to the registry below.
4. Check it: `unload <name>`, `load <name>`.

## Repairing after a format change

When OntoForge changes its design or data format, `load` then `save` rewrites the files
in the current format — `schema.json` in transfer format 6.0. The server still imports a
5.0 file, converting it on the way in, so an old fixture loads as it is. If `load` fails
on an old file, fix the JSON by hand once, then load and save.

## Safety

- Fixture ontologies are always named `fx_<name>`; nothing else is created.
- `unload` deletes only ontologies whose fixture folder exists, so other ontologies on the
  server are never touched.
- Loading builds search entries with whatever embedding provider the server is configured
  with — a cloud provider is called (and billed) if the server uses one.
- Neo4j holds at most one ontology per server: a fixture loads there only into an
  otherwise empty server.

## Registry

| Name | Ontology key | Purpose | Size |
|---|---|---|---|
| [people_basic](ontologies/people_basic/README.md) | `fx_people_basic` | Simple general-purpose fixture: CRUD, scoped and unscoped lenses, agents, saved queries | 20 entities, 15 relations |
| [trade_fair](ontologies/trade_fair/README.md) | `fx_trade_fair` | Retrieval and search: saved retrievers, property and passage search over long documents, an agent, saved queries | 55 entities, 109 relations |
| [org_graph](ontologies/org_graph/README.md) | `fx_org_graph` | Graph structure without providers: multi-hop traversal, self-relations, relation properties, OQL, saved query pipelines, every lens scoping variant, query-path filters, near-duplicates for identity comparison | 59 entities, 150 relations |
| [search_bilingual](ontologies/search_bilingual/README.md) | `fx_search_bilingual` | Search indices: relation pairing in a custom index (several employments per person), bilingual German/English keyword search, cross-language semantic search, a scoped lens that skips relation entries | 23 entities, 28 relations |
