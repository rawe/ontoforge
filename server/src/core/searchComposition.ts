/**
 * Composition: the text of each search entry, from an index definition,
 * the schema and an entity's current state.
 *
 * Pure — no storage, no I/O; the caller reads the entity, its relations
 * and their targets, and chunks its document. An entity yields:
 *
 * - `self` — its type label and own fields; none when no own field has a
 *   value (or `fields` holds only a document).
 * - `relation` — one per relation instance of a relation group: the
 *   header, the group label, the relation's fields and the fields of the
 *   entity on the other end. Never two relations in one entry (D1).
 * - `passage` — one per chunk of the document field: the header and the
 *   chunk text.
 *
 * Semantic entries render as labelled lines with display names:
 *
 * ```
 * Person: Ada Lovelace      ← header block: type label, name merged in
 * Employment                ← group label (default: relation type name)
 * Role: CTO                 ← relation fields
 * Company: ACME             ← target block: target type label, name merged in
 * Founded: 1999
 * ```
 *
 * A block over one type's fields — the self part, the header, the target
 * — starts with the type's display name; when the type's name property
 * is among the fields, its value joins that line (`Person: Ada
 * Lovelace`) instead of a line of its own. An empty header leaves the
 * bare type label. Empty values are omitted; scalars render as text,
 * datetimes as ISO.
 *
 * Keyword entries hold the values only, in the same order, one per line
 * — no type, field or group label — so a schema label never counts as
 * matching content (`docs/decisions.md`, "Property keyword content
 * contains values, not schema labels").
 *
 * Templates (`semantic.template` for the self part, `relations[].template`
 * per relation part) replace the labelled lines of semantic entries; a
 * keyword entry never depends on a template (`definitionHash`).
 */

import type { SearchPartKind } from "./ports.js";
import { capEntryText } from "./searchEntry.js";
import { effectiveHeader, type SearchIndexDefinition, type SearchIndexSchema } from "./searchIndex.js";

/** Data types rendered as text; anything else is never rendered. */
const TEXT_DATA_TYPES = new Set(["string", "integer", "float", "boolean", "date", "datetime"]);

type IndexEntityType = SearchIndexSchema["entityTypes"][string];
type IndexRelationType = SearchIndexSchema["relationTypes"][string];
type Values = Record<string, unknown>;

/** An entity as composition reads it: its id and current property values. */
export interface ComposeEntity {
  id: string;
  properties: Values;
}

/** One relation instance of a group, with the entity on its other end. */
export interface ComposeRelation {
  id: string;
  properties: Values;
  target: ComposeEntity & { typeKey: string };
}

/** One chunk of the document field (`runtime/search/chunking.ts`). */
export interface ComposeChunk {
  startChar: number;
  charLength: number;
  text: string;
}

/** One entry's worth of text, before hashing. */
export interface ComposedPart {
  partKind: SearchPartKind;
  /** The relation group's position in the definition; 0 for self and
   * passages. */
  groupNo: number;
  /** The relation id of a relation part, the chunk ordinal of a passage,
   * `""` for self. */
  partId: string;
  relationType: string | null;
  targetType: string | null;
  targetId: string | null;
  startChar: number | null;
  charLength: number | null;
  /** The values only, one per line — what keyword entries hold. */
  keywordText: string;
  /** The template rendering where the definition has one, else the
   * labelled lines — what semantic entries hold. */
  semanticText: string;
}

// ---------------------------------------------------------------------------
// What a definition reads
// ---------------------------------------------------------------------------

/** The root's document field, if the index reads one. */
export function documentField(
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
): string | null {
  const root = schema.entityTypes[definition.entityType];
  return definition.fields.find((key) => root?.properties[key]?.dataType === "document") ?? null;
}

/** The root's own fields rendered as text — `fields` without the document. */
export function ownTextFields(
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
): string[] {
  const root = schema.entityTypes[definition.entityType];
  return definition.fields.filter((key) => isTextField(root, key));
}

/** The header the parts carry, against the current schema. */
export function headerFields(
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
): string[] {
  const root = schema.entityTypes[definition.entityType];
  if (root === undefined) return [];
  return effectiveHeader(definition, root).filter((key) => isTextField(root, key));
}

/** The entity type on the other end of a relation group; null when the
 * relation type no longer exists. */
