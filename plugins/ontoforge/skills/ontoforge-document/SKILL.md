---
name: ontoforge-document
description: "Upload a file's contents verbatim into a document property of an existing OntoForge entity, or download that property back into a file, byte for byte. Use when the user wants to move the text of one file in or out of one document property of one entity that already exists."
---

# OntoForge: upload and download a document

One file, one `document` property, one entity. The file content becomes the
document content unchanged, and the other way round, byte for byte. Nothing is
parsed out of the file and nothing is mapped onto other properties: the bytes
are the payload.

## Prerequisites

- Node.js 18 or newer
- a running OntoForge server
- **the entity already exists.** The script creates none: that would mean
  filling required properties, and that is not its job. New entities are created
  in the UI, over MCP or over REST.

## Usage

```bash
node <skill>/scripts/ontoforge-doc.mjs upload   <file> --type <key> (--id <uuid> | --where <field>=<value>) [--property <field>]
node <skill>/scripts/ontoforge-doc.mjs download <file> --type <key> (--id <uuid> | --where <field>=<value>) [--property <field>]
```

Server, ontology and lens come from the environment or from flags:

| Environment | Flag | Default |
|---|---|---|
| `ONTOFORGE_BASE_URL` | – | `http://localhost:8000` |
| `ONTOFORGE_ONTOLOGY` | `--ontology` | required |
| `ONTOFORGE_LENS` | `--lens` | required |

With both variables in the environment the call stays short. Otherwise pass
`--ontology` and `--lens` per call — that way the script is bound to no
ontology.

## Naming the entity

Either directly or through a field:

- `--id <uuid>` — unambiguous, when the ID is already known
- `--where <field>=<value>` — more readable. Must match **exactly one** entity;
  on several the script stops and asks for `--id`

## Naming the property

If the entity type has exactly one `document` property, the script takes it by
itself. On several, `--property <field>` picks one. The schema is always read,
so that a typo returns a list of the existing fields instead of a silent
failure.

## What happens

The upload is a `PATCH` on the entity with the property as an ordinary string —
that one field only, every other stays untouched. The previous content is fully
replaced; there is no appending.

The download reads through `GET .../documents/<field>`. That detour is necessary
because ordinary entity reads return `document` properties as a stub only
(`{"document": true, "length": N}`), never as text.

The server normalizes nothing: trailing newlines, Unicode and empty files come
back unchanged. A download after an upload yields exactly the original file, and
a second download no longer changes it.

## When something jams

The error messages name the reason and usually the valid values too — the
existing entity types, the existing `document` properties, the number of
matches. Reading them is quicker than guessing at the call.
