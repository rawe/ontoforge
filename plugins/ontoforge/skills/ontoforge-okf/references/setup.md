# Preparing a bundle and an ontology for OKF sync

Read this when a bundle has no `okf.config.json`, when the ontology has no entity
types for the bundle's `type` values, or when a push reports a missing `typeMap`
entry or a missing entity type.

The result is one committed file at the bundle root and an ontology whose entity
types can hold every concept in the bundle. Work through the steps in order; the
setup is done when every `type` value found in step 3 has a `typeMap` entry
pointing at an entity type that exists.

Use the OntoForge **modeling MCP tools** where they are connected. The REST
equivalents are named per step for the case where they are not.

## 1. Name the ontology

List the ontologies and pick the key this bundle syncs with.

- MCP: `get_schema`
- REST: `GET /api/model/ontologies`

Create one with `create_ontology` (REST: `POST /api/model/ontologies`) when none
fits. An unscoped ontology sees the whole schema and is the simplest choice.

## 2. List the entity types that already exist

- MCP: `get_schema`
- REST: `GET /api/model/entity-types`

Record each type's key and its properties. Types created for other purposes can
serve OKF concepts as soon as they meet the minimum in step 4.

## 3. Collect the `type` values in the bundle

Every concept document carries exactly one `type` in its frontmatter, and OKF
lets producers choose the wording freely — `BigQuery Table`, `Metric`,
`Playbook`.

```bash
grep -rh '^type:' --include='*.md' . | sort -u
```

This list drives everything that follows. Each entry becomes one `typeMap` key.

## 4. Give every `type` value an entity type

For each value from step 3 without a matching entity type, create one with
`create_entity_type` (REST: `POST /api/model/entity-types`), then add its
properties with `add_property` (REST:
`POST /api/model/entity-types/{entityTypeId}/properties`).

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

Finally, add each type to the ontology with `add_entity_type_to_ontology` (REST:
`POST /api/model/ontologies/{ontologyId}/includes/entity-types`). A scoped
ontology must expose the concept-ID property and the document property, because
a property the ontology hides cannot be written through it.

## 5. Write `okf.config.json` at the bundle root

Place it where the bundle starts — that directory becomes the bundle root.

```json
{
  "ontology": "main",
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
| `ontology` | yes | The ontology key the runtime API addresses |
| `typeMap` | yes | Frontmatter `type` value → entity type key. Every entity type key appears once: the pull reverses this map to recover the `type` value |
| `conceptIdProperty` | no | The string property holding the concept ID. Default `concept_id` |
| `documentProperty` | no | Which document property holds the body. Needed only when a type has several; `null` auto-detects the single one |
| `listProperties` | no | String properties written as YAML lists. Default `["tags"]` |
| `listDelimiter` | no | How list values are joined inside the string property. Default `", "` |

The server URL is not part of this file; it comes from `ONTOFORGE_BASE_URL`.

## 6. Confirm the setup

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

Keys reported as unknown during the push have no property yet: return to step 4
and add them, or accept that they are dropped.
