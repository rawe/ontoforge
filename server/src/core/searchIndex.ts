/**
 * Search index definitions: the wire format, its validation against the
 * schema, the managed definitions derived from the schema, and the
 * definition hash that identifies a generation.
 *
 * Pure — no storage, no I/O. The root of an index is always an entity
 * type and every hit is an entity; relation groups enrich the entity with
 * one relation instance per entry, never a combination of them.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { KEY_PATTERN, MAX_KEY_LENGTH, type PropertyDef } from "./schemas.js";

/** Most fields one custom index reads: own, relation and target fields together. */
export const MAX_INDEX_FIELDS = 12;

/** Most relation groups one custom index holds. */
export const MAX_RELATION_GROUPS = 4;

/**
 * Separates the entity type key from the suffix in a managed index key
 * (`person~default`, `person~bio`). No key pattern allows it, so a managed
 * key never collides with a user key.
 */
export const MANAGED_KEY_SEPARATOR = "~";

/** Suffix of a default index key. */
export const DEFAULT_INDEX_SUFFIX = "default";

/** Data types an index renders as text. `document` is allowed only as
 * the root's own field, at most once (→ passages). */
const TEXT_DATA_TYPES = new Set(["string", "integer", "float", "boolean", "date", "datetime"]);

const Key = z.string().regex(KEY_PATTERN).max(MAX_KEY_LENGTH);

export const RelationDirection = z.enum(["outgoing", "incoming"]);
export type RelationDirection = z.infer<typeof RelationDirection>;

/** One relation type in one direction: its relation fields and the fields
 * of the entity on the other end, keyed by that entity's type. */
export const RelationGroup = z.object({
  relationType: Key,
  direction: RelationDirection,
  fields: z.array(Key).default([]),
  target: z.record(Key, z.array(Key)).default({}),
  /** Null: the relation type's display name. */
  label: z.string().nullable().default(null),
  template: z.string().nullable().default(null),
});
export type RelationGroup = z.infer<typeof RelationGroup>;

/**
 * The wire format of a custom index. `key` follows the shared key rules,
 * so it can never be a managed key. `header` null means the root type's
 * name property; an empty list means no header.
 */
export const SearchIndexDefinition = z.object({
  key: Key,
  name: z.string().min(1),
  description: z
    .string()
    .refine((text) => text.trim().length > 0, {
      message: "Describe what the index finds — agents choose indices by it.",
    }),
  entityType: Key,
  fields: z.array(Key).default([]),
  header: z.array(Key).nullable().default(null),
  relations: z.array(RelationGroup).default([]),
  semantic: z
    .object({
      enabled: z.boolean().default(true),
      template: z.string().nullable().default(null),
    })
    .default({ enabled: true, template: null }),
  keyword: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
});
export type SearchIndexDefinition = z.infer<typeof SearchIndexDefinition>;

export type SearchIndexKind = "default" | "passage" | "custom";

export type SearchRepresentation = "semantic" | "keyword";

// ---------------------------------------------------------------------------
// The schema an index is read against
// ---------------------------------------------------------------------------

type IndexProperty = Pick<PropertyDef, "key" | "displayName" | "dataType">;

/** What an index reads of the schema. The runtime's full schema
 * (`SchemaCacheValue`) satisfies it. */
export interface SearchIndexSchema {
  entityTypes: Record<
    string,
    {
      key: string;
      displayName: string;
      nameProperty: string | null;
      properties: Record<string, IndexProperty>;
    }
  >;
  relationTypes: Record<
    string,
    {
      key: string;
      displayName: string;
      fromEntityTypeKey: string;
      toEntityTypeKey: string;
      properties: Record<string, IndexProperty>;
    }
  >;
}

type IndexEntityType = SearchIndexSchema["entityTypes"][string];

// ---------------------------------------------------------------------------
// Keys and header
// ---------------------------------------------------------------------------

/** The key of a managed index: `<entityTypeKey>~<suffix>`. */
export function managedIndexKey(entityTypeKey: string, suffix: string): string {
  return `${entityTypeKey}${MANAGED_KEY_SEPARATOR}${suffix}`;
}

/** Whether a key names a managed index — user keys never contain `~`. */
export function isManagedIndexKey(key: string): boolean {
  return key.includes(MANAGED_KEY_SEPARATOR);
}

