# Naming concepts and keys

Use this guide when adding a domain concept or keyed resource. The
[glossary](../glossary.md) owns the vocabulary; the
[interface conventions](../interfaces/README.md#what-a-path-segment-identifies) explain how
clients address resources.

## Follow one concept across the system

Use one name for a concept across modules, routes and stores rather than introducing
synonyms at each layer. A contributor must be able to follow the same concept from a
request to its persistence boundary. The web client may use its own product-facing
names; do not turn those presentation labels into competing domain terms.

## Reuse the key rule of the resource's level

A new keyed resource uses the existing rule for its level, not a private pattern invented
for that resource. Define each rule once on the server and mirror it once in the client,
so validation, error messages and tool descriptions use the same definition.

The server definitions are in [core schemas](../../server/src/core/schemas.ts); the
client mirror is in [schemaKeys](../../frontend/src/components/studio/modeling/schemaKeys.ts).
Use the appropriate shared definition at each entrance, including import. Rules for
generated keys, such as managed search-index keys, follow their documented derivation
in the owning capability; do not confuse them with caller-defined keys.

When changing a key rule, check the server definition, client mirror, imports, tool
descriptions and tests together. The [name compatibility policy](../interfaces/README.md#compatibility-of-names)
covers renaming public API, MCP and configuration names; changing a stored or exported
name also requires accounting for the corresponding upgrade.
