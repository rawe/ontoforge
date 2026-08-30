# Preparing a bundle, an ontology and a lens for OKF sync

Read this when a bundle has no `okf.config.json`, when the ontology has no entity
types for the bundle's `type` values, or when a push reports a missing `typeMap`
entry or an entity type the lens does not expose.

The result is one committed file at the bundle root, an ontology whose entity types
can hold every concept in the bundle, and a lens that exposes them. Work through the
steps in order; the setup is done when every `type` value found in step 4 has a
`typeMap` entry pointing at an entity type that the bundle's lens exposes.

Two things are being named, and confusing them is the one mistake worth guarding
against:

- The **ontology** is the isolated unit — one schema, its lenses, and all of its
  instance data. Nothing spans two.
- A **lens** is a named view over that ontology's schema. Instance data is only
  reachable through one, which is why a bundle names both.

Use the OntoForge **modeling MCP tools** where they are connected. The REST
equivalents are named per step for the case where they are not; every modeling path
below is relative to `/api/ontologies/{ontologyKey}/model`.

A note on the REST paths: modeling addresses types, lenses and properties by their
**internal identifier**, not by their key. An identifier comes back from the create
call or from a list call. The MCP tools take keys throughout and need none of this.

## 1. Name the ontology

List the server's ontologies and pick the key this bundle syncs with. This is the
registry, the one surface that manages ontologies as whole units:

- REST: `GET /api/ontologies`

Create one when none fits:

- REST: `POST /api/ontologies` with a key, and optionally a display name

An ontology is created **bare** — empty schema, no lenses, no data, and no lens is
created for it. Keys match `^[a-z][a-z0-9_]*$`, are at most 59 characters, and are
unique across the whole server.

Over MCP, a modeling mount bound to an ontology that does not exist yet can create
its own with the argument-less `ensure_ontology`. That is the only ontology
management MCP offers — listing, renaming and deleting are REST or web UI.

## 2. Name the lens

The lens is what the push and pull actually read and write through.

- MCP: `get_schema` — it reports every lens of the ontology, and is the only way to
  enumerate them
- REST: `GET /lenses`

Create one with `create_lens` (REST: `POST /lenses`) when none fits. A lens that
declares no inclusions is **unscoped**: it exposes the ontology's whole schema and
widens automatically as types are added. That is the simplest choice for a bundle.

## 3. List the entity types that already exist

- MCP: `get_schema`
- REST: `GET /entity-types`

Record each type's key and its properties. Types created for other purposes can
serve OKF concepts as soon as they meet the minimum in step 5.

## 4. Collect the `type` values in the bundle

Every concept document carries exactly one `type` in its frontmatter, and OKF
lets producers choose the wording freely — `BigQuery Table`, `Metric`,
`Playbook`.

```bash
grep -rh '^type:' --include='*.md' . | sort -u
```

This list drives everything that follows. Each entry becomes one `typeMap` key.

## 5. Give every `type` value an entity type

For each value from step 4 without a matching entity type, create one with
`create_entity_type` (REST: `POST /entity-types`), then add its properties with
`add_property` (REST: `POST /entity-types/{entityTypeId}/properties`, where the
identifier is the one the create call returned).

**An entity type holding OKF concepts needs exactly two things:**

| Property | Data type | Required | Holds |
|---|---|---|---|
| the concept-ID property | `string` | yes | the file path without `.md` |
| one document property, any key | `document` | no | the Markdown body |

**Add one property per frontmatter key worth storing.** The property key must
equal the frontmatter key exactly. `title`, `description` and `resource` are
`string`; `tags` is a `string` too, stored delimited and rendered back as a YAML
list; a timestamp-valued key is `datetime`. A frontmatter key with no property
is rejected on push unless `--skip-unknown` drops it.

**Relation types play no part.** Markdown links between concepts stay inside the
body, so a bundle needs none.

**`type` gets no property.** The type value becomes the entity type itself.

**Names have a hard limit.** Entity type keys and property keys match
`^[a-z][a-z0-9_]*$` and are at most 64 characters. A frontmatter key outside
that shape — `staleAfter`, `okf-version` — can never be modeled, and stays
unknown on every push.

## 6. Make sure the lens exposes them

An unscoped lens already does, and this step is done.

A scoped lens exposes only what it names, so add each type to it with
`add_entity_type_to_lens` (REST: `POST /lenses/{lensId}/includes/entity-types`, which
names the type **by key in the request body** while the lens is named by identifier in
the path). A scoped lens must expose the concept-ID property and the document
property, because a property the lens hides cannot be written through it.

## 7. Write `okf.config.json` at the bundle root

Place it where the bundle starts — that directory becomes the bundle root.

```json
{
  "ontology": "knowledge_base",
  "lens": "full",
  "typeMap": {
    "BigQuery Table": "bigquery_table",
    "Metric": "metric"
  },
  "conceptIdProperty": "concept_id",
  "documentProperty": null,
  "listProperties": ["tags"],
  "listDelimiter": ", "
}
```

| Key | Required | Meaning |
|---|---|---|
| `ontology` | yes | The ontology key this bundle syncs with |
| `lens` | yes | The lens of that ontology the entities are read and written through |
| `typeMap` | yes | Frontmatter `type` value → entity type key. Every entity type key appears once: the pull reverses this map to recover the `type` value |
| `conceptIdProperty` | no | The string property holding the concept ID. Default `concept_id` |
| `documentProperty` | no | Which document property holds the body. Needed only when a type has several; `null` auto-detects the single one |
| `listProperties` | no | String properties written as YAML lists. Default `["tags"]` |
| `listDelimiter` | no | How list values are joined inside the string property. Default `", "` |

Both keys belong in this file because they are per-bundle state: everyone working on
the bundle syncs to the same ontology through the same lens. The server URL is not
part of it — that is per-developer, and comes from `ONTOFORGE_BASE_URL`.

## 8. Confirm the setup

Both scripts live in this skill's directory; the file argument is a path in the
bundle. Take one concept document and run a full round trip:

```bash
node <skill>/scripts/okf-push.mjs metrics/revenue.md   # store it
node <skill>/scripts/okf-pull.mjs metrics/revenue.md   # write it back

shasum metrics/revenue.md
node <skill>/scripts/okf-pull.mjs metrics/revenue.md   # pull the same concept again
shasum metrics/revenue.md                              # same hash
```

**The first pull rewrites the file, and that is correct.** Frontmatter is written
in alphabetical key order, so a hand-authored file comes back reordered. Compare
its content, not its shape: every key you modeled is present with the value you
authored, and the body is unchanged.

**The second pull must change nothing.** Matching hashes prove the mapping is
stable in both directions. A differing hash means the round trip loses or alters
data — the property list or the data types do not match the frontmatter.

Keys reported as unknown during the push have no property yet: return to step 5
and add them, or accept that they are dropped.

If a push reports that the lens exposes no such entity type, the type exists but the
lens hides it — return to step 6.
