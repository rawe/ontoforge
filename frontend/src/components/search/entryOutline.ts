/**
 * Pure helpers for the entry outline: the server composes each entry kind
 * of a draft with tokens — `⟦root.x⟧`, `⟦relation.x⟧`, `⟦target.x⟧`,
 * `⟦passage⟧` — standing in for the values; these turn the text into
 * segments the designer renders, and list what a draft leaves out.
 */
import type { OutlinePart, SearchIndexDefinition, SearchIndexRelationGroup } from '@/api/types'
import {
  isTextProperty,
  type IndexSchema,
  type IndexSchemaEntityType,
  type IndexSchemaProperty,
} from './searchIndexModel.ts'

export type FieldOwner = 'root' | 'relation' | 'target'

export type OutlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'field'; owner: FieldOwner; key: string }
  | { kind: 'passage' }

const TOKEN = /⟦(?:(root|relation|target)\.([^⟧]+)|passage)⟧/g

/** An outline text as lines of segments: literal text and field tokens. */
export function outlineLines(text: string): OutlineSegment[][] {
  return text.split('\n').map((line) => {
    const segments: OutlineSegment[] = []
    let last = 0
    for (const match of line.matchAll(TOKEN)) {
      if (match.index > last) segments.push({ kind: 'text', text: line.slice(last, match.index) })
      segments.push(
        match[1] === undefined
          ? { kind: 'passage' }
          : { kind: 'field', owner: match[1] as FieldOwner, key: match[2]! },
      )
      last = match.index + match[0].length
    }
    if (last < line.length) segments.push({ kind: 'text', text: line.slice(last) })
    return segments
  })
}

/** The outline part of the self entry, a relation group or the passages. */
export function outlinePart(
  outline: readonly OutlinePart[] | null | undefined,
  kind: OutlinePart['partKind'],
  groupNo: number | null = null,
): OutlinePart | undefined {
  return outline?.find((p) => p.partKind === kind && p.groupNo === groupNo)
}

/** The entity types and relation type the tokens of one part refer to. */
export interface PartTypes {
  root: IndexSchemaEntityType | undefined
  relation: IndexSchema['relationTypes'][number] | undefined
  target: IndexSchemaEntityType | undefined
}

export function partTypes(schema: IndexSchema, rootKey: string, part: OutlinePart): PartTypes {
  return {
    root: schema.entityTypes.find((t) => t.key === rootKey),
    relation: schema.relationTypes.find((r) => r.key === part.relationType),
    target: schema.entityTypes.find((t) => t.key === part.targetType),
  }
}

/** The display name of a token's field and of the type that owns it — the
 * far end of a relation from a type to itself is the "other" one. */
export function fieldNames(
  types: PartTypes,
  owner: FieldOwner,
  key: string,
): { field: string; owner: string } {
  const type = types[owner]
  const name = type?.displayName ?? owner
  const other = owner === 'target' && type !== undefined && type.key === types.root?.key
  return {
    field: type?.properties.find((p) => p.key === key)?.displayName ?? key,
    owner: other ? `other ${name}` : name,
  }
}

/** Text properties of `properties` not among `selected`. */
export function notSelected(
  properties: readonly IndexSchemaProperty[],
  selected: readonly string[],
): IndexSchemaProperty[] {
  return properties.filter((p) => isTextProperty(p) && !selected.includes(p.key))
}

/** The root's own fields a template may name: own text fields and header fields. */
function ownPlaceholders(draft: SearchIndexDefinition, root: IndexSchemaEntityType): string[] {
  const header = draft.header ?? [root.nameProperty]
  const text = new Set(root.properties.filter(isTextProperty).map((p) => p.key))
  return [...new Set([...draft.fields, ...header])].filter((k) => text.has(k))
}

/** Placeholders the self template can resolve, in braces. */
export function selfPlaceholders(draft: SearchIndexDefinition, root: IndexSchemaEntityType): string[] {
  return ownPlaceholders(draft, root).map((k) => `{${k}}`)
}

/** Placeholders a relation group's template can resolve: its relation
 * fields, its target fields, then the root's own and header fields. */
export function groupPlaceholders(
  draft: SearchIndexDefinition,
  root: IndexSchemaEntityType,
  group: SearchIndexRelationGroup,
): string[] {
  const target = Object.values(group.target)[0] ?? []
  const relation = new Set(group.fields)
  return [
    ...group.fields.map((k) => `{${k}}`),
    ...target.map((k) => `{target.${k}}`),
    ...ownPlaceholders(draft, root)
      .filter((k) => !relation.has(k))
      .map((k) => `{${k}}`),
  ]
}

/** `text` with `insert` put in place of the selection `[start, end)`. */
export function insertAt(text: string, insert: string, start: number, end: number): string {
  return text.slice(0, start) + insert + text.slice(end)
}

/**
 * How many leading lines of a relation or passage entry are its owner line
 * (the header): in the labelled lines the root type's line — carrying the
 * name property when the header holds it — and one line per other header
 * field; in the keyword text one value per header field. A template's text
 * carries none.
 */
export function ownerLineCounts(
  header: readonly string[] | null,
  root: IndexSchemaEntityType,
): { semantic: number; keyword: number } {
  const text = new Set(root.properties.filter(isTextProperty).map((p) => p.key))
  const fields = (header ?? [root.nameProperty]).filter((k) => text.has(k))
  return { semantic: 1 + fields.filter((k) => k !== root.nameProperty).length, keyword: fields.length }
}