/**
 * The header an index renders: the declared one, else the root type's
 * name property, else the first string field of the index.
 */
export function effectiveHeader(
  definition: Pick<SearchIndexDefinition, "header" | "fields">,
  root: Pick<IndexEntityType, "nameProperty" | "properties">,
): string[] {
  if (definition.header !== null) return definition.header;
  if (root.nameProperty !== null) return [root.nameProperty];
  const firstString = definition.fields.find((f) => root.properties[f]?.dataType === "string");
  return firstString === undefined ? [] : [firstString];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** One validation failure: a dotted path into the definition and a message
 * — the shape of the schema validation errors. */
export interface SearchIndexIssue {
  path: string;
  message: string;
}

/**
 * Validate a custom index against the full schema. Returns every issue,
 * empty when the definition is valid. The limits apply to custom indices
 * only; managed definitions are derived and never validated here.
 */
export function validateSearchIndex(
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
): SearchIndexIssue[] {
  const issues: SearchIndexIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });

  if (!definition.semantic.enabled && !definition.keyword.enabled) {
    issue("semantic.enabled", "At least one of semantic and keyword must be enabled");
  }
  if (definition.fields.length === 0 && definition.relations.length === 0) {
    issue("fields", "An index needs at least one field or relation group");
  }
  if (definition.relations.length > MAX_RELATION_GROUPS) {
    issue("relations", `An index holds at most ${MAX_RELATION_GROUPS} relation groups`);
  }
  const fieldCount =
    definition.fields.length +
    definition.relations.reduce(
      (sum, group) =>
        sum + group.fields.length + Object.values(group.target).reduce((n, f) => n + f.length, 0),
      0,
    );
  if (fieldCount > MAX_INDEX_FIELDS) {
    issue(
      "fields",
      `An index reads at most ${MAX_INDEX_FIELDS} fields (own, relation and target ` +
        `fields together); this one reads ${fieldCount}`,
    );
  }

  const root = schema.entityTypes[definition.entityType];
  if (root === undefined) {
    issue("entityType", `Entity type '${definition.entityType}' does not exist`);
    return issues;
  }

  // Own fields: text types, and at most one document.
  let documentSeen = false;
  checkFields(definition.fields, "fields", root, `entity type '${root.key}'`, issue, (key, path) => {
    if (root.properties[key]!.dataType !== "document") return true;
    if (documentSeen) {
      issue(path, "An index reads at most one document field");
    }
    documentSeen = true;
    return false;
  });

  if (definition.header !== null) {
    checkFields(definition.header, "header", root, `entity type '${root.key}'`, issue);
  }

  const groupsSeen = new Set<string>();
  definition.relations.forEach((group, i) => {
    const path = `relations.${i}`;
    const relationType = schema.relationTypes[group.relationType];
    if (relationType === undefined) {
      issue(`${path}.relationType`, `Relation type '${group.relationType}' does not exist`);
      return;
    }
    const outgoing = group.direction === "outgoing";
    const rootEnd = outgoing ? relationType.fromEntityTypeKey : relationType.toEntityTypeKey;
    const otherEnd = outgoing ? relationType.toEntityTypeKey : relationType.fromEntityTypeKey;
    if (rootEnd !== root.key) {
      issue(
        `${path}.direction`,
        `Relation type '${relationType.key}' does not ${outgoing ? "start" : "end"} at ` +
          `entity type '${root.key}'`,
      );
      return;
    }
    const groupKey = `${group.relationType}/${group.direction}`;
    if (groupsSeen.has(groupKey)) {
      issue(
        path,
        `Relation type '${relationType.key}' is already grouped in direction '${group.direction}'`,
      );
    }
    groupsSeen.add(groupKey);

    checkFields(group.fields, `${path}.fields`, relationType, `relation type '${relationType.key}'`, issue);

    let targetFieldCount = 0;
    for (const [targetKey, targetFields] of Object.entries(group.target)) {
      const targetPath = `${path}.target.${targetKey}`;
      const target = schema.entityTypes[targetKey];
      if (target === undefined || targetKey !== otherEnd) {
        issue(
          targetPath,
          `Entity type '${targetKey}' is not on the other end of relation type '${relationType.key}'`,
        );
        continue;
      }
      targetFieldCount += targetFields.length;
      checkFields(targetFields, targetPath, target, `entity type '${target.key}'`, issue);
    }
    if (group.fields.length === 0 && targetFieldCount === 0) {
      issue(path, "A relation group needs at least one relation or target field");
    }
  });

  return issues;
}

