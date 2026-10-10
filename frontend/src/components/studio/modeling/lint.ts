/**
 * Schema lint — pure, unit-tested with `node --test`. Live, non-blocking
 * quality hints computed from the schema already loaded: warnings only, no
 * request, never in the way of a write.
 */

import type { SchemaSelection } from '../schema/schemaUrl'
import type { ModelSchema } from './useModelSchema'

export type IssueKind = 'no-description' | 'isolated' | 'only-name'

export interface Issue {
  /** Stable across runs: kind plus the id of the type or property. */
  id: string
  kind: IssueKind
  /** The type the issue belongs to; clicking the issue selects it. */
  target: SchemaSelection
  /** `entityTypeId` / `relationTypeId` of the target. */
  typeId: string
  /** Set when the issue is about one property of the target. */
  propertyId?: string
  propertyKey?: string
  /** The offending item: a type key, or `owner.property`. */
  subject: string
  message: string
}

const blank = (text: string | null) => text === null || text.trim() === ''

export function lintSchema(schema: Pick<ModelSchema, 'entityTypes' | 'relationTypes' | 'properties'>): Issue[] {
  const issues: Issue[] = []
  const used = new Set<string>()
  for (const r of schema.relationTypes) {
    used.add(r.sourceEntityTypeKey)
    used.add(r.targetEntityTypeKey)
  }
  const propertyIssues = (target: SchemaSelection, typeId: string) => {
    for (const p of schema.properties[typeId] ?? []) {
      if (!blank(p.description)) continue
      issues.push({
        id: `desc:p:${p.propertyId}`,
        kind: 'no-description',
        target,
        typeId,
        propertyId: p.propertyId,
        propertyKey: p.key,
        subject: `${target.key}.${p.key}`,
        message: 'Property has no description',
      })
    }
  }

  for (const t of schema.entityTypes) {
    const target: SchemaSelection = { kind: 'entity-types', key: t.key }
    const typeId = t.entityTypeId
    const base = { target, typeId, subject: t.key }
    if (blank(t.description)) {
      issues.push({ ...base, id: `desc:e:${typeId}`, kind: 'no-description', message: 'Entity type has no description' })
    }
    if (!used.has(t.key)) {
      issues.push({ ...base, id: `iso:${typeId}`, kind: 'isolated', message: 'No relation type uses it' })
    }
    const props = schema.properties[typeId]
    if (props !== undefined && props.length <= 1) {
      issues.push({ ...base, id: `name:${typeId}`, kind: 'only-name', message: 'Only the name property' })
    }
    propertyIssues(target, typeId)
  }

  for (const r of schema.relationTypes) {
    const target: SchemaSelection = { kind: 'relation-types', key: r.key }
    const typeId = r.relationTypeId
    if (blank(r.description)) {
      issues.push({
        id: `desc:r:${typeId}`,
        kind: 'no-description',
        target,
        typeId,
        subject: r.key,
        message: 'Relation type has no description',
      })
    }
    propertyIssues(target, typeId)
  }
  return issues
}
