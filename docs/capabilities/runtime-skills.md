# Runtime skills

A runtime skill is a guide stored under a key in a lens. The lens's runtime MCP mount
publishes it as a skill: an MCP client connected to that lens discovers it, shows its
description, and loads its content when the work calls for it. A designer uses runtime
skills to explain how to work with the lens's data — which types to start from, which
search to run, how to stage a change — without changing any tool.

## What it holds

A runtime skill carries a **key**, a **description** and its **content**, the guide's
Markdown body. Nothing else is authored. The published skill is generated from these:
its `SKILL.md` has the key as `name`, the description as `description`, and the content
as its body.

    PUT …/lenses/visitor/skills/find-people
    {"description": "Find people by name, role or employer. Use before listing entities.",
     "content": "# Find people\n\nSearch the person index first, then read each match.\n"}

## Rules

- **Key.** The key is the skill's name in MCP clients, so it follows the Agent Skill name
  rule: 1 to 64 lowercase letters, digits and single hyphens (`find-people`, `step-2`). No
  underscore, unlike the lens-resource [key](../glossary.md#schema-and-design) rule. It is
  unique within the lens.
- **Description.** 1 to 1024 characters. A client shows it and chooses a skill by it, so
  it says what the guide helps with and when to use it.
- **Content.** Not empty. It is the body only; the server writes the frontmatter.
- Every violation is reported together, whichever interface saves the skill.
- Writing a runtime skill is an upsert on its key: it creates or replaces it wholesale.
- Runtime skills belong to a lens ([ontology-lenses.md](ontology-lenses.md)). Two lenses
  may hold the same key independently; changing or deleting one leaves the other as it
  is. Deleting the lens deletes its skills, and they travel with it through
  [transfer](transfer.md).

## Publishing

Every runtime MCP mount of the lens publishes its runtime skills, the ruleset mounts
included, through the MCP skills extension: each at `skill://<key>/SKILL.md`, listed with
`skills/list`, fetched with `skills/get` and read as a resource. A lens without runtime
skills lists none. Every lens role may read them. A mount publishes only its own lens's
skills: a key held only by another lens, or by a lens of another ontology, is not served,
neither listed nor by its URI.

A change is published on the next request, because each request reads the lens's current
design.

## Through the interfaces

| | Modeling (maintain) | Runtime (use) |
|---|---|---|
| REST | List, read, upsert by key, delete, under the lens's route | — |
| MCP | `list_runtime_skills`, `get_runtime_skill`, `set_runtime_skill`, `delete_runtime_skill` | [Skills](../interfaces/mcp.md#skills) on the lens's mounts |

Complete operation index: [../interfaces/](../interfaces/README.md).