/**
 * Check a field list against its owner: every field exists, is rendered
 * as text, and appears once. `allowOther` may accept a data type the text
 * rule rejects (the root's document field); it returns true to fall
 * through to the text rule.
 */
function checkFields(
  fields: readonly string[],
  path: string,
  owner: { properties: Record<string, IndexProperty> },
  ownerLabel: string,
  issue: (path: string, message: string) => void,
  allowOther?: (key: string, path: string) => boolean,
): void {
  const seen = new Set<string>();
  fields.forEach((key, i) => {
    const fieldPath = `${path}.${i}`;
    if (seen.has(key)) {
      issue(fieldPath, `Duplicate field '${key}'`);
      return;
    }
    seen.add(key);
    const property = owner.properties[key];
    if (property === undefined) {
      issue(fieldPath, `Property '${key}' does not exist on ${ownerLabel}`);
      return;
    }
    if (allowOther !== undefined && !allowOther(key, fieldPath)) return;
    if (!TEXT_DATA_TYPES.has(property.dataType)) {
      issue(fieldPath, `Property '${key}' of data type '${property.dataType}' cannot be indexed here`);
    }
  });
}

// ---------------------------------------------------------------------------
// Schema removals (the cascade)
// ---------------------------------------------------------------------------

/** A schema element about to be deleted, as the custom indices see it. */
export type SchemaRemoval =
  | { kind: "entityType"; key: string }
  | { kind: "relationType"; key: string }
  | { kind: "property"; owner: "entityType" | "relationType"; ownerKey: string; key: string };

/** What a removal does to the custom indices: definitions that change,
 * and keys of indices left with nothing to read (or rooted on a deleted
 * type), which go. */
export interface SearchIndexCascade {
  updated: SearchIndexDefinition[];
  deleted: string[];
}

/**
 * The custom indices a schema removal reaches, and what remains of them:
 * an index rooted on a deleted entity type goes; target entries naming
 * it, groups on a deleted relation type and fields reading a deleted
 * property are removed; a group left with no relation or target field is
 * removed, and an index left with no field and no group goes. Managed
 * indices follow the schema by themselves and are never passed here.
 */
export function planSearchIndexCascade(
  definitions: readonly SearchIndexDefinition[],
  removal: SchemaRemoval,
): SearchIndexCascade {
  const cascade: SearchIndexCascade = { updated: [], deleted: [] };
  for (const definition of definitions) {
    const pruned = pruneDefinition(definition, removal);
    if (pruned === null) {
      cascade.deleted.push(definition.key);
    } else if (!definitionsEqual(pruned, definition)) {
      cascade.updated.push(pruned);
    }
  }
  return cascade;
}

/** The keys a cascade touches, sorted — `CASCADE_REQUIRED`'s `affectedIndices`. */
export function cascadeIndexKeys(cascade: SearchIndexCascade): string[] {
  return [...cascade.deleted, ...cascade.updated.map((d) => d.key)].sort();
}

/** One definition without what a removal takes; null when nothing is left
 * (or its root type goes). */
function pruneDefinition(
  definition: SearchIndexDefinition,
  removal: SchemaRemoval,
): SearchIndexDefinition | null {
  if (removal.kind === "entityType" && definition.entityType === removal.key) return null;

  const without = (fields: string[], key: string) => fields.filter((f) => f !== key);
  const ownProperty =
    removal.kind === "property" && removal.owner === "entityType" && removal.ownerKey === definition.entityType
      ? removal.key
      : null;

  const relations = definition.relations
    .filter((group) => !(removal.kind === "relationType" && group.relationType === removal.key))
    .map((group) => {
      const fields =
        removal.kind === "property" && removal.owner === "relationType" && removal.ownerKey === group.relationType
          ? without(group.fields, removal.key)
          : group.fields;
      const target: Record<string, string[]> = {};
      for (const [targetType, targetFields] of Object.entries(group.target)) {
        if (removal.kind === "entityType" && targetType === removal.key) continue;
        if (removal.kind === "property" && removal.owner === "entityType" && removal.ownerKey === targetType) {
          const kept = without(targetFields, removal.key);
          if (kept.length > 0 || targetFields.length === 0) target[targetType] = kept;
          continue;
        }
        target[targetType] = targetFields;
      }
      return { ...group, fields, target };
    })
    .filter(
      (group) =>
        group.fields.length > 0 || Object.values(group.target).some((fields) => fields.length > 0),
    );

  const fields = ownProperty === null ? definition.fields : without(definition.fields, ownProperty);
  const header =
    ownProperty === null || definition.header === null ? definition.header : without(definition.header, ownProperty);
  if (fields.length === 0 && relations.length === 0) return null;
  return { ...definition, fields, header, relations };
}

