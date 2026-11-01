/**
 * The search index editor as a draft the Studio helper fills: its values
 * by field, and each field's value as the "changed by AI" diff shows it.
 * The helper proposes whole parts of the definition — the relation groups
 * at once, the semantic settings at once — so equality is nested and
 * order-aware (`sameNested`): the order of fields decides the text.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { SearchIndexDefinition, SearchIndexRelationGroup } from '@/api/types'
import { toDiffValue, type DiffValue } from '../../lib/valueDiff.ts'

/** The editor's fillable values: every part of the definition. */
export type IndexFields = { [K in keyof SearchIndexDefinition]: SearchIndexDefinition[K] }

export const indexFields = (draft: SearchIndexDefinition): IndexFields => ({ ...draft })

export const withIndexFields = (draft: SearchIndexDefinition, fields: IndexFields): SearchIndexDefinition => ({ ...draft, ...fields })

/** One relation group as one line: the relation and direction, then what it reads. */
export function groupLine(group: SearchIndexRelationGroup): string {
  const parts = [`${group.relationType} (${group.direction})`]
  if (group.fields.length > 0) parts.push(`fields: ${group.fields.join(', ')}`)
  for (const [type, keys] of Object.entries(group.target)) parts.push(`${type}: ${keys.join(', ')}`)
  if (group.label !== null && group.label !== '') parts.push(`label: ${group.label}`)
  if (group.template !== null && group.template !== '') parts.push(`template: ${group.template}`)
  return parts.join(' · ')
}

const onOff = (enabled: boolean) => (enabled ? 'On' : 'Off')

/** A list as one line per item: the diff then compares lines, so a change of order shows. */
const lines = (items: readonly string[]) => items.join('\n')

/** How the diff shows a value of `field`. Lists are ordered here — their order decides the text — so they show as lines, not as a set. */
export function indexDiffValue(field: keyof SearchIndexDefinition): (value: unknown) => DiffValue {
  switch (field) {
    case 'fields':
      return (value) => (Array.isArray(value) ? lines(value.map(String)) : toDiffValue(value))
    case 'header':
      return (value) => (value === null ? 'Name property' : Array.isArray(value) && value.length === 0 ? 'None' : Array.isArray(value) ? lines(value.map(String)) : toDiffValue(value))
    case 'relations':
      return (value) => (Array.isArray(value) ? lines((value as SearchIndexRelationGroup[]).map(groupLine)) : toDiffValue(value))
    case 'semantic':
      return (value) => {
        const semantic = value as SearchIndexDefinition['semantic'] | undefined
        if (semantic === undefined || semantic === null) return toDiffValue(value)
        return semantic.template === null || semantic.template === ''
          ? onOff(semantic.enabled)
          : `${onOff(semantic.enabled)}\nTemplate: ${semantic.template}`
      }
    case 'keyword':
      return (value) => {
        const keyword = value as SearchIndexDefinition['keyword'] | undefined
        return keyword === undefined || keyword === null ? toDiffValue(value) : onOff(keyword.enabled)
      }
    default:
      return toDiffValue
  }
}
