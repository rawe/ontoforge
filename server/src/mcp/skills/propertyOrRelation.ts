/** The built-in skill `property-or-relation`: its SKILL.md. */
export default `---
name: property-or-relation
description: Decide whether a value in an OntoForge schema should be a property of an entity type or a relation to an entity type of its own, with the checklist, the trade-offs and the modeling tool calls for each choice. Use when designing or reviewing a schema and a value could be either, such as an employee's department, a product's category or an order's customer.
---

# Property or relation

In OntoForge a **property** holds one scalar value of one data type (\`string\`,
\`integer\`, \`float\`, \`boolean\`, \`date\`, \`datetime\`, \`document\`) on one entity
type or relation type. There are no list, enumeration, reference or nested-object data
types. A **relation type** is a directed connection from a source entity type to a
target entity type; its relations can carry properties of their own. Keys, data types
and a relation type's endpoints never change, so switching later means new types and
moving the data. Decide deliberately.

## The property-or-relation checklist

Answer each question for the value in question.

- **R1 Own attributes.** Does the value have facts of its own (a name plus a head, a
  location, a budget), now or soon? Yes points to an entity type and a relation.
- **R2 Shared.** Do many entities point at the same thing, so that renaming or
  correcting it once must change it for all? Yes points to a relation.
- **R3 More than one.** Can one entity have several of them? A property holds at most
  one value: yes means a relation.
- **R4 Data on the link.** Does the connection itself carry facts (since when, in which
  role, what share)? Yes means a relation with properties on the relation type.
- **R5 Navigation.** Will users or agents start from the value and look for the
  entities that have it, or traverse onward from it? Yes points to a relation.
- **P1 Must be present.** Must every entity have exactly this value? Only a property can
  be \`required\` (with or without a default). A relation type has no minimum cardinality,
  so nothing forces an entity to have one.
- **P2 Plain descriptor.** Is it a measurement, date, code, flag, label or free text
  that describes only this entity and means nothing on its own? Yes means a property.

**Verdict rule.** R3 or R4 yes: model a relation, whatever else holds. Otherwise two or
more R answers yes: model a relation. Only P answers yes: model a property. One of R1,
R2 or R5 yes: weigh it against P1; a hard need for \`required\` keeps a property. When you explain a decision, list the questions that decided it,
for example "Verdict: relation (R1, R2, R5)".

## Trade-offs to state

| Concern | Property | Relation to an entity type |
|---|---|---|
| Enforcement | \`required\` and a default are possible; values are coerced to the data type, never checked against a list | no "must have one"; \`one_per_pair\` stops linking the same pair twice; a parent relation allows at most one parent per entity |
| Fixed value sets | a \`string\` accepts any text, so typos become new values | the allowed values are the target's entities, created once and linked |
| Filtering and search | filter on the entity's own value | filter through a query path: \`<relationTypeKey>.<propertyKey>\` for the related entity's property, \`<relationTypeKey>@<propertyKey>\` for the relation's own; find entities without one with the relation existence filter \`<relationTypeKey>__missing\`; a relation type from an entity type to itself needs a direction, \`<relationTypeKey>:out\` or \`:in\` |
| Writes | one entity update | create or delete a relation; the target entity must exist first |
| Lenses | an inclusion's property list can hide it | the relation type and the target entity type are included or hidden on their own |
| Long text | a \`document\` property, on entity types only | not on relation types: a relation's properties cannot be documents |

## Applying it with the modeling tools

Start with \`get_schema\`: reuse an entity type that already describes the thing rather
than creating a second one.

**As a property:** \`add_property\` with \`type_kind\` \`entity_type\`, \`type_key\`, \`key\`,
\`display_name\`, \`data_type\`, and optionally \`required\` and \`default_value\`. On a lens
whose inclusion lists properties, a new required property without a default needs
\`cascade\`.

**As a relation:**

1. \`create_entity_type\` for the target if none fits. It gets its \`string\` name
   property \`name\`, which also identifies its entities for data loads unless you choose
   another key: for a separate natural key, \`add_property\` first, then
   \`update_entity_type\` with \`identity_properties\`.
2. \`create_relation_type\` with \`key\`, \`display_name\`, \`source_entity_type_key\`,
   \`target_entity_type_key\`. Turn \`one_per_pair\` on for a plain link such as membership
   or location. Set \`parent\` (\`source\` or \`target\`) only for a containment hierarchy:
   each entity has at most one parent across all parent relations.
3. \`add_property\` with \`type_kind\` \`relation_type\` for facts that belong to the link
   (R4).
4. An unscoped lens shows the new types at once. On a scoped lens, read the lens
   first and add only what is missing: a lens that lists entity types but no relation
   types already shows every relation type between them, and a first
   \`add_relation_type_to_lens\` hides the others. The skill \`lens-scoping\` has the rules.
5. \`validate_schema\` at the end.

## Examples

- **An employee's department.** A department has a name, a head and a cost centre
  (R1), many employees share it and a rename must reach all of them (R2), and people ask
  "who works in Sales?" (R5). Verdict: relation (R1, R2, R5). Create \`department\`, then
  \`works_in\` from \`employee\` to \`department\` with \`one_per_pair\` on. A relation cannot
  be required (P1): find employees without a department with the filter
  \`works_in__missing\` set to true.
- **An employee's hire date.** A date describing only this employee (P2), possibly
  required (P1). Verdict: property, \`hire_date\` of data type \`date\`.
- **Skills with a level.** An employee has several skills (R3), each skill is shared
  (R2) and the level belongs to the pair (R4). Verdict: relation (R2, R3, R4):
  \`has_skill\` from \`employee\` to \`skill\` with an \`integer\` property \`level\` on the
  relation type.
- **An order's status.** A short code from a small set, describing only this order
  (P2), changed often. Verdict: property, a \`string\` \`status\` with a default. Make it a
  relation only when statuses gain facts of their own (R1).
`;