// ---------------------------------------------------------------------------
// Managed indices
// ---------------------------------------------------------------------------

export interface ManagedSearchIndex {
  kind: "default" | "passage";
  definition: SearchIndexDefinition;
}

/**
 * The managed indices the schema implies, recomputed on every schema
 * change: per entity type a default index over its own string properties
 * (none when it has no string property), and a passage index per document
 * property — both in declaration order, semantic and keyword.
 *
 * A document property keyed `default` would yield the default index's key;
 * it gets no passage index.
 */
export function deriveManagedIndices(schema: SearchIndexSchema): ManagedSearchIndex[] {
  const managed: ManagedSearchIndex[] = [];
  for (const entityType of Object.values(schema.entityTypes)) {
    const properties = Object.values(entityType.properties);
    const strings = properties.filter((p) => p.dataType === "string");
    if (strings.length > 0) {
      managed.push({
        kind: "default",
        definition: managedDefinition(entityType.key, DEFAULT_INDEX_SUFFIX, {
          name: `${entityType.displayName} — default`,
          description:
            `Finds ${entityType.displayName} entities by their own text properties: ` +
            `${strings.map((p) => p.displayName).join(", ")}.`,
          fields: strings.map((p) => p.key),
          header: [],
        }),
      });
    }
    for (const document of properties.filter((p) => p.dataType === "document")) {
      if (document.key === DEFAULT_INDEX_SUFFIX) continue;
      managed.push({
        kind: "passage",
        definition: managedDefinition(entityType.key, document.key, {
          name: `${entityType.displayName} — ${document.displayName} passages`,
          description:
            `Finds ${entityType.displayName} entities by passages of their ` +
            `${document.displayName} document; each passage starts with the entity's name.`,
          fields: [document.key],
          header: null,
        }),
      });
    }
  }
  return managed;
}

function managedDefinition(
  entityTypeKey: string,
  suffix: string,
  parts: Pick<SearchIndexDefinition, "name" | "description" | "fields" | "header">,
): SearchIndexDefinition {
  return {
    key: managedIndexKey(entityTypeKey, suffix),
    entityType: entityTypeKey,
    ...parts,
    relations: [],
    semantic: { enabled: true, template: null },
    keyword: { enabled: true },
  };
}

// ---------------------------------------------------------------------------
// Definition hash
// ---------------------------------------------------------------------------

/**
 * The hash of what a definition contributes to one representation's
 * entries — with the model id (semantic) or the language set (keyword),
 * the identity of a generation. SHA-256 hex over canonical JSON (sorted
 * keys) of the content parts only: key, name, description and the enabled
 * switches change no entry. Templates and group labels belong to the
 * semantic representation alone: keyword entries hold values only
 * (`core/searchComposition.ts`).
 *
 * The definition is hashed as given — schema inputs to the rendered text
 * (display names, the name property behind a null header) are not part of
 * it; their changes re-enqueue entries instead of starting a generation.
 */
export function definitionHash(
  definition: SearchIndexDefinition,
  representation: SearchRepresentation,
): string {
  const content: Record<string, unknown> = {
    entityType: definition.entityType,
    fields: definition.fields,
    header: definition.header,
    relations: definition.relations.map((group) => ({
      relationType: group.relationType,
      direction: group.direction,
      fields: group.fields,
      target: group.target,
      ...(representation === "semantic" ? { label: group.label, template: group.template } : {}),
    })),
  };
  if (representation === "semantic") {
    content.template = definition.semantic.template;
  }
  return createHash("sha256")
    .update(canonicalJson({ representation, content }))
    .digest("hex");
}

/** Whether two definitions are the same, whatever their key order — a
 * stored definition comes back from storage with its keys reordered. */
export function definitionsEqual(a: SearchIndexDefinition, b: SearchIndexDefinition): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** JSON with object keys sorted at every level; array order is kept. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