export function groupTargetType(
  definition: SearchIndexDefinition,
  groupNo: number,
  schema: SearchIndexSchema,
): string | null {
  const group = definition.relations[groupNo];
  const relationType = group === undefined ? undefined : schema.relationTypes[group.relationType];
  if (group === undefined || relationType === undefined) return null;
  return group.direction === "outgoing" ? relationType.toEntityTypeKey : relationType.fromEntityTypeKey;
}

/** The target fields of a group rendered as text. */
export function groupTargetFields(
  definition: SearchIndexDefinition,
  groupNo: number,
  schema: SearchIndexSchema,
): string[] {
  const targetType = groupTargetType(definition, groupNo, schema);
  if (targetType === null) return [];
  const fields = definition.relations[groupNo]!.target[targetType] ?? [];
  return fields.filter((key) => isTextField(schema.entityTypes[targetType], key));
}

/** The placeholders of a template: `{field}` and `{target.field}`. */
export function templatePlaceholders(
  template: string | null,
): { field: string; target: boolean }[] {
  if (template === null) return [];
  return [...template.matchAll(PLACEHOLDER)].map((match) => ({
    field: match[2]!,
    target: match[1] !== undefined,
  }));
}

function isTextField(type: { properties: IndexEntityType["properties"] } | undefined, key: string): boolean {
  const property = type?.properties[key];
  return property !== undefined && TEXT_DATA_TYPES.has(property.dataType);
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** The `self` part, or null when the index has no own text field or none
 * of them has a value. */
export function composeSelf(
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
  entity: ComposeEntity,
): ComposedPart | null {
  const root = schema.entityTypes[definition.entityType];
  const fields = ownTextFields(definition, schema);
  if (root === undefined || !fields.some((key) => renderValue(entity.properties[key]) !== null)) {
    return null;
  }
  const labelled = cap(block(root, fields, entity.properties).join("\n"));
  const header = headerFields(definition, schema);
  const resolve = (field: string, target: boolean): string | null =>
    !target && (fields.includes(field) || header.includes(field))
      ? renderValue(entity.properties[field])
      : null;
  return {
    partKind: "self",
    groupNo: 0,
    partId: "",
    relationType: null,
    targetType: null,
    targetId: null,
    startChar: null,
    charLength: null,
    keywordText: cap(blockValues(root, fields, entity.properties).join("\n")),
    semanticText: semanticText(definition.semantic.template, resolve, labelled),
  };
}

/** The `relation` part of one relation instance in group `groupNo`; null
 * when the group or its types no longer exist. */
export function composeRelation(
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
  entity: ComposeEntity,
  groupNo: number,
  relation: ComposeRelation,
): ComposedPart | null {
  const group = definition.relations[groupNo];
  const root = schema.entityTypes[definition.entityType];
  const relationType = group === undefined ? undefined : schema.relationTypes[group.relationType];
  const targetType = groupTargetType(definition, groupNo, schema);
  const target = targetType === null ? undefined : schema.entityTypes[targetType];
  if (group === undefined || root === undefined || relationType === undefined || target === undefined) {
    return null;
  }
  const header = headerFields(definition, schema);
  const relationFields = group.fields.filter((key) => isTextField(relationType, key));
  const targetFields = groupTargetFields(definition, groupNo, schema);

  const lines = [
    ...block(root, header, entity.properties),
    group.label ?? relationType.displayName,
    ...fieldLines(relationType, relationFields, relation.properties),
  ];
  if (targetFields.length > 0) {
    lines.push(...block(target, targetFields, relation.target.properties));
  }
  const labelled = cap(lines.join("\n"));
  const values = [
    ...blockValues(root, header, entity.properties),
    ...fieldValues(relationFields, relation.properties),
    ...blockValues(target, targetFields, relation.target.properties),
  ];

  const own = new Set([...header, ...ownTextFields(definition, schema)]);
  const resolve = (field: string, isTarget: boolean): string | null => {
    if (isTarget) {
      return targetFields.includes(field) ? renderValue(relation.target.properties[field]) : null;
    }
    if (relationFields.includes(field)) return renderValue(relation.properties[field]);
    return own.has(field) ? renderValue(entity.properties[field]) : null;
  };
  return {
    partKind: "relation",
    groupNo,
    partId: relation.id,
    relationType: relationType.key,
    targetType: target.key,
    targetId: relation.target.id,
    startChar: null,
    charLength: null,
    keywordText: cap(values.join("\n")),
    semanticText: semanticText(group.template, resolve, labelled),
  };
}

/** The `passage` parts: one per chunk, the chunk ordinal as part id. */
export function composePassages(
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
  entity: ComposeEntity,
  chunks: ComposeChunk[],
): ComposedPart[] {
  const root = schema.entityTypes[definition.entityType];
  if (root === undefined) return [];
  const fields = headerFields(definition, schema);
  const labelled = block(root, fields, entity.properties);
  const values = blockValues(root, fields, entity.properties);
  return chunks.map((chunk, ordinal) => {
    return {
      partKind: "passage",
      groupNo: 0,
      partId: String(ordinal),
      relationType: null,
      targetType: null,
      targetId: null,
      startChar: chunk.startChar,
      charLength: chunk.charLength,
      keywordText: cap([...values, chunk.text].join("\n")),
      semanticText: cap([...labelled, chunk.text].join("\n")),
    };
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** A value as entry text; null when there is nothing to render. */
export function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** A block over one type's fields: the type label line — carrying the
 * name property's value when it is among the fields — then the other
 * fields as labelled lines. */
function block(type: IndexEntityType, fields: string[], values: Values): string[] {
  const name = type.nameProperty !== null && fields.includes(type.nameProperty)
    ? renderValue(values[type.nameProperty])
    : null;
  const label = name === null ? type.displayName : `${type.displayName}: ${name}`;
  return [label, ...fieldLines(type, fields.filter((key) => key !== type.nameProperty), values)];
}

/** The values of a block, in the block's order: the name first. */
function blockValues(type: IndexEntityType, fields: string[], values: Values): string[] {
  const ordered =
    type.nameProperty !== null && fields.includes(type.nameProperty)
      ? [type.nameProperty, ...fields.filter((key) => key !== type.nameProperty)]
      : fields;
  return fieldValues(ordered.filter((key) => type.properties[key] !== undefined), values);
}

function fieldValues(fields: string[], values: Values): string[] {
  return fields.map((key) => renderValue(values[key])).filter((value) => value !== null);
}

function fieldLines(
  type: IndexEntityType | IndexRelationType,
  fields: string[],
  values: Values,
): string[] {
  const lines: string[] = [];
  for (const key of fields) {
    const value = renderValue(values[key]);
    const property = type.properties[key];
    if (value !== null && property !== undefined) {
      lines.push(`${property.displayName}: ${value}`);
    }
  }
  return lines;
}

function cap(text: string): string {
  return capEntryText(text);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{(target\.)?([^{}\s.]+)\}/g;

/** A clause ends at one of these characters (kept with it) or at the end
 * of the template; a placeholder's own dot (`{target.name}`) ends none. */
const CLAUSE = /(?:\{[^{}]*\}|\{|[^,;.\n{])*(?:[,;.\n]|$)/g;

/**
 * Render a template: each placeholder is replaced by its value; a clause
 * holding a placeholder without a value is dropped whole. A clause is the
 * template text up to and including the next `,` `;` `.` or line break —
 * the template is split before values are inserted, so a value's own
 * punctuation never splits anything. Leftover separators at the start or
 * end are trimmed. Null when nothing is left.
 */
export function renderTemplate(
  template: string,
  resolve: (field: string, target: boolean) => string | null,
): string | null {
  const kept: string[] = [];
  for (const clause of template.match(CLAUSE) ?? []) {
    let missing = false;
    const rendered = clause.replace(PLACEHOLDER, (_match, target: string | undefined, field: string) => {
      const value = resolve(field, target !== undefined);
      if (value === null) missing = true;
      return value ?? "";
    });
    if (!missing) kept.push(rendered);
  }
  const text = kept
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/^[\s,;.]+/, "")
    .replace(/[\s,;]+$/, "");
  return text === "" ? null : text;
}

function semanticText(
  template: string | null,
  resolve: (field: string, target: boolean) => string | null,
  fallback: string,
): string {
  if (template === null) return fallback;
  const rendered = renderTemplate(template, resolve);
  return rendered === null ? fallback : cap(rendered);
}
